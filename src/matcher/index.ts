import { passesNgramFilter, phraseMatches } from "./ngram.ts";
import { generateNgrams } from "./normalize.ts";
import { matcherLog } from "../logger.ts";
import { semanticMatch, checkBgeHealth } from "../llm/embeddings.ts";
import type { Subscription, MatchResult, IncomingMessage } from "../types.ts";

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
 * Returns null if no match, or MatchResult if passed
 */
export async function matchMessage(
  message: IncomingMessage,
  subscription: Subscription,
  config: MatcherConfig = DEFAULT_CONFIG
): Promise<MatchResult | null> {
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
        return null; // Negative keyword found, skip
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
      score: ngram.score,
      stage: "ngram",
      passed: true,
    };
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
        return null;
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
          score: semantic.score,
          stage: "ngram", // Keep stage as "ngram" for compatibility, could add "bge-m3"
          passed: true,
        };
      }
    } catch (error) {
      matcherLog.error(
        { subscriptionId: subscription.id, error },
        "BGE-M3 semantic match failed"
      );
      // Fall through — no match
    }
  }

  return null;
}

/**
 * Match a message against all active subscriptions
 * Returns array of potential matches for LLM verification
 */
export async function matchMessageAgainstAll(
  message: IncomingMessage,
  subscriptions: Subscription[],
  config: MatcherConfig = DEFAULT_CONFIG
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  // Process subscriptions sequentially to avoid overwhelming BGE server
  for (const subscription of subscriptions) {
    const result = await matchMessage(message, subscription, config);
    if (result) {
      results.push(result);
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}

export { calculateNgramSimilarity, passesNgramFilter } from "./ngram.ts";
export { normalizeText, tokenize, generateNgrams, generateWordShingles } from "./normalize.ts";
