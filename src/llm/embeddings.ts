/**
 * BGE-M3 Embeddings Client
 * HTTP client for local BGE-M3 server
 */

import { llmLog } from "../logger.ts";

const BGE_URL = process.env.BGE_URL || "http://localhost:8079";

export interface KeywordEmbedding {
  keyword: string;
  vec: number[];
}

export interface KeywordEmbeddings {
  pos: KeywordEmbedding[];
  neg: KeywordEmbedding[];
}

export interface SemanticMatchResult {
  passed: boolean;
  score: number;
  blocked?: string; // negative keyword that blocked the match
}

// Response types from BGE server
interface SingleEmbeddingResponse {
  embedding: number[];
}

interface BatchEmbeddingResponse {
  embeddings: number[][];
}

/**
 * Get embedding for a single text
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${BGE_URL}/embed/single`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`BGE server error: ${error}`);
  }

  const data = (await response.json()) as SingleEmbeddingResponse;
  return data.embedding;
}

/**
 * Get embeddings for multiple texts (batch)
 */
export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await fetch(`${BGE_URL}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`BGE server error: ${error}`);
  }

  const data = (await response.json()) as BatchEmbeddingResponse;
  return data.embeddings;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Generate embeddings for keywords when creating subscription
 */
export async function generateKeywordEmbeddings(
  positiveKeywords: string[],
  negativeKeywords: string[]
): Promise<KeywordEmbeddings> {
  const allKeywords = [...positiveKeywords, ...negativeKeywords];

  if (allKeywords.length === 0) {
    return { pos: [], neg: [] };
  }

  llmLog.info(
    { posCount: positiveKeywords.length, negCount: negativeKeywords.length },
    "Generating keyword embeddings"
  );

  const embeddings = await getEmbeddings(allKeywords);

  const pos: KeywordEmbedding[] = positiveKeywords.map((keyword, i) => ({
    keyword,
    vec: embeddings[i] ?? [],
  }));

  const neg: KeywordEmbedding[] = negativeKeywords.map((keyword, i) => ({
    keyword,
    vec: embeddings[positiveKeywords.length + i] ?? [],
  }));

  return { pos, neg };
}

/**
 * Semantic match with early stop
 *
 * Logic:
 * - Interleave positive and negative keywords
 * - Negative keywords BLOCK if similarity > negThreshold
 * - Positive keywords accumulate score (sum of similarities)
 * - Early stop when positive score >= posThreshold
 */
export async function semanticMatch(
  messageText: string,
  keywordEmbeddings: KeywordEmbeddings,
  config: { posThreshold: number; negThreshold: number }
): Promise<SemanticMatchResult> {
  const { pos, neg } = keywordEmbeddings;

  // Nothing to match against
  if (pos.length === 0 && neg.length === 0) {
    return { passed: false, score: 0 };
  }

  // Get message embedding
  const msgEmb = await getEmbedding(messageText);
  let posScore = 0;

  // Interleave pos[0], neg[0], pos[1], neg[1], ...
  const maxLen = Math.max(pos.length, neg.length);

  for (let i = 0; i < maxLen; i++) {
    // Check negative keyword first — blocks immediately if > threshold
    const negKw = neg[i];
    if (negKw) {
      const sim = cosineSimilarity(msgEmb, negKw.vec);
      llmLog.debug(
        { keyword: negKw.keyword, similarity: sim.toFixed(3) },
        "Negative keyword similarity"
      );

      if (sim > config.negThreshold) {
        llmLog.debug(
          { keyword: negKw.keyword, similarity: sim.toFixed(3) },
          "Blocked by negative keyword"
        );
        return { passed: false, score: 0, blocked: negKw.keyword };
      }
    }

    // Accumulate positive score
    const posKw = pos[i];
    if (posKw) {
      const sim = cosineSimilarity(msgEmb, posKw.vec);
      posScore += sim;

      llmLog.debug(
        { keyword: posKw.keyword, similarity: sim.toFixed(3), totalScore: posScore.toFixed(3) },
        "Positive keyword similarity"
      );

      // Early stop: score already exceeds threshold
      if (posScore >= config.posThreshold) {
        llmLog.debug(
          { score: posScore.toFixed(3), threshold: config.posThreshold },
          "Early stop: threshold reached"
        );
        return { passed: true, score: posScore };
      }
    }
  }

  const passed = posScore >= config.posThreshold;
  llmLog.debug(
    { score: posScore.toFixed(3), threshold: config.posThreshold, passed },
    "Semantic match result"
  );

  return { passed, score: posScore };
}

/**
 * Check if BGE server is available
 */
export async function checkBgeHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BGE_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
