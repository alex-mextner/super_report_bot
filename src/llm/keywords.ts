import { hf, MODELS, withRetry } from "./index.ts";
import { llmLog } from "../logger.ts";
import type { KeywordGenerationResult, ExampleRating, RatingExample } from "../types.ts";

const SYSTEM_PROMPT = `You are a keyword extraction assistant for user search queries.
Your task is to generate positive and negative keywords for message filtering.

## Rules

### Positive keywords (positive_keywords)
**IMPORTANT: Generate 50-100 keywords!**

List ALL possible subtypes/variants of what the user is looking for:
- For categories — all specific types (clothing → jacket, coat, jeans, t-shirt, sweater, dress, skirt, shorts...)
- For electronics — all brands and types (phone → iphone, samsung, xiaomi, redmi, poco, honor, android...)
- For furniture — all types (furniture → sofa, armchair, table, chair, wardrobe, dresser, bed, nightstand...)
- Synonyms for each subtype
- Colloquial/diminutive forms
- Transliteration where appropriate (iphone → айфон for Russian)
- Singular and plural forms

More variants = better matching!

### Negative keywords (negative_keywords)
Words to EXCLUDE irrelevant results. This is critically important!

**Typical negative words by category:**

For goods/purchases:
- "spare parts", "disassembly" (if not looking for parts)
- "broken", "defective", "for parts"
- "repair", "fix" (if looking for new item)
- "exchange", "swap" (if looking to buy)
- "urgent sale" (spam marker)

For job search:
- "intern", "internship" (if looking for experienced)
- "no experience" (if experience needed)
- "part-time" (if looking for full-time)
- "remote" (if office needed, and vice versa)

For real estate:
- "daily", "hourly" (if long-term)
- "hostel", "shared room" (if apartment)
- "unfurnished" (if furnished needed)

Common spam filters:
- "advertisement", "promotion"
- "pyramid", "mlm", "network marketing"
- "casino", "betting"

**CRITICAL — Listing type (buying vs selling):**
Determine user intent and EXCLUDE opposite listing types:

1. If user is LOOKING FOR/BUYING an item (default for most queries):
   → Add to negative: buyer keywords (куплю, ищу, нужен, looking for, want to buy, WTB)
   → Add to positive: seller keywords (продам, продаю, selling, for sale, WTS)

2. If user is SELLING an item (explicitly stated "selling", "for sale"):
   → Add to negative: seller keywords (продам, продаю, selling, for sale, price)
   → Add to positive: buyer keywords (куплю, ищу, looking for, want to buy)

3. If user OFFERS services (explicitly stated "offering services"):
   → Add to negative: service provider keywords
   → Add to positive: service seeker keywords

4. If user is LOOKING FOR services/contractor:
   → Add to negative: job seeker keywords
   → Add to positive: service provider keywords

## Examples

Query: "women's clothing buy"
{
  "positive_keywords": ["одежда", "вещи", "куртка", "пуховик", "пальто", "джинсы", "брюки", "юбка", "платье", "футболка", "блузка", "свитер", "худи", "костюм", "женская", "продам", "продаю", "clothing", "jacket", "coat", "jeans", "dress", "blouse", "sweater", "women's", "selling"],
  "negative_keywords": ["детская", "мужская", "обмен", "куплю", "ищу", "children", "men's", "exchange", "looking for", "WTB"],
  "description": "Women's clothing for sale"
}

Query: "smartphone phone buy"
{
  "positive_keywords": ["телефон", "смартфон", "iphone", "айфон", "samsung", "самсунг", "xiaomi", "redmi", "honor", "huawei", "android", "продам", "продаю", "phone", "smartphone", "selling", "for sale"],
  "negative_keywords": ["запчасти", "битый", "сломан", "ремонт", "куплю", "ищу", "spare parts", "broken", "repair", "looking for", "WTB"],
  "description": "Smartphones for sale"
}

Query: "home furniture"
{
  "positive_keywords": ["мебель", "диван", "кресло", "стол", "стул", "шкаф", "кровать", "комод", "полка", "продам", "продаю", "furniture", "sofa", "armchair", "table", "chair", "wardrobe", "bed", "selling"],
  "negative_keywords": ["ремонт", "реставрация", "запчасти", "куплю", "ищу", "repair", "restoration", "parts", "looking for", "WTB"],
  "description": "Home furniture for sale"
}

## Response format

Respond ONLY with JSON, no additional text:
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

const DRAFT_KEYWORDS_PROMPT = `Extract 10-15 keywords from the user query for searching.
Include: main terms, synonyms, brands, spelling variations.

Respond ONLY with JSON array of strings, no explanations:
["word1", "word2", ...]`;

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

const EXAMPLE_MESSAGES_PROMPT = `Generate 3 example listings that could match the user's query.

## Example types
1. Exact match — perfectly fits the query
2. Price/condition variation — similar item but different terms
3. Alternative — related item/service that might not fit

## Each example MUST contain
- Realistic price for this item/service (research the market!)
- City or district
- Contact (DM, @username, phone...)
- Condition (used, new, negotiable)
- Emojis like in real listings
- 2-4 sentences

## IMPORTANT about prices
- iPhone 14: $600-900 (NOT $50)
- MacBook Pro: $1000-2500 (NOT $150)
- Used bicycle: $50-300
- Used sofa: $30-150
Research real market prices!

Respond ONLY with JSON:
{
  "examples": [
    {"text": "listing text 1", "variation": "exact"},
    {"text": "listing text 2", "variation": "price"},
    {"text": "listing text 3", "variation": "alternative"}
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
    groupTitle: "Example",
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

const KEYWORDS_WITH_RATINGS_PROMPT = `You are a keyword extraction assistant for search queries.
User has rated example listings — consider this feedback!

## Feedback types

🔥 Hot = perfect match!
   - Extract the TYPE of product/service
   - If user's QUERY has specifics (brand, characteristic) — include them
   - Example shows EXACTLY what's needed

☀️ Warm = right type but not quite
   - Extract only the CATEGORY/TYPE
   - IGNORE specifics from example (sizes, colors, brands)
   - Example shows direction, not the standard

❄️ Cold = doesn't fit
   - Understand what to EXCLUDE by type
   - Add characteristic words to negative_keywords

## CRITICALLY IMPORTANT — what NOT to extract from examples:
- DO NOT extract specific sizes (46, S, W30, 42-44)
- DO NOT extract specific brands unless in user's original query
- DO NOT extract specific prices or price ranges
- DO NOT extract specific colors unless in query
- DO NOT extract specific styles (baggy, slim) unless in query
- DO NOT extract specific characteristics from examples

Examples are ONLY for understanding:
- What TYPE of listings is relevant (sale vs services)
- What CATEGORY of products/services fits
- What to EXCLUDE by type (e.g., construction services)

## Generation rules

### positive_keywords (50-100 words)
- Main product/service from user's QUERY
- ALL subtypes/variants of this product/service
- Synonyms, colloquial forms, transliteration
- DO NOT add specific brands/sizes/colors from examples

### negative_keywords
- Words to exclude irrelevant TYPES of content
- Typical words from "cold" examples (services, rental, repair — if not needed)
- Standard spam filters

**CRITICAL — Listing type (buying vs selling):**
Determine user intent and EXCLUDE opposite type:
- If BUYING → negative: buyer keywords (куплю, ищу, looking for, WTB)
- If SELLING → negative: seller keywords (продам, продаю, selling, for sale)
- If OFFERING services → negative: provider keywords
- If SEEKING services → negative: job seeker keywords

### description
Brief GENERAL description of what user is looking for.
DO NOT include specific sizes, brands, styles — only general category.
Example: "men's jeans" NOT "men's ASOS jeans size W30 baggy style"

## Response format
ONLY JSON:
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
    feedbackLines.push("🔥 Hot (relevant):");
    hot.forEach((r) => feedbackLines.push(`  "${r.text.slice(0, 200)}..."`));
  }

  if (warm.length > 0) {
    feedbackLines.push("☀️ Warm (partially):");
    warm.forEach((r) => feedbackLines.push(`  "${r.text.slice(0, 200)}..."`));
  }

  if (cold.length > 0) {
    feedbackLines.push("❄️ Cold (irrelevant):");
    cold.forEach((r) => feedbackLines.push(`  "${r.text.slice(0, 200)}..."`));
  }

  const feedbackSection = feedbackLines.length > 0
    ? `\n\nUser ratings:\n${feedbackLines.join("\n")}`
    : "";

  const userMessage = clarificationContext
    ? `Query: ${query}${clarificationContext}${feedbackSection}`
    : `Query: ${query}${feedbackSection}`;

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

const CORRECT_DESCRIPTION_PROMPT = `You are an assistant for refining search queries.
User wants to adjust the description of what they're looking for.

## Your task
1. Understand the original user query (what they were looking for initially)
2. Understand what user wants to change/refine
3. Create a new description combining original meaning with refinements

## Rules
- Description must PRESERVE the essence of original query
- Add refinements from user's instruction
- Description should be brief (1-2 sentences)
- Don't lose important details from original query
- Don't add specific sizes, brands, colors unless user explicitly asks
- Focus on CATEGORY and TYPE of product/service
- Consider exclusions (what is NOT needed)

## Response format
ONLY JSON:
{
  "description": "new description",
  "summary": "what changed (briefly)"
}`;

interface DescriptionCorrectionResult {
  description: string;
  summary: string;
}

// =====================================================
// Extract keywords from message text (for criteria expansion)
// =====================================================

const EXTRACT_KEYWORDS_PROMPT = `Extract 5-15 keywords/phrases from message text that could be useful for finding similar listings.

Include:
- Product/service names
- Brands and models
- Characteristics and parameters
- Relevant adjectives

DO NOT include:
- Stop words (and, in, on, for, with)
- Contact information
- Prices and currencies
- Emojis

Respond ONLY with JSON array of strings:
["word1", "word2", ...]`;

/**
 * Extract keywords from message text for criteria expansion
 * Used when user wants to expand subscription criteria based on a forwarded message
 */
export async function extractKeywordsFromText(text: string): Promise<string[]> {
  try {
    const response = await withRetry(async () => {
      const result = await hf.chatCompletion({
        model: MODELS.DEEPSEEK_R1,
        provider: "novita",
        messages: [
          { role: "system", content: EXTRACT_KEYWORDS_PROMPT },
          { role: "user", content: text.slice(0, 2000) }, // Limit text length
        ],
        max_tokens: 500,
        temperature: 0.4,
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
        return parsed.filter((k) => typeof k === "string" && k.length > 1);
      }
    }
  } catch (e) {
    llmLog.error({ error: e, textLen: text.length }, "extractKeywordsFromText failed");
  }

  // Fallback to simple tokenization
  return generateKeywordsFallback(text).positive_keywords.slice(0, 10);
}

// =====================================================
// Description correction (for normal mode)
// =====================================================

export async function correctDescription(
  originalQuery: string,
  currentDescription: string,
  userInstruction: string
): Promise<DescriptionCorrectionResult> {
  const userMessage = `Original user query: "${originalQuery}"

Current description: "${currentDescription}"

What user wants to change: ${userInstruction}`;

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
      summary: parsed.summary || "Description updated",
    };
  } catch {
    throw new Error(`Invalid JSON in LLM response: ${match[0]}`);
  }
}
