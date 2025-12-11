import { llmLog } from "../logger.ts";
import type { RatingExample } from "../types.ts";
import { hf, withRetry, MODELS } from "./index.ts";

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

export interface BraveResult {
  title: string;
  url: string;
  description: string;
}

/**
 * Search Brave for product/service examples
 */
export async function searchBrave(query: string, count = 5): Promise<BraveResult[]> {
  if (!BRAVE_API_KEY) {
    llmLog.debug("Brave API key not configured, skipping search");
    return [];
  }

  try {
    const searchQuery = `${query} купить цена`;
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}&count=${count}`,
      {
        headers: {
          "X-Subscription-Token": BRAVE_API_KEY,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      llmLog.warn({ status: response.status }, "Brave search failed");
      return [];
    }

    const data = (await response.json()) as { web?: { results?: BraveResult[] } };
    const results = data.web?.results ?? [];

    llmLog.debug({ query, found: results.length }, "Brave search completed");
    return results;
  } catch (error) {
    llmLog.error({ err: error, query }, "Brave search error");
    return [];
  }
}

const BRAVE_EXAMPLES_PROMPT = `Ты генерируешь примеры объявлений для Telegram-групп на основе информации из поиска.

## Задача
На основе найденных товаров/услуг сгенерируй реалистичные примеры объявлений как в Telegram-барахолках.

## Требования к каждому примеру
- Реалистичная цена (исследуй диапазон цен из поиска)
- Город или район
- Контакт (в ЛС, @username, +7...)
- Состояние (б/у, новый, торг уместен)
- Эмодзи как в реальных объявлениях
- 2-4 предложения

## Формат ответа
JSON массив из 3 объектов:
[
  {"text": "текст объявления"},
  {"text": "текст объявления"},
  {"text": "текст объявления"}
]

ТОЛЬКО JSON, без комментариев.`;

interface GeneratedExample {
  text: string;
}

/**
 * Generate example messages based on Brave search results
 */
export async function generateExamplesFromBrave(
  query: string,
  braveResults: BraveResult[]
): Promise<RatingExample[]> {
  if (braveResults.length === 0) return [];

  const searchContext = braveResults
    .slice(0, 5)
    .map((r) => `- ${r.title}: ${r.description}`)
    .join("\n");

  const userMessage = `Запрос: ${query}

Найденная информация:
${searchContext}

Сгенерируй 3 примера объявлений.`;

  try {
    const response = await withRetry(async () => {
      const result = await hf.chatCompletion({
        model: MODELS.DEEPSEEK_R1,
        provider: "novita",
        messages: [
          { role: "system", content: BRAVE_EXAMPLES_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 1500,
        temperature: 0.7,
      });
      return result.choices[0]?.message?.content || "";
    });

    // Strip thinking tags
    const cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Parse JSON
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) {
      llmLog.warn({ query, response: cleaned.slice(0, 200) }, "Failed to parse Brave examples");
      return [];
    }

    const parsed = JSON.parse(match[0]) as GeneratedExample[];

    llmLog.debug({ query, generated: parsed.length }, "Generated examples from Brave search");

    return parsed.map((item, index) => ({
      id: -(index + 1), // negative IDs for generated examples
      text: item.text,
      groupId: 0,
      groupTitle: "🌐 На основе поиска",
      isGenerated: true,
    }));
  } catch (error) {
    llmLog.error({ err: error, query }, "Failed to generate examples from Brave");
    return [];
  }
}
