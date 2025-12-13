import { llmLog } from "../logger.ts";
import type { RatingExample } from "../types.ts";
import { llmThink } from "./index.ts";

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
    const searchQuery = `${query} buy price`;
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

const BRAVE_EXAMPLES_PROMPT = `You generate example listings for Telegram groups based on search results.

## Task
Based on found products/services, generate realistic listing examples as in Telegram marketplaces.

## Requirements for each example
- Realistic price (research price range from search results)
- City or district
- Contact (DM, @username, phone...)
- Condition (used, new, negotiable)
- Emojis like in real listings
- 2-4 sentences

## Response format
JSON array of 3 objects:
[
  {"text": "listing text"},
  {"text": "listing text"},
  {"text": "listing text"}
]

ONLY JSON, no comments.`;

interface GeneratedExample {
  text: string;
}

/**
 * Generate example messages based on Brave search results
 */
export async function generateExamplesFromBrave(
  query: string,
  braveResults: BraveResult[],
  language: string = "English"
): Promise<RatingExample[]> {
  if (braveResults.length === 0) return [];

  const searchContext = braveResults
    .slice(0, 5)
    .map((r) => `- ${r.title}: ${r.description}`)
    .join("\n");

  const userMessage = `Query: ${query}

Found information:
${searchContext}

Generate 3 example listings.
IMPORTANT: Write all listings in ${language}.`;

  try {
    const response = await llmThink({
      messages: [
        { role: "system", content: BRAVE_EXAMPLES_PROMPT },
        { role: "user", content: userMessage },
      ],
      maxTokens: 1500,
      temperature: 0.7,
    });

    const cleaned = response.trim();

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
      groupTitle: "🌐 Based on search",
      isGenerated: true,
    }));
  } catch (error) {
    llmLog.error({ err: error, query }, "Failed to generate examples from Brave");
    return [];
  }
}
