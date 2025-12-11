/**
 * Forward message handling for explaining why a message wasn't matched
 */

import type { Message as GramioMessage } from "gramio";
import type { ForwardInfo, FoundPostAnalysis, Subscription } from "../types.ts";
import { queries } from "../db/index.ts";
import { formatRejectionReason, formatDate } from "./rejection-texts.ts";
import { forwardActionsKeyboard, addGroupKeyboard, analyzeForwardKeyboard } from "./keyboards.ts";
import { matchMessage } from "../matcher/index.ts";
import { verifyMatch } from "../llm/verify.ts";

/**
 * Extract forward info from a gramio message
 */
export function extractForwardInfo(msg: GramioMessage): ForwardInfo | null {
  const origin = msg.forwardOrigin;
  if (!origin) return null;

  switch (origin.type) {
    case "channel":
      return {
        chatId: origin.chat.id,
        messageId: origin.messageId,
        chatTitle: origin.chat.title,
        date: origin.date,
      };

    case "chat":
      return {
        chatId: origin.senderChat.id,
        messageId: null, // Telegram API doesn't provide message_id for chat forwards
        chatTitle: origin.senderChat.title,
        date: origin.date,
      };

    case "user":
    case "hidden_user":
      // User forwards from groups - can't determine original group
      // But we can still analyze the message text against all subscriptions
      return {
        chatId: undefined,
        messageId: null,
        chatTitle: undefined,
        date: origin.date,
      };

    default:
      return null;
  }
}

export type NotFoundReason =
  | "no_text"
  | "text_not_in_db"
  | "no_analyses_for_user"
  | "group_not_monitored_by_user";

export type ForwardResult =
  | { type: "not_forward" }
  | { type: "error"; message: string }
  | { type: "not_monitored"; chatId: number; chatTitle?: string }
  | { type: "not_found"; forwardInfo: ForwardInfo; reason: NotFoundReason; groupTitle?: string }
  | { type: "found"; analyses: (FoundPostAnalysis & { original_query: string })[]; forwardInfo: ForwardInfo };

/**
 * Handle a forwarded message - check DB for existing analyses
 * If chatId/messageId unknown, searches by exact text match
 */
export function handleForward(
  context: {
    message: GramioMessage;
    from?: { id: number };
  },
  messageText?: string
): ForwardResult {
  const userId = context.from?.id;
  if (!userId) {
    return { type: "not_forward" };
  }

  const forwardInfo = extractForwardInfo(context.message);
  if (!forwardInfo) {
    return { type: "error", message: "Не могу определить источник сообщения." };
  }

  const text = messageText ?? context.message.text ?? context.message.caption ?? "";
  const { chatId, messageId } = forwardInfo;

  // If we know the group, check if it's monitored
  if (chatId !== undefined) {
    const userGroups = queries.getUserGroups(userId);
    const isMonitored = userGroups.some((g) => g.id === chatId);

    if (!isMonitored) {
      return {
        type: "not_monitored",
        chatId,
        chatTitle: forwardInfo.chatTitle,
      };
    }

    // Look for existing analyses in DB
    if (messageId) {
      const analyses = queries.getAnalysesForMessageByUser(messageId, chatId, userId);

      if (analyses.length > 0) {
        return {
          type: "found",
          analyses,
          forwardInfo,
        };
      }
    }

    // Known group but no analyses found
    return {
      type: "not_found",
      forwardInfo,
      reason: "no_analyses_for_user",
      groupTitle: forwardInfo.chatTitle,
    };
  }

  // Unknown group (user forward) - search by exact text
  if (!text.trim()) {
    return {
      type: "not_found",
      forwardInfo,
      reason: "no_text",
    };
  }

  // Search message by exact text match
  const foundMessage = queries.findMessageByExactText(text);

  if (!foundMessage) {
    return {
      type: "not_found",
      forwardInfo,
      reason: "text_not_in_db",
    };
  }

  // Found message by text - check if user monitors this group
  const userGroups = queries.getUserGroups(userId);
  const isMonitored = userGroups.some((g) => g.id === foundMessage.group_id);

  if (!isMonitored) {
    return {
      type: "not_found",
      forwardInfo: { ...forwardInfo, chatId: foundMessage.group_id, messageId: foundMessage.message_id },
      reason: "group_not_monitored_by_user",
      groupTitle: foundMessage.group_title ?? undefined,
    };
  }

  // Get analyses for the found message
  const analyses = queries.getAnalysesForMessageByUser(
    foundMessage.message_id,
    foundMessage.group_id,
    userId
  );

  if (analyses.length > 0) {
    return {
      type: "found",
      analyses,
      forwardInfo: {
        ...forwardInfo,
        chatId: foundMessage.group_id,
        messageId: foundMessage.message_id,
        chatTitle: foundMessage.group_title ?? undefined,
      },
    };
  }

  return {
    type: "not_found",
    forwardInfo: {
      ...forwardInfo,
      chatId: foundMessage.group_id,
      messageId: foundMessage.message_id,
      chatTitle: foundMessage.group_title ?? undefined,
    },
    reason: "no_analyses_for_user",
    groupTitle: foundMessage.group_title ?? undefined,
  };
}

/**
 * Single analysis result for a subscription
 */
export interface SubscriptionAnalysisResult {
  subscription: Subscription;
  analysis: FoundPostAnalysis & { original_query: string };
}

/**
 * Analyze a forwarded message on demand
 * Returns results for each subscription separately
 */
export async function analyzeForwardedMessage(
  userId: number,
  forwardInfo: ForwardInfo,
  messageText: string
): Promise<SubscriptionAnalysisResult[]> {
  const userSubscriptions = queries.getUserSubscriptions(userId);

  if (userSubscriptions.length === 0) {
    return [];
  }

  // If we know the group, filter subscriptions for it
  // Otherwise, use ALL subscriptions
  let relevantSubs = userSubscriptions;
  if (forwardInfo.chatId !== undefined) {
    relevantSubs = userSubscriptions.filter((sub) => {
      const groups = queries.getSubscriptionGroups(sub.id);
      return groups.some((g) => g.group_id === forwardInfo.chatId);
    });
  }

  // Create a minimal IncomingMessage for matching
  const incomingMsg = {
    id: forwardInfo.messageId ?? 0,
    group_id: forwardInfo.chatId ?? 0,
    group_title: forwardInfo.chatTitle || "Неизвестная группа",
    text: messageText,
    sender_name: "Неизвестно",
    timestamp: new Date(),
  };

  const results: SubscriptionAnalysisResult[] = [];

  for (const subscription of relevantSubs) {
    // Run matcher
    const matchAnalysis = await matchMessage(incomingMsg, subscription);

    let analysisResult: FoundPostAnalysis & { original_query: string };

    if (matchAnalysis.passed) {
      // Run LLM verification
      try {
        const verification = await verifyMatch(incomingMsg, subscription);

        analysisResult = {
          id: 0,
          subscription_id: subscription.id,
          message_id: forwardInfo.messageId ?? 0,
          group_id: forwardInfo.chatId ?? 0,
          result: verification.isMatch ? "matched" : "rejected_llm",
          ngram_score: matchAnalysis.ngramScore ?? null,
          semantic_score: matchAnalysis.semanticScore ?? null,
          llm_confidence: verification.confidence,
          rejection_keyword: null,
          llm_reasoning: verification.reasoning ?? null,
          analyzed_at: Math.floor(Date.now() / 1000),
          notified_at: null,
          original_query: subscription.original_query,
        };
      } catch {
        // LLM failed
        analysisResult = {
          id: 0,
          subscription_id: subscription.id,
          message_id: forwardInfo.messageId ?? 0,
          group_id: forwardInfo.chatId ?? 0,
          result: (matchAnalysis.ngramScore ?? 0) > 0.7 ? "matched" : "rejected_llm",
          ngram_score: matchAnalysis.ngramScore ?? null,
          semantic_score: matchAnalysis.semanticScore ?? null,
          llm_confidence: null,
          rejection_keyword: null,
          llm_reasoning: "LLM verification failed",
          analyzed_at: Math.floor(Date.now() / 1000),
          notified_at: null,
          original_query: subscription.original_query,
        };
      }
    } else {
      // Rejected by matcher
      analysisResult = {
        id: 0,
        subscription_id: subscription.id,
        message_id: forwardInfo.messageId ?? 0,
        group_id: forwardInfo.chatId ?? 0,
        result: matchAnalysis.result,
        ngram_score: matchAnalysis.ngramScore ?? null,
        semantic_score: matchAnalysis.semanticScore ?? null,
        llm_confidence: null,
        rejection_keyword: matchAnalysis.rejectionKeyword ?? null,
        llm_reasoning: null,
        analyzed_at: Math.floor(Date.now() / 1000),
        notified_at: null,
        original_query: subscription.original_query,
      };
    }

    // Save to DB if we know the group
    if (forwardInfo.chatId !== undefined) {
      queries.saveAnalysis({
        subscriptionId: subscription.id,
        messageId: forwardInfo.messageId ?? 0,
        groupId: forwardInfo.chatId,
        result: analysisResult.result,
        ngramScore: matchAnalysis.ngramScore,
        semanticScore: matchAnalysis.semanticScore,
        llmConfidence: analysisResult.llm_confidence ?? undefined,
        llmReasoning: analysisResult.llm_reasoning ?? undefined,
        rejectionKeyword: analysisResult.rejection_keyword ?? undefined,
      });
    }

    results.push({
      subscription,
      analysis: analysisResult,
    });
  }

  return results;
}

/**
 * Format a single analysis result for display
 */
export function formatAnalysisResult(
  analysis: FoundPostAnalysis & { original_query: string }
): string {
  const isMatched = analysis.result === "matched";
  const icon = isMatched ? "✅" : "❌";

  let text = `${icon} "${analysis.original_query}"\n`;

  if (isMatched) {
    if (analysis.notified_at) {
      text += `Отправлено ${formatDate(analysis.notified_at)}`;
    } else {
      text += "Совпадение найдено";
    }
  } else {
    text += formatRejectionReason(analysis);
  }

  return text;
}

// Re-export keyboards for convenience
export { forwardActionsKeyboard, addGroupKeyboard, analyzeForwardKeyboard };
