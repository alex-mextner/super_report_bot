import { Bot, format, bold, code } from "gramio";
import type { CallbackQueryContext } from "@gramio/contexts";
import { queries } from "../db/index.ts";
import {
  generateKeywords,
  generateKeywordsFallback,
  generateDraftKeywords,
  generateExampleMessages,
  generatedToRatingExamples,
  generateKeywordsWithRatings,
  correctDescription,
} from "../llm/keywords.ts";
import {
  generateClarificationQuestions,
  analyzeQueryAndGenerateQuestions,
  formatClarificationContext,
} from "../llm/clarify.ts";
import { searchBrave, generateExamplesFromBrave } from "../llm/brave.ts";
import {
  confirmKeyboard,
  keywordEditConfirmKeyboard,
  subscriptionKeyboard,
  groupPickerKeyboard,
  inviteLinkKeyboard,
  groupsKeyboard,
  skipQuestionKeyboard,
  aiEditKeyboard,
  aiEditStartKeyboard,
  pendingAiEditKeyboard,
  pendingAiCorrectionStartKeyboard,
  nextRequestId,
  keywordEditSubmenu,
  keywordEditSubmenuPending,
  removeKeywordsKeyboard,
  ratingKeyboard,
  settingsKeyboard,
  feedbackOutcomeKeyboard,
  feedbackReviewKeyboard,
  premiumKeyboard,
  presetsListKeyboard,
  presetBuyKeyboard,
  presetSelectionKeyboard,
  regionSelectionKeyboard,
  promotionDurationKeyboard,
  languageKeyboard,
} from "./keyboards.ts";
import {
  t,
  getTranslator,
  getTranslatorForLocale,
  getUserLocale,
  setUserLanguage,
  localeNames,
  isValidLocale,
  detectLocale,
  getLLMLanguage,
  type Locale,
  type Translator,
} from "../i18n/index.ts";
import {
  formatPlanInfo,
  createSubscriptionLink,
  handlePreCheckout,
  handleSuccessfulPayment,
  checkSubscriptionLimits,
  PLAN_PRICES,
  getAnalyzePrice,
  canUseFreeAnalyze,
  sendPaymentInvoice,
  canSeeFora,
  type PaymentPayload,
} from "./payments.ts";
import { runWithRecovery } from "./operations.ts";
import { interpretEditCommand } from "../llm/edit.ts";
import { generateKeywordEmbeddings, checkBgeHealth } from "../llm/embeddings.ts";
import {
  parseGroupTitle,
  matchCountry,
  matchCurrency,
  matchCity,
  getDefaultCurrency,
  getCountryName,
  getCurrencyName,
} from "../utils/geo.ts";

/**
 * Get region presets for user's country (for groupsKeyboard)
 */
function getUserRegionPresets(userId: number): Array<{
  id: number;
  region_name: string;
  groupIds: number[];
}> {
  const userPlan = queries.getUserPlan(userId);
  if (!userPlan.region_code) return [];
  return queries.getPresetsByCountry(userPlan.region_code);
}

/**
 * Regenerate BGE-M3 embeddings for a subscription (background, non-blocking)
 */
function regenerateEmbeddings(subscriptionId: number): void {
  const subscription = queries.getSubscriptionByIdOnly(subscriptionId);
  if (!subscription) return;

  generateKeywordEmbeddings(subscription.positive_keywords, subscription.negative_keywords)
    .then((embeddings) => {
      queries.updateKeywordEmbeddings(subscriptionId, embeddings);
      botLog.info({ subscriptionId }, "Embeddings regenerated after keyword update");
    })
    .catch((e) => botLog.error({ err: e, subscriptionId }, "Failed to regenerate embeddings"));
}
import { getExamplesForSubscription } from "./examples.ts";
import { findSimilarWithFallback, toRatingExamples, filterExamplesWithAI } from "./similar.ts";
import {
  invalidateSubscriptionsCache,
  isUserbotMember,
  ensureUserbotInGroup,
  joinGroupByUserbot,
  scanFromCache,
  isUserGroupAdmin,
} from "../listener/index.ts";
import {
  handleForward,
  analyzeForwardedMessage,
  formatAnalysisResult,
  extractForwardInfo,
  addGroupKeyboard,
  analyzeForwardKeyboard,
  forwardActionsKeyboard,
} from "./forward.ts";
import {
  handlePublishCommand,
  handleConnectTelegram,
  handlePublicationText,
  handlePublicationPhoto,
  handleContentDone,
  handleCreatePublication,
  handlePublishToPreset,
  handleConfirmPublication,
  handleMyPublications,
  handleDisconnectAccount,
  handleCancelAuth,
  handleCancelPublication,
  isInPublicationFlow,
} from "./publish.ts";
import { botLog } from "../logger.ts";
import type {
  UserMode,
  KeywordGenerationResult,
  PendingGroup,
  ExampleRating,
  RatingExample,
  MediaItem,
} from "../types.ts";

// FSM with SQLite persistence
import {
  send,
  getCurrentState,
  getFsmContext,
  type BotContext,
} from "../fsm/index.ts";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// FSM helper shortcuts
const ctx = (userId: number): BotContext => getFsmContext(userId);
const fsmState = (userId: number) => getCurrentState(userId);

/**
 * Edit callback message text or caption depending on message type.
 * Uses editText for text messages, editCaption for media messages.
 */
async function editCallbackMessage(
  context: CallbackQueryContext<typeof bot>,
  text: string,
  options?: { parse_mode?: "HTML" | "Markdown"; link_preview_options?: { is_disabled: boolean } }
): Promise<void> {
  const isTextMessage = context.message?.text !== undefined;
  if (isTextMessage) {
    await context.editText(text, options);
  } else {
    await context.editCaption(text, options);
  }
}

/**
 * Reset FSM to idle if stuck in another state.
 * Call this before starting new flows (commands, new subscription requests).
 */
function ensureIdle(userId: number): void {
  const currentState = fsmState(userId);
  if (currentState !== "idle") {
    botLog.debug({ userId, currentState }, "Resetting stuck FSM state to idle");
    send(userId, { type: "CANCEL" });
  }
}

/**
 * Build Telegram message link for promoted product
 */
function buildPromoLink(groupId: number, messageId: number): string {
  const chatIdStr = String(groupId);
  const cleanChatId = chatIdStr.startsWith("-100")
    ? chatIdStr.slice(4)
    : chatIdStr.replace("-", "");
  return `https://t.me/c/${cleanChatId}/${messageId}`;
}

// Tips to show during LLM processing (20% chance if no promo)
const TIP_KEYS = [
  "tip_referral",
  "tip_plans",
  "tip_usecase_rare",
  "tip_usecase_price",
] as const;

/**
 * Send progress message with optional promotion or tip
 * Shows unseen promotion to user while they wait for LLM response
 * If no promo, 20% chance to show a random tip
 */
async function sendProgressWithPromo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
  userId: number,
  text: string,
  promoContext: "bot_analyzing" | "bot_keywords"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const promo = queries.getUnseenProductPromotion(userId);
  const tr = getTranslator(userId);

  if (promo) {
    // Mark as viewed immediately
    queries.markPromotionViewed(userId, promo.promotion_id, promoContext);

    // Format promo text (truncate if too long)
    const promoText = promo.text.length > 300
      ? promo.text.slice(0, 300) + "..."
      : promo.text;
    const link = buildPromoLink(promo.group_id, promo.message_id);

    const fullText = `${text}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${tr("waiting_promo")}` +
      `${promoText}\n\n` +
      `👉 ${link}`;

    return context.send(fullText, { link_preview_options: { is_disabled: true } });
  }

  // No promo - 20% chance to show a random tip
  if (Math.random() < 0.2) {
    const tipIndex = Math.floor(Math.random() * TIP_KEYS.length);
    const tipKey = TIP_KEYS[tipIndex]!;
    const tip = tr(tipKey);
    const fullText = `${text}\n\n${tip}`;
    return context.send(fullText);
  }

  return context.send(text);
}

// Helper: show single example for rating
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showExampleForRating(
  context: any,
  userId: number,
  example: RatingExample,
  index: number,
  total: number
): Promise<void> {
  const tr = getTranslator(userId);
  const deletedLabel = example.isDeleted ? tr("example_deleted") : "";
  const sourceLabel = example.isGenerated
    ? tr("example_generated")
    : `📍 ${example.groupTitle}${deletedLabel}`;

  await context.send(
    format`${bold(tr("rating_example_title", { index: index + 1, total }))} ${sourceLabel}

${example.text.slice(0, 500)}${example.text.length > 500 ? "..." : ""}

${tr("rating_is_this_match")}`,
    {
      reply_markup: ratingKeyboard(index, total),
    }
  );
}

// Helper: show confirmation screen
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showConfirmation(
  context: any,
  userId: number,
  result: KeywordGenerationResult,
  query: string,
  mode: UserMode
): Promise<void> {
  const tr = getTranslator(userId);
  const queryId = `${userId}_${Date.now()}`;

  send(userId, {
    type: "KEYWORDS_GENERATED",
    pendingSub: {
      originalQuery: query,
      positiveKeywords: result.positive_keywords,
      negativeKeywords: result.negative_keywords,
      llmDescription: result.llm_description,
    },
  });

  if (mode === "normal") {
    // Simplified view for normal mode - only description
    await context.send(
      format`${bold(tr("analysis_result"))}

${bold(tr("analysis_what_looking"))}
${result.llm_description}

${tr("sub_confirm_or_cancel")}`,
      {
        reply_markup: confirmKeyboard(queryId, tr),
      }
    );
  } else {
    // Full view for advanced mode
    await context.send(
      format`${bold(tr("analysis_result"))}

${bold(tr("analysis_positive_kw"))}
${code(result.positive_keywords.join(", "))}

${bold(tr("analysis_negative_kw"))}
${code(result.negative_keywords.join(", ") || tr("analysis_none"))}

${bold(tr("analysis_description"))}
${result.llm_description}

${tr("sub_confirm_or_adjust")}`,
      {
        reply_markup: keywordEditConfirmKeyboard(queryId, tr),
      }
    );
  }
}

// Helper: start rating flow with examples
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function startRatingFlow(
  context: any,
  userId: number,
  query: string,
  clarificationContext?: string
): Promise<void> {
  const tr = getTranslator(userId);
  // Get user's groups
  const userGroups = queries.getUserGroups(userId);
  const groupIds = userGroups.map((g) => g.id);

  // Search for similar messages in cache (fetch more candidates for AI filtering)
  let examples: RatingExample[] = [];

  if (groupIds.length > 0) {
    const similar = await findSimilarWithFallback(query, groupIds, 10);
    const candidates = toRatingExamples(similar);
    botLog.debug({ userId, candidates: candidates.length }, "Found candidates for AI filtering");

    // AI filter candidates from cache
    if (candidates.length > 0) {
      const filtered = await filterExamplesWithAI(candidates, query);
      examples.push(...filtered.slice(0, 3));
      botLog.debug({ userId, afterFilter: examples.length }, "After AI filtering");
    }
  }

  // If not enough examples after filtering, try Brave search
  if (examples.length < 3) {
    botLog.debug({ userId, existing: examples.length }, "Not enough examples, trying Brave search");

    const braveResults = await searchBrave(query);
    if (braveResults.length > 0) {
      try {
        const braveExamples = await generateExamplesFromBrave(query, braveResults);
        // AI filter Brave examples too
        const filteredBrave = await filterExamplesWithAI(braveExamples, query);
        examples = [...examples, ...filteredBrave].slice(0, 3);
        botLog.debug({ userId, afterBrave: examples.length }, "Added AI-filtered Brave examples");
      } catch (error) {
        botLog.warn({ err: error, userId }, "Failed to generate Brave examples");
      }
    }
  }

  // Still not enough? Fall back to pure LLM generation (no AI filter needed)
  if (examples.length < 3) {
    botLog.debug({ userId, existing: examples.length }, "Still not enough, generating via LLM");
    try {
      const generated = await runWithRecovery(
        userId,
        "GENERATE_EXAMPLES",
        undefined,
        () => generateExampleMessages(query)
      );
      const synthetic = generatedToRatingExamples(generated);
      examples = [...examples, ...synthetic].slice(0, 3);
    } catch (error) {
      botLog.error({ err: error, userId }, "Failed to generate examples");
    }
  }

  if (examples.length === 0) {
    // No examples at all, skip to keyword generation
    botLog.debug({ userId }, "No examples available, skipping rating flow");
    const mode = queries.getUserMode(userId);
    const progressMsg = await context.send(tr("sub_no_examples"));
    const messageId = progressMsg?.message?.message_id;

    const result = await runWithRecovery(
      userId,
      "GENERATE_KEYWORDS",
      messageId,
      async (): Promise<KeywordGenerationResult> => {
        try {
          return await generateKeywords(query, clarificationContext);
        } catch (error) {
          botLog.error({ err: error, userId }, "LLM keyword generation failed");
          return generateKeywordsFallback(query);
        }
      }
    );

    await showConfirmation(context, userId, result, query, mode);
    return;
  }

  // Save state and show first example - single event sets both pendingSub and ratingExamples
  send(userId, {
    type: "START_RATING",
    pendingSub: {
      originalQuery: query,
      positiveKeywords: [],
      negativeKeywords: [],
      llmDescription: "",
    },
    examples: {
      messages: examples.map((e) => ({
        id: e.id,
        text: e.text,
        groupId: e.groupId,
        groupTitle: e.groupTitle,
        isGenerated: e.isGenerated,
        isDeleted: e.isDeleted,
      })),
      ratings: [],
      currentIndex: 0,
    },
  });

  // Explain what examples are for
  await context.send(tr("rating_intro"));

  await showExampleForRating(context, userId, examples[0]!, 0, examples.length);
}

// Helper: finish rating and generate final keywords
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finishRatingAndGenerateKeywords(
  context: any,
  userId: number
): Promise<void> {
  const c = ctx(userId);
  const mode = queries.getUserMode(userId);
  const tr = getTranslator(userId);

  if (!c.ratingExamples || !c.pendingSub) {
    await context.send(tr("sub_session_expired"));
    send(userId, { type: "CANCEL" });
    return;
  }

  const { ratings } = c.ratingExamples;
  const query = c.pendingSub.originalQuery;
  const clarificationContext = c.clarification
    ? formatClarificationContext(c.clarification.questions, c.clarification.answers)
    : undefined;

  const progressMsg = await sendProgressWithPromo(
    context,
    userId,
    tr("analysis_generating_with_ratings"),
    "bot_keywords"
  );
  const messageId = progressMsg?.message?.message_id;

  // Run LLM generation with recovery tracking
  const result = await runWithRecovery(
    userId,
    "GENERATE_KEYWORDS",
    messageId,
    async (): Promise<KeywordGenerationResult> => {
      if (ratings.length > 0) {
        // Generate with ratings feedback
        try {
          return await generateKeywordsWithRatings(
            query,
            ratings.map((r) => ({ text: r.text, rating: r.rating })),
            clarificationContext
          );
        } catch (error) {
          botLog.error({ err: error, userId }, "LLM generation with ratings failed");
          // Fallback to regular generation
          try {
            return await generateKeywords(query, clarificationContext);
          } catch {
            return generateKeywordsFallback(query);
          }
        }
      } else {
        // No ratings, use regular generation
        try {
          return await generateKeywords(query, clarificationContext);
        } catch (error) {
          botLog.error({ err: error, userId }, "LLM keyword generation failed");
          return generateKeywordsFallback(query);
        }
      }
    }
  );

  await showConfirmation(context, userId, result, query, mode);
}

// Legacy helper kept for backwards compatibility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateKeywordsAndShowResult(
  context: any,
  userId: number,
  query: string,
  clarificationContext?: string
): Promise<void> {
  const tr = getTranslator(userId);
  const mode = queries.getUserMode(userId);
  const progressMsg = await context.send(tr("sub_generating_keywords"));
  const messageId = progressMsg?.message?.message_id;

  const result = await runWithRecovery(
    userId,
    "GENERATE_KEYWORDS",
    messageId,
    async (): Promise<KeywordGenerationResult> => {
      try {
        return await generateKeywords(query, clarificationContext);
      } catch (error) {
        botLog.error({ err: error, userId }, "LLM keyword generation failed");
        return generateKeywordsFallback(query);
      }
    }
  );

  await showConfirmation(context, userId, result, query, mode);
}

export const bot = new Bot(BOT_TOKEN);

// Track album messages to collect all captions before processing
interface AlbumData {
  messages: Array<{ text?: string; caption?: string; message: unknown }>;
  userId: number;
  timeout: Timer;
}
const pendingAlbums = new Map<string, AlbumData>();
const ALBUM_COLLECT_DELAY = 1500; // 1.5 sec to collect all album messages

// EventEmitter for SSE notifications about user activity
import { EventEmitter } from "events";
export const botActivityEmitter = new EventEmitter();

// Middleware: log all incoming messages and update last_active
bot.on("message", (context, next) => {
  const userId = context.from?.id;
  if (!userId) return next();

  let messageType: "text" | "command" | "callback" | "forward" | "other" = "text";
  let text: string | undefined;
  let command: string | undefined;

  if (context.text) {
    text = context.text;
    if (text.startsWith("/")) {
      messageType = "command";
      command = text.split(" ")[0];
    }
  }
  if (context.forwardOrigin) {
    messageType = "forward";
  }

  const msg = queries.logBotMessage({
    telegramId: userId,
    direction: "incoming",
    messageType,
    text,
    command,
  });

  // Emit event for SSE
  if (msg) {
    botActivityEmitter.emit("user_activity", {
      telegram_id: userId,
      last_active: msg.created_at,
      first_name: context.from?.firstName ?? null,
      username: context.from?.username ?? null,
    });
    botActivityEmitter.emit("new_message", msg);
  }

  return next();
});

// Middleware: log all callback queries
bot.on("callback_query", (context, next) => {
  const userId = context.from?.id;
  if (!userId) return next();

  const msg = queries.logBotMessage({
    telegramId: userId,
    direction: "incoming",
    messageType: "callback",
    callbackData: context.data,
    text: context.data,
  });

  // Emit event for SSE
  if (msg) {
    botActivityEmitter.emit("user_activity", {
      telegram_id: userId,
      last_active: msg.created_at,
      first_name: context.from?.firstName ?? null,
      username: context.from?.username ?? null,
    });
    botActivityEmitter.emit("new_message", msg);
  }

  return next();
});

// Wrap bot.api.sendMessage to log outgoing messages
const originalSendMessage = bot.api.sendMessage.bind(bot.api);
bot.api.sendMessage = async (params) => {
  const result = await originalSendMessage(params);

  // Log outgoing message
  const chatId = typeof params.chat_id === "number" ? params.chat_id : parseInt(String(params.chat_id), 10);
  if (!isNaN(chatId) && chatId > 0) {
    // params.text can be string or FormattedString
    const textValue = typeof params.text === "string" ? params.text : params.text?.toString();

    const msg = queries.logBotMessage({
      telegramId: chatId,
      direction: "outgoing",
      messageType: "text",
      text: textValue,
    });

    if (msg) {
      botActivityEmitter.emit("new_message", msg);
    }
  }

  return result;
};

// /start command
bot.command("start", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  // Check if this is a new user before creating
  const existingUser = queries.getUserByTelegramId(userId);
  const isNewUser = !existingUser;

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);
  ensureIdle(userId);

  const tr = getTranslator(userId);

  // Handle referral deep link: /start ref_123456789
  const args = context.args;
  if (isNewUser && args?.startsWith("ref_")) {
    const referrerTelegramIdStr = args.slice(4); // Remove "ref_" prefix
    const referrerTelegramId = parseInt(referrerTelegramIdStr, 10);

    if (!isNaN(referrerTelegramId) && referrerTelegramId !== userId) {
      const referrerExists = queries.getUserByTelegramId(referrerTelegramId);
      if (referrerExists) {
        const success = queries.setReferrer(userId, referrerTelegramId);
        if (success) {
          // Notify referrer about new user
          const referrerTr = getTranslator(referrerTelegramId);
          const newUserName = context.from?.firstName || context.from?.username || "User";
          try {
            await bot.api.sendMessage({
              chat_id: referrerTelegramId,
              text: referrerTr("referral_new_user", { name: newUserName }),
            });
          } catch {
            // Referrer may have blocked the bot
          }
        }
      }
    }
  }

  await context.send(tr("cmd_start_welcome"));
});

// /referral command - show referral link and stats
bot.command("referral", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);
  const tr = getTranslator(userId);

  // Get bot username for the link
  const botInfo = await bot.api.getMe({});
  const botUsername = botInfo.username;

  const referralLink = `https://t.me/${botUsername}?start=ref_${userId}`;
  const balance = queries.getBonusBalance(userId);
  const stats = queries.getReferralStats(userId);

  const message = `${tr("referral_title")}\n\n` +
    `${tr("referral_link", { link: referralLink })}\n\n` +
    `${tr("referral_balance", { amount: balance })}\n` +
    `${tr("referral_stats", { count: stats.referral_count, total: stats.total_earned })}\n\n` +
    `${tr("referral_info")}`;

  await context.send(message, { parse_mode: "Markdown" });
});

// /list command - show user subscriptions
bot.command("list", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const tr = getTranslator(userId);
  const mode = queries.getUserMode(userId);
  const subscriptions = queries.getUserSubscriptions(userId);

  if (subscriptions.length === 0) {
    await context.send(tr("list_no_subscriptions"));
    return;
  }

  for (const sub of subscriptions) {
    const hasNeg = sub.negative_keywords.length > 0;
    const hasDisabledNeg = (sub.disabled_negative_keywords?.length ?? 0) > 0;
    const isPaused = sub.is_paused === 1;
    const pauseLabel = isPaused ? " ⏸️" : "";

    let messageText;
    if (mode === "advanced") {
      let exclusionsText = tr("analysis_none");
      if (hasNeg) {
        exclusionsText = sub.negative_keywords.join(", ");
      } else if (hasDisabledNeg) {
        exclusionsText = `(${sub.disabled_negative_keywords!.join(", ")})`;
      }

      messageText = format`
${bold(tr("list_sub_header", { id: sub.id, pause: pauseLabel }))}
${bold(tr("list_query"))} ${sub.original_query}
${bold(tr("list_keywords"))} ${code(sub.positive_keywords.join(", "))}
${bold(tr("list_exclusions"))} ${code(exclusionsText)}
      `;
    } else {
      messageText = format`
${bold(tr("list_sub_header", { id: sub.id, pause: pauseLabel }))}
${bold(tr("list_query"))} ${sub.original_query}
      `;
    }

    await context.send(messageText, {
      reply_markup: subscriptionKeyboard(sub.id, hasNeg, hasDisabledNeg, mode, isPaused, tr),
    });
  }
});

// /help command
bot.command("help", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const tr = getTranslator(userId);
  await context.send(tr("cmd_help"));
});

// /lang command - change language
bot.command("lang", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);
  const currentLocale = getUserLocale(userId);
  const tr = getTranslator(userId);

  await context.send(tr("lang_select"), {
    reply_markup: languageKeyboard(currentLocale),
  });
});

// /settings command - configure user mode
bot.command("settings", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);
  const tr = getTranslator(userId);
  const currentMode = queries.getUserMode(userId);

  const modeDescription = currentMode === "normal" ? tr("settings_normal_desc") : tr("settings_advanced_desc");
  const modeLabel = currentMode === "normal" ? tr("settings_mode_normal") : tr("settings_mode_advanced");

  await context.send(
    format`${bold(tr("settings_title"))}

${bold(tr("settings_current_mode"))} ${modeLabel}

${modeDescription}`,
    {
      reply_markup: settingsKeyboard(currentMode, tr),
    }
  );
});

// /premium command - show plan info and upgrade options
bot.command("premium", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);

  const planInfo = formatPlanInfo(userId);
  const { plan } = queries.getUserPlan(userId);

  await context.send(planInfo, {
    reply_markup: premiumKeyboard(plan),
  });
});

// /presets command - region presets
bot.command("presets", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);
  const tr = getTranslator(userId);

  const presets = queries.getRegionPresets();
  const presetsWithAccess = presets.map((p) => ({
    ...p,
    hasAccess: queries.hasPresetAccess(userId, p.id),
  }));

  if (presets.length === 0) {
    await context.send(tr("presets_not_configured"));
    return;
  }

  await context.send("🗺️ **" + tr("presets_select_region") + "**\n\n" + tr("presets_intro"), {
    parse_mode: "Markdown",
    reply_markup: presetsListKeyboard(presetsWithAccess, tr),
  });
});

// /catalog command - open webapp
bot.command("catalog", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const tr = getTranslator(userId);
  const webappUrl = process.env.WEBAPP_URL;

  if (!webappUrl) {
    await context.send("WebApp not configured");
    return;
  }

  await context.send(tr("catalog_open"), {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: tr("catalog_button"),
            web_app: { url: webappUrl },
          },
        ],
      ],
    },
  });
});

// /addgroup command - add a new group for monitoring
bot.command("addgroup", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);
  ensureIdle(userId);
  const tr = getTranslator(userId);

  // Check for links in command arguments
  const args = context.text?.replace(/^\/addgroup(@\w+)?\s*/i, "").trim() || "";
  const links = parseTelegramLinks(args);

  if (links.length === 0) {
    // No links provided — show interactive picker
    send(userId, { type: "ADDGROUP" });
    await context.send(tr("groups_select_add"), {
      reply_markup: groupPickerKeyboard(nextRequestId(), tr),
    });
    return;
  }

  // Process links
  await context.send(tr("group_adding_count", { count: tr("groups_count", { n: links.length }) }));

  const results: string[] = [];
  const addedGroups: Array<{ groupId: number; groupTitle: string }> = [];

  for (const link of links) {
    const result = await addGroupByLink(userId, link);
    const displayValue = link.type === "username" ? link.value : link.value;
    if (result.success) {
      results.push(`✅ ${result.title}`);
      addedGroups.push({ groupId: result.groupId!, groupTitle: result.title! });
    } else {
      results.push(`❌ ${displayValue}: ${result.error}`);
    }
  }

  await context.send(results.join("\n"));

  // If groups were added — show add group prompt
  if (addedGroups.length > 0) {
    send(userId, { type: "ADDGROUP" });
    await showAddGroupPrompt(context, userId);
  }
});

// /groups command - list user's groups
bot.command("groups", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const tr = getTranslator(userId);
  const groups = queries.getUserGroups(userId);

  if (groups.length === 0) {
    await context.send(tr("groups_none"));
    return;
  }

  const list = groups
    .map((g) => {
      const icon = g.isChannel ? "📢" : "👥";
      return `${icon} ${g.title}`;
    })
    .join("\n");

  await context.send(format`
${bold(tr("groups_list_header"))}

${list}
  `);
});

// /publish command - publish ads to flea markets
bot.command("publish", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  ensureIdle(userId);
  await handlePublishCommand(bot, userId);
});

// Handle chat_shared event (user selected a group/channel via requestChat)
bot.on("chat_shared", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const tr = getTranslator(userId);

  if (fsmState(userId) !== "addingGroup") return;

  const chatShared = context.chatShared;
  if (!chatShared) return;

  const chatId = chatShared.chatId;
  const title = chatShared.title || "Unknown";
  const username = chatShared.username;
  const requestId = chatShared.requestId;
  // Even requestId = group, odd = channel (based on our nextRequestId logic)
  const isChannel = requestId % 2 === 1;

  botLog.debug({ chatId, title, username, requestId, isChannel }, "Chat shared");

  // Check if already added by user
  if (queries.hasUserGroup(userId, chatId)) {
    await context.send(tr("groups_already_added"));
    await showAddGroupPrompt(context, userId);
    return;
  }

  // Check if userbot is already member
  const isMember = await isUserbotMember(chatId);
  const needsInviteLink = !isMember && !username;

  const newGroup: PendingGroup = {
    id: chatId,
    title,
    username,
    needsInviteLink,
    isChannel,
  };

  if (needsInviteLink) {
    // Ask for invite link - FSM transitions to awaitingInviteLink via guard
    send(userId, { type: "CHAT_SHARED", group: newGroup });

    await context.send(
      tr("groups_private_need_link", { title }),
      { reply_markup: inviteLinkKeyboard(tr) }
    );
    return;
  }

  // Try to join and add
  await addGroupForUser(context, userId, newGroup);
});

// Parse Telegram group/channel links from text
type ParsedLink = { type: "username" | "invite"; value: string };

function parseTelegramLinks(text: string): ParsedLink[] {
  const results: ParsedLink[] = [];
  const seen = new Set<string>();

  // Invite links: t.me/+hash or t.me/joinchat/hash
  const inviteRegex = /(?:https?:\/\/)?t\.me\/(\+|joinchat\/)([a-zA-Z0-9_-]+)/gi;
  let match;
  while ((match = inviteRegex.exec(text)) !== null) {
    const prefix = match[1];
    const hash = match[2];
    if (!prefix || !hash) continue;
    const link = `t.me/${prefix}${hash}`;
    if (!seen.has(link)) {
      seen.add(link);
      results.push({ type: "invite", value: link });
    }
  }

  // Public usernames: t.me/username (not starting with + or joinchat/)
  const usernameRegex = /(?:https?:\/\/)?t\.me\/([a-zA-Z][a-zA-Z0-9_]{3,})/gi;
  while ((match = usernameRegex.exec(text)) !== null) {
    const username = match[1]?.toLowerCase();
    if (!username) continue;
    // Skip if it was already matched as invite link
    if (username === "joinchat") continue;
    if (!seen.has(username)) {
      seen.add(username);
      results.push({ type: "username", value: `@${username}` });
    }
  }

  return results;
}

// Add group by link (join userbot, save to DB)
async function addGroupByLink(
  userId: number,
  link: ParsedLink
): Promise<{ success: true; title: string; groupId: number } | { success: false; error: string }> {
  // Check for duplicate by trying to resolve the link
  const joinResult = await joinGroupByUserbot(
    link.type === "username" ? link.value : `https://${link.value}`
  );

  if (!joinResult.success) {
    return { success: false, error: joinResult.error };
  }

  // Check if already added
  if (queries.hasUserGroup(userId, joinResult.chatId)) {
    // Note: error message returned here, translation happens in caller
    return { success: false, error: "already_added" };
  }

  // Save to DB (isChannel = false by default, we can't easily detect this from link)
  queries.addUserGroup(userId, joinResult.chatId, joinResult.title, false);

  return { success: true, title: joinResult.title, groupId: joinResult.chatId };
}

// Helper to show add group prompt
async function showAddGroupPrompt(
  context: { send: (text: string, options?: object) => Promise<unknown> },
  userId: number
): Promise<void> {
  const tr = getTranslator(userId);
  send(userId, { type: "ADDGROUP" });
  await context.send(tr("groups_select_more"), {
    reply_markup: groupPickerKeyboard(nextRequestId(), tr),
  });
}

// Add group for user (join userbot if needed, save to DB)
async function addGroupForUser(
  context: { send: (text: string, options?: object) => Promise<unknown> },
  userId: number,
  group: PendingGroup
): Promise<{ success: boolean; groupId?: number }> {
  const icon = group.isChannel ? "📢" : "👥";

  // Try to join
  const result = await ensureUserbotInGroup(group.id, group.username, group.inviteLink);

  if (result.success) {
    const tr = getTranslator(userId);
    // Save to DB
    queries.addUserGroup(userId, group.id, group.title || "Unknown", group.isChannel);
    await context.send(tr("group_added_success", { icon, title: group.title || "Unknown" }), {
      reply_markup: { remove_keyboard: true },
    });

    await showAddGroupPrompt(context, userId);
    return { success: true, groupId: group.id };
  } else {
    const tr = getTranslator(userId);
    await context.send(tr("group_add_failed", { title: group.title || "Unknown", error: result.error || "Unknown error" }), {
      reply_markup: { remove_keyboard: true },
    });
    await showAddGroupPrompt(context, userId);
    return { success: false };
  }
}

// Helper: process new subscription query
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processSubscriptionQuery(context: any, userId: number, query: string): Promise<void> {
  const tr = getTranslator(userId);

  // Check subscription limits before processing
  const limits = checkSubscriptionLimits(userId);
  if (!limits.canCreate) {
    const planNames = { free: "Free", basic: "Basic", pro: "Pro", business: "Business" } as const;
    const currentPlanName = planNames[limits.plan];
    const nextPlan = limits.plan === "free" ? "basic" : limits.plan === "basic" ? "pro" : "business";
    const nextPlanName = planNames[nextPlan];
    const price = PLAN_PRICES[nextPlan];

    await context.send(
      format`${bold(tr("sub_limit_reached"))}

${tr("sub_limit_your_plan", { plan: currentPlanName })}
${tr("sub_limit_subs_count", { current: limits.current, max: limits.max })}

${tr("sub_limit_upgrade_prompt")}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: tr("sub_limit_upgrade_button", { plan: nextPlanName, price }), callback_data: JSON.stringify({ action: "upgrade", plan: nextPlan }) }],
          ],
        },
      }
    );
    return;
  }

  // Check if user has region selected
  const userPlan = queries.getUserPlan(userId);
  if (!userPlan.region_code) {
    // Get unique countries from presets
    const countries = queries.getUniqueCountries();
    if (countries.length > 0) {
      // Save query to continue after region selection
      send(userId, { type: "SAVE_PENDING_QUERY", query });

      const countryOptions = countries.map((c) => ({
        country_code: c.country_code,
        country_name: getCountryName(c.country_code),
      }));

      await context.send(
        format`${bold(tr("presets_select_region"))}

${tr("presets_region_explanation")}`,
        { reply_markup: regionSelectionKeyboard(countryOptions, tr) }
      );
      return;
    }
  }

  const mode = queries.getUserMode(userId);

  if (mode === "normal") {
    // Normal mode: analyze query first, ask clarification if needed
    // Save query for recovery before starting LLM call
    send(userId, { type: "SAVE_QUERY", query });

    await sendProgressWithPromo(context, userId, tr("analysis_analyzing"), "bot_analyzing");

    try {
      const analysis = await runWithRecovery(
        userId,
        "GENERATE_QUESTIONS",
        undefined,
        () => analyzeQueryAndGenerateQuestions(query)
      );

      if (analysis.needsClarification && analysis.questions.length > 0) {
        // Need clarification — show questions
        botLog.debug({ userId, questionsCount: analysis.questions.length }, "Normal mode: asking clarification");

        send(userId, {
          type: "START_CLARIFICATION",
          data: {
            originalQuery: query,
            questions: analysis.questions,
            answers: [],
            currentIndex: 0,
          },
        });

        // Debug: verify state changed
        const newState = fsmState(userId);
        const newCtx = ctx(userId);
        botLog.debug(
          { userId, newState, hasClarification: !!newCtx.clarification },
          "After START_CLARIFICATION"
        );

        const firstQuestion = analysis.questions[0]!;
        const questionNumber = `(1/${analysis.questions.length})`;
        await context.send(format`${bold(tr("clarify_question"))} ${questionNumber}\n\n${firstQuestion}`, {
          reply_markup: skipQuestionKeyboard(tr),
        });
        return;
      }
    } catch (error) {
      botLog.error({ err: error, userId }, "Query analysis failed, skipping clarification");
      // Continue without clarification
    }

    // No clarification needed — go directly to rating (semantic search by query)
    await startRatingFlow(context, userId, query);
  } else {
    // Advanced mode: start with clarification questions
    // Save query for recovery before starting LLM call
    send(userId, { type: "SAVE_QUERY", query });

    await context.send(tr("clarify_generating"));

    let questions: string[];
    try {
      questions = await runWithRecovery(
        userId,
        "GENERATE_QUESTIONS",
        undefined,
        () => generateClarificationQuestions(query)
      );
    } catch (error) {
      botLog.error({ err: error, userId }, "LLM clarification generation failed");
      // Fallback: skip clarification, go directly to rating (semantic search by query)
      await context.send(tr("clarify_failed"));
      await startRatingFlow(context, userId, query);
      return;
    }

    // Save clarification state
    send(userId, {
      type: "START_CLARIFICATION",
      data: {
        originalQuery: query,
        questions,
        answers: [],
        currentIndex: 0,
      },
    });

    // Send first question
    const firstQuestion = questions[0] ?? tr("clarify_default");
    const questionNumber = `(1/${questions.length})`;
    await context.send(format`${bold(tr("clarify_question"))} ${questionNumber}\n\n${firstQuestion}`, {
      reply_markup: skipQuestionKeyboard(tr),
    });
  }
}

// Format not_found reason for user
function formatNotFoundReason(
  reason: import("./forward.ts").NotFoundReason,
  groupTitle: string | undefined,
  tr: Translator
): string {
  switch (reason) {
    case "no_text":
      return tr("forward_no_text");
    case "text_not_in_db":
      return tr("forward_not_seen");
    case "no_analyses_for_user":
      return groupTitle
        ? tr("forward_not_analyzed_group", { title: groupTitle })
        : tr("forward_not_analyzed");
    case "group_not_monitored_by_user":
      return groupTitle
        ? tr("forward_group_not_added", { title: groupTitle })
        : tr("forward_group_not_monitored");
  }
}

// Process forwarded message (extracted for reuse with albums)
async function processForwardedMessage(
  context: Parameters<Parameters<typeof bot.on<"message">>[1]>[0],
  userId: number,
  messageText: string
) {
  const tr = getTranslator(userId);
  const result = handleForward(
    {
      message: context as unknown as import("gramio").Message,
      from: context.from,
    },
    messageText
  );

  switch (result.type) {
    case "not_forward":
      // Should not happen
      break;

    case "error":
      await context.send(result.message);
      break;

    case "not_monitored":
      await context.send(
        tr("forward_group_not_added", { title: result.chatTitle || tr("forward_group_unknown") }),
        { reply_markup: addGroupKeyboard(result.chatId, result.chatTitle, tr) }
      );
      break;

    case "not_found": {
      const reasonText = formatNotFoundReason(result.reason, result.groupTitle, tr);

      // If no text or group not monitored - just show message, no analyze button
      if (result.reason === "no_text" || result.reason === "group_not_monitored_by_user") {
        await context.send(reasonText);
        return;
      }

      // Offer to analyze
      await context.send(
        reasonText,
        {
          reply_markup: analyzeForwardKeyboard(),
          reply_parameters: { message_id: context.id! },
        }
      );
      break;
    }

    case "found":
      // Show each analysis as separate message with actions
      for (const analysis of result.analyses) {
        const text = formatAnalysisResult(analysis, userId);
        const isRejected = analysis.result !== "matched";

        if (isRejected && result.forwardInfo.chatId !== undefined) {
          await context.send(text, {
            reply_markup: forwardActionsKeyboard(
              analysis.subscription_id,
              result.forwardInfo.messageId ?? 0,
              result.forwardInfo.chatId,
              analysis.rejection_keyword
            ),
          });
        } else {
          await context.send(text);
        }
      }
      break;
  }
}

// Handle text messages (new subscription requests)
bot.on("message", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const tr = getTranslator(userId);

  // Handle forwarded messages FIRST - before text check
  // (forwards can be media without text)
  if (context.forwardOrigin) {
    // For albums - collect all messages then process
    if (context.mediaGroupId) {
      const albumKey = `${userId}:${context.mediaGroupId}`;
      const existing = pendingAlbums.get(albumKey);

      if (existing) {
        // Add to existing album collection
        existing.messages.push({
          text: context.text,
          caption: context.caption,
          message: context,
        });
        return; // Wait for timeout to process
      }

      // First message of album - start collecting
      const albumData: AlbumData = {
        messages: [{
          text: context.text,
          caption: context.caption,
          message: context,
        }],
        userId,
        timeout: setTimeout(async () => {
          pendingAlbums.delete(albumKey);

          // Find text from any message in album
          const albumText = albumData.messages
            .map(m => m.text || m.caption || "")
            .find(t => t.trim()) || "";

          // Use first message for forward info
          const firstMsg = albumData.messages[0]?.message;
          if (!firstMsg) return;

          await processForwardedMessage(
            firstMsg as typeof context,
            userId,
            albumText
          );
        }, ALBUM_COLLECT_DELAY),
      };
      pendingAlbums.set(albumKey, albumData);
      return; // Wait for timeout
    }

    // Single message (not album) - process immediately
    await processForwardedMessage(context, userId, context.text || context.caption || "");
    return;
  }

  // Check publication flow for photos (with optional caption as text)
  if (isInPublicationFlow(userId) && context.photo) {
    // Get largest photo size
    const photo = context.photo[context.photo.length - 1];
    if (photo) {
      const handled = await handlePublicationPhoto(bot, userId, photo.fileId, context.caption);
      if (handled) return;
    }
  }

  // For non-forward messages, require text
  if (!context.text || context.text.startsWith("/")) return;

  // Check if user is editing a publication post
  const { isEditing, handleEditedText } = await import("../publisher/interactive.ts");
  if (isEditing(userId)) {
    const handled = await handleEditedText(bot, userId, context.text);
    if (handled) return;
  }

  // Check publication flow first (phone/code/password/text input)
  if (isInPublicationFlow(userId)) {
    const handled = await handlePublicationText(bot, userId, context.text);
    if (handled) return;
  }

  const currentState = fsmState(userId);
  const c = ctx(userId);
  const text = context.text;

  // Debug logging
  botLog.debug(
    { userId, currentState, hasClarification: !!c.clarification, text: text.substring(0, 50) },
    "Message handler: state check"
  );

  // Handle "Done" button in adding_group state (check all locales)
  const isDoneButton = text === "Готово" || text === "Done" || text === "Gotovo";
  if (isDoneButton && currentState === "addingGroup") {
    const pendingQuery = c.pendingQuery;
    send(userId, { type: "DONE_ADDING_GROUPS" });

    // Clear pending query if it exists
    if (pendingQuery) {
      send(userId, { type: "CLEAR_PENDING_QUERY" });
    }

    const groups = queries.getUserGroups(userId);
    if (groups.length > 0) {
      // If there was a pending query, process it automatically
      if (pendingQuery) {
        await context.send(tr("groups_added_processing", { n: groups.length }), {
          reply_markup: { remove_keyboard: true },
        });
        await processSubscriptionQuery(context, userId, pendingQuery);
      } else {
        await context.send(tr("groups_added_ready", { n: groups.length }), {
          reply_markup: { remove_keyboard: true },
        });
      }
    } else {
      await context.send(tr("groups_not_added"), {
        reply_markup: { remove_keyboard: true },
      });
    }
    return;
  }

  // Handle invite link input (for /addgroup flow)
  if (currentState === "awaitingInviteLink" && c.currentPendingGroup) {
    const inviteLinkRegex = /t\.me\/(\+|joinchat\/)/;
    if (inviteLinkRegex.test(text)) {
      const group: PendingGroup = {
        ...c.currentPendingGroup,
        inviteLink: text.trim(),
        needsInviteLink: false,
      };
      send(userId, { type: "INVITE_LINK", link: text.trim() });
      await context.send(tr("groups_joining"), {
        reply_markup: { remove_keyboard: true },
      });
      await addGroupForUser(context, userId, group);
    } else {
      await context.send(tr("groups_invalid_format"));
    }
    return;
  }

  // Handle editing existing subscription positive keywords
  if (currentState === "editingSubPositive" && c.editingSubscriptionId) {
    const newKeywords = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (newKeywords.length === 0) {
      await context.send(tr("kw_need_words"));
      return;
    }

    const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
    if (!sub) {
      send(userId, { type: "CANCEL" });
      await context.send(tr("sub_not_found"));
      return;
    }

    const combined = [...sub.positive_keywords, ...newKeywords];
    const unique = [...new Set(combined)];
    queries.updatePositiveKeywords(c.editingSubscriptionId, userId, unique);
    invalidateSubscriptionsCache();

    send(userId, { type: "CANCEL" });
    await context.send(tr("kw_added", { added: newKeywords.join(", "), current: unique.join(", ") }));
    return;
  }

  // Handle editing existing subscription negative keywords
  if (currentState === "editingSubNegative" && c.editingSubscriptionId) {
    const newKeywords = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (newKeywords.length === 0) {
      await context.send(tr("kw_need_words"));
      return;
    }

    const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
    if (!sub) {
      send(userId, { type: "CANCEL" });
      await context.send(tr("sub_not_found"));
      return;
    }

    const combined = [...sub.negative_keywords, ...newKeywords];
    const unique = [...new Set(combined)];
    queries.updateNegativeKeywords(c.editingSubscriptionId, userId, unique);
    invalidateSubscriptionsCache();

    send(userId, { type: "CANCEL" });
    await context.send(tr("kw_added", { added: newKeywords.join(", "), current: unique.join(", ") }));
    return;
  }

  // Handle editing existing subscription description
  if (currentState === "editingSubDescription" && c.editingSubscriptionId) {
    if (text.length < 5) {
      await context.send(tr("kw_description_short"));
      return;
    }

    queries.updateLlmDescription(c.editingSubscriptionId, userId, text);
    send(userId, { type: "TEXT_DESCRIPTION", text });
    await context.send(tr("kw_description_updated"));
    return;
  }

  // Handle adding positive keywords
  if (currentState === "addingPositive") {
    const newKeywords = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (newKeywords.length === 0) {
      await context.send(tr("kw_need_words"));
      return;
    }

    // Pending subscription (during confirmation)
    if (c.pendingSub) {
      const combined = [...c.pendingSub.positiveKeywords, ...newKeywords];
      const unique = [...new Set(combined)];
      const queryId = `${userId}_${Date.now()}`;

      send(userId, { type: "TEXT_KEYWORDS", keywords: newKeywords });
      await context.send(
        format`${tr("kw_added_full", { added: newKeywords.join(", ") })}

${bold(tr("kw_positive"))}
${code(unique.join(", "))}

${bold(tr("kw_negative"))}
${code(c.pendingSub.negativeKeywords.join(", ") || tr("analysis_none"))}
        `,
        { reply_markup: keywordEditConfirmKeyboard(queryId, tr) }
      );
      return;
    }

    // Existing subscription
    if (c.editingSubscriptionId) {
      const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
      if (!sub) {
        send(userId, { type: "CANCEL" });
        await context.send(tr("sub_not_found"));
        return;
      }

      const combined = [...sub.positive_keywords, ...newKeywords];
      const unique = [...new Set(combined)];
      queries.updatePositiveKeywords(c.editingSubscriptionId, userId, unique);
      invalidateSubscriptionsCache();

      send(userId, { type: "CANCEL" });
      await context.send(tr("kw_added_current", { added: newKeywords.join(", "), current: unique.join(", ") }));
      return;
    }

    send(userId, { type: "CANCEL" });
    return;
  }

  // Handle adding negative keywords
  if (currentState === "addingNegative") {
    const newKeywords = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (newKeywords.length === 0) {
      await context.send(tr("kw_need_words"));
      return;
    }

    // Pending subscription (during confirmation)
    if (c.pendingSub) {
      const combined = [...c.pendingSub.negativeKeywords, ...newKeywords];
      const unique = [...new Set(combined)];
      const queryId = `${userId}_${Date.now()}`;

      send(userId, { type: "TEXT_KEYWORDS", keywords: newKeywords });
      await context.send(
        format`${tr("kw_added", { words: newKeywords.join(", ") })}

${bold(tr("kw_positive"))}
${code(c.pendingSub.positiveKeywords.join(", "))}

${bold(tr("kw_negative"))}
${code(unique.join(", "))}
        `,
        { reply_markup: keywordEditConfirmKeyboard(queryId) }
      );
      return;
    }

    // Existing subscription
    if (c.editingSubscriptionId) {
      const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
      if (!sub) {
        send(userId, { type: "CANCEL" });
        await context.send(tr("sub_not_found"));
        return;
      }

      const combined = [...sub.negative_keywords, ...newKeywords];
      const unique = [...new Set(combined)];
      queries.updateNegativeKeywords(c.editingSubscriptionId, userId, unique);
      invalidateSubscriptionsCache();

      send(userId, { type: "CANCEL" });
      await context.send(tr("kw_added_current", { added: newKeywords.join(", "), current: unique.join(", ") }));
      return;
    }

    send(userId, { type: "CANCEL" });
    return;
  }

  // Handle removing keywords by numbers
  if (currentState === "removingPositive" || currentState === "removingNegative") {
    const type = currentState === "removingPositive" ? "positive" : "negative";

    // Parse numbers from text (e.g., "1, 3, 5" or "1 3 5")
    const indices = text
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10) - 1) // Convert to 0-indexed
      .filter((n) => !isNaN(n) && n >= 0);

    if (indices.length === 0) {
      await context.send(tr("kw_send_numbers"));
      return;
    }

    // Pending subscription (during confirmation)
    if (c.pendingSub) {
      const keywords =
        type === "positive"
          ? [...c.pendingSub.positiveKeywords]
          : [...c.pendingSub.negativeKeywords];
      const removed: string[] = [];

      const sortedIndices = [...new Set(indices)].sort((a, b) => b - a);
      for (const idx of sortedIndices) {
        if (idx >= 0 && idx < keywords.length) {
          const [word] = keywords.splice(idx, 1);
          if (word) removed.unshift(word);
        }
      }

      if (removed.length === 0) {
        await context.send(tr("kw_invalid_numbers"));
        return;
      }

      if (type === "positive" && keywords.length === 0) {
        await context.send(tr("kw_cant_delete_all"));
        return;
      }

      const queryId = `${userId}_${Date.now()}`;

      // Send REMOVE_KEYWORD for each removed index (in reverse order)
      for (const idx of sortedIndices) {
        send(userId, { type: "REMOVE_KEYWORD", index: idx });
      }

      const updatedC = ctx(userId);
      await context.send(
        format`${tr("kw_deleted", { list: removed.join(", ") })}

${bold(tr("kw_positive"))}
${code(updatedC.pendingSub?.positiveKeywords.join(", ") || "")}

${bold(tr("kw_negative"))}
${code(updatedC.pendingSub?.negativeKeywords.join(", ") || tr("analysis_none"))}
        `,
        { reply_markup: keywordEditConfirmKeyboard(queryId) }
      );
      return;
    }

    // Existing subscription
    if (c.editingSubscriptionId) {
      const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
      if (!sub) {
        send(userId, { type: "CANCEL" });
        await context.send(tr("sub_not_found"));
        return;
      }

      const keywords = type === "positive" ? [...sub.positive_keywords] : [...sub.negative_keywords];
      const removed: string[] = [];

      const sortedIndices = [...new Set(indices)].sort((a, b) => b - a);
      for (const idx of sortedIndices) {
        if (idx >= 0 && idx < keywords.length) {
          const [word] = keywords.splice(idx, 1);
          if (word) removed.unshift(word);
        }
      }

      if (removed.length === 0) {
        await context.send(tr("kw_invalid_numbers"));
        return;
      }

      if (type === "positive" && keywords.length === 0) {
        await context.send(tr("kw_cant_delete_all"));
        return;
      }

      if (type === "positive") {
        queries.updatePositiveKeywords(c.editingSubscriptionId, userId, keywords);
      } else {
        queries.updateNegativeKeywords(c.editingSubscriptionId, userId, keywords);
      }
      invalidateSubscriptionsCache();

      send(userId, { type: "CANCEL" });
      await context.send(
        keywords.length > 0
          ? tr("kw_removed_remaining", { removed: removed.join(", "), remaining: keywords.join(", ") })
          : tr("kw_removed_all", { removed: removed.join(", ") })
      );
      return;
    }

    send(userId, { type: "CANCEL" });
    return;
  }

  // Handle AI editing flow
  if (currentState === "editingSubAi" && c.pendingAiEdit) {
    const { current, conversation, subscriptionId } = c.pendingAiEdit;
    // Convert camelCase to snake_case for LLM function
    const currentSnake = {
      positive_keywords: current.positiveKeywords,
      negative_keywords: current.negativeKeywords,
      llm_description: current.llmDescription,
    };

    await context.send(tr("ai_correcting"));

    try {
      const result = await runWithRecovery(
        userId,
        "AI_EDIT",
        undefined, // MessageContext.send() doesn't return message_id
        () => interpretEditCommand(text, currentSnake, conversation, getLLMLanguage(userId))
      );

      // Get examples for new parameters
      const examples = getExamplesForSubscription(
        subscriptionId,
        result.positive_keywords,
        result.negative_keywords,
        2
      );

      // Format diff
      const addedPos = result.positive_keywords.filter((k: string) => !currentSnake.positive_keywords.includes(k));
      const removedPos = currentSnake.positive_keywords.filter((k: string) => !result.positive_keywords.includes(k));
      const addedNeg = result.negative_keywords.filter((k: string) => !currentSnake.negative_keywords.includes(k));
      const removedNeg = currentSnake.negative_keywords.filter((k: string) => !result.negative_keywords.includes(k));

      let diffText = "";
      if (addedPos.length) diffText += tr("diff_added", { list: addedPos.join(", ") }) + "\n";
      if (removedPos.length) diffText += tr("diff_removed", { list: removedPos.join(", ") }) + "\n";
      if (addedNeg.length) diffText += tr("diff_added_exclusions", { list: addedNeg.join(", ") }) + "\n";
      if (removedNeg.length) diffText += tr("diff_removed_exclusions", { list: removedNeg.join(", ") }) + "\n";
      if (currentSnake.llm_description !== result.llm_description) {
        diffText += tr("diff_description", { desc: result.llm_description }) + "\n";
      }

      // Format examples
      let examplesText = "";
      for (const ex of examples) {
        const source = ex.isFromCache ? `[${ex.groupTitle}]` : ex.groupTitle;
        examplesText += `${source}\n"${ex.text}"\n\n`;
      }

      // Update FSM state with proposed changes
      send(userId, { type: "TEXT_AI_COMMAND", text });
      send(userId, {
        type: "AI_PROPOSED",
        proposed: {
          positiveKeywords: result.positive_keywords,
          negativeKeywords: result.negative_keywords,
          llmDescription: result.llm_description,
        },
      });

      await context.send(
        format`${bold(tr("ai_changes"))}
${diffText || tr("ai_no_changes")}
${bold(tr("ai_comment"))} ${result.summary}

${bold(tr("ai_example_messages"))}
${examplesText}
${tr("ai_continue_or_apply")}`,
        {
          reply_markup: aiEditKeyboard(subscriptionId, tr),
        }
      );
    } catch (error) {
      botLog.error({ err: error, userId }, "AI edit interpretation failed");
      await context.send(tr("ai_error"));
    }
    return;
  }

  // Handle feedback review text after subscription deletion
  if (currentState === "awaitingFeedbackReview") {
    const subscriptionId = c.feedbackSubscriptionId;
    const subscriptionQuery = c.feedbackSubscriptionQuery;
    const outcome = c.feedbackOutcome;

    if (!subscriptionId || !outcome) {
      send(userId, { type: "CANCEL" });
      return;
    }

    // Save feedback with review
    queries.saveFeedback({
      subscriptionId,
      telegramId: userId,
      outcome,
      review: text,
    });

    // Notify admin
    const adminId = process.env.ADMIN_ID;
    if (adminId) {
      const adminTr = getTranslator(Number(adminId));
      const outcomeText = {
        bought: adminTr("admin_feedback_bought"),
        not_bought: adminTr("admin_feedback_not_bought"),
        complicated: adminTr("admin_feedback_complicated"),
      };
      const user = queries.getUserByTelegramId(userId);
      const username = user?.username ? `@${user.username}` : `ID: ${userId}`;
      await bot.api.sendMessage({
        chat_id: Number(adminId),
        text: adminTr("admin_feedback_from", {
          user: username,
          outcome: outcomeText[outcome],
          query: subscriptionQuery ?? "—",
          review: text,
        }),
      });
    }

    send(userId, { type: "FEEDBACK_REVIEW", text });
    await context.send(tr("feedback_thanks_full"));
    return;
  }

  // Handle AI correction for pending subscription
  if (currentState === "correctingPendingAi" && c.pendingSub && c.pendingAiCorrection) {
    const { mode, current, conversation } = c.pendingAiCorrection;
    // Convert to snake_case for LLM
    const currentSnake = {
      positive_keywords: current.positiveKeywords,
      negative_keywords: current.negativeKeywords,
      llm_description: current.llmDescription,
    };

    await context.send(tr("ai_correcting"));

    try {
      if (mode === "normal") {
        // Normal mode: correct description only, then regenerate keywords
        const { descResult, keywordsResult } = await runWithRecovery(
          userId,
          "AI_CORRECT",
          undefined, // MessageContext.send() doesn't return message_id
          async () => {
            const descResult = await correctDescription(
              c.pendingSub!.originalQuery,
              currentSnake.llm_description,
              text
            );
            // Regenerate keywords based on new description
            const keywordsResult = await generateKeywords(descResult.description);
            return { descResult, keywordsResult };
          }
        );

        // Update FSM state with proposed changes
        send(userId, { type: "TEXT_AI_COMMAND", text });
        send(userId, {
          type: "AI_CORRECTION_PROPOSED",
          proposed: {
            positiveKeywords: keywordsResult.positive_keywords,
            negativeKeywords: keywordsResult.negative_keywords,
            llmDescription: descResult.description,
          },
        });

        await context.send(
          format`${bold(tr("ai_new_description"))}
${descResult.description}

${bold(tr("ai_comment"))} ${descResult.summary}

${tr("ai_keywords_auto_regen")}`,
          {
            reply_markup: pendingAiEditKeyboard(tr),
          }
        );
      } else {
        // Advanced mode: full control over keywords
        const result = await runWithRecovery(
          userId,
          "AI_CORRECT",
          undefined,
          () => interpretEditCommand(text, currentSnake, conversation, getLLMLanguage(userId))
        );

        // Format diff
        const addedPos = result.positive_keywords.filter((k: string) => !currentSnake.positive_keywords.includes(k));
        const removedPos = currentSnake.positive_keywords.filter((k: string) => !result.positive_keywords.includes(k));
        const addedNeg = result.negative_keywords.filter((k: string) => !currentSnake.negative_keywords.includes(k));
        const removedNeg = currentSnake.negative_keywords.filter((k: string) => !result.negative_keywords.includes(k));

        let diffText = "";
        if (addedPos.length) diffText += tr("diff_added", { list: addedPos.join(", ") }) + "\n";
        if (removedPos.length) diffText += tr("diff_removed", { list: removedPos.join(", ") }) + "\n";
        if (addedNeg.length) diffText += tr("diff_added_exclusions", { list: addedNeg.join(", ") }) + "\n";
        if (removedNeg.length) diffText += tr("diff_removed_exclusions", { list: removedNeg.join(", ") }) + "\n";
        if (currentSnake.llm_description !== result.llm_description) {
          diffText += tr("diff_description", { desc: result.llm_description }) + "\n";
        }

        // Update FSM state with proposed changes
        send(userId, { type: "TEXT_AI_COMMAND", text });
        send(userId, {
          type: "AI_CORRECTION_PROPOSED",
          proposed: {
            positiveKeywords: result.positive_keywords,
            negativeKeywords: result.negative_keywords,
            llmDescription: result.llm_description,
          },
        });

        await context.send(
          format`${bold(tr("ai_changes"))}
${diffText || tr("ai_no_changes")}
${bold(tr("ai_comment"))} ${result.summary}

${tr("ai_continue_or_apply")}`,
          {
            reply_markup: pendingAiEditKeyboard(tr),
          }
        );
      }
    } catch (error) {
      botLog.error({ err: error, userId }, "AI correction for pending failed");
      await context.send(tr("ai_error"));
    }
    return;
  }

  // Handle clarification question answers
  if (currentState === "clarifyingQuery" && c.clarification) {
    const { questions, answers, currentIndex, originalQuery } = c.clarification;

    // Save answer via FSM event
    send(userId, { type: "ANSWER", text });

    const nextIndex = currentIndex + 1;

    if (nextIndex < questions.length) {
      // More questions to ask
      const nextQuestion = questions[nextIndex] ?? "";
      const questionNumber = `(${nextIndex + 1}/${questions.length})`;
      await context.send(format`${bold(tr("clarify_question"))} ${questionNumber}\n\n${nextQuestion}`, {
        reply_markup: skipQuestionKeyboard(tr),
      });
    } else {
      // All questions answered — start rating flow (semantic search by query)
      await sendProgressWithPromo(context, userId, tr("clarify_analyzing"), "bot_analyzing");
      const updatedC = ctx(userId);
      const finalAnswers = updatedC.clarification?.answers || [...answers, text];
      const clarificationContext = formatClarificationContext(questions, finalAnswers);

      await startRatingFlow(context, userId, originalQuery, clarificationContext);
    }
    return;
  }

  // New subscription request — start appropriate flow
  const query = context.text;

  // Reset FSM to idle if stuck in another state (e.g. from previous session)
  ensureIdle(userId);

  // Check if user has any groups to monitor
  const userGroups = queries.getUserGroups(userId);
  if (userGroups.length === 0) {
    // No groups - save query and redirect to addgroup flow
    send(userId, { type: "SAVE_PENDING_QUERY", query });
    send(userId, { type: "ADDGROUP" });
    await context.send(
      tr("sub_need_groups_first"),
      { reply_markup: groupPickerKeyboard(nextRequestId(), tr) }
    );
    return;
  }

  // Process the subscription query
  await processSubscriptionQuery(context, userId, query);
});

// Handle callback queries (button clicks)
bot.on("callback_query", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  let data: { action: string; id?: string | number; type?: string; idx?: number; msgId?: number; grpId?: number; kw?: string; lang?: string };
  try {
    const raw = JSON.parse(context.data || "{}");
    // Normalize short keys to long keys
    data = {
      action: raw.action || raw.a || "",
      id: raw.id ?? raw.s,
      type: raw.type,
      idx: raw.idx,
      msgId: raw.msgId ?? raw.m,
      grpId: raw.grpId ?? raw.g,
      kw: raw.kw,
      lang: raw.lang ?? raw.l,
    };
  } catch {
    return;
  }

  const c = ctx(userId);
  const currentState = fsmState(userId);
  const tr = getTranslator(userId);

  switch (data.action) {
    case "confirm": {
      if (currentState !== "awaitingConfirmation" || !c.pendingSub) {
        await context.answer({ text: tr("sub_session_expired") });
        return;
      }

      // Get user's groups from DB
      const userGroups = queries.getUserGroups(userId);

      if (userGroups.length === 0) {
        // No groups - create subscription without them
        const { originalQuery, positiveKeywords, negativeKeywords, llmDescription } =
          c.pendingSub;

        const subscriptionId = queries.createSubscription(
          userId,
          originalQuery,
          positiveKeywords,
          negativeKeywords,
          llmDescription
        );

        // Generate BGE-M3 embeddings in background (non-blocking)
        generateKeywordEmbeddings(positiveKeywords, negativeKeywords)
          .then((embeddings) => {
            queries.updateKeywordEmbeddings(subscriptionId, embeddings);
            botLog.info({ subscriptionId }, "Keyword embeddings generated");
          })
          .catch((e) => botLog.error({ err: e, subscriptionId }, "Failed to generate embeddings"));

        invalidateSubscriptionsCache();

        send(userId, { type: "CANCEL" });
        await context.answer({ text: tr("cb_subscription_created") });
        await context.editText(tr("sub_no_groups_created"));
        return;
      }

      // Move to group selection
      const groups = userGroups.map((g) => ({ id: g.id, title: g.title }));
      send(userId, { type: "START_GROUP_SELECTION", available: groups });

      // Get region presets for user's country
      const regionPresets = getUserRegionPresets(userId);

      await context.answer({ text: tr("cb_select_groups") });
      await context.editText(
        format`
${bold(tr("sub_select_groups"))}

${groups.length}
        `,
        {
          reply_markup: groupsKeyboard(groups, new Set(), regionPresets, tr),
        }
      );
      break;
    }

    case "edit": {
      // Legacy - redirect to positive keywords submenu
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      await context.answer({ text: tr("cb_select_action") });
      await context.editText(
        tr("kw_pending_positive", { list: c.pendingSub.positiveKeywords.join(", ") }),
        { reply_markup: keywordEditSubmenuPending("positive") }
      );
      break;
    }

    // Pending subscription: show submenu for positive keywords
    case "edit_positive_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      await context.answer({ text: tr("cb_select_action") });
      await context.editText(
        tr("kw_pending_positive", { list: c.pendingSub.positiveKeywords.join(", ") }),
        { reply_markup: keywordEditSubmenuPending("positive") }
      );
      break;
    }

    // Pending subscription: show submenu for negative keywords
    case "edit_negative_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      await context.answer({ text: tr("cb_select_action") });
      await context.editText(
        tr("kw_pending_negative", { list: c.pendingSub.negativeKeywords.join(", ") || tr("analysis_none") }),
        { reply_markup: keywordEditSubmenuPending("negative") }
      );
      break;
    }

    // Pending: add positive keywords
    case "add_positive_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      send(userId, { type: "ADD_POSITIVE" });
      await context.answer({ text: tr("cb_send_words") });
      await context.editText(
        tr("kw_current_send_add", { current: c.pendingSub.positiveKeywords.join(", ") })
      );
      break;
    }

    // Pending: add negative keywords
    case "add_negative_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      send(userId, { type: "ADD_NEGATIVE" });
      await context.answer({ text: tr("cb_send_words") });
      await context.editText(
        tr("kw_current_send_add", { current: c.pendingSub.negativeKeywords.join(", ") || tr("analysis_none") })
      );
      break;
    }

    // Pending: remove positive keywords (show UI)
    case "remove_positive_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      const keywords = c.pendingSub.positiveKeywords;
      if (keywords.length === 0) {
        await context.answer({ text: tr("kw_no_words_to_delete") });
        return;
      }
      send(userId, { type: "REMOVE_POSITIVE" });
      const list = keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
      await context.answer({ text: tr("kw_select_words") });
      await context.editText(
        tr("kw_select_words_numbered", { label: tr("kw_positive_label"), list }),
        { reply_markup: removeKeywordsKeyboard(keywords, "positive", null) }
      );
      break;
    }

    // Pending: remove negative keywords (show UI)
    case "remove_negative_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      const keywords = c.pendingSub.negativeKeywords;
      if (keywords.length === 0) {
        await context.answer({ text: tr("kw_no_words_to_delete") });
        return;
      }
      send(userId, { type: "REMOVE_NEGATIVE" });
      const list = keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
      await context.answer({ text: tr("kw_select_words") });
      await context.editText(
        tr("kw_select_words_numbered", { label: tr("kw_negative_label"), list }),
        { reply_markup: removeKeywordsKeyboard(keywords, "negative", null) }
      );
      break;
    }

    // Pending: remove keyword by clicking button
    case "rm_kw_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      const type = data.type as "positive" | "negative";
      const idx = Number(data.idx);

      const keywords =
        type === "positive"
          ? [...c.pendingSub.positiveKeywords]
          : [...c.pendingSub.negativeKeywords];
      const removed = keywords[idx];
      if (!removed) {
        await context.answer({ text: tr("kw_word_not_found") });
        return;
      }

      keywords.splice(idx, 1);

      if (type === "positive" && keywords.length === 0) {
        await context.answer({ text: tr("kw_cant_delete_last") });
        return;
      }

      // Remove keyword via FSM event
      send(userId, { type: "REMOVE_KEYWORD", index: idx });

      await context.answer({ text: tr("kw_answer_removed", { removed }) });

      // Re-read context after FSM update
      const updatedC = ctx(userId);

      if (keywords.length === 0) {
        // No more keywords, go back to confirm
        const queryId = `${userId}_${Date.now()}`;
        send(userId, { type: "BACK_TO_CONFIRM" });
        await context.editText(
          format`
${bold(tr("list_keywords"))}

${bold(tr("kw_positive"))}
${code(updatedC.pendingSub?.positiveKeywords.join(", ") ?? "")}

${bold(tr("kw_negative"))}
${code(updatedC.pendingSub?.negativeKeywords.join(", ") || tr("analysis_none"))}

${bold(tr("list_llm_description"))}
${updatedC.pendingSub?.llmDescription ?? ""}
          `,
          { reply_markup: keywordEditConfirmKeyboard(queryId) }
        );
      } else {
        const list = keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
        const label = type === "positive" ? tr("kw_positive_label") : tr("kw_negative_label");
        await context.editText(
          tr("kw_words_list", { label, list }),
          { reply_markup: removeKeywordsKeyboard(keywords, type, null) }
        );
      }
      break;
    }

    // Pending: back to confirmation screen
    case "back_to_confirm": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }
      const queryId = `${userId}_${Date.now()}`;
      send(userId, { type: "BACK_TO_CONFIRM" });
      await context.answer({ text: "OK" });
      await context.editText(
        format`
${bold(tr("list_keywords"))}

${bold(tr("kw_positive"))}
${code(c.pendingSub.positiveKeywords.join(", "))}

${bold(tr("kw_negative"))}
${code(c.pendingSub.negativeKeywords.join(", ") || tr("analysis_none"))}

${bold(tr("list_llm_description"))}
${c.pendingSub.llmDescription}
        `,
        { reply_markup: keywordEditConfirmKeyboard(queryId) }
      );
      break;
    }

    case "cancel": {
      send(userId, { type: "CANCEL" });
      await context.answer({ text: tr("cb_cancelled") });
      await context.editText(tr("cancel_send_new_query"));
      break;
    }

    case "skip_question": {
      if (currentState !== "clarifyingQuery" || !c.clarification) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const { questions, answers, currentIndex, originalQuery } = c.clarification;

      // Skip via FSM event
      send(userId, { type: "SKIP_QUESTION" });

      const nextIndex = currentIndex + 1;

      if (nextIndex < questions.length) {
        // More questions
        const nextQuestion = questions[nextIndex] ?? "";
        const questionNumber = `(${nextIndex + 1}/${questions.length})`;
        await context.answer({ text: tr("clarify_skipped") });
        await context.editText(format`${bold(tr("clarify_question"))} ${questionNumber}\n\n${nextQuestion}`, {
          reply_markup: skipQuestionKeyboard(),
        });
      } else {
        // All questions done — start rating flow (semantic search by query)
        await context.answer({ text: tr("ai_generating") });
        await context.editText(tr("clarify_analyzing"));
        const clarificationContext = formatClarificationContext(questions, answers);

        await startRatingFlow(context, userId, originalQuery, clarificationContext);
      }
      break;
    }

    case "disable": {
      const subscriptionId = Number(data.id);
      // Get subscription info before deactivating (for feedback notification)
      const subToDelete = queries.getSubscriptionById(subscriptionId, userId);
      const subscriptionQuery = subToDelete?.original_query ?? tr("unknown_query");

      queries.deactivateSubscription(subscriptionId, userId);
      invalidateSubscriptionsCache();
      await context.answer({ text: tr("sub_disabled") });

      // Ask for feedback
      await context.editText(tr("sub_disabled_ask_feedback"), {
        reply_markup: feedbackOutcomeKeyboard(subscriptionId),
      });

      // Transition FSM to collect feedback
      send(userId, {
        type: "START_FEEDBACK",
        subscriptionId,
        subscriptionQuery,
      });
      break;
    }

    case "pause": {
      const subscriptionId = Number(data.id);
      queries.pauseSubscription(subscriptionId, userId);
      invalidateSubscriptionsCache();
      await context.answer({ text: tr("sub_paused") });

      // Update the message to show paused state
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (sub) {
        const hasNeg = sub.negative_keywords.length > 0;
        const hasDisabledNeg = (sub.disabled_negative_keywords?.length ?? 0) > 0;
        const mode = queries.getUserMode(userId);

        let messageText;
        if (mode === "advanced") {
          let exclusionsText = tr("analysis_none");
          if (hasNeg) {
            exclusionsText = sub.negative_keywords.join(", ");
          } else if (hasDisabledNeg) {
            exclusionsText = tr("list_exclusions_disabled_list", { list: sub.disabled_negative_keywords!.join(", ") });
          }
          messageText = format`
${bold(tr("list_sub_header_paused", { id: sub.id }))}
${bold(tr("list_query"))} ${sub.original_query}
${bold(tr("list_keywords"))} ${code(sub.positive_keywords.join(", "))}
${bold(tr("list_exclusions"))} ${code(exclusionsText)}
          `;
        } else {
          messageText = format`
${bold(tr("list_sub_header_paused", { id: sub.id }))}
${bold(tr("list_query"))} ${sub.original_query}
          `;
        }

        await context.editText(messageText);
        await context.editReplyMarkup(subscriptionKeyboard(sub.id, hasNeg, hasDisabledNeg, mode, true));
      }
      break;
    }

    case "resume": {
      const subscriptionId = Number(data.id);
      queries.resumeSubscription(subscriptionId, userId);
      invalidateSubscriptionsCache();
      await context.answer({ text: tr("sub_resumed") });

      // Update the message to show active state
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (sub) {
        const hasNeg = sub.negative_keywords.length > 0;
        const hasDisabledNeg = (sub.disabled_negative_keywords?.length ?? 0) > 0;
        const mode = queries.getUserMode(userId);

        let messageText;
        if (mode === "advanced") {
          let exclusionsText = tr("analysis_none");
          if (hasNeg) {
            exclusionsText = sub.negative_keywords.join(", ");
          } else if (hasDisabledNeg) {
            exclusionsText = tr("list_exclusions_disabled_list", { list: sub.disabled_negative_keywords!.join(", ") });
          }
          messageText = format`
${bold(tr("list_sub_header", { id: sub.id, pause: "" }))}
${bold(tr("list_query"))} ${sub.original_query}
${bold(tr("list_keywords"))} ${code(sub.positive_keywords.join(", "))}
${bold(tr("list_exclusions"))} ${code(exclusionsText)}
          `;
        } else {
          messageText = format`
${bold(tr("list_sub_header", { id: sub.id, pause: "" }))}
${bold(tr("list_query"))} ${sub.original_query}
          `;
        }

        await context.editText(messageText);
        await context.editReplyMarkup(subscriptionKeyboard(sub.id, hasNeg, hasDisabledNeg, mode, false));
      }
      break;
    }

    case "pause_from_notification": {
      const subscriptionId = Number(data.id);
      queries.pauseSubscription(subscriptionId, userId);
      invalidateSubscriptionsCache();
      await context.answer({ text: tr("sub_paused_list") });
      break;
    }

    case "show_keywords": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      let text = `+ ${sub.positive_keywords.join(", ")}`;
      if (sub.negative_keywords.length > 0) {
        text += `\n− ${sub.negative_keywords.join(", ")}`;
      }

      await context.answer({ text, show_alert: true });
      break;
    }

    case "edit_positive": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      send(userId, { type: "CANCEL" }); // Reset to idle
      await context.answer({ text: tr("cb_select_action") });
      await context.editText(
        tr("kw_pending_positive", { list: sub.positive_keywords.join(", ") }),
        { reply_markup: keywordEditSubmenu("positive", subscriptionId) }
      );
      break;
    }

    case "edit_negative": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      send(userId, { type: "CANCEL" }); // Reset to idle
      await context.answer({ text: tr("cb_select_action") });
      await context.editText(
        tr("kw_pending_negative", { list: sub.negative_keywords.join(", ") || tr("analysis_none") }),
        { reply_markup: keywordEditSubmenu("negative", subscriptionId) }
      );
      break;
    }

    case "edit_description": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      send(userId, { type: "EDIT_SUB_DESCRIPTION", subscriptionId });
      await context.answer({ text: tr("ai_send_description") });
      await context.send(
        tr("kw_current_description", { desc: sub.llm_description })
      );
      break;
    }

    case "toggle_negative": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      const hasNeg = sub.negative_keywords.length > 0;
      queries.toggleNegativeKeywords(subscriptionId, userId, !hasNeg);
      invalidateSubscriptionsCache();

      // Refresh subscription data
      const updated = queries.getSubscriptionById(subscriptionId, userId)!;
      const newHasNeg = updated.negative_keywords.length > 0;
      const newHasDisabled = (updated.disabled_negative_keywords?.length ?? 0) > 0;

      let exclusionsText = tr("analysis_none");
      if (newHasNeg) {
        exclusionsText = updated.negative_keywords.join(", ");
      } else if (newHasDisabled) {
        exclusionsText = tr("list_exclusions_disabled_list", { list: updated.disabled_negative_keywords!.join(", ") });
      }

      await context.answer({
        text: hasNeg ? tr("list_exclusions_disabled") : tr("list_exclusions_enabled"),
      });
      await context.editText(
        format`
${bold(tr("list_sub_header", { id: updated.id, pause: "" }))}
${bold(tr("list_query"))} ${updated.original_query}
${bold(tr("list_keywords"))} ${code(updated.positive_keywords.join(", "))}
${bold(tr("list_exclusions"))} ${code(exclusionsText)}
        `,
        {
          reply_markup: subscriptionKeyboard(subscriptionId, newHasNeg, newHasDisabled),
        }
      );
      break;
    }

    case "regenerate": {
      // Regenerate keywords for pending subscription
      if (currentState !== "awaitingConfirmation" || !c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      await context.answer({ text: tr("ai_generating") });

      const result = await runWithRecovery(
        userId,
        "GENERATE_KEYWORDS",
        undefined, // callback query doesn't have message_id for progress
        async (): Promise<KeywordGenerationResult> => {
          try {
            return await generateKeywords(c.pendingSub!.originalQuery);
          } catch (error) {
            botLog.error({ err: error, userId }, "LLM regeneration failed");
            throw error;
          }
        }
      ).catch(async () => {
        await context.send(tr("ai_generation_error"));
        return null;
      });

      if (!result) return;

      const queryId = `${userId}_${Date.now()}`;

      send(userId, {
        type: "SET_PENDING_SUB",
        pendingSub: {
          originalQuery: c.pendingSub.originalQuery,
          positiveKeywords: result.positive_keywords,
          negativeKeywords: result.negative_keywords,
          llmDescription: result.llm_description,
        },
      });

      await context.editText(
        format`
${bold(tr("ai_regenerated_keywords"))}

${bold(tr("kw_positive"))}
${code(result.positive_keywords.join(", "))}

${bold(tr("kw_negative"))}
${code(result.negative_keywords.join(", ") || tr("analysis_none"))}

${bold(tr("list_description"))}
${result.llm_description}

${tr("ai_confirm_or_change")}
        `,
        {
          reply_markup: queries.getUserMode(userId) === "advanced"
            ? keywordEditConfirmKeyboard(queryId)
            : confirmKeyboard(queryId),
        }
      );
      break;
    }

    case "regenerate_sub": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      // Enter AI editing dialog mode
      send(userId, {
        type: "EDIT_SUB_AI",
        data: {
          subscriptionId,
          current: {
            positiveKeywords: sub.positive_keywords,
            negativeKeywords: sub.negative_keywords,
            llmDescription: sub.llm_description,
          },
          conversation: [],
        },
      });

      await context.answer({ text: tr("ai_edit_mode_short") });

      // Show current params and instructions
      const posPreview = sub.positive_keywords.slice(0, 10).join(", ");
      const posMore = sub.positive_keywords.length > 10 ? ` (+${sub.positive_keywords.length - 10})` : "";

      await context.editText(
        format`${bold(tr("ai_edit_mode"))}

${bold(tr("ai_current_params"))}
${bold(tr("ai_plus_words"))} ${code(posPreview + posMore)}
${bold(tr("ai_words"))} ${code(sub.negative_keywords.join(", ") || tr("analysis_none"))}
${bold(tr("list_description"))} ${sub.llm_description}

${tr("ai_edit_examples")}`,
        {
          reply_markup: aiEditStartKeyboard(subscriptionId),
        }
      );
      break;
    }

    case "apply_ai_edit": {
      if (currentState !== "editingSubAi" || !c.pendingAiEdit?.proposed) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const { subscriptionId, proposed } = c.pendingAiEdit;

      // Apply changes
      queries.updatePositiveKeywords(subscriptionId, userId, proposed.positiveKeywords);
      queries.updateNegativeKeywords(subscriptionId, userId, proposed.negativeKeywords);
      queries.updateLlmDescription(subscriptionId, userId, proposed.llmDescription);
      invalidateSubscriptionsCache();

      send(userId, { type: "APPLY_AI_EDIT" });

      await context.answer({ text: tr("ai_applied") });
      await context.editText(tr("ai_changes_applied"));
      break;
    }

    case "cancel_ai_edit": {
      send(userId, { type: "CANCEL" });
      await context.answer({ text: tr("cb_cancelled") });
      await context.editText(tr("ai_cancelled_full"));
      break;
    }

    case "manual_ai_edit": {
      // User wants to describe changes manually instead of using AI suggestion
      if (currentState !== "editingSubAi" || !c.pendingAiEdit) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const { subscriptionId, current } = c.pendingAiEdit;
      const posPreview = current.positiveKeywords.slice(0, 10).join(", ");
      const posMore =
        current.positiveKeywords.length > 10
          ? ` (+${current.positiveKeywords.length - 10})`
          : "";

      await context.answer({ text: tr("ai_describe_changes_short") });
      await context.editText(
        format`${bold(tr("ai_describe_changes"))}

${bold(tr("ai_current_params"))}
${bold(tr("ai_plus_words"))} ${code(posPreview + posMore)}
${bold(tr("ai_words"))} ${code(current.negativeKeywords.join(", ") || tr("analysis_none"))}
${bold(tr("list_description"))} ${current.llmDescription}

${tr("ai_edit_short_examples")}`,
        { reply_markup: aiEditStartKeyboard(subscriptionId) }
      );
      break;
    }

    case "correct_pending": {
      // Enter AI correction mode for pending subscription
      if (currentState !== "awaitingConfirmation" || !c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const pending = c.pendingSub;
      const userMode = queries.getUserMode(userId);

      send(userId, {
        type: "START_AI_CORRECTION",
        data: {
          mode: userMode,
          current: {
            positiveKeywords: pending.positiveKeywords,
            negativeKeywords: pending.negativeKeywords,
            llmDescription: pending.llmDescription,
          },
          conversation: [],
        },
      });

      await context.answer({ text: tr("ai_correction_mode_short") });

      if (userMode === "normal") {
        // Normal mode: only description, keywords will be regenerated
        await context.editText(
          format`${bold(tr("ai_clarify_query"))}

${bold(tr("ai_current_description"))}
${pending.llmDescription}

${tr("ai_clarify_examples")}`,
          {
            reply_markup: pendingAiCorrectionStartKeyboard(),
          }
        );
      } else {
        // Advanced mode: full control over keywords
        const posPreview = pending.positiveKeywords.slice(0, 10).join(", ");
        const posMore = pending.positiveKeywords.length > 10 ? ` (+${pending.positiveKeywords.length - 10})` : "";

        await context.editText(
          format`${bold(tr("ai_correction_mode_full"))}

${bold(tr("ai_current_params"))}
${bold(tr("ai_plus_words"))} ${code(posPreview + posMore)}
${bold(tr("ai_words"))} ${code(pending.negativeKeywords.join(", ") || tr("analysis_none"))}
${bold(tr("list_description"))} ${pending.llmDescription}

${tr("ai_edit_short_examples")}`,
          {
            reply_markup: pendingAiCorrectionStartKeyboard(),
          }
        );
      }
      break;
    }

    case "apply_pending_ai": {
      if (currentState !== "correctingPendingAi" || !c.pendingAiCorrection?.proposed) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const { proposed } = c.pendingAiCorrection;
      const queryId = `${userId}_${Date.now()}`;

      // Apply correction via FSM
      send(userId, { type: "APPLY_AI_CORRECTION" });

      await context.answer({ text: tr("ai_applied") });

      const mode = queries.getUserMode(userId);

      if (mode === "advanced") {
        await context.editText(
          format`
${bold(tr("ai_corrected_keywords"))}

${bold(tr("kw_positive"))}
${code(proposed.positiveKeywords.join(", "))}

${bold(tr("kw_negative"))}
${code(proposed.negativeKeywords.join(", ") || tr("analysis_none"))}

${bold(tr("list_description"))}
${proposed.llmDescription}

${tr("ai_confirm_or_change")}
          `,
          { reply_markup: keywordEditConfirmKeyboard(queryId) }
        );
      } else {
        await context.editText(tr("ai_confirm_or_change"), {
          reply_markup: confirmKeyboard(queryId),
        });
      }
      break;
    }

    case "cancel_pending_ai": {
      if (!c.pendingSub) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const pending = c.pendingSub;
      const queryId = `${userId}_${Date.now()}`;

      // Return to awaiting_confirmation
      send(userId, { type: "CANCEL" });

      await context.answer({ text: tr("cb_cancelled") });

      await context.editText(
        format`
${bold(tr("list_keywords"))}

${bold(tr("kw_positive"))}
${code(pending.positiveKeywords.join(", "))}

${bold(tr("kw_negative"))}
${code(pending.negativeKeywords.join(", ") || tr("analysis_none"))}

${bold(tr("list_description"))}
${pending.llmDescription}

${tr("ai_confirm_or_change")}
        `,
        {
          reply_markup: queries.getUserMode(userId) === "advanced"
            ? keywordEditConfirmKeyboard(queryId)
            : confirmKeyboard(queryId),
        }
      );
      break;
    }

    case "back": {
      send(userId, { type: "CANCEL" });
      await context.answer({ text: "OK" });
      break;
    }

    // Submenu: back to subscription view
    case "back_to_sub": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      send(userId, { type: "CANCEL" });

      let exclusionsText = tr("analysis_none");
      if (sub.negative_keywords.length > 0) {
        exclusionsText = sub.negative_keywords.join(", ");
      } else if ((sub.disabled_negative_keywords?.length ?? 0) > 0) {
        exclusionsText = tr("list_exclusions_disabled_list", { list: sub.disabled_negative_keywords!.join(", ") });
      }

      await context.answer({ text: "OK" });
      await context.editText(
        format`
${bold(tr("list_sub_header", { id: sub.id, pause: "" }))}
${bold(tr("list_query"))} ${sub.original_query}
${bold(tr("list_keywords"))} ${code(sub.positive_keywords.join(", "))}
${bold(tr("list_exclusions"))} ${code(exclusionsText)}
        `,
        {
          reply_markup: subscriptionKeyboard(
            sub.id,
            sub.negative_keywords.length > 0,
            (sub.disabled_negative_keywords?.length ?? 0) > 0
          ),
        }
      );
      break;
    }

    // Add positive keywords to existing subscription
    case "add_positive": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      send(userId, { type: "EDIT_SUB_POSITIVE", subscriptionId });
      await context.answer({ text: tr("cb_send_words") });
      await context.editText(
        tr("kw_current_send_add", { current: sub.positive_keywords.join(", ") })
      );
      break;
    }

    // Add negative keywords to existing subscription
    case "add_negative": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      send(userId, { type: "EDIT_SUB_NEGATIVE", subscriptionId });
      await context.answer({ text: tr("cb_send_words") });
      await context.editText(
        tr("kw_current_send_add", { current: sub.negative_keywords.join(", ") || tr("analysis_none") })
      );
      break;
    }

    // Show remove keywords UI for existing subscription
    case "remove_positive": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      if (sub.positive_keywords.length === 0) {
        await context.answer({ text: tr("kw_no_words_to_delete") });
        return;
      }

      send(userId, { type: "EDIT_SUB_POSITIVE", subscriptionId });

      const list = sub.positive_keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
      await context.answer({ text: tr("kw_select_words") });
      await context.editText(
        tr("kw_select_words_numbered", { label: tr("kw_positive_label"), list }),
        { reply_markup: removeKeywordsKeyboard(sub.positive_keywords, "positive", subscriptionId) }
      );
      break;
    }

    // Show remove keywords UI for existing subscription (negative)
    case "remove_negative": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      if (sub.negative_keywords.length === 0) {
        await context.answer({ text: tr("kw_no_words_to_delete") });
        return;
      }

      send(userId, { type: "EDIT_SUB_NEGATIVE", subscriptionId });

      const list = sub.negative_keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
      await context.answer({ text: tr("kw_select_words") });
      await context.editText(
        tr("kw_select_words_numbered", { label: tr("kw_negative_label"), list }),
        { reply_markup: removeKeywordsKeyboard(sub.negative_keywords, "negative", subscriptionId) }
      );
      break;
    }

    // Remove keyword by clicking button (existing subscription)
    case "rm_kw": {
      const subscriptionId = Number(data.id);
      const type = data.type as "positive" | "negative";
      const idx = Number(data.idx);

      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      const keywords = type === "positive" ? [...sub.positive_keywords] : [...sub.negative_keywords];
      const removed = keywords[idx];
      if (!removed) {
        await context.answer({ text: tr("kw_word_not_found") });
        return;
      }

      keywords.splice(idx, 1);

      if (type === "positive") {
        if (keywords.length === 0) {
          await context.answer({ text: tr("kw_cant_delete_last") });
          return;
        }
        queries.updatePositiveKeywords(subscriptionId, userId, keywords);
      } else {
        queries.updateNegativeKeywords(subscriptionId, userId, keywords);
      }
      invalidateSubscriptionsCache();

      await context.answer({ text: tr("kw_answer_removed", { removed }) });

      if (keywords.length === 0) {
        // No more keywords to remove, go back to subscription
        const updated = queries.getSubscriptionById(subscriptionId, userId)!;
        let exclusionsText = tr("analysis_none");
        if (updated.negative_keywords.length > 0) {
          exclusionsText = updated.negative_keywords.join(", ");
        }
        await context.editText(
          format`
${bold(tr("list_sub_header", { id: updated.id, pause: "" }))}
${bold(tr("list_query"))} ${updated.original_query}
${bold(tr("list_keywords"))} ${code(updated.positive_keywords.join(", "))}
${bold(tr("list_exclusions"))} ${code(exclusionsText)}
          `,
          {
            reply_markup: subscriptionKeyboard(
              updated.id,
              updated.negative_keywords.length > 0,
              (updated.disabled_negative_keywords?.length ?? 0) > 0
            ),
          }
        );
        send(userId, { type: "CANCEL" });
      } else {
        // Update the keyboard with remaining keywords
        const list = keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
        const label = type === "positive" ? tr("kw_positive_label") : tr("kw_negative_label");
        await context.editText(
          tr("kw_words_list", { label, list }),
          { reply_markup: removeKeywordsKeyboard(keywords, type, subscriptionId) }
        );
      }
      break;
    }

    case "skip_invite_link": {
      if (currentState !== "awaitingInviteLink") {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      // Skip - go back to adding_group
      send(userId, { type: "SKIP_INVITE" });
      await context.answer({ text: tr("clarify_skipped") });
      await context.editText(tr("groups_skipped"));
      await showAddGroupPrompt(
        { send: (text, opts) => bot.api.sendMessage({ chat_id: userId, text, ...opts }) },
        userId
      );
      break;
    }

    case "toggle_group": {
      // DEBUG: Log what we receive
      botLog.debug({
        rawCallbackData: context.data,
        parsedData: data,
        availableGroups: c.availableGroups.map((g) => ({ id: g.id, title: g.title })),
      }, "toggle_group: received callback");

      if (currentState !== "selectingGroups" || c.availableGroups.length === 0) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const groupId = Number(data.id);
      const group = c.availableGroups.find((g) => g.id === groupId);
      if (!group) return;

      // Toggle via FSM event
      send(userId, { type: "TOGGLE_GROUP", groupId });

      // Re-read context after update
      const updatedC = ctx(userId);
      const isSelected = !c.selectedGroups.some((g) => g.id === groupId);

      const selectedIds = new Set(updatedC.selectedGroups.map((g) => g.id));
      await context.answer({ text: isSelected ? tr("selected") : tr("deselected") });
      const regionPresets = getUserRegionPresets(userId);
      await context.editText(
        format`
${bold(tr("groups_select_for_monitoring"))}

${tr("groups_selected_count", { selected: updatedC.selectedGroups.length, total: updatedC.availableGroups.length })}
        `,
        {
          reply_markup: groupsKeyboard(updatedC.availableGroups, selectedIds, regionPresets),
        }
      );
      break;
    }

    case "toggle_preset": {
      // Toggle all groups in a preset (select/deselect)
      if (currentState !== "selectingGroups" || c.availableGroups.length === 0) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const presetId = Number(data.id);
      const presetGroups = queries.getPresetGroups(presetId);
      const presetGroupIds = presetGroups.map((pg) => pg.group_id);

      // Filter to only groups available to user
      const availableGroupIds = new Set(c.availableGroups.map((g) => g.id));
      const availablePresetGroupIds = presetGroupIds.filter((id) =>
        availableGroupIds.has(id)
      );

      if (availablePresetGroupIds.length === 0) {
        await context.answer({ text: tr("preset_no_groups") });
        return;
      }

      // Check if all preset groups are already selected
      const allSelected = availablePresetGroupIds.every((id) =>
        c.selectedGroups.some((g) => g.id === id)
      );

      if (allSelected) {
        // Deselect all preset groups
        for (const gid of availablePresetGroupIds) {
          if (c.selectedGroups.some((g) => g.id === gid)) {
            send(userId, { type: "TOGGLE_GROUP", groupId: gid });
          }
        }
        await context.answer({ text: tr("preset_deselected") });
      } else {
        // Select all preset groups that are not yet selected
        for (const gid of availablePresetGroupIds) {
          if (!c.selectedGroups.some((g) => g.id === gid)) {
            send(userId, { type: "TOGGLE_GROUP", groupId: gid });
          }
        }
        await context.answer({ text: tr("preset_selected") });
      }

      // Re-read context and update keyboard
      const updatedCtx = ctx(userId);
      const selectedIdsSet = new Set(updatedCtx.selectedGroups.map((g) => g.id));
      const regionPresets2 = getUserRegionPresets(userId);

      await context.editText(
        format`
${bold(tr("groups_select_for_monitoring"))}

${tr("groups_selected_count", { selected: updatedCtx.selectedGroups.length, total: updatedCtx.availableGroups.length })}
        `,
        {
          reply_markup: groupsKeyboard(updatedCtx.availableGroups, selectedIdsSet, regionPresets2),
        }
      );
      break;
    }

    case "select_all_groups": {
      if (currentState !== "selectingGroups" || c.availableGroups.length === 0) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      send(userId, { type: "SELECT_ALL" });

      const updatedC = ctx(userId);
      const selectedIds = new Set(updatedC.availableGroups.map((g) => g.id));
      const regionPresets = getUserRegionPresets(userId);
      await context.answer({ text: tr("preset_all_selected") });
      await context.editText(
        format`
${bold(tr("groups_select_for_monitoring"))}

${tr("groups_selected_count", { selected: updatedC.availableGroups.length, total: updatedC.availableGroups.length })}
        `,
        {
          reply_markup: groupsKeyboard(updatedC.availableGroups, selectedIds, regionPresets),
        }
      );
      break;
    }

    case "deselect_all_groups": {
      if (currentState !== "selectingGroups" || c.availableGroups.length === 0) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      send(userId, { type: "DESELECT_ALL" });

      const regionPresets = getUserRegionPresets(userId);
      await context.answer({ text: tr("preset_all_deselected") });
      await context.editText(
        format`
${bold(tr("groups_select_for_monitoring"))}

${tr("groups_selected_count", { selected: 0, total: c.availableGroups.length })}
        `,
        {
          reply_markup: groupsKeyboard(c.availableGroups, new Set(), regionPresets),
        }
      );
      break;
    }

    case "confirm_groups":
    case "skip_groups": {
      if (
        currentState !== "selectingGroups" ||
        !c.pendingSub ||
        c.availableGroups.length === 0
      ) {
        await context.answer({ text: tr("sub_session_expired") });
        return;
      }

      const { originalQuery, positiveKeywords, negativeKeywords, llmDescription } =
        c.pendingSub;

      // Create subscription
      const subscriptionId = queries.createSubscription(
        userId,
        originalQuery,
        positiveKeywords,
        negativeKeywords,
        llmDescription
      );

      // Send hot examples as notifications (real, not deleted)
      const ratingData = c.ratingExamples;
      let hotSentCount = 0;
      if (ratingData?.ratings) {
        for (const r of ratingData.ratings) {
          if (r.rating !== "hot") continue;

          const msg = ratingData.messages.find((m) => m.id === r.messageId);
          if (!msg || msg.isGenerated) continue; // skip generated

          // Check if message exists and not deleted
          const dbMsg = queries.getMessage(msg.id, msg.groupId);
          if (!dbMsg || dbMsg.is_deleted) continue;

          // Send notification
          await notifyUser(
            userId,
            msg.groupTitle,
            undefined, // no group username for cached examples
            msg.text,
            originalQuery,
            msg.id,
            msg.groupId,
            dbMsg.sender_name ?? undefined,
            dbMsg.sender_username ?? undefined,
            undefined, // no media for cached examples
            tr("rating_marked_relevant"),
            subscriptionId
          );

          // Mark as matched to avoid duplicate in scanFromCache
          queries.markMessageMatched(subscriptionId, msg.id, msg.groupId);
          hotSentCount++;
        }
        if (hotSentCount > 0) {
          botLog.info({ userId, subscriptionId, hotSentCount }, "Sent hot examples as notifications");
        }
      }

      // Generate BGE-M3 embeddings in background (non-blocking)
      generateKeywordEmbeddings(positiveKeywords, negativeKeywords)
        .then((embeddings) => {
          queries.updateKeywordEmbeddings(subscriptionId, embeddings);
          botLog.info({ subscriptionId }, "Keyword embeddings generated");
        })
        .catch((e) => botLog.error({ err: e, subscriptionId }, "Failed to generate embeddings"));

      const selectedGroups = c.selectedGroups;

      // Save selected groups
      if (selectedGroups.length > 0) {
        queries.setSubscriptionGroups(subscriptionId, selectedGroups);
      }

      invalidateSubscriptionsCache();
      send(userId, { type: "CONFIRM_GROUPS" });

      await context.answer({ text: tr("sub_created") });

      if (selectedGroups.length > 0) {
        const groupNames = selectedGroups.map((g) => g.title).join(", ");
        await context.editText(
          tr("sub_created_scanning", { groups: groupNames })
        );

        // Scan cache in background
        const groupIds = selectedGroups.map((g) => g.id);
        scanFromCache(groupIds, subscriptionId, { limit: 5, offset: 0, notify: true })
          .then((result) => {
            botLog.info({ total: result.total, subscriptionId }, "Cache scan complete");
            let resultText: string;
            if (result.total > 0) {
              resultText = tr("sub_created_found", { groups: groupNames, count: tr("messages_count", { n: result.total }) });
              if (result.total > 5) {
                resultText += tr("sub_created_sent_partial", { total: result.total });
              }
            } else {
              resultText = tr("sub_created_not_found", { groups: groupNames });
            }
            context
              .editText(resultText)
              .catch((e) =>
                botLog.error(e, "Failed to update scan result message")
              );
          })
          .catch((e) => {
            botLog.error(e, "Cache scan failed");
            context
              .editText(
                tr("sub_created_scan_error", { groups: groupNames })
              )
              .catch(() => {});
          });
      } else {
        await context.editText(
          tr("sub_created_no_groups")
        );
      }
      break;
    }

    // =====================================================
    // Rating flow handlers
    // =====================================================

    case "rate_hot":
    case "rate_warm":
    case "rate_cold": {
      if (currentState !== "ratingExamples" || !c.ratingExamples) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const { messages, currentIndex } = c.ratingExamples;
      const currentExample = messages[currentIndex];
      if (!currentExample) {
        await context.answer({ text: tr("error") });
        return;
      }

      // Map action to rating
      const ratingMap: Record<string, ExampleRating> = {
        rate_hot: "hot",
        rate_warm: "warm",
        rate_cold: "cold",
      };
      const rating = ratingMap[data.action]!;

      const ratingEmoji = { hot: "🔥", warm: "☀️", cold: "❄️" }[rating];
      await context.answer({ text: `${ratingEmoji} ${tr("rating_recorded")}` });

      // Send rating via FSM event
      send(userId, { type: "RATE", messageId: currentExample.id, rating });

      const nextIndex = currentIndex + 1;

      if (nextIndex < messages.length) {
        // Show next example
        await context.editText(tr("rating_moving_next"));
        await showExampleForRating(
          context,
          userId,
          messages[nextIndex]!,
          nextIndex,
          messages.length
        );
      } else {
        // All examples rated, generate final keywords
        await context.editText(tr("rating_all_done"));
        await finishRatingAndGenerateKeywords(context, userId);
      }
      break;
    }

    case "skip_rating": {
      if (currentState !== "ratingExamples" || !c.ratingExamples) {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      send(userId, { type: "SKIP_RATING" });
      await context.answer({ text: tr("clarify_skipping") });
      await context.editText(tr("clarify_examples_skipped"));
      await finishRatingAndGenerateKeywords(context, userId);
      break;
    }

    // =====================================================
    // Settings handlers
    // =====================================================

    case "set_mode_normal": {
      queries.setUserMode(userId, "normal");
      await context.answer({ text: tr("settings_mode_changed") });
      await context.editText(
        format`${bold(tr("settings_title"))}

${bold(tr("settings_current_mode"))} ${tr("settings_mode_normal")}

${tr("settings_normal_desc")}`,
        {
          reply_markup: settingsKeyboard("normal"),
        }
      );
      break;
    }

    case "set_mode_advanced": {
      queries.setUserMode(userId, "advanced");
      await context.answer({ text: tr("settings_mode_changed") });
      await context.editText(
        format`${bold(tr("settings_title"))}

${bold(tr("settings_current_mode"))} ${tr("settings_mode_advanced")}

${tr("settings_advanced_desc")}`,
        {
          reply_markup: settingsKeyboard("advanced"),
        }
      );
      break;
    }

    case "noop": {
      // Do nothing (already selected option)
      await context.answer({ text: tr("already_selected") });
      break;
    }

    // Forward analysis actions
    case "analyze_forward": {
      // Get forwarded message from reply_to_message
      const replyMsg = context.message?.replyMessage;
      if (!replyMsg) {
        await context.answer({ text: tr("analysis_no_original") });
        return;
      }

      const messageText = replyMsg.text || replyMsg.caption || "";
      if (!messageText) {
        await context.answer({ text: tr("forward_no_text") });
        return;
      }

      // Extract forward info from the replied message
      const forwardInfo = extractForwardInfo(replyMsg as import("gramio").Message);

      await context.answer({ text: tr("forward_analyzing") });

      const userSubs = queries.getUserSubscriptions(userId);
      if (userSubs.length === 0) {
        await context.editText(tr("forward_no_subscriptions"));
        return;
      }

      // Analyze against all subscriptions
      const results = await analyzeForwardedMessage(
        userId,
        forwardInfo || { messageId: null },
        messageText
      );

      if (results.length === 0) {
        await context.editText(tr("forward_no_matching_subs"));
        return;
      }

      // Edit original message to remove button
      await context.editText(tr("forward_results"));

      // Send each result as separate message
      for (const { analysis } of results) {
        const text = formatAnalysisResult(analysis, userId);
        const isRejected = analysis.result !== "matched";

        if (isRejected && forwardInfo?.chatId !== undefined) {
          await context.send(text, {
            reply_markup: forwardActionsKeyboard(
              analysis.subscription_id,
              forwardInfo.messageId ?? 0,
              forwardInfo.chatId,
              analysis.rejection_keyword
            ),
          });
        } else {
          await context.send(text);
        }
      }
      break;
    }

    case "exp":
    case "expand_criteria": {
      const subscriptionId = data.id as number;
      const msgId = data.msgId as number;
      const grpId = data.grpId as number;

      if (!subscriptionId) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      const subscription = queries.getSubscriptionById(subscriptionId, userId);
      if (!subscription) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      // Get message text from DB or from the forward
      let messageText = "";
      if (msgId && grpId) {
        const storedMsg = queries.getMessage(msgId, grpId);
        if (storedMsg) {
          messageText = storedMsg.text;
        }
      }

      if (!messageText) {
        await context.answer({ text: tr("forward_text_not_found") });
        return;
      }

      await context.answer({ text: tr("forward_expanding") });
      await editCallbackMessage(context, tr("forward_expanding_progress"));

      try {
        // Generate keywords from the message text
        const { extractKeywordsFromText } = await import("../llm/keywords.ts");
        const newKeywords = await extractKeywordsFromText(messageText);

        if (newKeywords.length === 0) {
          await editCallbackMessage(context, tr("forward_expand_failed"));
          return;
        }

        // Merge with existing keywords
        const combined = [...new Set([...subscription.positive_keywords, ...newKeywords])];
        queries.updatePositiveKeywords(subscriptionId, userId, combined);

        // Regenerate embeddings in background
        regenerateEmbeddings(subscriptionId);

        await editCallbackMessage(
          context,
          tr("forward_expand_success", { words: newKeywords.join(", ") })
        );
      } catch (e) {
        botLog.error({ err: e, subscriptionId }, "Failed to expand criteria");
        await editCallbackMessage(context, tr("forward_expand_error"));
      }
      break;
    }

    case "ai_fwd":
    case "ai_correct_forward": {
      const subscriptionId = data.id as number;

      if (!subscriptionId) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      const subscription = queries.getSubscriptionById(subscriptionId, userId);
      if (!subscription) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      // Start AI correction flow (same as regenerate_sub)
      send(userId, {
        type: "EDIT_SUB_AI",
        data: {
          subscriptionId,
          current: {
            positiveKeywords: subscription.positive_keywords,
            negativeKeywords: subscription.negative_keywords,
            llmDescription: subscription.llm_description,
          },
          conversation: [],
        },
      });
      await context.answer({ text: tr("forward_ai_correction") });
      await context.editText(
        tr("ai_edit_existing_prompt", { query: subscription.original_query }),
        { reply_markup: aiEditStartKeyboard(subscriptionId) }
      );
      break;
    }

    case "rm_neg": {
      const subscriptionId = data.id as number;
      const keyword = data.kw;

      if (!subscriptionId || !keyword) {
        await context.answer({ text: tr("error_data") });
        return;
      }

      const subscription = queries.getSubscriptionById(subscriptionId, userId);
      if (!subscription) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      // Remove keyword from negative_keywords
      const currentNegative = subscription.negative_keywords;
      const newNegative = currentNegative.filter(
        (kw) => kw.toLowerCase() !== keyword.toLowerCase()
      );

      if (newNegative.length === currentNegative.length) {
        await context.answer({ text: tr("kw_word_not_found") });
        return;
      }

      queries.updateNegativeKeywords(subscriptionId, userId, newNegative);
      invalidateSubscriptionsCache();

      await context.answer({ text: tr("kw_word_deleted") });
      await editCallbackMessage(
        context,
        tr("ai_keyword_removed", {
          keyword,
          query: subscription.original_query,
          remaining: newNegative.length > 0 ? newNegative.join(", ") : tr("analysis_none"),
        })
      );
      break;
    }

    case "miss": {
      // "Мимо" button - message was shown but doesn't match user intent
      // Show feedback immediately before any DB/AI operations
      await context.answer();
      await context.send(tr("miss_analyzing"));

      // Short keys s/m/g are normalized to id/msgId/grpId above
      const subscriptionId = data.id as number;
      const messageId = data.msgId as number;
      const groupId = data.grpId as number;

      if (!subscriptionId || !messageId || !groupId) {
        await context.answer({ text: tr("error_data") });
        return;
      }

      const subscription = queries.getSubscriptionById(subscriptionId, userId);
      if (!subscription) {
        await context.answer({ text: tr("sub_not_found") });
        return;
      }

      // Get message text from DB
      const message = queries.getMessage(messageId, groupId);
      const messageText = message?.text?.slice(0, 500) || tr("miss_text_unavailable");

      // Build context message for AI
      const contextMessage = tr("miss_context", { text: messageText });

      // Start AI editing with context in conversation
      send(userId, {
        type: "EDIT_SUB_AI",
        data: {
          subscriptionId,
          current: {
            positiveKeywords: subscription.positive_keywords,
            negativeKeywords: subscription.negative_keywords,
            llmDescription: subscription.llm_description,
          },
          conversation: [{ role: "user" as const, content: contextMessage }],
        },
      });

      // Trigger AI interpretation immediately
      const currentSnake = {
        positive_keywords: subscription.positive_keywords,
        negative_keywords: subscription.negative_keywords,
        llm_description: subscription.llm_description,
      };

      try {
        const result = await runWithRecovery(userId, "AI_EDIT", undefined, () =>
          interpretEditCommand(contextMessage, currentSnake, [], getLLMLanguage(userId))
        );

        // Format diff
        const addedNeg = result.negative_keywords.filter(
          (k: string) => !currentSnake.negative_keywords.includes(k)
        );
        const removedPos = currentSnake.positive_keywords.filter(
          (k: string) => !result.positive_keywords.includes(k)
        );

        let diffText = "";
        if (addedNeg.length) diffText += tr("diff_added_exclusions", { list: addedNeg.join(", ") }) + "\n";
        if (removedPos.length) diffText += tr("diff_removed", { list: removedPos.join(", ") }) + "\n";

        // Update FSM with proposed changes
        send(userId, { type: "TEXT_AI_COMMAND", text: contextMessage });
        send(userId, {
          type: "AI_PROPOSED",
          proposed: {
            positiveKeywords: result.positive_keywords,
            negativeKeywords: result.negative_keywords,
            llmDescription: result.llm_description,
          },
        });

        await context.editText(
          format`${bold(tr("miss_title"))} ${tr("miss_analyzing")}

${bold(tr("miss_suggestion"))}
${diffText || tr("miss_no_changes")}

${bold(tr("ai_comment"))} ${result.summary}

${tr("miss_clarify_or_apply")}`,
          { reply_markup: aiEditKeyboard(subscriptionId) }
        );
      } catch (error) {
        botLog.error({ err: error, userId, subscriptionId }, "Miss analysis failed");
        await context.editText(
          tr("miss_error_describe", { query: subscription.original_query }),
          { reply_markup: aiEditStartKeyboard(subscriptionId) }
        );
      }
      break;
    }

    case "add_group_quick": {
      const groupId = data.id as number;
      const groupTitle = (data as { title?: string }).title || tr("group_unknown");

      await context.answer({ text: tr("groups_adding") });
      await editCallbackMessage(context, tr("group_adding_progress", { title: groupTitle }));

      try {
        // Check if userbot is member
        const isMember = await isUserbotMember(groupId);
        if (!isMember) {
          await editCallbackMessage(
            context,
            tr("group_cant_read")
          );
          return;
        }

        // Add group for user
        queries.addUserGroup(userId, groupId, groupTitle, false);
        await editCallbackMessage(context, tr("group_added_to_monitoring", { title: groupTitle }));
      } catch (e) {
        botLog.error({ err: e, groupId }, "Failed to add group quick");
        await editCallbackMessage(context, tr("group_add_use_addgroup"));
      }
      break;
    }

    // =====================================================
    // Subscription deletion feedback handlers
    // =====================================================

    case "feedback_outcome": {
      const subscriptionId = Number(data.id);
      const outcome = (data as { outcome?: string }).outcome as "bought" | "not_bought" | "complicated";

      if (!outcome || currentState !== "collectingFeedbackOutcome") {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      // Store outcome and ask for review
      send(userId, { type: "FEEDBACK_OUTCOME", outcome });

      const outcomeLabels = {
        bought: tr("feedback_outcome_bought"),
        not_bought: tr("feedback_outcome_not_bought"),
        complicated: tr("feedback_outcome_complicated"),
      };
      await context.answer({ text: outcomeLabels[outcome] });

      // Ask for review
      await context.editText(
        tr("feedback_review_prompt"),
        { reply_markup: feedbackReviewKeyboard(subscriptionId) }
      );
      break;
    }

    case "skip_feedback": {
      if (currentState !== "awaitingFeedbackReview") {
        await context.answer({ text: tr("cb_session_expired") });
        return;
      }

      const subscriptionId = c.feedbackSubscriptionId;
      const subscriptionQuery = c.feedbackSubscriptionQuery;
      const outcome = c.feedbackOutcome;

      // Save feedback without review
      if (subscriptionId && outcome) {
        queries.saveFeedback({
          subscriptionId,
          telegramId: userId,
          outcome,
          review: null,
        });

        // Notify admin
        const adminId = process.env.ADMIN_ID;
        if (adminId) {
          const adminTr = getTranslator(Number(adminId));
          const outcomeText = {
            bought: adminTr("admin_feedback_bought"),
            not_bought: adminTr("admin_feedback_not_bought"),
            complicated: adminTr("admin_feedback_complicated"),
          };
          const user = queries.getUserByTelegramId(userId);
          const username = user?.username ? `@${user.username}` : `ID: ${userId}`;
          await bot.api.sendMessage({
            chat_id: Number(adminId),
            text: adminTr("admin_feedback_from", {
              user: username,
              outcome: outcomeText[outcome],
              query: subscriptionQuery ?? "—",
              review: "—",
            }),
          });
        }
      }

      send(userId, { type: "SKIP_FEEDBACK" });
      await context.answer({ text: tr("feedback_thanks") });
      await context.editText(tr("feedback_thanks_full"));
      break;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                       PREMIUM UPGRADE ACTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    case "upgrade": {
      const raw = JSON.parse(context.data || "{}");
      const plan = raw.plan as "basic" | "pro" | "business";

      if (!plan || !["basic", "pro", "business"].includes(plan)) {
        await context.answer({ text: tr("pay_invalid_plan") });
        return;
      }

      await context.answer({ text: tr("pay_creating_link") });

      try {
        const link = await createSubscriptionLink(bot, plan, userId);
        const planNames = { basic: "Basic", pro: "Pro", business: "Business" };

        await context.editText(
          tr("premium_select_plan", { plan: planNames[plan] }),
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: tr("premium_pay_button", { plan: planNames[plan] }), url: link }],
                [{ text: tr("premium_back"), callback_data: JSON.stringify({ action: "back_to_premium" }) }],
              ],
            },
          }
        );
      } catch (error) {
        botLog.error({ error }, "Failed to create subscription link");
        await context.editText(tr("pay_link_error"));
      }
      break;
    }

    case "back_to_premium": {
      const planInfo = formatPlanInfo(userId);
      const { plan } = queries.getUserPlan(userId);

      await context.answer();
      await context.editText(planInfo, {
        reply_markup: premiumKeyboard(plan),
      });
      break;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                       REGION PRESETS ACTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    case "presets_list": {
      const presets = queries.getRegionPresets();
      const presetsWithAccess = presets.map((p) => ({
        ...p,
        hasAccess: queries.hasPresetAccess(userId, p.id),
      }));

      await context.answer();
      await context.editText(
        tr("preset_title"),
        {
          parse_mode: "Markdown",
          reply_markup: presetsListKeyboard(presetsWithAccess),
        }
      );
      break;
    }

    case "preset_info": {
      const raw = JSON.parse(context.data || "{}");
      const presetId = raw.id as number;

      if (!presetId) {
        await context.answer({ text: tr("error") });
        return;
      }

      const presets = queries.getRegionPresets();
      const preset = presets.find((p) => p.id === presetId);

      if (!preset) {
        await context.answer({ text: tr("preset_not_found") });
        return;
      }

      const hasAccess = queries.hasPresetAccess(userId, presetId);
      const groups = queries.getPresetGroups(presetId);

      let text = `🗺️ **${preset.region_name}**\n\n`;
      text += tr("preset_country", { value: preset.country_code || "—" }) + "\n";
      text += tr("preset_currency", { value: preset.currency || "—" }) + "\n";
      text += tr("preset_groups_count", { count: groups.length }) + "\n\n";

      if (hasAccess) {
        text += tr("preset_has_access");
      } else {
        text += tr("preset_need_buy");
      }

      await context.answer();
      await context.editText(text, {
        parse_mode: "Markdown",
        reply_markup: presetBuyKeyboard(presetId, hasAccess),
      });
      break;
    }

    case "buy_preset": {
      const raw = JSON.parse(context.data || "{}");
      const presetId = raw.id as number;
      const accessType = raw.type as "lifetime" | "subscription";

      if (!presetId || !accessType) {
        await context.answer({ text: tr("error") });
        return;
      }

      const presets = queries.getRegionPresets();
      const preset = presets.find((p) => p.id === presetId);

      if (!preset) {
        await context.answer({ text: tr("preset_not_found") });
        return;
      }

      const price = accessType === "lifetime" ? 1000 : 300;

      await context.answer({ text: tr("pay_creating_invoice") });

      try {
        const result = await sendPaymentInvoice(bot, userId, {
          type: "preset",
          title: tr("preset_buy_title", { name: preset.region_name }),
          description: accessType === "lifetime"
            ? tr("preset_buy_desc_lifetime", { count: preset.group_count })
            : tr("preset_buy_desc_month", { count: preset.group_count }),
          amount: price,
          payload: {
            type: "preset",
            presetId,
            accessType,
          },
        });

        // If paid with bonus, grant access immediately
        if (result.type === "bonus_paid") {
          const expiresAt =
            accessType === "subscription"
              ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
              : null;
          queries.grantPresetAccess(userId, presetId, accessType, expiresAt);
          await context.editText(
            accessType === "subscription"
              ? tr("pay_preset_access_month", { name: preset.region_name })
              : tr("pay_preset_access_lifetime", { name: preset.region_name })
          );
        }
      } catch (error) {
        botLog.error({ error }, "Failed to send preset invoice");
        await context.editText(tr("pay_invoice_error"));
      }
      break;
    }

    case "select_region": {
      // User selected region (country) for presets
      const raw = JSON.parse(context.data || "{}");
      const regionCode = raw.code as string;

      if (!regionCode) {
        await context.answer({ text: tr("error") });
        return;
      }

      // Save region to user profile
      queries.setUserRegion(userId, regionCode);

      // Get pending query and continue subscription creation
      const pendingQuery = c.pendingQuery;
      if (pendingQuery) {
        send(userId, { type: "CLEAR_PENDING_QUERY" });
        await context.answer({ text: tr("preset_region", { name: getCountryName(regionCode) }) });
        // Delete the region selection message
        if (context.message?.id) {
          await bot.api.deleteMessage({ chat_id: userId, message_id: context.message.id });
        }
        await processSubscriptionQuery(
          { send: (text: string, opts?: object) => bot.api.sendMessage({ chat_id: userId, text, ...opts }) },
          userId,
          pendingQuery
        );
      } else {
        await context.answer({ text: tr("preset_region_saved", { name: getCountryName(regionCode) }) });
        // Delete the region selection message
        if (context.message?.id) {
          await bot.api.deleteMessage({ chat_id: userId, message_id: context.message.id });
        }
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                       PRODUCT ANALYSIS ACTION
    // ═══════════════════════════════════════════════════════════════════════════════

    case "analyze_product": {
      const raw = JSON.parse(context.data || "{}");
      const messageId = raw.m as number;
      const groupId = raw.g as number;

      if (!messageId || !groupId) {
        await context.answer({ text: tr("analysis_data_not_found") });
        return;
      }

      // Get the message text from DB
      const msg = queries.getMessage(messageId, groupId);
      if (!msg) {
        await context.answer({ text: tr("analysis_message_not_found") });
        return;
      }

      // Check if free analyze is available
      const isFree = canUseFreeAnalyze(userId);
      const price = getAnalyzePrice(userId);

      if (isFree || price === 0) {
        // Free analysis (first free or Business plan) — full deep analysis
        await context.answer({ text: tr("forward_analyzing") });
        await editCallbackMessage(context, tr("analysis_product_analyzing"));

        try {
          const { analyzeWithMedia } = await import("../llm/deep-analyze.ts");
          const { formatDeepAnalysisHtml } = await import("./formatters.ts");

          const result = await analyzeWithMedia({
            text: msg.text,
            messageId,
            groupId,
            groupTitle: msg.group_title,
          });

          // Mark free analyze as used
          if (isFree && price > 0) {
            queries.incrementFreeAnalyzes(userId);
          }

          const resultText = formatDeepAnalysisHtml(result);
          await editCallbackMessage(context, resultText, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });

          botLog.info({ userId, messageId, groupId }, "Product analyzed (free, deep)");
        } catch (error) {
          botLog.error({ error, userId }, "Deep analysis failed");
          await editCallbackMessage(context, tr("analysis_error"));
        }
      } else {
        // Paid analysis - send invoice or use bonus
        await context.answer({ text: tr("promo_opening_payment") });

        const result = await sendPaymentInvoice(bot, userId, {
          type: "analyze",
          title: tr("analysis_title"),
          description: tr("analysis_desc"),
          amount: price,
          payload: {
            type: "analyze",
            messageId,
            groupId,
          },
        });

        // If paid with bonus, run analysis immediately
        if (result.type === "bonus_paid") {
          await editCallbackMessage(context, tr("analysis_product_analyzing"));

          try {
            const { analyzeWithMedia } = await import("../llm/deep-analyze.ts");
            const { formatDeepAnalysisHtml } = await import("./formatters.ts");

            const analysisResult = await analyzeWithMedia({
              text: msg.text,
              messageId,
              groupId,
              groupTitle: msg.group_title,
            });

            const resultText = formatDeepAnalysisHtml(analysisResult);
            await editCallbackMessage(context, resultText, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });

            botLog.info({ userId, messageId, groupId }, "Product analyzed (bonus)");
          } catch (error) {
            botLog.error({ error, userId }, "Deep analysis failed (bonus)");
            await editCallbackMessage(context, tr("analysis_error"));
          }
        }
      }
      break;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                       PROMOTION ACTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    case "promote_product": {
      // User wants to promote a product — check permission first
      const raw = JSON.parse(context.data || "{}");
      const messageId = raw.m as number;
      const groupId = raw.g as number;

      if (!messageId || !groupId) {
        await context.answer({ text: tr("analysis_data_not_found") });
        return;
      }

      // Permission check: admin can promote anything, others only own posts
      const userIsAdmin = isAdmin(userId);
      let canPromote = userIsAdmin;

      if (!canPromote) {
        // Check if user is the post author
        const senderId = queries.getMessageSenderId(messageId, groupId);
        canPromote = senderId !== null && senderId === userId;
      }

      if (!canPromote) {
        await context.answer({
          text: tr("promo_only_own_posts"),
          show_alert: true,
        });
        return;
      }

      // Check if already promoted
      const existingPromo = queries.getProductPromotion(messageId, groupId);
      if (existingPromo) {
        const endsAt = new Date(existingPromo.ends_at * 1000);
        const locale = getUserLocale(userId);
        const dateStr = endsAt.toLocaleDateString(locale === "rs" ? "sr" : locale);
        await context.answer({
          text: tr("promo_already_until", { date: dateStr }),
          show_alert: true,
        });
        return;
      }

      await context.answer();
      await context.editText(tr("promo_product_full"), {
        parse_mode: "Markdown",
        reply_markup: promotionDurationKeyboard("product", messageId, groupId, false),
      });
      break;
    }

    case "promote_group": {
      // User wants to promote a group — check permission first
      const raw = JSON.parse(context.data || "{}");
      const groupId = raw.g as number;

      if (!groupId) {
        await context.answer({ text: tr("analysis_data_not_found") });
        return;
      }

      // Permission check: admin can promote anything, others only own groups
      const userIsAdmin = isAdmin(userId);
      let canPromote = userIsAdmin;

      if (!canPromote) {
        // Check if user is group admin via MTProto
        canPromote = await isUserGroupAdmin(userId, groupId);
      }

      if (!canPromote) {
        await context.answer({
          text: tr("promo_only_admin_groups"),
          show_alert: true,
        });
        return;
      }

      // Check if already promoted
      if (queries.isGroupPromoted(groupId)) {
        await context.answer({ text: tr("promo_already_promoted"), show_alert: true });
        return;
      }

      await context.answer();
      await context.editText(tr("promo_group_full"), {
        parse_mode: "Markdown",
        reply_markup: promotionDurationKeyboard("group", groupId, undefined, false),
      });
      break;
    }

    case "promo_info": {
      // Show info about existing promotion
      const raw = JSON.parse(context.data || "{}");
      const messageId = raw.m as number;
      const groupId = raw.g as number;

      const promo = queries.getProductPromotion(messageId, groupId);
      if (!promo) {
        await context.answer({ text: tr("promo_not_found") });
        return;
      }

      const endsAt = new Date(promo.ends_at * 1000);
      const daysLeft = Math.ceil((promo.ends_at - Date.now() / 1000) / 86400);
      const locale = getUserLocale(userId);
      const dateStr = endsAt.toLocaleDateString(locale === "rs" ? "sr" : locale);

      await context.answer({
        text: tr("promo_status", { date: dateStr, days: daysLeft }),
        show_alert: true,
      });
      break;
    }

    case "buy_promo_product": {
      const raw = JSON.parse(context.data || "{}");
      const messageId = raw.id as number;
      const groupId = raw.g as number;
      const days = raw.days as number;

      if (!messageId || !groupId || !days) {
        await context.answer({ text: tr("error_data") });
        return;
      }

      // Permission check: admin can promote anything, others only own posts
      const userIsAdmin = isAdmin(userId);
      if (!userIsAdmin) {
        const senderId = queries.getMessageSenderId(messageId, groupId);
        if (senderId === null || senderId !== userId) {
          await context.answer({ text: tr("promo_only_own_posts"), show_alert: true });
          return;
        }
      }

      // Everyone pays — send invoice
      const prices = { 3: 100, 7: 200, 30: 500 };
      const price = prices[days as keyof typeof prices] || 100;

      await context.answer({ text: tr("promo_opening_payment") });

      const result = await sendPaymentInvoice(bot, userId, {
        type: "promotion_product",
        title: tr("promo_product_title", { days }),
        description: tr("promo_product_desc"),
        amount: price,
        payload: {
          type: "promotion_product",
          messageId,
          groupId,
          days,
        },
      });

      // If paid with bonus, create promotion immediately
      if (result.type === "bonus_paid") {
        queries.createPromotion({
          telegramId: userId,
          type: "product",
          messageId,
          productGroupId: groupId,
          durationDays: days,
        });
        await context.editText(tr("pay_product_promo_activated", { days }));
      }
      break;
    }

    case "buy_promo_group": {
      const raw = JSON.parse(context.data || "{}");
      const groupId = raw.id as number;
      const days = raw.days as number;

      if (!groupId || !days) {
        await context.answer({ text: tr("error_data") });
        return;
      }

      // Permission check: admin can promote anything, others only own groups
      const userIsAdmin = isAdmin(userId);
      if (!userIsAdmin) {
        const isGroupAdmin = await isUserGroupAdmin(userId, groupId);
        if (!isGroupAdmin) {
          await context.answer({ text: tr("promo_only_admin_groups"), show_alert: true });
          return;
        }
      }

      // Everyone pays — send invoice
      const prices = { 3: 300, 7: 600, 30: 1500 };
      const price = prices[days as keyof typeof prices] || 300;

      await context.answer({ text: tr("promo_opening_payment") });

      const result = await sendPaymentInvoice(bot, userId, {
        type: "promotion_group",
        title: tr("promo_group_title_days", { days }),
        description: tr("promo_group_desc"),
        amount: price,
        payload: {
          type: "promotion_group",
          groupId,
          days,
        },
      });

      // If paid with bonus, create promotion immediately
      if (result.type === "bonus_paid") {
        queries.createPromotion({
          telegramId: userId,
          type: "group",
          groupId,
          durationDays: days,
        });
        await context.editText(tr("pay_group_promo_activated", { days }));
      }
      break;
    }

    case "cancel_promo": {
      await context.answer({ text: tr("cb_cancelled") });
      await context.editText(tr("promo_cancelled"));
      break;
    }

    // ══════════════════════════════════════════════════════════
    //                  PUBLICATION CALLBACKS
    // ══════════════════════════════════════════════════════════

    case "connect_telegram": {
      await handleConnectTelegram(
        bot,
        userId,
        async () => { await context.answer(); },
        (text, keyboard) => editCallbackMessage(context, text, { parse_mode: "Markdown", ...keyboard })
      );
      break;
    }

    case "create_publication": {
      await handleCreatePublication(
        bot,
        userId,
        async () => { await context.answer(); },
        (text, keyboard) => editCallbackMessage(context, text, { parse_mode: "Markdown", ...keyboard })
      );
      break;
    }

    case "my_publications": {
      await handleMyPublications(
        bot,
        userId,
        async () => { await context.answer(); },
        (text, keyboard) => editCallbackMessage(context, text, { parse_mode: "Markdown", ...keyboard })
      );
      break;
    }

    case "disconnect_account": {
      await handleDisconnectAccount(
        bot,
        userId,
        async () => { await context.answer(); },
        (text, keyboard) => editCallbackMessage(context, text, { parse_mode: "Markdown", ...keyboard })
      );
      break;
    }

    case "cancel_auth": {
      await handleCancelAuth(
        bot,
        userId,
        async () => { await context.answer(); },
        (text, keyboard) => editCallbackMessage(context, text, { parse_mode: "Markdown", ...keyboard })
      );
      break;
    }

    case "cancel_publication": {
      await handleCancelPublication(
        bot,
        userId,
        async () => { await context.answer(); },
        (text, keyboard) => editCallbackMessage(context, text, { parse_mode: "Markdown", ...keyboard })
      );
      break;
    }

    case "content_done": {
      await handleContentDone(
        bot,
        userId,
        async () => { await context.answer(); }
      );
      break;
    }

    case "pub_approve": {
      await context.answer();
      const { handlePostApprove } = await import("../publisher/interactive.ts");
      await handlePostApprove(bot, userId, data.id as number);
      break;
    }

    case "pub_skip": {
      await context.answer();
      const { handlePostSkip } = await import("../publisher/interactive.ts");
      await handlePostSkip(bot, userId, data.id as number);
      break;
    }

    case "pub_edit": {
      await context.answer();
      const { handlePostEdit } = await import("../publisher/interactive.ts");
      await handlePostEdit(bot, userId, data.id as number);
      break;
    }

    case "pub_cancel_edit": {
      await context.answer();
      const { handleCancelEdit } = await import("../publisher/interactive.ts");
      await handleCancelEdit(bot, userId, data.id as number);
      break;
    }

    case "pub_stop": {
      await context.answer();
      const { handleStopPublication } = await import("../publisher/interactive.ts");
      await handleStopPublication(bot, userId, data.id as number);
      break;
    }

    case "publish_to_preset": {
      const presetId = typeof data.id === "number" ? data.id : parseInt(String(data.id), 10);
      if (!presetId || isNaN(presetId)) {
        await context.answer({ text: tr("error_data") });
        return;
      }

      await handlePublishToPreset(
        bot,
        userId,
        presetId,
        async () => { await context.answer(); },
        (text, keyboard) => editCallbackMessage(context, text, { parse_mode: "Markdown", ...keyboard })
      );
      break;
    }

    case "confirm_publication": {
      const publicationId = typeof data.id === "number" ? data.id : parseInt(String(data.id), 10);
      if (!publicationId || isNaN(publicationId)) {
        await context.answer({ text: tr("error_data") });
        return;
      }

      await handleConfirmPublication(
        bot,
        userId,
        publicationId,
        async () => { await context.answer(); }
      );
      break;
    }

    case "use_pub_credit": {
      const publicationId = typeof data.id === "number" ? data.id : parseInt(String(data.id), 10);
      if (!publicationId || isNaN(publicationId)) {
        await context.answer({ text: tr("error_data") });
        return;
      }

      const { handleUsePubCredit } = await import("./publish.ts");
      await handleUsePubCredit(
        bot,
        userId,
        publicationId,
        async () => { await context.answer(); }
      );
      break;
    }

    case "lang": {
      const newLang = data.lang;
      if (!newLang || !isValidLocale(newLang)) {
        await context.answer({ text: "Invalid language" });
        return;
      }

      const tr = setUserLanguage(userId, newLang as Locale);
      await context.answer({ text: tr("lang_changed") });
      await context.editText(tr("lang_select"), {
        reply_markup: languageKeyboard(newLang as Locale),
      });
      break;
    }
  }
});

// Error handler
bot.onError(({ context, error }) => {
  botLog.error({ err: error }, "Bot error");
});

// ═══════════════════════════════════════════════════════════════════════════════════
//                       PAYMENT HANDLERS (Telegram Stars)
// ═══════════════════════════════════════════════════════════════════════════════════

// Pre-checkout validation - called before payment is processed
bot.on("pre_checkout_query", async (context) => {
  const userId = context.from?.id;
  if (!userId) {
    await context.answerPreCheckoutQuery({ ok: false, error_message: getTranslatorForLocale("ru")("pay_user_not_found") });
    return;
  }

  const tr = getTranslator(userId);

  try {
    const payload = JSON.parse(context.invoicePayload || "{}") as PaymentPayload;

    await handlePreCheckout(
      bot,
      context.id,
      userId,
      payload
    );
  } catch (error) {
    botLog.error({ error, userId }, "Pre-checkout error");
    await context.answerPreCheckoutQuery({ ok: false, error_message: tr("pay_verification_error") });
  }
});

// Successful payment - called after payment is completed
bot.on("successful_payment", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const payment = context.successfulPayment;
  if (!payment) return;

  const result = await handleSuccessfulPayment(
    bot,
    userId,
    payment.telegramPaymentChargeId,
    payment.totalAmount,
    payment.invoicePayload
  );

  // Send confirmation message
  await context.send(result.message);

  // Handle post-payment actions
  const tr = getTranslator(userId);

  try {
    const payload = JSON.parse(payment.invoicePayload) as PaymentPayload;

    if (payload.type === "analyze" && payload.messageId && payload.groupId) {
      // Run the paid deep analysis
      const msg = queries.getMessage(payload.messageId, payload.groupId);
      if (msg) {
        await context.send(tr("analysis_product_analyzing"));

        const { analyzeWithMedia } = await import("../llm/deep-analyze.ts");
        const { formatDeepAnalysisHtml } = await import("./formatters.ts");

        const analysisResult = await analyzeWithMedia({
          text: msg.text,
          messageId: payload.messageId,
          groupId: payload.groupId,
          groupTitle: msg.group_title,
        });

        const resultText = formatDeepAnalysisHtml(analysisResult);
        await context.send(resultText, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });

        botLog.info({ userId, messageId: payload.messageId, groupId: payload.groupId }, "Paid deep analysis completed");
      }
    }

    if (payload.type === "publication" && payload.publicationId) {
      // Start interactive publication flow
      const { startInteractivePublication } = await import("../publisher/interactive.ts");
      await startInteractivePublication(bot, userId, payload.publicationId);
    }
  } catch (error) {
    botLog.error({ error, userId }, "Post-payment action failed");
  }

  botLog.info(
    {
      userId,
      chargeId: payment.telegramPaymentChargeId,
      amount: payment.totalAmount,
      success: result.success,
    },
    "Payment processed"
  );
});

/**
 * Build message link for Telegram supergroup
 * Format: https://t.me/c/{internal_id}/{message_id}
 * internal_id is the group_id without the -100 prefix
 */
function buildMessageLink(groupId: number, messageId: number): string {
  // Telegram supergroup IDs are like -1001234567890
  // Internal ID for t.me/c/ links is 1234567890 (without -100 prefix)
  const internalId = String(Math.abs(groupId)).replace(/^100/, "");
  return `https://t.me/c/${internalId}/${messageId}`;
}

/**
 * Build caption for notification message
 * Format:
 *   <Quote from post>
 *
 *   Group: <Group Name> (link if public)
 *   <Sender Name> @username
 */
function buildNotificationCaption(
  groupTitle: string,
  groupUsername: string | undefined,
  messageText: string,
  senderName?: string,
  senderUsername?: string,
  maxLength: number = 1000, // Telegram caption limit is 1024
  competitorCount?: number, // Number of other users hunting the same product
  telegramId?: number
): string {
  const tr = telegramId ? getTranslator(telegramId) : getTranslatorForLocale("ru");

  // Group line (with link if username available)
  const groupLine = groupUsername
    ? tr("notif_group_link", { title: groupTitle, username: groupUsername })
    : tr("notif_group", { title: groupTitle });

  // Author line
  let authorLine = "";
  if (senderName) {
    authorLine = senderUsername
      ? `${senderName} @${senderUsername}`
      : senderName;
  }

  // Competitor line (only shown for Pro/Business users)
  const competitorLine = competitorCount && competitorCount > 0
    ? tr("notif_competitors", { count: competitorCount })
    : "";

  const suffix = `\n\n${groupLine}\n${authorLine}${competitorLine}`;
  const availableForText = maxLength - suffix.length - 3; // -3 for "..."
  const truncatedText = messageText.length > availableForText
    ? messageText.slice(0, availableForText) + "..."
    : messageText;

  return truncatedText + suffix;
}

/**
 * Check if user is admin
 */
function isAdmin(telegramId: number): boolean {
  const adminId = process.env.ADMIN_ID;
  return adminId ? Number(adminId) === telegramId : false;
}

/**
 * Build inline keyboard for notification
 */
function buildNotificationKeyboard(
  messageId?: number,
  groupId?: number,
  subscriptionId?: number,
  telegramId?: number
): { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> } | undefined {
  if (!messageId || !groupId) return undefined;

  const tr = telegramId ? getTranslator(telegramId) : getTranslatorForLocale("ru");
  const messageUrl = buildMessageLink(groupId, messageId);

  // Get analyze price for user (if telegramId provided)
  let analyzeLabel = tr("notif_analyze");
  if (telegramId) {
    const price = getAnalyzePrice(telegramId);
    const isFree = canUseFreeAnalyze(telegramId);
    if (price === 0) {
      analyzeLabel = tr("notif_analyze");
    } else if (isFree) {
      analyzeLabel = tr("notif_analyze_free");
    } else {
      analyzeLabel = tr("notif_analyze_price", { price });
    }
  }

  const keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [
    [{ text: tr("notif_go_to_post"), url: messageUrl }],
    [{
      text: analyzeLabel,
      callback_data: JSON.stringify({ action: "analyze_product", m: messageId, g: groupId }),
    }],
  ];

  // Add "Miss" and "Pause" buttons if subscription ID available (short keys for 64-byte limit)
  if (subscriptionId) {
    keyboard.push([{
      text: tr("notif_miss"),
      callback_data: JSON.stringify({ a: "miss", s: subscriptionId, m: messageId, g: groupId }),
    }]);
    keyboard.push([{
      text: tr("notif_pause_sub"),
      callback_data: JSON.stringify({ action: "pause_from_notification", id: subscriptionId }),
    }]);
  }

  // Show promote button to everyone - permission checked on callback
  const isPromoted = queries.isProductPromoted(messageId, groupId);
  if (!isPromoted) {
    keyboard.push([{
      text: tr("notif_promote"),
      callback_data: JSON.stringify({ action: "promote_product", m: messageId, g: groupId }),
    }]);
  } else {
    keyboard.push([{
      text: tr("notif_already_promoted"),
      callback_data: JSON.stringify({ action: "promo_info", m: messageId, g: groupId }),
    }]);
  }

  return { inline_keyboard: keyboard };
}

/**
 * Send notification to user about matched message
 */
export async function notifyUser(
  telegramId: number,
  groupTitle: string,
  groupUsername: string | undefined,
  messageText: string,
  subscriptionQuery: string,
  messageId?: number,
  groupId?: number,
  senderName?: string,
  senderUsername?: string,
  media?: MediaItem[],
  reasoning?: string,
  subscriptionId?: number,
  competitorCount?: number // Number of other users hunting the same product (for Pro/Business)
): Promise<void> {
  try {
    const keyboard = buildNotificationKeyboard(messageId, groupId, subscriptionId, telegramId);

    // Only show competitor count if user has Pro/Business plan
    const showCompetitors = canSeeFora(telegramId) ? competitorCount : undefined;

    // If we have media, send with photo/video
    if (media && media.length > 0) {
      const caption = buildNotificationCaption(
        groupTitle,
        groupUsername,
        messageText,
        senderName,
        senderUsername,
        1000, // Leave some room for Telegram formatting
        showCompetitors,
        telegramId
      );

      if (media.length === 1) {
        // Single photo or video — caption + keyboard in same message
        const item = media[0]!;
        const blob = new Blob([item.buffer], { type: item.mimeType });

        if (item.type === "photo") {
          await bot.api.sendPhoto({
            chat_id: telegramId,
            photo: blob,
            caption,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        } else {
          await bot.api.sendVideo({
            chat_id: telegramId,
            video: blob,
            caption,
            parse_mode: "Markdown",
            reply_markup: keyboard,
          });
        }

        // Send query + reasoning as separate message
        const tr = getTranslator(telegramId);
        const detailsText = reasoning
          ? `**${subscriptionQuery}**\n${tr("notif_reason", { reason: reasoning })}`
          : `**${subscriptionQuery}**`;
        await bot.api.sendMessage({
          chat_id: telegramId,
          text: detailsText,
          parse_mode: "Markdown",
        });
      } else {
        // Album (2-10 media items)
        const mediaGroup = media.slice(0, 10).map((item, i) => {
          const blob = new Blob([item.buffer], { type: item.mimeType });
          return {
            type: item.type as "photo" | "video",
            media: blob,
            caption: i === 0 ? caption : undefined,
            parse_mode: i === 0 ? ("Markdown" as const) : undefined,
          };
        });

        await bot.api.sendMediaGroup({
          chat_id: telegramId,
          media: mediaGroup as Parameters<typeof bot.api.sendMediaGroup>[0]["media"],
        });

        // Send query + reasoning + keyboard as separate message
        const tr = getTranslator(telegramId);
        const detailsText = reasoning
          ? `**${subscriptionQuery}**\n${tr("notif_reason", { reason: reasoning })}`
          : `**${subscriptionQuery}**`;
        await bot.api.sendMessage({
          chat_id: telegramId,
          text: detailsText,
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    } else {
      // Text-only notification
      const caption = buildNotificationCaption(
        groupTitle,
        groupUsername,
        messageText,
        senderName,
        senderUsername,
        4000, // Telegram message limit is 4096
        showCompetitors,
        telegramId
      );

      await bot.api.sendMessage({
        chat_id: telegramId,
        text: caption,
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });

      // Send query + reasoning as separate message
      const tr = getTranslator(telegramId);
      const detailsText = reasoning
        ? `**${subscriptionQuery}**\n${tr("notif_reason", { reason: reasoning })}`
        : `**${subscriptionQuery}**`;
      await bot.api.sendMessage({
        chat_id: telegramId,
        text: detailsText,
        parse_mode: "Markdown",
      });
    }

    botLog.debug({ userId: telegramId, groupTitle, hasMedia: !!media?.length }, "Notification sent");
  } catch (error) {
    botLog.error({ err: error, userId: telegramId }, "Failed to notify user");
  }
}
