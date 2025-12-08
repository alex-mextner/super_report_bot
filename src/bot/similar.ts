import { getMessages, getAllCachedMessages } from "../cache/messages.ts";
import { calculateKeywordNgramSimilarity } from "../matcher/ngram.ts";
import type { RatingExample } from "../types.ts";
import { botLog } from "../logger.ts";

export interface SimilarMessage {
  id: number;
  text: string;
  groupId: number;
  groupTitle: string;
  score: number;
}

/**
 * Find similar messages in cache by keywords
 * Returns top N messages sorted by similarity score
 */
export function findSimilarMessages(
  keywords: string[],
  groupIds: number[],
  maxResults: number = 3,
  negativeKeywords: string[] = [],
  threshold: number = 0.25
): SimilarMessage[] {
  if (keywords.length === 0) return [];

  const scored: SimilarMessage[] = [];

  // Get messages from specified groups or all cached
  const messagesToCheck =
    groupIds.length > 0
      ? groupIds.flatMap((gid) => getMessages(gid))
      : getAllCachedMessages();

  botLog.debug(
    { keywords: keywords.slice(0, 5), groupIds, messagesCount: messagesToCheck.length },
    "Searching for similar messages"
  );

  // Pre-compute negative keywords set for fast lookup
  const negativeSet = new Set(negativeKeywords.map((k) => k.toLowerCase()));

  for (const msg of messagesToCheck) {
    // Skip very short messages
    if (!msg.text || msg.text.length < 20) continue;

    // Check for negative keywords
    const textLower = msg.text.toLowerCase();
    let hasNegative = false;
    for (const neg of negativeSet) {
      if (textLower.includes(neg)) {
        hasNegative = true;
        break;
      }
    }
    if (hasNegative) continue;

    // Calculate similarity score
    const score = calculateKeywordNgramSimilarity(msg.text, keywords);

    if (score >= threshold) {
      scored.push({
        id: msg.id,
        text: msg.text,
        groupId: msg.groupId,
        groupTitle: msg.groupTitle,
        score,
      });
    }
  }

  // Sort by score descending and take top N
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, maxResults);

  botLog.debug(
    { found: scored.length, returned: results.length, threshold },
    "Similar messages search complete"
  );

  return results;
}

/**
 * Find similar messages with progressive threshold relaxation
 * First tries standard threshold, then relaxes it to find more matches
 */
export function findSimilarWithFallback(
  keywords: string[],
  groupIds: number[],
  maxResults: number = 3,
  negativeKeywords: string[] = []
): SimilarMessage[] {
  // Thresholds to try in order (progressively relaxed)
  const thresholds = [0.25, 0.15, 0.05];

  for (const threshold of thresholds) {
    const results = findSimilarMessages(
      keywords,
      groupIds,
      maxResults,
      negativeKeywords,
      threshold
    );

    if (results.length >= maxResults) {
      botLog.debug({ threshold, found: results.length }, "Found enough similar messages");
      return results;
    }

    // If we found some but not enough, keep what we have at this threshold
    // and continue trying lower thresholds for remaining slots
    if (results.length > 0 && threshold === thresholds[thresholds.length - 1]) {
      return results;
    }
  }

  // Return whatever we found at the lowest threshold
  return findSimilarMessages(keywords, groupIds, maxResults, negativeKeywords, 0.01);
}

/**
 * Convert SimilarMessage to RatingExample format
 */
export function toRatingExamples(messages: SimilarMessage[]): RatingExample[] {
  return messages.map((msg) => ({
    id: msg.id,
    text: msg.text,
    groupId: msg.groupId,
    groupTitle: msg.groupTitle,
    isGenerated: false,
  }));
}
