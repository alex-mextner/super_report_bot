/**
 * Vision LLM verification using Qwen3-VL via HuggingFace Inference API
 *
 * Uses the image to verify if product matches subscription description
 */

import { llmLog } from "../logger.ts";

const HF_TOKEN = process.env.HF_TOKEN;
const QWEN_VL_MODEL = "Qwen/Qwen2.5-VL-72B-Instruct"; // More stable than 235B Thinking

if (!HF_TOKEN) {
  llmLog.warn("HF_TOKEN not set. Vision verification will not work.");
}

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
  if (!HF_TOKEN) {
    throw new Error("HF_TOKEN not configured");
  }

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
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${QWEN_VL_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageDataUrl } },
                { type: "text", text: prompt },
              ],
            },
          ],
          parameters: {
            max_new_tokens: 300,
            temperature: 0.1,
            return_full_text: false,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HuggingFace API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as
      | { generated_text: string }
      | Array<{ generated_text: string }>;
    const content = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text;

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
  if (!HF_TOKEN) return false;

  try {
    // Simple status check
    const response = await fetch(
      `https://api-inference.huggingface.co/status/${QWEN_VL_MODEL}`,
      {
        headers: { Authorization: `Bearer ${HF_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) return false;

    const data = (await response.json()) as { state?: string };
    return data.state === "Loadable" || data.state === "Loaded";
  } catch {
    return false;
  }
}
