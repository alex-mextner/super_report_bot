import { hf, MODELS, withRetry } from "./index.ts";
import { llmLog } from "../logger.ts";
import type { Subscription, IncomingMessage } from "../types.ts";

export interface VerificationResult {
  isMatch: boolean;
  confidence: number;
  label: string;
}

interface ZeroShotResult {
  labels: string[];
  scores: number[];
  sequence: string;
}

/**
 * Verify if a message matches a subscription using zero-shot classification
 * Uses BART-MNLI for natural language inference
 */
export async function verifyMatch(
  message: IncomingMessage,
  subscription: Subscription
): Promise<VerificationResult> {
  const text = message.text;
  const description = subscription.llm_description;

  // Zero-shot classification: does the message match the description?
  const results = await withRetry(async () => {
    return await hf.zeroShotClassification({
      model: MODELS.BART_MNLI,
      inputs: text,
      parameters: {
        candidate_labels: [
          `This message matches: ${description}`,
          "This message does not match the search criteria",
        ],
      },
    });
  });

  // Result can be single object or array depending on input type
  const result = Array.isArray(results)
    ? (results as unknown as ZeroShotResult[])[0]
    : (results as unknown as ZeroShotResult);
  if (!result) {
    return { isMatch: false, confidence: 0, label: "no_result" };
  }

  const matchIndex = result.labels.findIndex((l) => l.includes("matches"));
  const matchScore = matchIndex >= 0 ? result.scores[matchIndex] ?? 0 : 0;
  const isMatch = matchScore > 0.6;

  llmLog.debug(
    {
      subscriptionId: subscription.id,
      confidence: matchScore.toFixed(3),
      isMatch,
      textPreview: text.slice(0, 50),
    },
    isMatch ? "LLM match" : "LLM no match"
  );

  return {
    isMatch,
    confidence: matchScore,
    label: result.labels[0] ?? "unknown",
  };
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
