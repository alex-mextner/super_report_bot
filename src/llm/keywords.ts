import { hf, MODELS, withRetry } from "./index.ts";
import { llmLog } from "../logger.ts";
import type { KeywordGenerationResult, ExampleRating, RatingExample } from "../types.ts";

const SYSTEM_PROMPT = `Ты помощник для извлечения ключевых слов из поисковых запросов пользователей.
Твоя задача — сгенерировать позитивные и негативные ключевые слова для фильтрации сообщений.

## Правила

### Позитивные ключевые слова (positive_keywords)
**ВАЖНО: Генерируй 50-100 ключевых слов!**

Перечисли ВСЕ возможные подвиды/типы/разновидности того, что ищет пользователь:
- Для категорий — все конкретные виды (одежда → куртка, пальто, джинсы, футболка, свитер, платье, юбка, шорты...)
- Для техники — все бренды и типы (телефон → iphone, samsung, xiaomi, redmi, poco, honor, android...)
- Для мебели — все виды (мебель → диван, кресло, стол, стул, шкаф, комод, кровать, тумба...)
- Синонимы для каждого подвида
- Разговорные/уменьшительные формы (куртка → курточка, кроссовки → кроссы)
- Транслит где уместно (iphone → айфон)
- Множественное и единственное число

Чем больше вариантов — тем лучше matching!

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

Запрос: "одежда женская купить"
{
  "positive_keywords": ["одежда", "вещи", "гардероб", "куртка", "курточка", "пуховик", "ветровка", "парка", "бомбер", "пальто", "плащ", "тренч", "джинсы", "брюки", "штаны", "леггинсы", "лосины", "шорты", "юбка", "мини", "миди", "макси", "платье", "сарафан", "туника", "футболка", "майка", "топ", "блузка", "рубашка", "кофта", "свитер", "джемпер", "кардиган", "худи", "толстовка", "свитшот", "водолазка", "жилет", "жилетка", "костюм", "пиджак", "блейзер", "комбинезон", "боди", "белье", "пижама", "халат", "спортивка", "спортивный", "женская", "женский", "продам", "продаю", "отдам", "цена", "размер"],
  "negative_keywords": ["детская", "мужская", "оптом", "сток", "секонд", "б/у", "порвано", "пятно", "дырка", "обмен", "меняю"],
  "description": "Новая женская одежда для покупки"
}

Запрос: "телефон смартфон купить"
{
  "positive_keywords": ["телефон", "смартфон", "мобильный", "сотовый", "трубка", "iphone", "айфон", "apple", "эпл", "samsung", "самсунг", "галакси", "galaxy", "xiaomi", "сяоми", "redmi", "редми", "poco", "поко", "honor", "хонор", "huawei", "хуавей", "oneplus", "ванплюс", "realme", "реалми", "oppo", "vivo", "google", "pixel", "пиксель", "nokia", "нокиа", "motorola", "моторола", "asus", "асус", "rog", "sony", "сони", "android", "андроид", "ios", "pro", "max", "plus", "ultra", "lite", "mini", "продам", "продаю", "цена", "куплю"],
  "negative_keywords": ["запчасти", "разбор", "разборка", "битый", "неисправный", "сломан", "не включается", "ремонт", "экран отдельно", "дисплей", "корпус", "батарея", "аккумулятор", "зарядка", "чехол", "стекло", "плёнка"],
  "description": "Рабочие смартфоны для покупки"
}

Запрос: "мебель для дома"
{
  "positive_keywords": ["мебель", "меблировка", "диван", "диванчик", "софа", "кресло", "кресла", "пуф", "пуфик", "стол", "столик", "стул", "стулья", "табурет", "табуретка", "шкаф", "шкафчик", "комод", "тумба", "тумбочка", "кровать", "кроватка", "матрас", "матрац", "полка", "полки", "стеллаж", "этажерка", "вешалка", "гардероб", "гардеробная", "прихожая", "обувница", "зеркало", "трюмо", "туалетный", "письменный", "компьютерный", "журнальный", "обеденный", "кухонный", "барный", "угловой", "раскладной", "трансформер", "модульный", "продам", "продаю", "отдам", "цена", "доставка"],
  "negative_keywords": ["сборка", "ремонт", "реставрация", "перетяжка", "обивка", "фурнитура", "ножки", "колёсики", "запчасти", "оптом", "производство", "на заказ"],
  "description": "Готовая мебель для дома"
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
 * @param query - Original user query
 * @param clarificationContext - Optional context from clarification Q&A (formatted string)
 */
export async function generateKeywords(
  query: string,
  clarificationContext?: string
): Promise<KeywordGenerationResult> {
  // Build user message with optional clarification context
  const userMessage = clarificationContext ? `${query}${clarificationContext}` : query;

  const response = await withRetry(async () => {
    const result = await hf.chatCompletion({
      model: MODELS.DEEPSEEK_R1,
      provider: "novita",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 2500,
      temperature: 0.6,
    });
    return result.choices[0]?.message?.content || "";
  });

  // DeepSeek R1 may include <think>...</think> reasoning blocks — strip them
  const cleanedResponse = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  llmLog.debug({ query, response: cleanedResponse.slice(0, 500) }, "generateKeywords raw response");

  // Parse JSON from response
  const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    llmLog.error({ query, response: cleanedResponse.slice(0, 300) }, "Failed to parse generateKeywords response");
    throw new Error(`Failed to parse LLM response: ${response}`);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = {
      positive_keywords: parsed.positive_keywords || [],
      negative_keywords: parsed.negative_keywords || [],
      llm_description: parsed.description || "",
    };

    llmLog.info({
      query,
      positiveCount: result.positive_keywords.length,
      negativeCount: result.negative_keywords.length,
      description: result.llm_description,
    }, "generateKeywords result");

    return result;
  } catch (e) {
    llmLog.error({ query, json: jsonMatch[0].slice(0, 300) }, "Invalid JSON in generateKeywords response");
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

// =====================================================
// Draft keywords generation (fast, for searching examples)
// =====================================================

const DRAFT_KEYWORDS_PROMPT = `Из запроса пользователя извлеки 10-15 ключевых слов для поиска.
Включи: основные термины, синонимы, бренды, вариации написания.

Ответ ТОЛЬКО JSON массив строк, без пояснений:
["слово1", "слово2", ...]`;

/**
 * Generate draft keywords quickly for searching similar messages
 * Simpler and faster than full generateKeywords
 */
export async function generateDraftKeywords(query: string): Promise<string[]> {
  try {
    const response = await withRetry(async () => {
      const result = await hf.chatCompletion({
        model: MODELS.DEEPSEEK_R1,
        provider: "novita",
        messages: [
          { role: "system", content: DRAFT_KEYWORDS_PROMPT },
          { role: "user", content: query },
        ],
        max_tokens: 500,
        temperature: 0.5,
      });
      return result.choices[0]?.message?.content || "";
    });

    // Strip thinking tags
    const cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Parse JSON array
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((k) => typeof k === "string");
      }
    }
  } catch {
    // Fallback to simple tokenization
  }

  return generateKeywordsFallback(query).positive_keywords;
}

// =====================================================
// Example messages generation (when cache is empty)
// =====================================================

const EXAMPLE_MESSAGES_PROMPT = `Сгенерируй 3 примера объявлений, которые могли бы подойти под запрос пользователя.

Примеры должны быть:
1. Точное совпадение — идеально подходит под запрос
2. Вариация по цене/состоянию — похожий товар, но другие условия
3. Альтернатива — смежный товар/услуга, который может не подойти

Формат объявлений — как в Telegram-группах: краткие, с эмодзи, ценой, описанием.

Ответ ТОЛЬКО JSON:
{
  "examples": [
    {"text": "текст объявления 1", "variation": "exact"},
    {"text": "текст объявления 2", "variation": "price"},
    {"text": "текст объявления 3", "variation": "alternative"}
  ]
}`;

export interface GeneratedExample {
  text: string;
  variation: "exact" | "price" | "alternative";
}

/**
 * Generate example messages when cache is empty
 * Returns 3 synthetic examples for user to rate
 */
export async function generateExampleMessages(
  query: string
): Promise<GeneratedExample[]> {
  try {
    const response = await withRetry(async () => {
      const result = await hf.chatCompletion({
        model: MODELS.DEEPSEEK_R1,
        provider: "novita",
        messages: [
          { role: "system", content: EXAMPLE_MESSAGES_PROMPT },
          { role: "user", content: query },
        ],
        max_tokens: 1000,
        temperature: 0.7,
      });
      return result.choices[0]?.message?.content || "";
    });

    // Strip thinking tags
    const cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Parse JSON
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.examples && Array.isArray(parsed.examples)) {
        return parsed.examples;
      }
    }
  } catch {
    // Return empty if failed
  }

  return [];
}

/**
 * Convert generated examples to RatingExample format
 */
export function generatedToRatingExamples(
  examples: GeneratedExample[]
): RatingExample[] {
  return examples.map((ex, idx) => ({
    id: -(idx + 1), // negative IDs for generated examples
    text: ex.text,
    groupId: 0,
    groupTitle: "Пример",
    isGenerated: true,
  }));
}

// =====================================================
// Keywords generation with ratings feedback
// =====================================================

interface RatingFeedback {
  text: string;
  rating: ExampleRating;
}

const KEYWORDS_WITH_RATINGS_PROMPT = `Ты помощник для извлечения ключевых слов из поисковых запросов.
Пользователь оценил примеры объявлений — учти эту обратную связь!

## Обратная связь
🔥 Горячо = идеально подходит, понимай ОБЩИЙ ТИП контента
☀️ Тепло = частично подходит, полезный контекст
❄️ Холодно = НЕ подходит, понимай что исключать по ТИПУ

## КРИТИЧЕСКИ ВАЖНО — что НЕ нужно извлекать из примеров:
- НЕ извлекай конкретные размеры (46, S, W30, 42-44)
- НЕ извлекай конкретные бренды, если они не в запросе пользователя
- НЕ извлекай конкретные цены или диапазоны цен
- НЕ извлекай конкретные цвета, если они не в запросе
- НЕ извлекай конкретные стили (baggy, slim) если не в запросе
- НЕ извлекай специфические характеристики из примеров

Примеры нужны ТОЛЬКО для понимания:
- Какой ТИП объявлений релевантен (продажа vs услуги)
- Какая КАТЕГОРИЯ товаров/услуг подходит
- Что ИСКЛЮЧАТЬ по типу (например, услуги строительства)

## Правила генерации

### positive_keywords (50-100 слов)
- Основной товар/услуга из ЗАПРОСА пользователя
- ВСЕ подвиды/типы этого товара/услуги
- Синонимы, разговорные формы, транслит
- НЕ добавляй конкретные бренды/размеры/цвета из примеров

### negative_keywords
- Слова для исключения нерелевантных ТИПОВ контента
- Типичные слова из "холодных" примеров (услуги, аренда, ремонт — если не нужны)
- Стандартные спам-фильтры

### description
Краткое ОБЩЕЕ описание того, что ищет пользователь.
НЕ включай конкретные размеры, бренды, стили — только общую категорию.
Пример: "мужские джинсы" НЕ "мужские джинсы ASOS размера W30 в стиле baggy"

## Формат ответа
ТОЛЬКО JSON:
{
  "positive_keywords": [...],
  "negative_keywords": [...],
  "description": "..."
}`;

/**
 * Generate keywords with user's rating feedback
 * Takes into account which examples user marked as relevant/irrelevant
 */
export async function generateKeywordsWithRatings(
  query: string,
  ratings: RatingFeedback[],
  clarificationContext?: string
): Promise<KeywordGenerationResult> {
  // Build feedback section
  const feedbackLines: string[] = [];

  const hot = ratings.filter((r) => r.rating === "hot");
  const warm = ratings.filter((r) => r.rating === "warm");
  const cold = ratings.filter((r) => r.rating === "cold");

  if (hot.length > 0) {
    feedbackLines.push("🔥 Горячо (релевантно):");
    hot.forEach((r) => feedbackLines.push(`  "${r.text.slice(0, 200)}..."`));
  }

  if (warm.length > 0) {
    feedbackLines.push("☀️ Тепло (частично):");
    warm.forEach((r) => feedbackLines.push(`  "${r.text.slice(0, 200)}..."`));
  }

  if (cold.length > 0) {
    feedbackLines.push("❄️ Холодно (нерелевантно):");
    cold.forEach((r) => feedbackLines.push(`  "${r.text.slice(0, 200)}..."`));
  }

  const feedbackSection = feedbackLines.length > 0
    ? `\n\nОценки пользователя:\n${feedbackLines.join("\n")}`
    : "";

  const userMessage = clarificationContext
    ? `Запрос: ${query}${clarificationContext}${feedbackSection}`
    : `Запрос: ${query}${feedbackSection}`;

  const response = await withRetry(async () => {
    const result = await hf.chatCompletion({
      model: MODELS.DEEPSEEK_R1,
      provider: "novita",
      messages: [
        { role: "system", content: KEYWORDS_WITH_RATINGS_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 2500,
      temperature: 0.6,
    });
    return result.choices[0]?.message?.content || "";
  });

  // Strip thinking tags
  const cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  llmLog.debug({
    query,
    ratingsCount: ratings.length,
    hot: ratings.filter((r) => r.rating === "hot").length,
    warm: ratings.filter((r) => r.rating === "warm").length,
    cold: ratings.filter((r) => r.rating === "cold").length,
    response: cleaned.slice(0, 500),
  }, "generateKeywordsWithRatings raw response");

  // Parse JSON
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    llmLog.error({ query, response: cleaned.slice(0, 300) }, "Failed to parse generateKeywordsWithRatings response");
    throw new Error(`Failed to parse LLM response: ${response}`);
  }

  try {
    const parsed = JSON.parse(match[0]);
    const result = {
      positive_keywords: parsed.positive_keywords || [],
      negative_keywords: parsed.negative_keywords || [],
      llm_description: parsed.description || "",
    };

    llmLog.info({
      query,
      positiveCount: result.positive_keywords.length,
      negativeCount: result.negative_keywords.length,
      description: result.llm_description,
    }, "generateKeywordsWithRatings result");

    return result;
  } catch {
    llmLog.error({ query, json: match[0].slice(0, 300) }, "Invalid JSON in generateKeywordsWithRatings response");
    throw new Error(`Invalid JSON in LLM response: ${match[0]}`);
  }
}

// =====================================================
// Description correction (for normal mode)
// =====================================================

const CORRECT_DESCRIPTION_PROMPT = `Ты помощник для уточнения поисковых запросов.
Пользователь хочет скорректировать описание того, что он ищет.

## Твоя задача
1. Понять что пользователь хочет изменить в описании
2. Создать новое, уточненное описание

## Правила
- Описание должно быть кратким (1-2 предложения)
- Не добавляй конкретные размеры, бренды, цвета если пользователь явно не просит
- Фокусируйся на КАТЕГОРИИ и ТИПЕ товара/услуги
- Учитывай исключения (что НЕ нужно)

## Формат ответа
ТОЛЬКО JSON:
{
  "description": "новое описание",
  "summary": "что изменил (коротко)"
}`;

interface DescriptionCorrectionResult {
  description: string;
  summary: string;
}

/**
 * Correct description based on user's instruction (for normal mode)
 * Returns new description, keywords will be regenerated separately
 */
export async function correctDescription(
  currentDescription: string,
  userInstruction: string
): Promise<DescriptionCorrectionResult> {
  const userMessage = `Текущее описание: "${currentDescription}"

Инструкция пользователя: ${userInstruction}`;

  const response = await withRetry(async () => {
    const result = await hf.chatCompletion({
      model: MODELS.DEEPSEEK_R1,
      provider: "novita",
      messages: [
        { role: "system", content: CORRECT_DESCRIPTION_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 500,
      temperature: 0.5,
    });
    return result.choices[0]?.message?.content || "";
  });

  // Strip thinking tags
  const cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  // Parse JSON
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Failed to parse LLM response: ${response}`);
  }

  try {
    const parsed = JSON.parse(match[0]);
    return {
      description: parsed.description || currentDescription,
      summary: parsed.summary || "Описание обновлено",
    };
  } catch {
    throw new Error(`Invalid JSON in LLM response: ${match[0]}`);
  }
}
