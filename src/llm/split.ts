/**
 * Message splitting for multi-item messages
 *
 * Splits messages containing multiple products/items into separate texts
 * so each can be verified independently against subscriptions.
 */

import { llmLog } from "../logger.ts";
import { llmFast } from "./index.ts";

export interface SplitResult {
  items: string[]; // Texts of separate items
  isSingleItem: boolean; // true if message contains only 1 item
}

// Don't bother splitting short messages
const MIN_LENGTH_FOR_SPLIT = 200;

/**
 * Split message text into separate items/products using DeepSeek
 *
 * @param text - Original message text
 * @returns Array of item texts and whether it was a single item
 */
export async function splitMessageToItems(text: string): Promise<SplitResult> {
  // Skip splitting for short messages
  if (text.length < MIN_LENGTH_FOR_SPLIT || !text.includes("\n")) {
    return { items: [text], isSingleItem: true };
  }

  const systemPrompt = `You analyze marketplace/classified messages.
Your task: determine if the message describes MULTIPLE separate items/products for sale, or just ONE item.

If multiple items: extract each item's FULL text (description, price, condition, etc.)
If single item: return the original text as-is.

IMPORTANT:
- Items are separate products being sold, not features of one product
- "iPhone 13 + чехол" = ONE item (bundle)
- "iPhone 13 - 50k, Samsung S22 - 40k" = TWO items (different products)

Return JSON only:
{"items": ["full text of item 1", "full text of item 2", ...], "single": true/false}`;

  const userPrompt = `Message:
"""
${text.slice(0, 3000)}
"""

Split into items or return as single.`;

  try {
    const response = await llmFast({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      maxTokens: text.length + 500,
    });

    const result = parseSplitResponse(response, text);

    llmLog.debug(
      {
        originalLength: text.length,
        itemCount: result.items.length,
        isSingleItem: result.isSingleItem,
      },
      "Message split result"
    );

    return result;
  } catch (error) {
    llmLog.error({ error }, "Failed to split message, using original");
    // Fallback: return original text as single item
    return { items: [text], isSingleItem: true };
  }
}

/**
 * Parse DeepSeek response for split result
 */
function parseSplitResponse(content: string, originalText: string): SplitResult {
  const defaultResult: SplitResult = { items: [originalText], isSingleItem: true };

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    llmLog.warn({ content: content.slice(0, 100) }, "Failed to parse split response as JSON");
    return defaultResult;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate items array
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      return defaultResult;
    }

    // Filter out empty items
    const items = parsed.items.filter(
      (item: unknown): item is string => typeof item === "string" && item.trim().length > 0
    );

    if (items.length === 0) {
      return defaultResult;
    }

    return {
      items,
      isSingleItem: items.length === 1 || Boolean(parsed.single),
    };
  } catch {
    llmLog.warn({ content: content.slice(0, 100) }, "JSON parse failed for split response");
    return defaultResult;
  }
}
