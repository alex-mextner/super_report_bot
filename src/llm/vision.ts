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
 */
export async function verifyWithVision(
  imageBuffer: Uint8Array,
  subscriptionDescription: string
): Promise<VisionVerificationResult> {
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

  const prompt = `You are a product classifier. Look at this image and determine if it matches this search criteria: "${subscriptionDescription}"

Analyze the image carefully and respond ONLY with a JSON object in this exact format:
{"match": true/false, "confidence": 0.0-1.0, "reason": "brief explanation in Russian"}

Be strict but reasonable:
- Match if the product/item in the image clearly matches the search criteria
- Don't match if the image shows something different or unrelated
- Consider visual characteristics, brand, type, condition visible in image`;

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
 */
export async function analyzeListingImage(
  imageBuffer: Uint8Array,
  listingText?: string
): Promise<ListingImageAnalysis> {
  const base64Image = Buffer.from(imageBuffer).toString("base64");
  const imageDataUrl = `data:image/jpeg;base64,${base64Image}`;

  const textContext = listingText
    ? `Текст объявления:
${listingText.slice(0, 1000)}

`
    : "";

  const prompt = `Ты анализируешь фото товара из объявления о продаже.

${textContext}Проанализируй фото и определи:
1. Что за товар (краткое описание)
2. Состояние товара: new/used/unknown
3. Детали состояния: царапины, потёртости, сколы, недостающие части, признаки использования
4. Качество фото: real_photo/stock_photo/screenshot
5. Соответствует ли фото описанию в тексте (если текст предоставлен)?

Особое внимание:
- Если текст говорит "новый/new", а на фото видны признаки использования — это расхождение
- Если текст говорит "б/у" но фото явно стоковое — это подозрительно
- Если не видно товар чётко — это подозрительно
- Стоковое фото: профессиональное освещение, белый фон, водяные знаки
- Скриншот: UI телефона, элементы браузера

Верни ТОЛЬКО JSON:
{
  "description": "краткое описание товара по-русски (бренд, тип, цвет)",
  "condition": "new" | "used" | "unknown",
  "conditionDetails": "детальное описание состояния по-русски (царапины, потёртости, комплектность)",
  "conditionMismatch": true/false,
  "mismatchReason": "объяснение расхождения по-русски или null если нет расхождения",
  "quality": "real_photo" | "stock_photo" | "screenshot" | "unknown",
  "suspiciousFlags": ["список подозрительных признаков по-русски, пустой если нет"]
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
