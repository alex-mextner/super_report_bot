import { hf, MODELS, withRetry } from "./index.ts";
import { llmLog } from "../logger.ts";

const SYSTEM_PROMPT = `You are an assistant for setting up Telegram group monitoring.
The bot will search messages by keywords and notify the user about matches.

Your task is to ask 2-5 short clarifying questions to better understand search parameters.

## IMPORTANT: Your world knowledge is outdated

- Your data may be outdated — new product models come out constantly
- DO NOT assume that a product/model doesn't exist or hasn't been released
- DO NOT ask "is this a typo?" about model names — you don't know the current product lineup
- Accept user's query as-is — they know what they're looking for

## Rules for questions

Each question should be:
- Short and specific (1 sentence)
- In the same language as user's query
- Without numbering

Ask about practical search parameters:
- Specific characteristics (storage, color, size)
- Price range (for products)
- Condition: new/used (for products)
- What to exclude from search
- Region/location (if local search)

DO NOT ask about what's already obvious from the query.
DO NOT ask more than 5 questions.

## Response format

Respond ONLY with JSON, no additional text:
{"questions": ["Question 1?", "Question 2?", "Question 3?"]}`;

export interface ClarificationResult {
  questions: string[];
}

/**
 * Generate clarification questions for a user query using DeepSeek R1
 */
export async function generateClarificationQuestions(query: string): Promise<string[]> {
  const response = await withRetry(async () => {
    const result = await hf.chatCompletion({
      model: MODELS.DEEPSEEK_R1,
      provider: "novita",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });
    return result.choices[0]?.message?.content || "";
  });

  // DeepSeek R1 may include <think>...</think> reasoning blocks — strip them
  const cleanedResponse = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // Parse JSON from response
  const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    llmLog.error({ response: cleanedResponse.slice(0, 200) }, "Failed to parse clarification response");
    throw new Error(`Failed to parse LLM response: ${response}`);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as ClarificationResult;
    const questions = parsed.questions || [];

    // Validate: 2-5 questions
    if (questions.length < 2) {
      llmLog.warn({ count: questions.length }, "Too few clarification questions, padding");
      return ["What specific characteristics are important?", "What should be excluded from search?"];
    }
    if (questions.length > 5) {
      return questions.slice(0, 5);
    }

    return questions;
  } catch (e) {
    llmLog.error({ json: jsonMatch[0].slice(0, 200), error: e }, "Invalid JSON in clarification response");
    throw new Error(`Invalid JSON in LLM response: ${jsonMatch[0]}`);
  }
}

// =====================================================
// Smart query analysis (for normal mode)
// =====================================================

const ANALYZE_QUERY_PROMPT = `You are an assistant for setting up Telegram group monitoring.
Analyze the user query and determine if clarifying questions are needed.

## IMPORTANT: Your world knowledge is outdated
- DO NOT assume that a product/model doesn't exist
- Accept query as-is — user knows what they're looking for

## When to ASK (1-3 questions):
- Product category without specifics: "jeans", "phone", "furniture"
- No price/condition specified for products
- No size/characteristics where it matters
- Too generic query (1-2 words without details)

## When NOT to ask:
- Query contains specifics: brand, model, price, size, color
- Example: "iPhone 15 Pro Max 256gb under $800" — all clear
- Example: "blue Levis jeans size 32" — all clear
- User explicitly stated what they want

## What questions to ask:
- Price range (for products)
- Size/characteristics (where relevant)
- Condition: new/used
- What to exclude from search
DO NOT ask about what's already in the query!

## Response format
ONLY JSON:
{
  "needsClarification": true/false,
  "questions": ["question1", "question2"],
  "reasoning": "why"
}`;

export interface QueryAnalysisResult {
  needsClarification: boolean;
  questions: string[];
  reasoning: string;
}

/**
 * Analyze query and generate clarification questions if needed (for normal mode)
 * Returns 0-3 questions based on query specificity
 */
export async function analyzeQueryAndGenerateQuestions(
  query: string
): Promise<QueryAnalysisResult> {
  const response = await withRetry(async () => {
    const result = await hf.chatCompletion({
      model: MODELS.DEEPSEEK_R1,
      provider: "novita",
      messages: [
        { role: "system", content: ANALYZE_QUERY_PROMPT },
        { role: "user", content: query },
      ],
      max_tokens: 800,
      temperature: 0.5,
    });
    return result.choices[0]?.message?.content || "";
  });

  // Strip thinking tags
  const cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  llmLog.debug({ query, response: cleaned.slice(0, 400) }, "analyzeQuery raw response");

  // Parse JSON
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    llmLog.error({ query, response: cleaned.slice(0, 200) }, "Failed to parse analyzeQuery response");
    // Default: no clarification needed
    return { needsClarification: false, questions: [], reasoning: "parse_error" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result: QueryAnalysisResult = {
      needsClarification: Boolean(parsed.needsClarification),
      questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 3) : [],
      reasoning: parsed.reasoning || "",
    };

    // If needsClarification but no questions — fix it
    if (result.needsClarification && result.questions.length === 0) {
      result.needsClarification = false;
    }

    llmLog.info({
      query,
      needsClarification: result.needsClarification,
      questionsCount: result.questions.length,
      reasoning: result.reasoning,
    }, "analyzeQuery result");

    return result;
  } catch (e) {
    llmLog.error({ query, json: jsonMatch[0].slice(0, 200), error: e }, "Invalid JSON in analyzeQuery response");
    return { needsClarification: false, questions: [], reasoning: "json_error" };
  }
}

/**
 * Format Q&A pairs for keyword generation context
 */
export function formatClarificationContext(questions: string[], answers: string[]): string {
  const pairs: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const answer = answers[i];
    // Skip unanswered (skipped) questions
    if (answer && answer.trim()) {
      pairs.push(`Q: ${questions[i]}\nA: ${answer}`);
    }
  }

  if (pairs.length === 0) {
    return "";
  }

  return `\nUser clarifications:\n${pairs.join("\n\n")}`;
}
