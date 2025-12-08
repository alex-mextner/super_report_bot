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
