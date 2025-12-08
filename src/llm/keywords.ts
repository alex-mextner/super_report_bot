import { hf, MODELS, withRetry } from "./index.ts";
import type { KeywordGenerationResult } from "../types.ts";

const SYSTEM_PROMPT = `Ты помощник для извлечения ключевых слов из поисковых запросов пользователей.
Твоя задача — сгенерировать позитивные и негативные ключевые слова для фильтрации сообщений.

## Правила

### Позитивные ключевые слова (positive_keywords)
Слова, которые ДОЛЖНЫ присутствовать в подходящих сообщениях:
- Основные термины из запроса
- Синонимы и вариации написания
- Транслит (если уместно)
- Сокращения и аббревиатуры

### Негативные ключевые слова (negative_keywords)
Слова для ИСКЛЮЧЕНИЯ нерелевантных результатов. Это критически важно!

**Типичные негативные слова по категориям:**

Для товаров/покупок:
- "запчасти", "запчасть", "разбор", "разборка" (если не ищут запчасти)
- "неисправный", "сломанный", "битый", "на запчасти"
- "ремонт", "починка" (если ищут новый товар)
- "обмен", "меняю" (если ищут покупку)
- "срочно продам" (спам-маркер)

Для поиска работы:
- "стажёр", "стажировка" (если ищут опытного)
- "без опыта" (если нужен опыт)
- "подработка" (если ищут полную занятость)
- "удалёнка" (если нужен офис, и наоборот)

Для недвижимости:
- "посуточно", "почасово" (если долгосрок)
- "хостел", "койко-место" (если квартира)
- "без мебели" (если с мебелью нужна)

Общие спам-фильтры:
- "реклама", "продвижение", "раскрутка"
- "пирамида", "mlm", "сетевой"
- "казино", "ставки"

## Примеры

Запрос: "iPhone 15 Pro Max купить"
{
  "positive_keywords": ["iphone", "айфон", "15", "pro", "max", "купить", "продам", "продаю", "цена"],
  "negative_keywords": ["запчасти", "разбор", "битый", "неисправный", "ремонт", "обмен", "корпус", "дисплей", "экран отдельно"],
  "description": "Объявления о продаже рабочего iPhone 15 Pro Max"
}

Запрос: "python разработчик вакансия"
{
  "positive_keywords": ["python", "питон", "разработчик", "developer", "программист", "вакансия", "работа", "ищем"],
  "negative_keywords": ["стажёр", "стажировка", "джун", "junior", "без опыта", "обучение", "курсы", "фриланс"],
  "description": "Вакансии для Python разработчиков (не стажировки)"
}

Запрос: "аренда квартиры москва"
{
  "positive_keywords": ["аренда", "снять", "сдаётся", "квартира", "однушка", "двушка", "москва", "мск"],
  "negative_keywords": ["посуточно", "почасово", "хостел", "койко", "комната", "подселение", "без мебели", "продажа", "купить"],
  "description": "Долгосрочная аренда квартир в Москве"
}

Запрос: "macbook pro m3 бу"
{
  "positive_keywords": ["macbook", "макбук", "pro", "m3", "бу", "б/у", "продам", "продаю"],
  "negative_keywords": ["запчасти", "разбор", "неисправный", "сломан", "не включается", "под ремонт", "корпус"],
  "description": "Рабочие MacBook Pro M3 б/у для покупки"
}

## Формат ответа

Ответь ТОЛЬКО JSON без дополнительного текста:
{
  "positive_keywords": [...],
  "negative_keywords": [...],
  "description": "..."
}`;

/**
 * Generate keywords from user's free-form search request using DeepSeek R1 via Novita
 */
export async function generateKeywords(query: string): Promise<KeywordGenerationResult> {
  const response = await withRetry(async () => {
    const result = await hf.chatCompletion({
      model: MODELS.DEEPSEEK_R1,
      provider: "novita",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      max_tokens: 1000,
      temperature: 0.6,
    });
    return result.choices[0]?.message?.content || "";
  });

  // DeepSeek R1 may include <think>...</think> reasoning blocks — strip them
  const cleanedResponse = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // Parse JSON from response
  const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse LLM response: ${response}`);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      positive_keywords: parsed.positive_keywords || [],
      negative_keywords: parsed.negative_keywords || [],
      llm_description: parsed.description || "",
    };
  } catch (e) {
    throw new Error(`Invalid JSON in LLM response: ${jsonMatch[0]}`);
  }
}

/**
 * Fallback keyword generation without LLM (simple tokenization)
 */
export function generateKeywordsFallback(query: string): KeywordGenerationResult {
  const words = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  return {
    positive_keywords: words,
    negative_keywords: [],
    llm_description: query,
  };
}
