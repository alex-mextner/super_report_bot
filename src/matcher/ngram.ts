import { generateNgrams, generateWordShingles } from "./normalize.ts";
import { matcherLog } from "../logger.ts";

/**
 * Calculate Jaccard similarity between two sets
 */
function jaccardSimilarity<T>(setA: Set<T>, setB: Set<T>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersection++;
    }
  }

  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

export interface NgramMatchResult {
  charNgramScore: number; // Character-level n-gram similarity
  wordShingleScore: number; // Word-level shingle similarity
  combinedScore: number; // Weighted combination
}

/**
 * Calculate N-gram + Jaccard similarity between text and description
 * Uses both character n-grams and word shingles for better accuracy
 */
export function calculateNgramSimilarity(
  text: string,
  description: string,
  charN: number = 3,
  wordN: number = 2
): NgramMatchResult {
  // Character-level n-grams (trigrams by default)
  const textCharNgrams = generateNgrams(text, charN);
  const descCharNgrams = generateNgrams(description, charN);
  const charNgramScore = jaccardSimilarity(textCharNgrams, descCharNgrams);

  // Word-level shingles (bigrams by default)
  const textWordShingles = generateWordShingles(text, wordN);
  const descWordShingles = generateWordShingles(description, wordN);
  const wordShingleScore = jaccardSimilarity(textWordShingles, descWordShingles);

  // Combined score: word shingles weighted higher as they capture meaning better
  const combinedScore = charNgramScore * 0.3 + wordShingleScore * 0.7;

  matcherLog.trace(
    {
      charNgramScore: charNgramScore.toFixed(3),
      wordShingleScore: wordShingleScore.toFixed(3),
      combinedScore: combinedScore.toFixed(3),
    },
    "N-gram similarity breakdown"
  );

  return {
    charNgramScore,
    wordShingleScore,
    combinedScore,
  };
}

/**
 * Calculate what fraction of keyword's ngrams are present in text
 * This is asymmetric - we check if keyword is IN text, not similarity
 */
function keywordCoverage(textNgrams: Set<string>, keyword: string): number {
  const keywordNgrams = generateNgrams(keyword, 3);
  if (keywordNgrams.size === 0) return 0;

  let found = 0;
  for (const ng of keywordNgrams) {
    if (textNgrams.has(ng)) found++;
  }
  return found / keywordNgrams.size;
}

/**
 * Calculate similarity between text and positive keywords
 * Checks how well the text matches the expected content
 */
export function calculateKeywordNgramSimilarity(
  text: string,
  positiveKeywords: string[]
): number {
  if (positiveKeywords.length === 0) return 0;

  const textNgrams = generateNgrams(text, 3);

  // Check individual keyword coverage (is keyword present in text?)
  let keywordsCovered = 0;
  let totalCoverage = 0;

  for (const keyword of positiveKeywords) {
    const coverage = keywordCoverage(textNgrams, keyword);
    totalCoverage += coverage;
    // Keyword is "found" if at least 70% of its ngrams are in text
    if (coverage >= 0.7) {
      keywordsCovered++;
    }
  }

  // Two scores:
  // 1. Binary coverage: what fraction of keywords are found
  const binaryCoverage = keywordsCovered / positiveKeywords.length;
  // 2. Soft coverage: average coverage across all keywords
  const softCoverage = totalCoverage / positiveKeywords.length;

  const score = binaryCoverage * 0.7 + softCoverage * 0.3;

  matcherLog.trace(
    {
      keywordsFound: keywordsCovered,
      totalKeywords: positiveKeywords.length,
      binaryCoverage: binaryCoverage.toFixed(3),
      softCoverage: softCoverage.toFixed(3),
      score: score.toFixed(3),
    },
    "Keyword coverage breakdown"
  );

  // Combine: binary is more important (you either found the keyword or not)
  return score;
}

/**
 * Check if text passes N-gram filter
 */
export function passesNgramFilter(
  text: string,
  positiveKeywords: string[],
  llmDescription: string,
  threshold: number = 0.25
): { passed: boolean; score: number } {
  // Calculate similarity with keywords
  const keywordScore = calculateKeywordNgramSimilarity(text, positiveKeywords);

  // Calculate similarity with description
  const descResult = calculateNgramSimilarity(text, llmDescription);

  // Combined score
  const score = keywordScore * 0.5 + descResult.combinedScore * 0.5;

  return {
    passed: score >= threshold,
    score,
  };
}
