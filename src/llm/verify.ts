import { llmLog } from "../logger.ts";
import { verifyMessage, verifyMessageBatch } from "./index.ts";
import { verifyWithVision, matchPhotosToItems } from "./vision.ts";
import { splitMessageToItems } from "./split.ts";
import type { Subscription, IncomingMessage, ItemVerificationResult } from "../types.ts";

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
  let visionReasoning: string | undefined;
  let visionFailed = false;

  if (hasPhoto) {
    try {
      const firstPhoto = message.media!.find((m) => m.type === "photo")!;
      const visionResult = await verifyWithVision(firstPhoto.buffer, description, text);

      llmLog.debug(
        {
          subscriptionId: subscription.id,
          visionConfidence: visionResult.confidence.toFixed(3),
          visionMatch: visionResult.isMatch,
        },
        "Vision verification result"
      );

      // If Vision is confident enough, use its result directly
      if (visionResult.confidence >= VISION_CONFIDENCE_THRESHOLD) {
        return {
          isMatch: visionResult.isMatch,
          confidence: visionResult.confidence,
          label: visionResult.isMatch ? "vision_match" : "vision_no_match",
          reasoning: visionResult.reasoning,
        };
      }

      // Vision uncertain — save reasoning with disclaimer
      visionReasoning = `📷 Could not confidently recognize photo: ${visionResult.reasoning || "no description"}`;
      llmLog.debug(
        { subscriptionId: subscription.id },
        "Vision uncertain, falling back to text"
      );
    } catch (error) {
      llmLog.warn(
        { err: error, subscriptionId: subscription.id },
        "Vision verification failed, falling back to text"
      );
      visionFailed = true;
      // Continue to text-based verification
    }
  }

  // Text-based verification with DeepSeek
  // Pass hasPhoto flag so DeepSeek doesn't guess about photo content from emojis
  try {
    const result = await verifyMessage(text, description, hasPhoto);

    const isMatch = result.isMatch && result.confidence >= DEEPSEEK_CONFIDENCE_THRESHOLD;

    // Log with appropriate level based on confidence
    const logData = {
      subscriptionId: subscription.id,
      confidence: result.confidence.toFixed(3),
      isMatch,
      textPreview: text.slice(0, 80),
      description: description.slice(0, 50),
      hasPhoto,
      visionFailed,
    };

    if (isMatch) {
      llmLog.debug(logData, "DeepSeek match");
    } else if (result.confidence >= 0.5) {
      // Near-threshold rejection — log at info level for monitoring
      llmLog.info(logData, "DeepSeek near-threshold rejection");
    } else {
      llmLog.debug(logData, "DeepSeek no match");
    }

    // Build reasoning: prefer Vision reasoning if available (even if uncertain)
    let finalReasoning: string | undefined;
    if (visionReasoning) {
      // Vision was uncertain — use its reasoning with disclaimer
      finalReasoning = visionReasoning;
    } else if (visionFailed && hasPhoto) {
      // Vision failed completely — add disclaimer to DeepSeek reasoning
      finalReasoning = `📷 Could not analyze photo. ${result.reasoning || ""}`.trim();
    } else {
      // No photo or Vision wasn't attempted
      finalReasoning = result.reasoning;
    }

    return {
      isMatch,
      confidence: result.confidence,
      label: visionReasoning ? "vision_uncertain_text_verified" : (result.isMatch ? "text_match" : "text_no_match"),
      reasoning: finalReasoning,
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
      reasoning: hasPhoto ? "📷 Could not analyze message" : undefined,
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

export interface BatchMessageInput {
  index: number;
  message: IncomingMessage;
}

/**
 * Batch verify multiple messages against a single subscription
 * Optimized for history scanning: batch text-only messages, process photos individually
 *
 * @param messages - array of messages with indices
 * @param subscription - the subscription to verify against
 * @returns Map from message index to verification result
 */
export async function verifyMatchBatch(
  messages: BatchMessageInput[],
  subscription: Subscription
): Promise<Map<number, VerificationResult>> {
  const results = new Map<number, VerificationResult>();

  if (messages.length === 0) {
    return results;
  }

  // Separate messages with and without photos
  const withPhoto: BatchMessageInput[] = [];
  const textOnly: BatchMessageInput[] = [];

  for (const item of messages) {
    const hasPhoto = item.message.media?.some((m) => m.type === "photo");
    if (hasPhoto) {
      withPhoto.push(item);
    } else {
      textOnly.push(item);
    }
  }

  llmLog.info(
    {
      total: messages.length,
      withPhoto: withPhoto.length,
      textOnly: textOnly.length,
      subscriptionId: subscription.id,
    },
    "Starting batch verification"
  );

  // Process text-only messages in batch
  if (textOnly.length > 0) {
    try {
      const batchInput = textOnly.map((item) => ({
        index: item.index,
        text: item.message.text,
      }));

      const batchResults = await verifyMessageBatch(
        batchInput,
        subscription.llm_description
      );

      for (const result of batchResults) {
        const isMatch = result.isMatch && result.confidence >= DEEPSEEK_CONFIDENCE_THRESHOLD;
        results.set(result.index, {
          isMatch,
          confidence: result.confidence,
          label: isMatch ? "batch_match" : "batch_no_match",
          reasoning: result.reasoning,
        });
      }
    } catch (error) {
      llmLog.error({ error, count: textOnly.length }, "Batch verification failed, falling back to sequential");
      // Fallback: process sequentially
      for (const item of textOnly) {
        try {
          const result = await verifyMatch(item.message, subscription);
          results.set(item.index, result);
        } catch {
          results.set(item.index, {
            isMatch: false,
            confidence: 0,
            label: "error",
          });
        }
      }
    }
  }

  // Process messages with photos individually (need Vision API)
  for (const item of withPhoto) {
    try {
      const result = await verifyMatch(item.message, subscription);
      results.set(item.index, result);
    } catch (error) {
      llmLog.error({ error, index: item.index }, "Vision verification failed");
      results.set(item.index, {
        isMatch: false,
        confidence: 0,
        label: "error",
        reasoning: "📷 Could not analyze photo",
      });
    }
  }

  llmLog.info(
    {
      total: messages.length,
      matched: Array.from(results.values()).filter((r) => r.isMatch).length,
    },
    "Batch verification complete"
  );

  return results;
}

/**
 * Verify message with multi-item support
 * Splits message into separate items if needed, verifies each, and returns only matched items
 *
 * @param message - Incoming message
 * @param subscription - Subscription to verify against
 * @returns Extended result with matched items and their photos
 */
export async function verifyMatchWithItems(
  message: IncomingMessage,
  subscription: Subscription
): Promise<ItemVerificationResult> {
  const description = subscription.llm_description;

  // Step 1: Split message into items
  const splitResult = await splitMessageToItems(message.text);

  llmLog.debug(
    {
      subscriptionId: subscription.id,
      itemCount: splitResult.items.length,
      isSingleItem: splitResult.isSingleItem,
    },
    "Message split for verification"
  );

  // If single item, use existing verifyMatch for backward compatibility
  if (splitResult.isSingleItem) {
    const result = await verifyMatch(message, subscription);
    return {
      ...result,
      matchedItems: result.isMatch ? [message.text] : [],
      matchedPhotoIndices: result.isMatch
        ? message.media?.map((_, i) => i).filter((i) => message.media?.[i]?.type === "photo") ?? []
        : [],
    };
  }

  // Step 2: Verify each item
  const batchInput = splitResult.items.map((text, index) => ({
    index,
    text,
  }));

  const hasPhoto = message.media?.some((m) => m.type === "photo");

  let batchResults;
  try {
    batchResults = await verifyMessageBatch(batchInput, description);
  } catch (error) {
    llmLog.error({ error, subscriptionId: subscription.id }, "Batch item verification failed");
    // Fallback to single-item logic
    const result = await verifyMatch(message, subscription);
    return {
      ...result,
      matchedItems: result.isMatch ? [message.text] : [],
      matchedPhotoIndices: result.isMatch
        ? message.media?.map((_, i) => i).filter((i) => message.media?.[i]?.type === "photo") ?? []
        : [],
    };
  }

  // Collect matched item indices and texts
  const matchedItemIndices: number[] = [];
  const matchedItems: string[] = [];
  let maxConfidence = 0;
  const reasonings: string[] = [];

  for (const result of batchResults) {
    const isMatch = result.isMatch && result.confidence >= DEEPSEEK_CONFIDENCE_THRESHOLD;
    if (isMatch) {
      matchedItemIndices.push(result.index);
      matchedItems.push(splitResult.items[result.index]!);
      if (result.reasoning) {
        reasonings.push(result.reasoning);
      }
    }
    if (result.confidence > maxConfidence) {
      maxConfidence = result.confidence;
    }
  }

  llmLog.debug(
    {
      subscriptionId: subscription.id,
      totalItems: splitResult.items.length,
      matchedItems: matchedItemIndices.length,
    },
    "Item verification results"
  );

  // No matches
  if (matchedItems.length === 0) {
    return {
      isMatch: false,
      confidence: maxConfidence,
      label: "items_no_match",
      reasoning: reasonings[0],
      matchedItems: [],
      matchedPhotoIndices: [],
    };
  }

  // Step 3: Match photos to items (if there are photos)
  let matchedPhotoIndices: number[] = [];

  if (hasPhoto && message.media) {
    const photos = message.media
      .map((m, i) => ({ index: i, buffer: m.buffer, type: m.type }))
      .filter((p) => p.type === "photo");

    if (photos.length > 0) {
      try {
        const photoMappings = await matchPhotosToItems(
          photos.map((p) => ({ index: p.index, buffer: p.buffer })),
          splitResult.items
        );

        // Get photos that belong to matched items
        matchedPhotoIndices = photoMappings
          .filter(
            (mapping) =>
              mapping.itemIndex !== null && matchedItemIndices.includes(mapping.itemIndex)
          )
          .map((mapping) => mapping.photoIndex);

        // If no photos matched to specific items, include all photos (fallback)
        if (matchedPhotoIndices.length === 0 && photos.length > 0) {
          llmLog.debug(
            { subscriptionId: subscription.id },
            "No photos mapped to matched items, including all photos"
          );
          matchedPhotoIndices = photos.map((p) => p.index);
        }
      } catch (error) {
        llmLog.error({ error, subscriptionId: subscription.id }, "Photo mapping failed, including all photos");
        matchedPhotoIndices = photos.map((p) => p.index);
      }
    }
  }

  llmLog.info(
    {
      subscriptionId: subscription.id,
      matchedItems: matchedItems.length,
      matchedPhotos: matchedPhotoIndices.length,
      totalPhotos: message.media?.filter((m) => m.type === "photo").length ?? 0,
    },
    "Multi-item verification complete"
  );

  return {
    isMatch: true,
    confidence: maxConfidence,
    label: "items_match",
    reasoning: reasonings.length > 0 ? reasonings.join("; ") : undefined,
    matchedItems,
    matchedPhotoIndices,
  };
}
