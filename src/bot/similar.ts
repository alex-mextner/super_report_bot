import { getMessages, getAllCachedMessages } from "../cache/messages.ts";
import { calculateKeywordNgramSimilarity } from "../matcher/ngram.ts";
import { semanticSearch } from "../embeddings/search.ts";
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
 * Simple tokenization for N-gram fallback (no LLM needed)
 * Extracts meaningful words from query
 */
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // keep letters, numbers, spaces
    .split(/\s+/)
    .filter((w) => w.length >= 2) // skip single chars
    .slice(0, 10); // limit tokens
}

/**
 * Find similar messages using semantic search with N-gram fallback
 * Returns top N messages sorted by similarity score
 *
 * @param query - user's search query text
 * @param groupIds - groups to search in
 * @param maxResults - max number of results
 * @param negativeKeywords - words to exclude from results
 */
export async function findSimilarMessages(
  query: string,
  groupIds: number[],
  maxResults: number = 3,
  negativeKeywords: string[] = []
): Promise<SimilarMessage[]> {
  if (!query || query.trim().length === 0) return [];

  // Pre-compute negative keywords set for filtering
  const negativeSet = new Set(negativeKeywords.map((k) => k.toLowerCase()));

  try {
    // Semantic search via BGE-M3 + sqlite-vec
    const similar = await semanticSearch(
      query,
      maxResults * 3, // fetch more to filter
      groupIds.length > 0 ? groupIds : undefined
    );

    botLog.debug(
      { query: query.slice(0, 50), groupIds, found: similar.length },
      "Semantic search for similar messages"
    );

    // Filter by negative keywords and convert format
    const results = similar
      .filter((msg) => {
        const textLower = msg.text.toLowerCase();
        return !Array.from(negativeSet).some((neg) => textLower.includes(neg));
      })
      .map((msg) => ({
        id: msg.id,
        text: msg.text,
        groupId: msg.groupId,
        groupTitle: msg.groupTitle ?? "",
        score: 1 - msg.distance, // distance → score (lower distance = higher score)
      }))
      .slice(0, maxResults);

    botLog.debug(
      { found: results.length, maxResults },
      "Semantic similar messages search complete"
    );

    return results;
  } catch (error) {
    // Fallback to N-gram search if semantic search fails
    botLog.warn({ err: error }, "Semantic search failed, falling back to N-gram");
    const keywords = tokenizeQuery(query);
    return findSimilarByNgram(keywords, groupIds, maxResults, negativeKeywords);
  }
}

/**
 * Fallback: N-gram based similarity search (used when BGE unavailable)
 */
function findSimilarByNgram(
  keywords: string[],
  groupIds: number[],
  maxResults: number,
  negativeKeywords: string[],
  threshold: number = 0.15
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
    "N-gram fallback: searching for similar messages"
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
    "N-gram similar messages search complete"
  );

  return results;
}

/**
 * Find similar messages with progressive threshold relaxation
 * First tries semantic search, then falls back to N-gram with relaxed thresholds
 *
 * @param query - user's search query text
 * @param groupIds - groups to search in
 * @param maxResults - max number of results
 * @param negativeKeywords - words to exclude from results
 */
export async function findSimilarWithFallback(
  query: string,
  groupIds: number[],
  maxResults: number = 3,
  negativeKeywords: string[] = []
): Promise<SimilarMessage[]> {
  // First try semantic search
  const results = await findSimilarMessages(query, groupIds, maxResults, negativeKeywords);

  if (results.length >= maxResults) {
    return results;
  }

  // If not enough results, try N-gram with progressively relaxed thresholds
  const keywords = tokenizeQuery(query);
  if (keywords.length === 0) return results;

  const thresholds = [0.15, 0.05, 0.01];

  for (const threshold of thresholds) {
    const ngramResults = findSimilarByNgram(
      keywords,
      groupIds,
      maxResults,
      negativeKeywords,
      threshold
    );

    if (ngramResults.length >= maxResults) {
      botLog.debug({ threshold, found: ngramResults.length }, "Found enough via N-gram fallback");
      return ngramResults;
    }

    if (ngramResults.length > results.length) {
      return ngramResults;
    }
  }

  return results;
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
