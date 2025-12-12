import { llmLight, type LLMMessage } from "./index.ts";
import { llmLog } from "../logger.ts";

export interface EditInterpretationResult {
  positive_keywords: string[];
  negative_keywords: string[];
  llm_description: string;
  summary: string; // Human-readable summary of changes
}

const EDIT_SYSTEM_PROMPT = `Ты помощник для редактирования подписок на мониторинг Telegram-групп.
Пользователь отправляет команды на изменение параметров подписки в свободной форме.

## Текущие параметры подписки
- Позитивные слова: {positive_keywords}
- Негативные слова: {negative_keywords}
- Описание: {llm_description}

## Твоя задача

Интерпретируй команду пользователя и верни ПОЛНЫЙ обновлённый список параметров.

### Типы команд

1. **Добавить слово**: "добавь аренда", "ещё добавь квартира", "+ слово"
   → Добавить в positive_keywords

2. **Убрать слово**: "убери продажа", "удали слово дом", "- слово"
   → Убрать из positive_keywords

3. **Добавить исключение**: "исключи коммерческая", "добавь в негативные офис", "минус офис"
   → Добавить в negative_keywords

4. **Убрать исключение**: "убери из исключений посуточно", "верни посуточно"
   → Убрать из negative_keywords

5. **Изменить описание**: "измени описание на ...", "сделай описание про ...", "описание: ..."
   → Обновить llm_description

6. **Комбинированные**: "добавь аренда и убери продажа"
   → Применить все изменения

### Правила

- Сохраняй ВСЕ существующие слова которые не нужно удалять
- При добавлении слова проверь что его нет в списке (не дублируй)
- Генерируй summary на русском: что именно изменилось
- Если команда непонятна, верни текущие значения без изменений и summary с уточняющим вопросом

## Формат ответа

Ответь ТОЛЬКО JSON без дополнительного текста:
{
  "positive_keywords": [...],
  "negative_keywords": [...],
  "llm_description": "...",
  "summary": "Добавлено: аренда. Удалено: продажа."
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
      summary: "Не удалось интерпретировать команду. Попробуй переформулировать.",
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      positive_keywords: parsed.positive_keywords || current.positive_keywords,
      negative_keywords: parsed.negative_keywords || current.negative_keywords,
      llm_description: parsed.llm_description || parsed.description || current.llm_description,
      summary: parsed.summary || "Изменения применены",
    };
  } catch {
    llmLog.warn({ json: jsonMatch[0].slice(0, 200) }, "Invalid JSON in edit response");
    return {
      ...current,
      summary: "Ошибка парсинга ответа. Попробуй ещё раз.",
    };
  }
}

/**
 * Simple command parser for basic operations when all LLMs fail
 * Supports: "+ слово", "- слово", "добавь слово", "убери слово", "исключи слово"
 */
function trySimpleParser(
  command: string,
  current: CurrentParams
): EditInterpretationResult | null {
  const cmd = command.toLowerCase().trim();

  // Pattern: "+ слово" or "добавь слово"
  const addMatch = cmd.match(/^(?:\+|добавь|добавить)\s+(.+)$/);
  if (addMatch?.[1]) {
    const word = addMatch[1].trim();
    if (!current.positive_keywords.includes(word)) {
      return {
        positive_keywords: [...current.positive_keywords, word],
        negative_keywords: current.negative_keywords,
        llm_description: current.llm_description,
        summary: `Добавлено: ${word}`,
      };
    }
    return {
      ...current,
      summary: `«${word}» уже есть в списке`,
    };
  }

  // Pattern: "- слово" or "убери слово" or "удали слово"
  const removeMatch = cmd.match(/^(?:-|убери|убрать|удали|удалить)\s+(.+)$/);
  if (removeMatch?.[1]) {
    const word = removeMatch[1].trim();
    if (current.positive_keywords.includes(word)) {
      return {
        positive_keywords: current.positive_keywords.filter((w) => w !== word),
        negative_keywords: current.negative_keywords,
        llm_description: current.llm_description,
        summary: `Удалено: ${word}`,
      };
    }
    return {
      ...current,
      summary: `«${word}» не найдено в списке`,
    };
  }

  // Pattern: "исключи слово" or "минус слово" (add to negative)
  const excludeMatch = cmd.match(/^(?:исключи|исключить|минус)\s+(.+)$/);
  if (excludeMatch?.[1]) {
    const word = excludeMatch[1].trim();
    if (!current.negative_keywords.includes(word)) {
      return {
        positive_keywords: current.positive_keywords,
        negative_keywords: [...current.negative_keywords, word],
        llm_description: current.llm_description,
        summary: `Исключено: ${word}`,
      };
    }
    return {
      ...current,
      summary: `«${word}» уже в исключениях`,
    };
  }

  // Command not recognized
  return null;
}

/**
 * Interpret user's free-form edit command and return updated subscription parameters
 * Uses llmLight with automatic fallbacks (Qwen 72B → Qwen 4B)
 */
export async function interpretEditCommand(
  command: string,
  current: CurrentParams,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
): Promise<EditInterpretationResult> {
  // Build system prompt with current values
  const systemPrompt = EDIT_SYSTEM_PROMPT
    .replace("{positive_keywords}", current.positive_keywords.join(", ") || "нет")
    .replace("{negative_keywords}", current.negative_keywords.join(", ") || "нет")
    .replace("{llm_description}", current.llm_description || "нет");

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
    summary: "Не смог обработать команду. Попробуй написать проще, например: «+ слово» или «убери слово»",
  };
}
