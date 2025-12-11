/**
 * Semantic search module using BGE-M3 embeddings + sqlite-vec
 */
import { getEmbedding } from "../llm/embeddings.ts";
import { queries, isSqliteVecAvailable } from "../db/index.ts";
import { apiLog } from "../logger.ts";
import type { StoredMessage } from "../types.ts";

export interface SemanticSearchResult {
  id: number;
  messageId: number;
  groupId: number;
  groupTitle: string | null;
  text: string;
  distance: number;
  timestamp: number;
  senderId: number | null;
  senderName: string | null;
  senderUsername: string | null;
}

/**
 * Semantic search for similar messages
 *
 * @param query - text to search for (product name, user query, etc.)
 * @param limit - maximum number of results
 * @param groupIds - optional filter by specific groups
 * @returns array of similar messages sorted by distance (closest first)
 */
export async function semanticSearch(
  query: string,
  limit: number,
  groupIds?: number[]
): Promise<SemanticSearchResult[]> {
  // Check if sqlite-vec is available
  if (!isSqliteVecAvailable()) {
    throw new Error("sqlite-vec extension not available");
  }

  apiLog.debug({ query: query.slice(0, 50), limit, groupIds }, "Starting semantic search");

  // Get embedding for query
  const embedding = await getEmbedding(query);

  // Find similar in database
  const results = queries.findSimilarByEmbedding(embedding, limit, groupIds);

  apiLog.debug({ found: results.length }, "Semantic search complete");

  return results.map((msg) => ({
    id: msg.id,
    messageId: msg.message_id,
    groupId: msg.group_id,
    groupTitle: msg.group_title,
    text: msg.text,
    distance: msg.distance,
    timestamp: msg.timestamp,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    senderUsername: msg.sender_username,
  }));
}

/**
 * Check if semantic search is available
 * (sqlite-vec loaded and BGE server running)
 */
export async function isSemanticSearchAvailable(): Promise<boolean> {
  // First check sqlite-vec
  if (!isSqliteVecAvailable()) {
    return false;
  }

  try {
    // Quick test: try to get an embedding
    await getEmbedding("test");
    return true;
  } catch {
    return false;
  }
}
