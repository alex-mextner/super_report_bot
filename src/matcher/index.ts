import { passesNgramFilter, phraseMatches } from "./ngram.ts";
import { generateNgrams } from "./normalize.ts";
import { matcherLog } from "../logger.ts";
import type { Subscription, MatchResult, IncomingMessage } from "../types.ts";

export interface MatcherConfig {
  ngramThreshold: number;
}

const DEFAULT_CONFIG: MatcherConfig = {
  ngramThreshold: 0.15, // lowered for better recall
};

/**
 * Match a message against a subscription using N-gram similarity
 * Also checks negative keywords to filter out unwanted matches
 *
 * Returns null if no match, or MatchResult if passed
 */
export function matchMessage(
  message: IncomingMessage,
  subscription: Subscription,
  config: MatcherConfig = DEFAULT_CONFIG
): MatchResult | null {
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

  // N-gram + Jaccard similarity
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

  if (!ngram.passed) {
    return null;
  }

  return {
    subscription,
    score: ngram.score,
    stage: "ngram",
    passed: true,
  };
}

/**
 * Match a message against all active subscriptions
 * Returns array of potential matches for LLM verification
 */
export function matchMessageAgainstAll(
  message: IncomingMessage,
  subscriptions: Subscription[],
  config: MatcherConfig = DEFAULT_CONFIG
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const subscription of subscriptions) {
    const result = matchMessage(message, subscription, config);
    if (result) {
      results.push(result);
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}

export { calculateNgramSimilarity, passesNgramFilter } from "./ngram.ts";
export { normalizeText, tokenize, generateNgrams, generateWordShingles } from "./normalize.ts";
