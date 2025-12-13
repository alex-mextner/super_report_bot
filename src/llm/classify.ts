import { llmThink } from "./index.ts";
import { llmLog } from "../logger.ts";

const SYSTEM_PROMPT = `You are an assistant for classifying products from Telegram group messages.

## Task
You receive an array of messages. For each one, determine:
1. Product category (code)
2. Seller contact if present in text

## Categories (use only these codes or suggest new ones)
- electronics: Electronics (phones, computers, TV, headphones)
- clothing: Clothing and footwear
- auto: Auto (cars, motorcycles, parts)
- realty: Real estate (apartments, houses, rental)
- furniture: Furniture
- appliances: Home appliances (refrigerator, washing machine)
- kids: Kids products
- sports: Sports and leisure
- beauty: Beauty and health
- pets: Animals and pet supplies
- services: Services
- jobs: Jobs, vacancies
- other: Other

## Contacts
Look for in text:
- Phone numbers: +7, 8, formats like 89001234567
- Telegram: @username, t.me/xxx
- WhatsApp: wa.me/xxx

## Response format
JSON without additional text:
{
  "items": [
    {
      "id": 123,
      "category": "electronics",
      "contacts": [
        { "type": "phone", "value": "+79001234567" },
        { "type": "username", "value": "@seller" }
      ]
    }
  ],
  "new_categories": [
    { "code": "new_code", "name_ru": "Name in Russian" }
  ]
}

If message is NOT a product (chat, question, spam, greeting) — skip it (don't include in items).
Be strict: only real sales/service listings.`;

export interface ClassificationInput {
  id: number;
  text: string;
}

export interface ClassifiedItem {
  id: number;
  category: string;
  contacts: Array<{ type: string; value: string }>;
}

export interface ClassificationResult {
  items: ClassifiedItem[];
  new_categories: Array<{ code: string; name_ru: string }>;
}

/**
 * Classify a batch of messages using LLM
 * @param messages - Array of messages with id and text
 * @returns Classification results
 */
export async function classifyBatch(
  messages: ClassificationInput[]
): Promise<ClassificationResult> {
  if (messages.length === 0) {
    return { items: [], new_categories: [] };
  }

  // Format messages for LLM (truncate long texts)
  const userMessage = messages
    .map((m) => `[ID:${m.id}]\n${m.text.slice(0, 500)}`)
    .join("\n\n---\n\n");

  llmLog.debug({ count: messages.length }, "Classifying batch");

  const response = await llmThink({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    maxTokens: 4000,
    temperature: 0.3,
  });

  const cleanedResponse = response.trim();

  // Parse JSON from response
  const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    llmLog.error({ response: cleanedResponse.slice(0, 200) }, "Failed to parse classification response");
    return { items: [], new_categories: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result: ClassificationResult = {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      new_categories: Array.isArray(parsed.new_categories) ? parsed.new_categories : [],
    };

    llmLog.debug(
      { classified: result.items.length, newCategories: result.new_categories.length },
      "Batch classified"
    );

    return result;
  } catch (e) {
    llmLog.error({ json: jsonMatch[0].slice(0, 200) }, "Invalid JSON in classification response");
    return { items: [], new_categories: [] };
  }
}

// Default categories to seed the database
export const DEFAULT_CATEGORIES = [
  { code: "electronics", name_ru: "Электроника" },
  { code: "clothing", name_ru: "Одежда и обувь" },
  { code: "auto", name_ru: "Авто" },
  { code: "realty", name_ru: "Недвижимость" },
  { code: "furniture", name_ru: "Мебель" },
  { code: "appliances", name_ru: "Бытовая техника" },
  { code: "kids", name_ru: "Детские товары" },
  { code: "sports", name_ru: "Спорт и отдых" },
  { code: "beauty", name_ru: "Красота и здоровье" },
  { code: "pets", name_ru: "Животные" },
  { code: "services", name_ru: "Услуги" },
  { code: "jobs", name_ru: "Работа" },
  { code: "other", name_ru: "Прочее" },
];
