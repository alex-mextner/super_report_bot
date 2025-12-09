import { hf, MODELS, withRetry } from "./index.ts";
import { llmLog } from "../logger.ts";

const SYSTEM_PROMPT = `Ты помощник для настройки мониторинга Telegram-групп.
Бот будет искать сообщения по ключевым словам и уведомлять пользователя о совпадениях.

Твоя задача — задать 2-5 коротких уточняющих вопросов чтобы лучше понять параметры поиска.

## ВАЖНО: Твои знания о мире устарели

- Твои данные могут быть неактуальны — новые модели товаров выходят постоянно
- НЕ предполагай что какой-то товар/модель не существует или ещё не вышла
- НЕ спрашивай "это опечатка?" про названия моделей — ты не знаешь актуальный модельный ряд
- Принимай запрос пользователя как есть — он знает что ищет

## Правила для вопросов

Каждый вопрос должен быть:
- Коротким и конкретным (1 предложение)
- На русском языке
- Без нумерации

Спрашивай о практических параметрах поиска:
- Конкретные характеристики (объём памяти, цвет, размер)
- Ценовой диапазон (для товаров)
- Состояние: новый/б/у (для товаров)
- Что нужно исключить из поиска
- Регион/локация (если локальный поиск)

НЕ спрашивай то, что уже очевидно из запроса.
НЕ задавай более 5 вопросов.

## Формат ответа

Ответь ТОЛЬКО JSON без дополнительного текста:
{"questions": ["Вопрос 1?", "Вопрос 2?", "Вопрос 3?"]}`;

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
      return ["Какие конкретные характеристики важны?", "Что нужно исключить из поиска?"];
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

const ANALYZE_QUERY_PROMPT = `Ты помощник для настройки мониторинга Telegram-групп.
Проанализируй запрос пользователя и определи, нужны ли уточняющие вопросы.

## ВАЖНО: Твои знания о мире устарели
- НЕ предполагай что какой-то товар/модель не существует
- Принимай запрос как есть — пользователь знает что ищет

## Когда СПРАШИВАТЬ (1-3 вопроса):
- Категория товара без конкретики: "джинсы", "телефон", "мебель"
- Нет указания на цену/состояние для товаров
- Нет размера/характеристик где это важно
- Слишком общий запрос (1-2 слова без деталей)

## Когда НЕ спрашивать:
- Запрос содержит конкретику: бренд, модель, цена, размер, цвет
- Пример: "iPhone 15 Pro Max 256gb до 80к" — всё понятно
- Пример: "синие джинсы Levis 32 размер" — всё понятно
- Пользователь явно указал что хочет

## Какие вопросы задавать:
- Ценовой диапазон (для товаров)
- Размер/характеристики (где важно)
- Состояние: новый/б/у
- Что исключить из поиска
НЕ спрашивай то, что уже в запросе!

## Формат ответа
ТОЛЬКО JSON:
{
  "needsClarification": true/false,
  "questions": ["вопрос1", "вопрос2"],
  "reasoning": "почему"
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

  return `\nУточнения от пользователя:\n${pairs.join("\n\n")}`;
}
