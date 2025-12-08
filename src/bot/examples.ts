import { getMessages, type CachedMessage } from "../cache/messages.ts";
import { queries } from "../db/index.ts";
import { calculateKeywordNgramSimilarity } from "../matcher/ngram.ts";

export interface ExampleMessage {
  text: string;
  groupTitle: string;
  isFromCache: boolean; // true = from cache, false = fallback
}

/**
 * Get example messages for a subscription
 * 1. Try to find relevant messages in cache from subscription groups
 * 2. Fallback: generate simple example from keywords (no AI)
 */
export function getExamplesForSubscription(
  subscriptionId: number,
  positiveKeywords: string[],
  negativeKeywords: string[],
  maxExamples: number = 2
): ExampleMessage[] {
  const examples: ExampleMessage[] = [];

  // 1. Get subscription groups
  const groups = queries.getSubscriptionGroups(subscriptionId);

  // 2. Collect messages from all groups' caches
  const allMessages: CachedMessage[] = [];
  for (const group of groups) {
    const messages = getMessages(group.group_id);
    allMessages.push(...messages);
  }

  // 3. Score messages by n-gram similarity
  const scored = allMessages
    .filter((msg) => msg.text && msg.text.length > 20) // Filter too short
    .map((msg) => ({
      message: msg,
      score: calculateKeywordNgramSimilarity(msg.text, positiveKeywords),
    }))
    .filter((item) => {
      // Filter by negative keywords (simple check)
      if (negativeKeywords.length === 0) return true;
      const textLower = item.message.text.toLowerCase();
      return !negativeKeywords.some((neg) => textLower.includes(neg.toLowerCase()));
    })
    .sort((a, b) => b.score - a.score);

  // 4. Take top examples from cache
  for (const item of scored.slice(0, maxExamples)) {
    if (item.score > 0.1) {
      // Minimum relevance threshold
      examples.push({
        text: truncateText(item.message.text, 200),
        groupTitle: item.message.groupTitle,
        isFromCache: true,
      });
    }
  }

  // 5. If not enough examples — add fallback
  while (examples.length < maxExamples) {
    examples.push(generateFallbackExample(positiveKeywords));
  }

  return examples;
}

/**
 * Generate fallback example WITHOUT AI
 * Simply compose a string from keywords
 */
function generateFallbackExample(keywords: string[]): ExampleMessage {
  if (keywords.length === 0) {
    return {
      text: "(нет ключевых слов)",
      groupTitle: "(пример)",
      isFromCache: false,
    };
  }

  // Take 3-5 random keywords
  const shuffled = [...keywords].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(5, shuffled.length));

  // Compose pseudo-message
  const templates = [
    `${selected[0]}, ${selected.slice(1).join(", ")}`,
    `Продам ${selected[0]}. ${selected.slice(1).join(", ")}`,
    `${selected[0]} - ${selected.slice(1).join(" ")}`,
    `Срочно! ${selected.join(", ")}`,
  ];

  const template = templates[Math.floor(Math.random() * templates.length)] ?? selected.join(", ");

  return {
    text: template,
    groupTitle: "(пример)",
    isFromCache: false,
  };
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
