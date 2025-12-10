import { passesNgramFilter, phraseMatches, calculateKeywordNgramSimilarity } from "./ngram.ts";
import { generateNgrams, tokenize } from "./normalize.ts";
import { matcherLog } from "../logger.ts";
import { semanticMatch, checkBgeHealth } from "../llm/embeddings.ts";
import type { Subscription, MatchResult, IncomingMessage, MatchAnalysis } from "../types.ts";

export interface MatcherConfig {
  ngramThreshold: number;
  // BGE-M3 semantic matching thresholds (optional, used when embeddings available)
  semanticPosThreshold?: number; // sum of positive similarities
  semanticNegThreshold?: number; // block if neg similarity > this
}

const DEFAULT_CONFIG: MatcherConfig = {
  ngramThreshold: 0.15, // lowered for better recall
  semanticPosThreshold: 0.5, // BGE-M3 positive sum threshold
  semanticNegThreshold: 0.7, // BGE-M3 negative block threshold
};

// Track BGE server availability
let bgeAvailable: boolean | null = null;
let bgeLastCheck = 0;
const BGE_CHECK_INTERVAL = 60000; // 1 minute

async function isBgeAvailable(): Promise<boolean> {
  const now = Date.now();
  if (bgeAvailable !== null && now - bgeLastCheck < BGE_CHECK_INTERVAL) {
    return bgeAvailable;
  }
  bgeAvailable = await checkBgeHealth();
  bgeLastCheck = now;
  if (!bgeAvailable) {
    matcherLog.warn("BGE server not available, semantic matching disabled");
  }
  return bgeAvailable;
}

/**
 * Match a message against a subscription using N-gram similarity
 * Falls back to BGE-M3 semantic matching if N-gram doesn't match
 *
 * Always returns MatchAnalysis with detailed rejection info
 */
export async function matchMessage(
  message: IncomingMessage,
  subscription: Subscription,
  config: MatcherConfig = DEFAULT_CONFIG
): Promise<MatchAnalysis> {
  const text = message.text;

  // Check negative keywords first (n-gram matching with bridge check for phrases)
  if (subscription.negative_keywords.length > 0) {
    const textNgrams = generateNgrams(text, 3);
    for (const negKw of subscription.negative_keywords) {
      // Threshold 0.85 catches morphological variants, bridge check ensures words are adjacent
      if (phraseMatches(textNgrams, negKw, 0.85)) {
        matcherLog.debug(
          { subscriptionId: subscription.id, negativeKeyword: negKw },
          "Negative keyword hit"
        );
        return {
          subscription,
          result: "rejected_negative",
          passed: false,
          rejectionKeyword: negKw,
        };
      }
    }
  }

  // Stage 1a: N-gram + Jaccard similarity (fast)
  const ngram = passesNgramFilter(
    text,
    subscription.positive_keywords,
    subscription.llm_description,
    config.ngramThreshold
  );

  matcherLog.debug(
    {
      subscriptionId: subscription.id,
      score: ngram.score.toFixed(3),
      passed: ngram.passed,
      threshold: config.ngramThreshold,
    },
    ngram.passed ? "N-gram passed" : "N-gram rejected"
  );

  if (ngram.passed) {
    return {
      subscription,
      result: "matched",
      passed: true,
      ngramScore: ngram.score,
    };
  }

  // Stage 1a-fallback: Try matching by original_query keywords
  // This uses the same algorithm as findSimilarWithFallback for consistency
  const queryKeywords = tokenize(subscription.original_query);
  if (queryKeywords.length > 0) {
    const queryScore = calculateKeywordNgramSimilarity(text, queryKeywords);

    // Progressive thresholds like findSimilarWithFallback
    const queryThreshold = 0.15;

    if (queryScore >= queryThreshold) {
      matcherLog.debug(
        {
          subscriptionId: subscription.id,
          queryScore: queryScore.toFixed(3),
          queryKeywords: queryKeywords.slice(0, 5),
        },
        "Query fallback passed"
      );
      return {
        subscription,
        result: "matched",
        passed: true,
        ngramScore: queryScore,
      };
    }
  }

  // Stage 1b: BGE-M3 semantic matching (if N-gram didn't match)
  // Only if subscription has embeddings and BGE server is available
  if (subscription.keyword_embeddings && (await isBgeAvailable())) {
    try {
      const semantic = await semanticMatch(text, subscription.keyword_embeddings, {
        posThreshold: config.semanticPosThreshold ?? 0.5,
        negThreshold: config.semanticNegThreshold ?? 0.7,
      });

      if (semantic.blocked) {
        matcherLog.debug(
          { subscriptionId: subscription.id, blockedBy: semantic.blocked },
          "Blocked by semantic negative keyword"
        );
        return {
          subscription,
          result: "rejected_semantic",
          passed: false,
          ngramScore: ngram.score,
          semanticScore: semantic.score,
          rejectionKeyword: semantic.blocked,
        };
      }

      matcherLog.debug(
        {
          subscriptionId: subscription.id,
          score: semantic.score.toFixed(3),
          passed: semantic.passed,
          threshold: config.semanticPosThreshold ?? 0.5,
        },
        semantic.passed ? "BGE-M3 passed" : "BGE-M3 rejected"
      );

      if (semantic.passed) {
        return {
          subscription,
          result: "matched",
          passed: true,
          ngramScore: ngram.score,
          semanticScore: semantic.score,
        };
      }

      // Semantic didn't pass
      return {
        subscription,
        result: "rejected_semantic",
        passed: false,
        ngramScore: ngram.score,
        semanticScore: semantic.score,
      };
    } catch (error) {
      matcherLog.error(
        { subscriptionId: subscription.id, error },
        "BGE-M3 semantic match failed"
      );
      // Fall through — return ngram rejection
    }
  }

  // Final rejection: n-gram filter didn't pass
  return {
    subscription,
    result: "rejected_ngram",
    passed: false,
    ngramScore: ngram.score,
  };
}

/**
 * Match a message against all active subscriptions
 * Returns all analyses (both passed and rejected) for saving to DB
 */
export async function matchMessageAgainstAll(
  message: IncomingMessage,
  subscriptions: Subscription[],
  config: MatcherConfig = DEFAULT_CONFIG
): Promise<MatchAnalysis[]> {
  const results: MatchAnalysis[] = [];

  // Process subscriptions sequentially to avoid overwhelming BGE server
  for (const subscription of subscriptions) {
    const result = await matchMessage(message, subscription, config);
    results.push(result);
  }

  return results;
}

/**
 * Get only passed matches (candidates for LLM verification)
 * Sorted by score descending
 */
export function getPassedMatches(analyses: MatchAnalysis[]): MatchAnalysis[] {
  return analyses
    .filter((a) => a.passed)
    .sort((a, b) => (b.ngramScore ?? 0) - (a.ngramScore ?? 0));
}

export { calculateNgramSimilarity, passesNgramFilter } from "./ngram.ts";
export { normalizeText, tokenize, generateNgrams, generateWordShingles } from "./normalize.ts";
