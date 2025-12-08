import { tokenize } from "./normalize.ts";

// BM25 parameters
const K1 = 1.2; // Term frequency saturation
const B = 0.75; // Document length normalization

export interface BM25Result {
  score: number;
  matchedPositive: string[];
  matchedNegative: string[];
}

/**
 * Calculate BM25-style keyword match score
 * Simplified version for single document matching against keywords
 */
export function calculateBM25Score(
  text: string,
  positiveKeywords: string[],
  negativeKeywords: string[]
): BM25Result {
  const tokens = tokenize(text);
  const tokenSet = new Set(tokens);
  const docLength = tokens.length;
  const avgDocLength = 50; // Assume average message length

  const matchedPositive: string[] = [];
  const matchedNegative: string[] = [];

  let positiveScore = 0;
  let negativeScore = 0;

  // Check positive keywords
  for (const keyword of positiveKeywords) {
    const keywordTokens = tokenize(keyword);

    // Count term frequency in document
    let tf = 0;
    for (const kt of keywordTokens) {
      if (tokenSet.has(kt)) {
        tf += tokens.filter((t) => t === kt).length;
      }
    }

    if (tf > 0) {
      matchedPositive.push(keyword);

      // BM25 term frequency component
      const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (docLength / avgDocLength)));
      positiveScore += tfNorm;
    }
  }

  // Check negative keywords (should NOT be present)
  for (const keyword of negativeKeywords) {
    const keywordTokens = tokenize(keyword);

    for (const kt of keywordTokens) {
      if (tokenSet.has(kt)) {
        matchedNegative.push(keyword);
        negativeScore += 1;
        break;
      }
    }
  }

  // Final score: positive contribution minus negative penalty
  // Normalize by number of positive keywords to get 0-1 range
  const normalizedPositive = positiveKeywords.length > 0 ? positiveScore / positiveKeywords.length : 0;
  const negativePenalty = matchedNegative.length > 0 ? 0.5 : 0;

  return {
    score: Math.max(0, normalizedPositive - negativePenalty),
    matchedPositive,
    matchedNegative,
  };
}

/**
 * Check if text passes BM25 keyword filter
 * Returns true if score is above threshold AND no negative keywords matched
 */
export function passesBM25Filter(
  text: string,
  positiveKeywords: string[],
  negativeKeywords: string[],
  threshold: number = 0.3
): { passed: boolean; result: BM25Result } {
  const result = calculateBM25Score(text, positiveKeywords, negativeKeywords);

  // Fail if any negative keyword matched
  if (result.matchedNegative.length > 0) {
    return { passed: false, result };
  }

  // Pass if score above threshold
  return {
    passed: result.score >= threshold,
    result,
  };
}
