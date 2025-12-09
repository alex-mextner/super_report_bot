import { llmLog } from "../logger.ts";
import { verifyWithDeepSeek } from "./deepseek.ts";
import { verifyWithVision } from "./vision.ts";
import type { Subscription, IncomingMessage } from "../types.ts";

export interface VerificationResult {
  isMatch: boolean;
  confidence: number;
  label: string;
  // Reasoning from LLM explaining why message matches/doesn't match
  reasoning?: string;
}

// Minimum confidence threshold for DeepSeek verification
const DEEPSEEK_CONFIDENCE_THRESHOLD = 0.7;
// Minimum confidence threshold for Vision verification to be decisive
const VISION_CONFIDENCE_THRESHOLD = 0.75;

/**
 * Verify if a message matches a subscription
 * Uses Vision model first if photo is present, then falls back to text-based DeepSeek
 */
export async function verifyMatch(
  message: IncomingMessage,
  subscription: Subscription
): Promise<VerificationResult> {
  const text = message.text;
  const description = subscription.llm_description;

  // Try Vision verification first if there's a photo
  const hasPhoto = message.media?.some((m) => m.type === "photo");
  if (hasPhoto) {
    try {
      const firstPhoto = message.media!.find((m) => m.type === "photo")!;
      const visionResult = await verifyWithVision(firstPhoto.buffer, description);

      llmLog.debug(
        {
          subscriptionId: subscription.id,
          visionConfidence: visionResult.confidence.toFixed(3),
          visionMatch: visionResult.isMatch,
        },
        "Vision verification result"
      );

      // If Vision is confident enough, use its result
      if (visionResult.confidence >= VISION_CONFIDENCE_THRESHOLD) {
        return {
          isMatch: visionResult.isMatch,
          confidence: visionResult.confidence,
          label: visionResult.isMatch ? "vision_match" : "vision_no_match",
          reasoning: visionResult.reasoning,
        };
      }
      // Otherwise, fall through to text verification
      llmLog.debug(
        { subscriptionId: subscription.id },
        "Vision uncertain, falling back to text"
      );
    } catch (error) {
      llmLog.warn(
        { err: error, subscriptionId: subscription.id },
        "Vision verification failed, falling back to text"
      );
      // Continue to text-based verification
    }
  }

  // Text-based verification with DeepSeek
  try {
    const result = await verifyWithDeepSeek(text, description);

    const isMatch = result.isMatch && result.confidence >= DEEPSEEK_CONFIDENCE_THRESHOLD;

    // Log with appropriate level based on confidence
    const logData = {
      subscriptionId: subscription.id,
      confidence: result.confidence.toFixed(3),
      isMatch,
      textPreview: text.slice(0, 80),
      description: description.slice(0, 50),
    };

    if (isMatch) {
      llmLog.debug(logData, "DeepSeek match");
    } else if (result.confidence >= 0.5) {
      // Near-threshold rejection — log at info level for monitoring
      llmLog.info(logData, "DeepSeek near-threshold rejection");
    } else {
      llmLog.debug(logData, "DeepSeek no match");
    }

    return {
      isMatch,
      confidence: result.confidence,
      label: result.isMatch ? "text_match" : "text_no_match",
      reasoning: result.reasoning,
    };
  } catch (error) {
    llmLog.error(
      { subscriptionId: subscription.id, error },
      "DeepSeek verification failed"
    );

    // Return no match on error (safe fallback)
    return {
      isMatch: false,
      confidence: 0,
      label: "error",
      reasoning: undefined,
    };
  }
}

/**
 * Batch verify multiple matches
 * Useful when multiple subscriptions matched the same message
 */
export async function verifyMatches(
  message: IncomingMessage,
  subscriptions: Subscription[]
): Promise<Map<number, VerificationResult>> {
  const results = new Map<number, VerificationResult>();

  // Process sequentially to avoid rate limits
  for (const subscription of subscriptions) {
    try {
      const result = await verifyMatch(message, subscription);
      results.set(subscription.id, result);
    } catch (error) {
      llmLog.error({ err: error, subscriptionId: subscription.id }, "Failed to verify match");
      // On error, assume no match
      results.set(subscription.id, {
        isMatch: false,
        confidence: 0,
        label: "error",
      });
    }
  }

  return results;
}
