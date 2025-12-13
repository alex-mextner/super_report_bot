import { llmLight, type LLMMessage } from "./index.ts";
import { llmLog } from "../logger.ts";

export interface EditInterpretationResult {
  positive_keywords: string[];
  negative_keywords: string[];
  llm_description: string;
  summary: string; // Human-readable summary of changes
}

// System prompt template for edit command interpretation
// {language} placeholder for response language
const EDIT_SYSTEM_PROMPT = `You are an assistant for editing Telegram group monitoring subscriptions.
User sends free-form commands to modify subscription parameters.

## Current subscription parameters
- Positive keywords: {positive_keywords}
- Negative keywords: {negative_keywords}
- Description: {llm_description}

## Your task

Interpret user command and return the COMPLETE updated list of parameters.

### Command types

1. **Add keyword**: "добавь аренда", "add rental", "+ word"
   → Add to positive_keywords

2. **Remove keyword**: "убери продажа", "remove sale", "- word"
   → Remove from positive_keywords

3. **Add exclusion**: "исключи коммерческая", "exclude commercial", "minus office"
   → Add to negative_keywords

4. **Remove exclusion**: "убери из исключений посуточно", "remove from exclusions"
   → Remove from negative_keywords

5. **Change description**: "измени описание на ...", "change description to ...", "description: ..."
   → Update llm_description

6. **Combined**: "добавь аренда и убери продажа", "add rental and remove sale"
   → Apply all changes

### Rules

- Keep ALL existing keywords that don't need to be removed
- When adding a keyword, check it's not already in the list (no duplicates)
- Generate summary in {language}: what exactly changed
- If command is unclear, return current values unchanged and summary with clarifying question

## Response format

Respond ONLY with JSON, no additional text:
{
  "positive_keywords": [...],
  "negative_keywords": [...],
  "llm_description": "...",
  "summary": "Added: rental. Removed: sale."
}`;

interface CurrentParams {
  positive_keywords: string[];
  negative_keywords: string[];
  llm_description: string;
}

/**
 * Parse LLM response JSON
 */
function parseEditResponse(
  response: string,
  current: CurrentParams
): EditInterpretationResult {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    llmLog.warn({ response: response.slice(0, 200) }, "Failed to parse edit response");
    return {
      ...current,
      summary: "Could not interpret command. Try rephrasing.",
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      positive_keywords: parsed.positive_keywords || current.positive_keywords,
      negative_keywords: parsed.negative_keywords || current.negative_keywords,
      llm_description: parsed.llm_description || parsed.description || current.llm_description,
      summary: parsed.summary || "Changes applied",
    };
  } catch {
    llmLog.warn({ json: jsonMatch[0].slice(0, 200) }, "Invalid JSON in edit response");
    return {
      ...current,
      summary: "Response parsing error. Try again.",
    };
  }
}

/**
 * Simple command parser for basic operations when all LLMs fail
 * Supports Russian patterns: "+ word", "- word", "добавь word", "убери word", "исключи word"
 */
function trySimpleParser(
  command: string,
  current: CurrentParams
): EditInterpretationResult | null {
  const cmd = command.toLowerCase().trim();

  // Pattern: "+ word" or "добавь word" (Russian: "add word")
  const addMatch = cmd.match(/^(?:\+|добавь|добавить)\s+(.+)$/);
  if (addMatch?.[1]) {
    const word = addMatch[1].trim();
    if (!current.positive_keywords.includes(word)) {
      return {
        positive_keywords: [...current.positive_keywords, word],
        negative_keywords: current.negative_keywords,
        llm_description: current.llm_description,
        summary: `Added: ${word}`,
      };
    }
    return {
      ...current,
      summary: `"${word}" already in list`,
    };
  }

  // Pattern: "- word" or "убери/удали word" (Russian: "remove word")
  const removeMatch = cmd.match(/^(?:-|убери|убрать|удали|удалить)\s+(.+)$/);
  if (removeMatch?.[1]) {
    const word = removeMatch[1].trim();
    if (current.positive_keywords.includes(word)) {
      return {
        positive_keywords: current.positive_keywords.filter((w) => w !== word),
        negative_keywords: current.negative_keywords,
        llm_description: current.llm_description,
        summary: `Removed: ${word}`,
      };
    }
    return {
      ...current,
      summary: `"${word}" not found in list`,
    };
  }

  // Pattern: "исключи word" or "минус word" (Russian: "exclude word" - adds to negative list)
  const excludeMatch = cmd.match(/^(?:исключи|исключить|минус)\s+(.+)$/);
  if (excludeMatch?.[1]) {
    const word = excludeMatch[1].trim();
    if (!current.negative_keywords.includes(word)) {
      return {
        positive_keywords: current.positive_keywords,
        negative_keywords: [...current.negative_keywords, word],
        llm_description: current.llm_description,
        summary: `Excluded: ${word}`,
      };
    }
    return {
      ...current,
      summary: `"${word}" already in exclusions`,
    };
  }

  // Command not recognized
  return null;
}

/**
 * Interpret user's free-form edit command and return updated subscription parameters
 * Uses llmLight with automatic fallbacks (Qwen 72B → Qwen 4B)
 * @param language - language for the summary response (default: Russian)
 */
export async function interpretEditCommand(
  command: string,
  current: CurrentParams,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>,
  language: string = "Russian"
): Promise<EditInterpretationResult> {
  // Build system prompt with current values
  const systemPrompt = EDIT_SYSTEM_PROMPT
    .replace("{positive_keywords}", current.positive_keywords.join(", ") || "none")
    .replace("{negative_keywords}", current.negative_keywords.join(", ") || "none")
    .replace("{llm_description}", current.llm_description || "none")
    .replace("{language}", language);

  // Limit conversation history to last 6 messages to avoid token overflow
  const recentHistory = conversationHistory.slice(-6);

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: command },
  ];

  // Try LLM with automatic fallbacks
  try {
    const response = await llmLight({
      messages,
      maxTokens: 1500,
      temperature: 0.3,
    });
    llmLog.debug({ response: response.slice(0, 200) }, "Edit command via LLM");
    return parseEditResponse(response, current);
  } catch (llmError) {
    llmLog.warn({ error: llmError }, "LLM edit failed, trying simple parser");
  }

  // Final fallback: simple command parser (no LLM)
  const simpleResult = trySimpleParser(command, current);
  if (simpleResult) {
    llmLog.debug({ provider: "simple-parser" }, "Edit command via simple parser");
    return simpleResult;
  }

  // All failed — return current params without error message to user
  llmLog.error("All LLM providers failed for edit, returning unchanged params");
  return {
    ...current,
    summary: "Could not process command. Try simpler: \"+ word\" or \"- word\"",
  };
}
