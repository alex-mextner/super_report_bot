/**
 * Forward message handling for explaining why a message wasn't matched
 */

import type { Message as GramioMessage } from "gramio";
import type { ForwardInfo, FoundPostAnalysis } from "../types.ts";
import { queries } from "../db/index.ts";
import { formatRejectionReason, formatDate } from "./rejection-texts.ts";
import { forwardActionsKeyboard, addGroupKeyboard } from "./keyboards.ts";
import { matchMessage } from "../matcher/index.ts";
import { verifyMatch } from "../llm/verify.ts";

const FOUR_MINUTES = 4 * 60 * 1000;

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
      // Personal messages - can't determine original group
      return null;

    default:
      return null;
  }
}

/**
 * Handle a forwarded message - show analysis results or analyze on demand
 */
export async function handleForward(
  context: {
    message: GramioMessage;
    from?: { id: number };
    send: (text: string, options?: unknown) => Promise<unknown>;
  }
): Promise<{ handled: boolean; response?: string }> {
  const userId = context.from?.id;
  if (!userId) {
    return { handled: false };
  }

  const forwardInfo = extractForwardInfo(context.message);
  if (!forwardInfo) {
    return {
      handled: true,
      response: "Не могу определить источник сообщения. Форварды из личных чатов не поддерживаются.",
    };
  }

  const { chatId, messageId, chatTitle } = forwardInfo;

  // 1. Check if group is monitored by user
  const userGroups = queries.getUserGroups(userId);
  const isMonitored = userGroups.some((g) => g.id === chatId);

  if (!isMonitored) {
    return {
      handled: true,
      response: `Группа "${chatTitle || "Неизвестная"}" не добавлена в мониторинг.`,
      keyboard: addGroupKeyboard(chatId, chatTitle),
    } as { handled: boolean; response: string; keyboard?: unknown };
  }

  // 2. Look for existing analyses
  if (messageId) {
    const analyses = queries.getAnalysesForMessageByUser(messageId, chatId, userId);

    if (analyses.length > 0) {
      const result = buildAnalysisResponse(analyses, forwardInfo);
      return {
        handled: true,
        ...result,
      };
    }
  }

  // 3. Message not analyzed yet
  const forwardDate = forwardInfo.date;
  const messageAge = forwardDate ? Date.now() - forwardDate * 1000 : Infinity;

  if (messageAge < FOUR_MINUTES) {
    return {
      handled: true,
      response: "Сообщение ещё не было проанализировано. Подожди пару минут.",
    };
  }

  // 4. Old message - analyze on demand
  return {
    handled: true,
    response: "analyzing", // Special flag to trigger analysis
    forwardInfo,
    messageText: context.message.text || context.message.caption || "",
  } as { handled: boolean; response: string; forwardInfo?: ForwardInfo; messageText?: string };
}

/**
 * Build response text and keyboard for analysis results
 */
function buildAnalysisResponse(
  analyses: (FoundPostAnalysis & { original_query: string })[],
  forwardInfo: ForwardInfo
): { response: string; keyboard?: unknown } {
  let text = `Результаты анализа сообщения`;
  if (forwardInfo.chatTitle) {
    text += ` из "${forwardInfo.chatTitle}"`;
  }
  text += ":\n\n";

  const matched: typeof analyses = [];
  const rejected: typeof analyses = [];

  for (const analysis of analyses) {
    if (analysis.result === "matched") {
      matched.push(analysis);
    } else {
      rejected.push(analysis);
    }
  }

  // Show matched first
  for (const analysis of matched) {
    text += `✅ "${analysis.original_query}"\n`;
    if (analysis.notified_at) {
      text += `Отправлено ${formatDate(analysis.notified_at)}\n`;
    }
    text += "\n";
  }

  // Then rejected
  for (const analysis of rejected) {
    text += `❌ "${analysis.original_query}"\n`;
    text += `${formatRejectionReason(analysis)}\n\n`;
  }

  // Add keyboard for rejected analyses
  const firstRejected = rejected[0];
  if (firstRejected) {
    return {
      response: text,
      keyboard: forwardActionsKeyboard(
        firstRejected.subscription_id,
        forwardInfo.messageId ?? 0,
        forwardInfo.chatId
      ),
    };
  }

  return { response: text };
}

/**
 * Analyze a forwarded message on demand (for old messages not in cache)
 */
export async function analyzeForwardedMessage(
  userId: number,
  forwardInfo: ForwardInfo,
  messageText: string
): Promise<{ response: string; keyboard?: unknown }> {
  const userSubscriptions = queries.getUserSubscriptions(userId);

  if (userSubscriptions.length === 0) {
    return { response: "У тебя нет активных подписок для анализа." };
  }

  // Filter subscriptions for this group
  const relevantSubs = userSubscriptions.filter((sub) => {
    const groups = queries.getSubscriptionGroups(sub.id);
    return groups.some((g) => g.group_id === forwardInfo.chatId);
  });

  if (relevantSubs.length === 0) {
    return {
      response: `Нет подписок для группы "${forwardInfo.chatTitle || "Неизвестная"}".`,
    };
  }

  // Create a minimal IncomingMessage for matching
  const incomingMsg = {
    id: forwardInfo.messageId ?? 0,
    group_id: forwardInfo.chatId,
    group_title: forwardInfo.chatTitle || "Неизвестная группа",
    text: messageText,
    sender_name: "Неизвестно",
    timestamp: new Date(),
  };

  const results: (FoundPostAnalysis & { original_query: string })[] = [];

  for (const subscription of relevantSubs) {
    // Run matcher
    const analysis = await matchMessage(incomingMsg, subscription);

    if (analysis.passed) {
      // Run LLM verification
      try {
        const verification = await verifyMatch(incomingMsg, subscription);

        const analysisResult = {
          id: 0,
          subscription_id: subscription.id,
          message_id: forwardInfo.messageId ?? 0,
          group_id: forwardInfo.chatId,
          result: verification.isMatch ? "matched" : "rejected_llm",
          ngram_score: analysis.ngramScore ?? null,
          semantic_score: analysis.semanticScore ?? null,
          llm_confidence: verification.confidence,
          rejection_keyword: null,
          llm_reasoning: verification.reasoning ?? null,
          analyzed_at: Math.floor(Date.now() / 1000),
          notified_at: null,
          original_query: subscription.original_query,
        } as FoundPostAnalysis & { original_query: string };

        results.push(analysisResult);

        // Save to DB
        queries.saveAnalysis({
          subscriptionId: subscription.id,
          messageId: forwardInfo.messageId ?? 0,
          groupId: forwardInfo.chatId,
          result: analysisResult.result,
          ngramScore: analysis.ngramScore,
          semanticScore: analysis.semanticScore,
          llmConfidence: verification.confidence,
          llmReasoning: verification.reasoning,
        });
      } catch {
        // LLM failed, save as matched if score is high
        if ((analysis.ngramScore ?? 0) > 0.7) {
          results.push({
            id: 0,
            subscription_id: subscription.id,
            message_id: forwardInfo.messageId ?? 0,
            group_id: forwardInfo.chatId,
            result: "matched",
            ngram_score: analysis.ngramScore ?? null,
            semantic_score: analysis.semanticScore ?? null,
            llm_confidence: null,
            rejection_keyword: null,
            llm_reasoning: null,
            analyzed_at: Math.floor(Date.now() / 1000),
            notified_at: null,
            original_query: subscription.original_query,
          });
        }
      }
    } else {
      // Rejected by matcher
      const analysisResult = {
        id: 0,
        subscription_id: subscription.id,
        message_id: forwardInfo.messageId ?? 0,
        group_id: forwardInfo.chatId,
        result: analysis.result,
        ngram_score: analysis.ngramScore ?? null,
        semantic_score: analysis.semanticScore ?? null,
        llm_confidence: null,
        rejection_keyword: analysis.rejectionKeyword ?? null,
        llm_reasoning: null,
        analyzed_at: Math.floor(Date.now() / 1000),
        notified_at: null,
        original_query: subscription.original_query,
      } as FoundPostAnalysis & { original_query: string };

      results.push(analysisResult);

      // Save to DB
      queries.saveAnalysis({
        subscriptionId: subscription.id,
        messageId: forwardInfo.messageId ?? 0,
        groupId: forwardInfo.chatId,
        result: analysis.result,
        ngramScore: analysis.ngramScore,
        semanticScore: analysis.semanticScore,
        rejectionKeyword: analysis.rejectionKeyword,
      });
    }
  }

  if (results.length === 0) {
    return { response: "Не удалось проанализировать сообщение." };
  }

  return buildAnalysisResponse(results, forwardInfo);
}
