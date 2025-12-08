import { hf, MODELS, withRetry } from "./index.ts";
import { llmLog } from "../logger.ts";

export interface AnalysisResult {
  category: string;
  price: string | null;
  currency: string | null;
  contacts: string[];
}

const SYSTEM_PROMPT = `Analyze this marketplace message and extract:
1. Category (what is being sold/offered)
2. Price (if mentioned)
3. Currency (RSD, EUR, USD, etc.)
4. Contacts (phone numbers, usernames, links)

Respond in JSON format only:
{
  "category": "short category name in Russian",
  "price": "number or null",
  "currency": "currency code or null",
  "contacts": ["array of contacts found"]
}`;

export interface BatchItem {
  id: number;
  text: string;
}

export interface BatchResult {
  id: number;
  result: AnalysisResult;
}

/**
 * Analyze multiple messages in one LLM call
 */
export async function analyzeMessagesBatch(items: BatchItem[]): Promise<BatchResult[]> {
  if (!process.env.HF_TOKEN) {
    throw new Error("HF_TOKEN not configured");
  }

  if (items.length === 0) return [];

  const batchPrompt = items
    .map((item, i) => `[${i + 1}] ID=${item.id}\n${item.text.slice(0, 500)}`)
    .join("\n\n---\n\n");

  const response = await withRetry(async () => {
    const result = await hf.chatCompletion({
      model: MODELS.DEEPSEEK_R1,
      messages: [
        { role: "system", content: BATCH_SYSTEM_PROMPT },
        { role: "user", content: batchPrompt },
      ],
      max_tokens: 3000,
      provider: "novita",
    });

    return result.choices[0]?.message?.content || "";
  });

  llmLog.debug({ count: items.length }, "Batch analyzed");

  return parseBatchResponse(response, items);
}

const BATCH_SYSTEM_PROMPT = `Analyze these marketplace messages and extract for EACH:
1. Category (what is being sold)
2. Price (if mentioned)
3. Currency (RSD, EUR, USD, etc.)
4. Contacts (phones, usernames, links)

Respond with JSON array. Each item must have the original ID:
[
  {"id": 123, "category": "...", "price": "...", "currency": "...", "contacts": [...]},
  ...
]`;

function parseBatchResponse(response: string, items: BatchItem[]): BatchResult[] {
  try {
    // Extract JSON array from response
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1]?.trim() || response;
    }

    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      jsonStr = arrayMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as Array<{
      id?: number;
      category?: string;
      price?: string | null;
      currency?: string | null;
      contacts?: string[];
    }>;

    // Map results back to items by ID or index
    return parsed.map((p, i) => {
      const id = p.id ?? items[i]?.id ?? 0;
      return {
        id,
        result: {
          category: p.category || "Unknown",
          price: p.price || null,
          currency: p.currency || null,
          contacts: Array.isArray(p.contacts) ? p.contacts : [],
        },
      };
    });
  } catch (e) {
    llmLog.warn({ response: response.slice(0, 300) }, "Failed to parse batch response");
    // Return empty results for all items
    return items.map((item) => ({
      id: item.id,
      result: { category: "Unknown", price: null, currency: null, contacts: [] },
    }));
  }
}

export async function analyzeMessage(text: string): Promise<AnalysisResult> {
  if (!process.env.HF_TOKEN) {
    throw new Error("HF_TOKEN not configured");
  }

  const response = await withRetry(async () => {
    const result = await hf.chatCompletion({
      model: MODELS.DEEPSEEK_R1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      max_tokens: 500,
      provider: "novita",
    });

    return result.choices[0]?.message?.content || "";
  });

  llmLog.debug({ textLength: text.length }, "Message analyzed");

  try {
    // Extract JSON from response (may contain markdown code blocks)
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1]?.trim() || response;
    }

    // Try to find JSON object in response
    const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonObjMatch) {
      jsonStr = jsonObjMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as AnalysisResult;
    return {
      category: parsed.category || "Unknown",
      price: parsed.price || null,
      currency: parsed.currency || null,
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
    };
  } catch (e) {
    llmLog.warn({ response: response.slice(0, 200) }, "Failed to parse analysis response");
    return {
      category: "Unknown",
      price: null,
      currency: null,
      contacts: [],
    };
  }
}
