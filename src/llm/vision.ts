/**
 * Vision LLM verification using Qwen VL via HuggingFace Inference API
 *
 * Uses the image to verify if product matches subscription description
 */

import { llmLog } from "../logger.ts";
import { hf, withRetry } from "./index.ts";

const QWEN_VL_MODEL = "Qwen/Qwen3-VL-235B-A22B-Thinking";

export interface VisionVerificationResult {
  isMatch: boolean;
  confidence: number;
  reasoning?: string;
}

/**
 * Verify if image matches subscription description using Qwen VL
 *
 * @param imageBuffer - Photo data to analyze
 * @param subscriptionDescription - What user is searching for (e.g. "стеллаж IKEA белый")
 * @param listingText - Original listing text to understand context (e.g. "Продаю 3к квартиру...")
 * @param language - Language for the response reasoning (default: Russian)
 */
export async function verifyWithVision(
  imageBuffer: Uint8Array,
  subscriptionDescription: string,
  listingText?: string,
  language: string = "Russian"
): Promise<VisionVerificationResult> {
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

  const listingContext = listingText
    ? `\nListing text (what is actually being sold):\n"${listingText.slice(0, 500)}"\n`
    : "";

  const prompt = `You are a product classifier. Analyze the image and determine if it matches the search criteria.

Rules:
- Match if the product/item in the image clearly matches the search criteria
- Don't match if the image shows something different or unrelated
- Consider visual characteristics, brand, type, condition visible in image
- DON'T match if the searched item is just a visible COMPONENT of a larger product (e.g. "keyboard" should NOT match laptop photo - buying laptop for keyboard is impractical; "wheels" should NOT match a car photo)
- The item must be the MAIN product for sale, not just visible in the image
- Use the listing text to understand WHAT is being sold. Objects visible in the photo but NOT mentioned as the product in listing are likely just background/staging

Respond ONLY with JSON: {"match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation in ${language}"}

Search criteria: "${subscriptionDescription}"
${listingContext}`;

  try {
    const response = await withRetry(() =>
      hf.chatCompletion({
        model: QWEN_VL_MODEL,
        provider: "novita",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageDataUrl } },
              { type: "text", text: prompt },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.1,
      })
    );

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from vision model");
    }

    const result = parseVisionResponse(content);

    llmLog.debug(
      {
        isMatch: result.isMatch,
        confidence: result.confidence.toFixed(2),
        reasoning: result.reasoning?.slice(0, 50),
      },
      "Vision verification result"
    );

    return result;
  } catch (error) {
    llmLog.error({ error }, "Vision verification failed");
    throw error;
  }
}

/**
 * Parse vision model response to extract match result
 */
function parseVisionResponse(content: string): VisionVerificationResult {
  // Try to extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Fallback: look for keywords
    const lowerContent = content.toLowerCase();
    const isMatch =
      lowerContent.includes('"match": true') ||
      lowerContent.includes('"match":true') ||
      (lowerContent.includes("yes") && !lowerContent.includes("no"));

    return {
      isMatch,
      confidence: isMatch ? 0.6 : 0.4,
      reasoning: content.slice(0, 200),
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isMatch: Boolean(parsed.match),
      confidence:
        typeof parsed.confidence === "number" ? parsed.confidence : parsed.match ? 0.8 : 0.2,
      reasoning: parsed.reason || parsed.reasoning,
    };
  } catch {
    // JSON parse failed, use fallback
    const isMatch = content.toLowerCase().includes('"match": true');
    return {
      isMatch,
      confidence: 0.5,
      reasoning: content.slice(0, 200),
    };
  }
}

/**
 * Check if vision API is available
 */
export async function checkVisionHealth(): Promise<boolean> {
  try {
    // Quick test with minimal request
    const response = await hf.chatCompletion({
      model: QWEN_VL_MODEL,
      provider: "novita",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
    return !!response.choices[0]?.message?.content;
  } catch {
    return false;
  }
}

// ============= Listing Image Analysis =============

export interface ListingImageAnalysis {
  description: string;
  condition: "new" | "used" | "unknown";
  conditionDetails: string; // detailed condition description (scratches, wear, etc)
  conditionMismatch: boolean; // true if photo contradicts listing text
  mismatchReason: string | null; // explanation of mismatch
  suspiciousFlags: string[];
  quality: "real_photo" | "stock_photo" | "screenshot" | "unknown";
}

/**
 * Analyze listing image to describe product and detect suspicious signs
 * @param imageBuffer - image data
 * @param listingText - optional listing text for context and comparison
 * @param language - language for response text (default: Russian)
 */
export async function analyzeListingImage(
  imageBuffer: Uint8Array,
  listingText?: string,
  language: string = "Russian"
): Promise<ListingImageAnalysis> {
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

  const textContext = listingText
    ? `Listing text:
${listingText.slice(0, 1000)}

`
    : "";

  const prompt = `You are analyzing a product photo from a sales listing.

${textContext}Analyze the photo and determine:
1. What product is it (brief description)
2. Product condition: new/used/unknown
3. Condition details: scratches, scuffs, chips, missing parts, signs of use
4. Photo quality: real_photo/stock_photo/screenshot
5. Does the photo match the description in the text (if provided)?

Pay special attention:
- If text says "new" but photo shows signs of use — this is a mismatch
- If text says "used" but photo is clearly stock — this is suspicious
- If product is not clearly visible — this is suspicious
- Stock photo: professional lighting, white background, watermarks
- Screenshot: phone UI, browser elements

Respond ONLY with JSON:
{
  "description": "brief product description in ${language} (brand, type, color)",
  "condition": "new" | "used" | "unknown",
  "conditionDetails": "detailed condition description in ${language} (scratches, scuffs, completeness)",
  "conditionMismatch": true/false,
  "mismatchReason": "explanation of mismatch in ${language} or null if no mismatch",
  "quality": "real_photo" | "stock_photo" | "screenshot" | "unknown",
  "suspiciousFlags": ["list of suspicious signs in ${language}, empty if none"]
}`;

  try {
    const response = await withRetry(() =>
      hf.chatCompletion({
        model: QWEN_VL_MODEL,
        provider: "novita",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageDataUrl } },
              { type: "text", text: prompt },
            ],
          },
        ],
        max_tokens: 400,
        temperature: 0.1,
      })
    );

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error("Empty response from vision model");
    }

    const result = parseListingImageResponse(content);

    llmLog.debug(
      {
        description: result.description?.slice(0, 50),
        condition: result.condition,
        quality: result.quality,
        flags: result.suspiciousFlags.length,
      },
      "Listing image analysis result"
    );

    return result;
  } catch (error) {
    llmLog.error({ error }, "Listing image analysis failed");
    return {
      description: "",
      condition: "unknown",
      conditionDetails: "",
      conditionMismatch: false,
      mismatchReason: null,
      quality: "unknown",
      suspiciousFlags: [],
    };
  }
}

// ============= Photo-to-Item Matching =============

export interface PhotoItemMapping {
  photoIndex: number;
  itemIndex: number | null; // null if could not determine
  confidence: number;
}

/**
 * Match a single photo to one of the item descriptions
 * Returns which item (by index) the photo belongs to
 *
 * @param imageBuffer - Photo data
 * @param itemDescriptions - Array of item texts to match against
 * @returns Matching result with item index (or null if unknown)
 */
export async function matchPhotoToItem(
  imageBuffer: Uint8Array,
  itemDescriptions: string[]
): Promise<{ itemIndex: number | null; confidence: number }> {
  if (itemDescriptions.length === 0) {
    return { itemIndex: null, confidence: 0 };
  }

  if (itemDescriptions.length === 1) {
    // Only one item - photo must belong to it
    return { itemIndex: 0, confidence: 1.0 };
  }

  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

  // Build numbered list of items
  const itemsList = itemDescriptions
    .map((desc, i) => `${i + 1}. ${desc.slice(0, 300)}`)
    .join("\n\n");

  const prompt = `This photo shows a product from a listing. Which of these descriptions does it belong to?

${itemsList}

IMPORTANT:
- If the product in the photo clearly matches one of the descriptions, provide its number
- If you cannot determine exactly, answer 0

Respond ONLY with JSON: {"item": number (1-${itemDescriptions.length}) or 0, "confidence": 0.0-1.0}`;

  try {
    const response = await withRetry(() =>
      hf.chatCompletion({
        model: QWEN_VL_MODEL,
        provider: "novita",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageDataUrl } },
              { type: "text", text: prompt },
            ],
          },
        ],
        max_tokens: 100,
        temperature: 0.1,
      })
    );

    const content = response.choices[0]?.message?.content;

    if (!content) {
      return { itemIndex: null, confidence: 0 };
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { itemIndex: null, confidence: 0 };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const itemNum = typeof parsed.item === "number" ? parsed.item : 0;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;

    // Convert 1-based to 0-based index, 0 means unknown
    const itemIndex = itemNum > 0 && itemNum <= itemDescriptions.length ? itemNum - 1 : null;

    llmLog.debug({ itemNum, itemIndex, confidence }, "Photo-to-item match result");

    return { itemIndex, confidence };
  } catch (error) {
    llmLog.error({ error }, "Failed to match photo to item");
    return { itemIndex: null, confidence: 0 };
  }
}

/**
 * Match multiple photos to items
 * Processes photos in parallel for speed
 *
 * @param photos - Array of photo buffers with indices
 * @param itemDescriptions - Array of item texts
 * @returns Array of mappings from photo index to item index
 */
export async function matchPhotosToItems(
  photos: Array<{ index: number; buffer: Uint8Array }>,
  itemDescriptions: string[]
): Promise<PhotoItemMapping[]> {
  if (photos.length === 0 || itemDescriptions.length === 0) {
    return [];
  }

  // If only one item, all photos belong to it
  if (itemDescriptions.length === 1) {
    return photos.map((p) => ({
      photoIndex: p.index,
      itemIndex: 0,
      confidence: 1.0,
    }));
  }

  // Process photos in parallel (limit concurrency to 3)
  const results: PhotoItemMapping[] = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < photos.length; i += CONCURRENCY) {
    const batch = photos.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (photo) => {
        const match = await matchPhotoToItem(photo.buffer, itemDescriptions);
        return {
          photoIndex: photo.index,
          itemIndex: match.itemIndex,
          confidence: match.confidence,
        };
      })
    );
    results.push(...batchResults);
  }

  llmLog.debug(
    {
      totalPhotos: photos.length,
      mapped: results.filter((r) => r.itemIndex !== null).length,
      unmapped: results.filter((r) => r.itemIndex === null).length,
    },
    "Photos-to-items matching complete"
  );

  return results;
}

function parseListingImageResponse(content: string): ListingImageAnalysis {
  const defaultResult: ListingImageAnalysis = {
    description: content.slice(0, 200),
    condition: "unknown",
    conditionDetails: "",
    conditionMismatch: false,
    mismatchReason: null,
    quality: "unknown",
    suspiciousFlags: [],
  };

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return defaultResult;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      description: parsed.description || "",
      condition: ["new", "used", "unknown"].includes(parsed.condition)
        ? parsed.condition
        : "unknown",
      conditionDetails: parsed.conditionDetails || "",
      conditionMismatch: Boolean(parsed.conditionMismatch),
      mismatchReason: parsed.mismatchReason || null,
      quality: ["real_photo", "stock_photo", "screenshot", "unknown"].includes(parsed.quality)
        ? parsed.quality
        : "unknown",
      suspiciousFlags: Array.isArray(parsed.suspiciousFlags) ? parsed.suspiciousFlags : [],
    };
  } catch {
    return defaultResult;
  }
}
