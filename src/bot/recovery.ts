/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *                     OPERATION RECOVERY ON BOT STARTUP
 *
 *         Resumes interrupted LLM operations after bot restart
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * When the bot crashes or restarts during a long-running operation (LLM call),
 * the user is left hanging with "Generating keywords..." forever.
 *
 * This module scans the database on startup for users with pending operations
 * and resumes those operations automatically.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { queries } from "../db/index";
import { send, getFsmContext, type BotContext } from "../fsm/index";
import type { PendingOperationType } from "../fsm/context";
import { botLog } from "../logger";
import {
  generateKeywords,
  generateKeywordsFallback,
  generateKeywordsWithRatings,
  generateDraftKeywords,
} from "../llm/keywords";
import {
  formatClarificationContext,
  analyzeQueryAndGenerateQuestions,
  generateClarificationQuestions,
} from "../llm/clarify";
import { interpretEditCommand } from "../llm/edit";
import { confirmKeyboard, skipQuestionKeyboard } from "./keyboards";
import type { Bot } from "gramio";
import { format, bold } from "gramio";

/**
 * Recover all interrupted operations on bot startup.
 *
 * Called once during bot initialization, before starting to listen for updates.
 *
 * @param bot - The gramio bot instance for sending messages
 */
export function recoverPendingOperations(bot: Bot): void {
  const usersWithPending = queries.getUsersWithPendingOperations();

  botLog.info({ count: usersWithPending.length }, "Checking pending operations");

  if (usersWithPending.length === 0) {
    return;
  }

  // Run all recoveries in parallel, non-blocking
  botLog.info({ count: usersWithPending.length }, "Starting recovery for pending operations");

  for (const { telegramId, snapshot } of usersWithPending) {
    // Fire and forget - each recovery runs independently
    (async () => {
      try {
        const parsed = JSON.parse(snapshot);
        const ctx = parsed.context as BotContext;

        if (ctx.pendingOperation) {
          await recoverOperation(bot, telegramId, ctx);
          botLog.info({ userId: telegramId }, "Recovery completed");
        }
      } catch (error) {
        botLog.error({ err: error, userId: telegramId }, "Failed to recover operation");
        // Clear the failed operation to prevent infinite retry loops
        send(telegramId, { type: "CLEAR_OPERATION" });
      }
    })();
  }
}

/**
 * Recover a single user's interrupted operation.
 */
async function recoverOperation(
  bot: Bot,
  userId: number,
  ctx: BotContext
): Promise<void> {
  const op = ctx.pendingOperation;
  if (!op) return;

  const operationType = op.type;
  const messageId = op.messageId;

  botLog.info({ userId, operationType, messageId }, "Recovering operation");

  // Notify user
  try {
    if (messageId) {
      await bot.api.editMessageText({
        chat_id: userId,
        message_id: messageId,
        text: "⏳ Бот был перезапущен, возобновляю операцию...",
      });
    } else {
      await bot.api.sendMessage({
        chat_id: userId,
        text: "⏳ Бот был перезапущен, возобновляю операцию...",
      });
    }
  } catch (e) {
    // Message might be too old to edit, just continue
    botLog.debug({ err: e, userId }, "Could not edit progress message");
  }

  // Route to specific recovery handler
  switch (operationType) {
    case "GENERATE_KEYWORDS":
      await retryGenerateKeywords(bot, userId, ctx);
      break;
    case "AI_CORRECT":
      await retryAiCorrect(bot, userId, ctx);
      break;
    case "AI_EDIT":
      await retryAiEdit(bot, userId, ctx);
      break;
    case "GENERATE_QUESTIONS":
      await retryGenerateQuestions(bot, userId, ctx);
      break;
    case "GENERATE_EXAMPLES":
      await retryGenerateExamples(bot, userId, ctx);
      break;
    default:
      botLog.warn({ userId, operationType }, "Unknown operation type for recovery");
      send(userId, { type: "CLEAR_OPERATION" });
  }
}

/**
 * Retry keyword generation.
 */
async function retryGenerateKeywords(
  bot: Bot,
  userId: number,
  ctx: BotContext
): Promise<void> {
  // Query can be in pendingSub or clarification (depending on flow stage)
  const query = ctx.pendingSub?.originalQuery || ctx.clarification?.originalQuery;

  if (!query) {
    botLog.warn({ userId }, "No query for keyword generation recovery");
    send(userId, { type: "CLEAR_OPERATION" });
    return;
  }

  const clarificationContext = ctx.clarification
    ? formatClarificationContext(ctx.clarification.questions, ctx.clarification.answers)
    : undefined;

  const ratings = ctx.ratingExamples?.ratings || [];

  let result;
  try {
    if (ratings.length > 0) {
      result = await generateKeywordsWithRatings(
        query,
        ratings.map((r) => ({ text: r.text, rating: r.rating })),
        clarificationContext
      );
    } else {
      result = await generateKeywords(query, clarificationContext);
    }
  } catch (error) {
    botLog.error({ err: error, userId }, "Recovery: LLM keyword generation failed");
    result = generateKeywordsFallback(query);
  }

  // Clear operation and update FSM
  send(userId, { type: "CLEAR_OPERATION" });
  send(userId, {
    type: "KEYWORDS_GENERATED",
    pendingSub: {
      originalQuery: query,
      positiveKeywords: result.positive_keywords,
      negativeKeywords: result.negative_keywords,
      llmDescription: result.llm_description,
    },
  });

  // Show confirmation with keyboard
  const mode = queries.getUserMode(userId);
  const queryId = `${userId}_${Date.now()}`;
  const positive = result.positive_keywords.join(", ");
  const negative = result.negative_keywords.join(", ");

  const text =
    `⏳ Бот был перезапущен. Ключевые слова восстановлены:\n\n` +
    `🔍 Позитивные: ${positive}\n` +
    `🚫 Негативные: ${negative}\n\n` +
    `📝 ${result.llm_description}\n\n` +
    `Подтверди или скорректируй:`;

  await bot.api.sendMessage({
    chat_id: userId,
    text,
    reply_markup: confirmKeyboard(queryId, mode),
  });
}

/**
 * Retry AI correction during subscription creation.
 */
async function retryAiCorrect(
  bot: Bot,
  userId: number,
  ctx: BotContext
): Promise<void> {
  if (!ctx.pendingAiCorrection) {
    botLog.warn({ userId }, "No pendingAiCorrection for recovery");
    send(userId, { type: "CLEAR_OPERATION" });
    return;
  }

  const conversation = ctx.pendingAiCorrection.conversation;
  const lastUserMessage = [...conversation].reverse().find((m) => m.role === "user");

  if (!lastUserMessage) {
    botLog.warn({ userId }, "No user message in AI correction conversation");
    send(userId, { type: "CLEAR_OPERATION" });
    await bot.api.sendMessage({
      chat_id: userId,
      text: "❌ Не удалось восстановить AI-корректировку. Попробуй еще раз.",
    });
    return;
  }

  const current = ctx.pendingAiCorrection.current;

  try {
    const result = await interpretEditCommand(
      lastUserMessage.content,
      {
        positive_keywords: current.positiveKeywords,
        negative_keywords: current.negativeKeywords,
        llm_description: current.llmDescription,
      },
      conversation
    );

    const proposed = {
      positiveKeywords: result.positive_keywords,
      negativeKeywords: result.negative_keywords,
      llmDescription: result.llm_description,
    };

    send(userId, { type: "CLEAR_OPERATION" });
    send(userId, { type: "AI_CORRECTION_PROPOSED", proposed });

    const text =
      `✅ AI-коррекция восстановлена:\n\n` +
      `🔍 Позитивные: ${proposed.positiveKeywords.join(", ")}\n` +
      `🚫 Негативные: ${proposed.negativeKeywords.join(", ")}\n\n` +
      `Отправь "применить" чтобы использовать эти ключевые слова, или опиши другие изменения.`;

    await bot.api.sendMessage({ chat_id: userId, text });
  } catch (error) {
    botLog.error({ err: error, userId }, "Recovery: AI correction failed");
    send(userId, { type: "CLEAR_OPERATION" });
    await bot.api.sendMessage({
      chat_id: userId,
      text: "❌ Не удалось восстановить AI-корректировку. Попробуй еще раз.",
    });
  }
}

/**
 * Retry AI editing of existing subscription.
 */
async function retryAiEdit(
  bot: Bot,
  userId: number,
  ctx: BotContext
): Promise<void> {
  if (!ctx.pendingAiEdit) {
    botLog.warn({ userId }, "No pendingAiEdit for recovery");
    send(userId, { type: "CLEAR_OPERATION" });
    return;
  }

  const conversation = ctx.pendingAiEdit.conversation;
  const lastUserMessage = [...conversation].reverse().find((m) => m.role === "user");

  if (!lastUserMessage) {
    botLog.warn({ userId }, "No user message in AI edit conversation");
    send(userId, { type: "CLEAR_OPERATION" });
    await bot.api.sendMessage({
      chat_id: userId,
      text: "❌ Не удалось восстановить AI-редактирование. Попробуй еще раз.",
    });
    return;
  }

  const current = ctx.pendingAiEdit.current;

  try {
    const result = await interpretEditCommand(
      lastUserMessage.content,
      {
        positive_keywords: current.positiveKeywords,
        negative_keywords: current.negativeKeywords,
        llm_description: current.llmDescription,
      },
      conversation
    );

    const proposed = {
      positiveKeywords: result.positive_keywords,
      negativeKeywords: result.negative_keywords,
      llmDescription: result.llm_description,
    };

    send(userId, { type: "CLEAR_OPERATION" });
    send(userId, { type: "AI_PROPOSED", proposed });

    const text =
      `✅ AI-редактирование восстановлено:\n\n` +
      `🔍 Позитивные: ${proposed.positiveKeywords.join(", ")}\n` +
      `🚫 Негативные: ${proposed.negativeKeywords.join(", ")}\n\n` +
      `Отправь "применить" чтобы сохранить изменения.`;

    await bot.api.sendMessage({ chat_id: userId, text });
  } catch (error) {
    botLog.error({ err: error, userId }, "Recovery: AI edit failed");
    send(userId, { type: "CLEAR_OPERATION" });
    await bot.api.sendMessage({
      chat_id: userId,
      text: "❌ Не удалось восстановить AI-редактирование. Попробуй еще раз.",
    });
  }
}

/**
 * Retry clarification question generation.
 */
async function retryGenerateQuestions(
  bot: Bot,
  userId: number,
  ctx: BotContext
): Promise<void> {
  const query = ctx.pendingSub?.originalQuery;

  if (!query) {
    botLog.warn({ userId }, "No query for question generation recovery");
    send(userId, { type: "CLEAR_OPERATION" });
    await bot.api.sendMessage({
      chat_id: userId,
      text:
        "⚠️ Бот был перезапущен во время анализа запроса.\n" +
        "Отправь свой запрос еще раз, и я начну сначала.",
    });
    return;
  }

  const mode = queries.getUserMode(userId);

  try {
    if (mode === "normal") {
      // Normal mode: analyze and decide if clarification needed
      botLog.info({ userId, query }, "Recovery: retrying query analysis");

      const analysis = await analyzeQueryAndGenerateQuestions(query);

      send(userId, { type: "CLEAR_OPERATION" });

      if (analysis.needsClarification && analysis.questions.length > 0) {
        send(userId, {
          type: "START_CLARIFICATION",
          data: {
            originalQuery: query,
            questions: analysis.questions,
            answers: [],
            currentIndex: 0,
          },
        });

        const firstQuestion = analysis.questions[0]!;
        const questionNumber = `(1/${analysis.questions.length})`;
        await bot.api.sendMessage({
          chat_id: userId,
          text: `⏳ Бот был перезапущен. Продолжаем:\n\n<b>Уточняющий вопрос</b> ${questionNumber}\n\n${firstQuestion}`,
          parse_mode: "HTML",
          reply_markup: skipQuestionKeyboard(),
        });
      } else {
        // No clarification needed, go to rating
        let draftKeywords: string[];
        try {
          draftKeywords = await generateDraftKeywords(query);
        } catch {
          draftKeywords = generateKeywordsFallback(query).positive_keywords;
        }

        // Start rating flow - send message asking to rate
        await bot.api.sendMessage({
          chat_id: userId,
          text:
            "⏳ Бот был перезапущен. Продолжаем с примерами.\n" +
            "Используй /start чтобы начать заново.",
        });
      }
    } else {
      // Advanced mode: generate clarification questions
      botLog.info({ userId, query }, "Recovery: retrying clarification generation");

      const questions = await generateClarificationQuestions(query);

      send(userId, { type: "CLEAR_OPERATION" });

      send(userId, {
        type: "START_CLARIFICATION",
        data: {
          originalQuery: query,
          questions,
          answers: [],
          currentIndex: 0,
        },
      });

      const firstQuestion = questions[0]!;
      const questionNumber = `(1/${questions.length})`;
      await bot.api.sendMessage({
        chat_id: userId,
        text: `⏳ Бот был перезапущен. Продолжаем:\n\n<b>Уточняющий вопрос</b> ${questionNumber}\n\n${firstQuestion}`,
        parse_mode: "HTML",
        reply_markup: skipQuestionKeyboard(),
      });
    }
  } catch (error) {
    botLog.error({ err: error, userId }, "Recovery: question generation failed");
    send(userId, { type: "CLEAR_OPERATION" });
    await bot.api.sendMessage({
      chat_id: userId,
      text:
        "❌ Не удалось восстановить сессию после перезапуска.\n" +
        "Отправь свой запрос еще раз.",
    });
  }
}

/**
 * Retry example message generation.
 * If examples fail, skip to keyword generation (examples are optional).
 */
async function retryGenerateExamples(
  bot: Bot,
  userId: number,
  ctx: BotContext
): Promise<void> {
  const query = ctx.pendingSub?.originalQuery;

  if (!query) {
    botLog.warn({ userId }, "No query for example generation recovery");
    send(userId, { type: "CLEAR_OPERATION" });
    await bot.api.sendMessage({
      chat_id: userId,
      text:
        "⚠️ Бот был перезапущен во время генерации примеров.\n" +
        "Отправь свой запрос еще раз.",
    });
    return;
  }

  // Examples are optional - skip to keyword generation
  botLog.info({ userId, query }, "Recovery: skipping examples, generating keywords");

  const mode = queries.getUserMode(userId);
  const clarificationContext = ctx.clarification
    ? formatClarificationContext(ctx.clarification.questions, ctx.clarification.answers)
    : undefined;

  let result;
  try {
    result = await generateKeywords(query, clarificationContext);
  } catch (error) {
    botLog.error({ err: error, userId }, "Recovery: keyword generation failed");
    result = generateKeywordsFallback(query);
  }

  send(userId, { type: "CLEAR_OPERATION" });
  send(userId, {
    type: "KEYWORDS_GENERATED",
    pendingSub: {
      originalQuery: query,
      positiveKeywords: result.positive_keywords,
      negativeKeywords: result.negative_keywords,
      llmDescription: result.llm_description,
    },
  });

  const queryId = `${userId}_${Date.now()}`;
  const positive = result.positive_keywords.join(", ");
  const negative = result.negative_keywords.join(", ");

  const text =
    `⏳ Бот был перезапущен. Пропускаем примеры, ключевые слова готовы:\n\n` +
    `🔍 Позитивные: ${positive}\n` +
    `🚫 Негативные: ${negative}\n\n` +
    `📝 ${result.llm_description}\n\n` +
    `Подтверди или скорректируй:`;

  await bot.api.sendMessage({
    chat_id: userId,
    text,
    reply_markup: confirmKeyboard(queryId, mode),
  });
}
