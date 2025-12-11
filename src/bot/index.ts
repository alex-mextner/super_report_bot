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
  subscriptionKeyboard,
  groupPickerKeyboard,
  inviteLinkKeyboard,
  groupsKeyboard,
  skipQuestionKeyboard,
  aiEditKeyboard,
  pendingAiEditKeyboard,
  pendingAiCorrectionStartKeyboard,
  nextRequestId,
  keywordEditSubmenu,
  keywordEditSubmenuPending,
  removeKeywordsKeyboard,
  ratingKeyboard,
  settingsKeyboard,
  marketplaceKeyboard,
  metadataSkipKeyboard,
  metadataPrefilledKeyboard,
  metadataCurrencyKeyboard,
} from "./keyboards.ts";
import { runWithRecovery } from "./operations.ts";
import { interpretEditCommand } from "../llm/edit.ts";
import { generateKeywordEmbeddings, checkBgeHealth } from "../llm/embeddings.ts";
import { groups, messages } from "../utils/pluralize.ts";
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

// Helper: show single example for rating
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showExampleForRating(
  context: any,
  userId: number,
  example: RatingExample,
  index: number,
  total: number
): Promise<void> {
  const deletedLabel = example.isDeleted ? " (удалено)" : "";
  const sourceLabel = example.isGenerated
    ? "🤖 Сгенерированный пример"
    : `📍 ${example.groupTitle}${deletedLabel}`;

  await context.send(
    format`${bold(`Пример ${index + 1}/${total}`)} ${sourceLabel}

${example.text.slice(0, 500)}${example.text.length > 500 ? "..." : ""}

Это похоже на то, что ты ищешь?`,
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
      format`${bold("Результат анализа:")}

${bold("Что будем искать:")}
${result.llm_description}

Подтверди или отмени:`,
      {
        reply_markup: confirmKeyboard(queryId, mode),
      }
    );
  } else {
    // Full view for advanced mode
    await context.send(
      format`${bold("Результат анализа:")}

${bold("Позитивные ключевые слова:")}
${code(result.positive_keywords.join(", "))}

${bold("Негативные ключевые слова:")}
${code(result.negative_keywords.join(", ") || "нет")}

${bold("Описание для проверки:")}
${result.llm_description}

Подтверди или измени параметры:`,
      {
        reply_markup: confirmKeyboard(queryId, mode),
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
    const progressMsg = await context.send("Примеры не найдены, генерирую ключевые слова...");
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
  await context.send(`📝 Покажу примеры — оцени их, чтобы я лучше понял что искать.

Бот использует ИИ, ключевые слова и семантический анализ — находит посты с опечатками, на разных языках, сформулированные по-разному, и даже анализирует картинки если из текста мало что понятно.`);

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

  if (!c.ratingExamples || !c.pendingSub) {
    await context.send("Сессия истекла. Отправь новый запрос.");
    send(userId, { type: "CANCEL" });
    return;
  }

  const { ratings } = c.ratingExamples;
  const query = c.pendingSub.originalQuery;
  const clarificationContext = c.clarification
    ? formatClarificationContext(c.clarification.questions, c.clarification.answers)
    : undefined;

  const progressMsg = await context.send("Генерирую ключевые слова с учётом твоих оценок...");
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
  const mode = queries.getUserMode(userId);
  const progressMsg = await context.send("Генерирую ключевые слова...");
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

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);
  ensureIdle(userId);

  await context.send(format`
Привет! Я бот для мониторинга сообщений в группах.

${bold("Примеры использования:")}
• Поиск объявлений в барахолках — "iPhone 14 до 50к в Москве"
• Поиск клиентов для бизнеса — "ищу мастера по ремонту техники"
• Мониторинг новостей — "вакансии frontend разработчик"

${bold("Как начать:")}
1. Добавь группы: /addgroup
2. Опиши что ищешь
3. Получай уведомления

${bold("Команды:")}
/addgroup - добавить группу
/list - мои подписки
/settings - настройки
  `);
});

// /list command - show user subscriptions
bot.command("list", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const mode = queries.getUserMode(userId);
  const subscriptions = queries.getUserSubscriptions(userId);

  if (subscriptions.length === 0) {
    await context.send("У тебя пока нет активных подписок. Отправь описание того, что хочешь найти.");
    return;
  }

  for (const sub of subscriptions) {
    const hasNeg = sub.negative_keywords.length > 0;
    const hasDisabledNeg = (sub.disabled_negative_keywords?.length ?? 0) > 0;

    let messageText;
    if (mode === "advanced") {
      let exclusionsText = "нет";
      if (hasNeg) {
        exclusionsText = sub.negative_keywords.join(", ");
      } else if (hasDisabledNeg) {
        exclusionsText = `(отключены: ${sub.disabled_negative_keywords!.join(", ")})`;
      }

      messageText = format`
${bold("Подписка #" + sub.id)}
${bold("Запрос:")} ${sub.original_query}
${bold("Ключевые слова:")} ${code(sub.positive_keywords.join(", "))}
${bold("Исключения:")} ${code(exclusionsText)}
      `;
    } else {
      messageText = format`
${bold("Подписка #" + sub.id)}
${bold("Запрос:")} ${sub.original_query}
      `;
    }

    await context.send(messageText, {
      reply_markup: subscriptionKeyboard(sub.id, hasNeg, hasDisabledNeg, mode),
    });
  }
});

// /help command
bot.command("help", async (context) => {
  await context.send(format`
${bold("Как работает бот:")}

1. Добавь группы для мониторинга: /addgroup
2. Отправь описание того, что ищешь
3. Выбери группы и получай уведомления

${bold("Команды:")}
/addgroup - добавить группу/канал
/groups - список добавленных групп
/list - мои подписки
/settings - настройки режима
/catalog - каталог товаров
  `);
});

// /settings command - configure user mode
bot.command("settings", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId, context.from?.firstName, context.from?.username);
  const currentMode = queries.getUserMode(userId);

  const modeDescription =
    currentMode === "normal"
      ? "В обычном режиме бот не показывает ключевые слова и не задаёт уточняющих вопросов."
      : "В продвинутом режиме ты видишь ключевые слова, можешь их редактировать и отвечаешь на уточняющие вопросы.";

  await context.send(
    format`${bold("Настройки")}

${bold("Текущий режим:")} ${currentMode === "normal" ? "📊 Обычный" : "🔬 Продвинутый"}

${modeDescription}`,
    {
      reply_markup: settingsKeyboard(currentMode),
    }
  );
});

// /catalog command - open webapp
bot.command("catalog", async (context) => {
  const webappUrl = process.env.WEBAPP_URL;

  if (!webappUrl) {
    await context.send("WebApp не настроен. Добавь WEBAPP_URL в .env");
    return;
  }

  await context.send("Открой каталог товаров:", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Открыть каталог",
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

  // Check for links in command arguments
  const args = context.text?.replace(/^\/addgroup(@\w+)?\s*/i, "").trim() || "";
  const links = parseTelegramLinks(args);

  if (links.length === 0) {
    // No links provided — show interactive picker
    send(userId, { type: "ADDGROUP" });
    await context.send("Выбери группу или канал для добавления:", {
      reply_markup: groupPickerKeyboard(nextRequestId()),
    });
    return;
  }

  // Process links
  await context.send(`Добавляю ${groups(links.length)}...`);

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

  // If groups were added — start metadata collection for each
  if (addedGroups.length > 0) {
    // Enter addingGroup state first
    send(userId, { type: "ADDGROUP" });

    // If multiple groups, create queue
    if (addedGroups.length > 1) {
      send(userId, { type: "START_METADATA_QUEUE", groups: addedGroups });
    }

    // Start with first group
    const firstGroup = addedGroups[0]!;
    const prefilled = parseGroupTitle(firstGroup.groupTitle);
    send(userId, {
      type: "START_METADATA_COLLECTION",
      groupId: firstGroup.groupId,
      groupTitle: firstGroup.groupTitle,
      prefilled,
    });

    await askNextMetadataQuestion(context, userId);
  }
});

// /groups command - list user's groups
bot.command("groups", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  const groups = queries.getUserGroups(userId);

  if (groups.length === 0) {
    await context.send("У тебя нет добавленных групп. Используй /addgroup для добавления.");
    return;
  }

  const list = groups
    .map((g) => {
      const icon = g.isChannel ? "📢" : "👥";
      return `${icon} ${g.title}`;
    })
    .join("\n");

  await context.send(format`
${bold("Твои группы для мониторинга:")}

${list}

Используй /addgroup чтобы добавить ещё.
  `);
});

// Handle chat_shared event (user selected a group/channel via requestChat)
bot.on("chat_shared", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

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
    await context.send("Эта группа уже добавлена!");
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
      `Приватная группа "${title}".\n\n` +
        "Бот не может присоединиться без invite link.\n" +
        "Отправь ссылку вида t.me/+XXX или нажми Пропустить.",
      { reply_markup: inviteLinkKeyboard() }
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
    return { success: false, error: "Уже добавлена" };
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
  send(userId, { type: "ADDGROUP" });
  await context.send('Выбери ещё группу или нажми "Готово":', {
    reply_markup: groupPickerKeyboard(nextRequestId()),
  });
}

// Add group for user (join userbot if needed, save to DB)
// Returns groupId on success for metadata collection
async function addGroupForUser(
  context: { send: (text: string, options?: object) => Promise<unknown> },
  userId: number,
  group: PendingGroup,
  skipMetadata: boolean = false
): Promise<{ success: boolean; groupId?: number }> {
  const icon = group.isChannel ? "📢" : "👥";

  // Try to join
  const result = await ensureUserbotInGroup(group.id, group.username, group.inviteLink);

  if (result.success) {
    // Save to DB
    queries.addUserGroup(userId, group.id, group.title || "Unknown", group.isChannel);
    await context.send(`${icon} "${group.title}" добавлена!`, {
      reply_markup: { remove_keyboard: true },
    });

    if (skipMetadata) {
      await showAddGroupPrompt(context, userId);
      return { success: true, groupId: group.id };
    }

    // Start metadata collection
    const prefilled = parseGroupTitle(group.title || "");
    send(userId, {
      type: "START_METADATA_COLLECTION",
      groupId: group.id,
      groupTitle: group.title || "Unknown",
      prefilled,
    });

    await askNextMetadataQuestion(context, userId);
    return { success: true, groupId: group.id };
  } else {
    await context.send(`Не удалось добавить "${group.title}": ${result.error}`, {
      reply_markup: { remove_keyboard: true },
    });
    await showAddGroupPrompt(context, userId);
    return { success: false };
  }
}

// Helper: ask next metadata question based on current step
async function askNextMetadataQuestion(
  context: { send: (text: string, options?: object) => Promise<unknown> },
  userId: number
): Promise<void> {
  const userCtx = ctx(userId);
  const meta = userCtx.pendingGroupMetadata;

  if (!meta) {
    botLog.warn({ userId }, "askNextMetadataQuestion called but no pendingGroupMetadata");
    await showAddGroupPrompt(context, userId);
    return;
  }

  switch (meta.step) {
    case "marketplace":
      await context.send(`Продают ли товары в группе "${meta.groupTitle}"?`, {
        reply_markup: marketplaceKeyboard(),
      });
      break;

    case "country":
      if (meta.prefilled.country && !meta.awaitingTextInput) {
        // Has prefilled country — show confirm button
        const countryName = getCountryName(meta.prefilled.country);
        await context.send("Страна группы:", {
          reply_markup: metadataPrefilledKeyboard(meta.prefilled.country, `${countryName} (${meta.prefilled.country})`),
        });
      } else {
        await context.send("В какой стране находится группа? (например: Сербия, Россия)", {
          reply_markup: metadataSkipKeyboard(),
        });
      }
      break;

    case "city":
      if (meta.prefilled.city && !meta.awaitingTextInput) {
        await context.send("Город группы:", {
          reply_markup: metadataPrefilledKeyboard(meta.prefilled.city, meta.prefilled.city),
        });
      } else {
        await context.send("Какой город? (например: Белград, Москва)", {
          reply_markup: metadataSkipKeyboard(),
        });
      }
      break;

    case "currency": {
      // Prefill currency from country if available
      const defaultCurrency = meta.country ? getDefaultCurrency(meta.country) : null;
      if (defaultCurrency && !meta.awaitingTextInput) {
        const currencyName = getCurrencyName(defaultCurrency);
        await context.send("Валюта группы:", {
          reply_markup: metadataCurrencyKeyboard(defaultCurrency, currencyName),
        });
      } else {
        await context.send("Какая основная валюта? (например: динары, рубли, евро)", {
          reply_markup: metadataSkipKeyboard(),
        });
      }
      break;
    }
  }
}

// Helper: save metadata to DB and show next group or add prompt
async function finishMetadataCollection(
  context: { send: (text: string, options?: object) => Promise<unknown> },
  userId: number
): Promise<void> {
  const userCtx = ctx(userId);
  const meta = userCtx.pendingGroupMetadata;
  const queue = userCtx.metadataQueue;

  // Save to DB if we have metadata
  if (meta) {
    queries.upsertGroupMetadata({
      telegramId: meta.groupId,
      title: meta.groupTitle,
      country: meta.country,
      city: meta.city,
      currency: meta.currency,
      isMarketplace: meta.isMarketplace ?? false,
    });
    botLog.info({ groupId: meta.groupId, meta }, "Group metadata saved");
  }

  // Check if more groups in queue
  if (queue && queue.groups.length > 1) {
    // Next group
    const nextGroup = queue.groups[1]!;
    const prefilled = parseGroupTitle(nextGroup.groupTitle);
    send(userId, {
      type: "START_METADATA_COLLECTION",
      groupId: nextGroup.groupId,
      groupTitle: nextGroup.groupTitle,
      prefilled,
    });
    await askNextMetadataQuestion(context, userId);
  } else {
    // All done
    await showAddGroupPrompt(context, userId);
  }
}

// Helper: process new subscription query
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processSubscriptionQuery(context: any, userId: number, query: string): Promise<void> {
  const mode = queries.getUserMode(userId);

  if (mode === "normal") {
    // Normal mode: analyze query first, ask clarification if needed
    // Save query for recovery before starting LLM call
    send(userId, { type: "SAVE_QUERY", query });

    await context.send("Анализирую запрос...");

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
        await context.send(format`${bold("Уточняющий вопрос")} ${questionNumber}\n\n${firstQuestion}`, {
          reply_markup: skipQuestionKeyboard(),
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

    await context.send("Генерирую уточняющие вопросы...");

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
      await context.send("Не удалось сгенерировать вопросы, перехожу к примерам...");
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
    const firstQuestion = questions[0] ?? "Какие конкретные характеристики важны?";
    const questionNumber = `(1/${questions.length})`;
    await context.send(format`${bold("Уточняющий вопрос")} ${questionNumber}\n\n${firstQuestion}`, {
      reply_markup: skipQuestionKeyboard(),
    });
  }
}

// Format not_found reason for user
function formatNotFoundReason(reason: import("./forward.ts").NotFoundReason, groupTitle?: string): string {
  switch (reason) {
    case "no_text":
      return "Сообщение не содержит текста.";
    case "text_not_in_db":
      return "Бот не видел это сообщение в мониторируемых группах.";
    case "no_analyses_for_user":
      return groupTitle
        ? `Сообщение из "${groupTitle}" ещё не было проанализировано.`
        : "Сообщение ещё не было проанализировано.";
    case "group_not_monitored_by_user":
      return groupTitle
        ? `Группа "${groupTitle}" не добавлена в твой мониторинг.`
        : "Группа этого сообщения не добавлена в твой мониторинг.";
  }
}

// Process forwarded message (extracted for reuse with albums)
async function processForwardedMessage(
  context: Parameters<Parameters<typeof bot.on<"message">>[1]>[0],
  userId: number,
  messageText: string
) {
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
        `Группа "${result.chatTitle || "Неизвестная"}" не добавлена в мониторинг.`,
        { reply_markup: addGroupKeyboard(result.chatId, result.chatTitle) }
      );
      break;

    case "not_found": {
      const reasonText = formatNotFoundReason(result.reason, result.groupTitle);

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
        const text = formatAnalysisResult(analysis);
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

  // For non-forward messages, require text
  if (!context.text || context.text.startsWith("/")) return;

  const currentState = fsmState(userId);
  const c = ctx(userId);
  const text = context.text;

  // Debug logging
  botLog.debug(
    { userId, currentState, hasClarification: !!c.clarification, text: text.substring(0, 50) },
    "Message handler: state check"
  );

  // Handle "Готово" button in adding_group state
  if (text === "Готово" && currentState === "addingGroup") {
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
        await context.send(`Добавлено групп: ${groups.length}. Обрабатываю твой запрос...`, {
          reply_markup: { remove_keyboard: true },
        });
        await processSubscriptionQuery(context, userId, pendingQuery);
      } else {
        await context.send(`Добавлено групп: ${groups.length}. Теперь отправь описание того, что ищешь.`, {
          reply_markup: { remove_keyboard: true },
        });
      }
    } else {
      await context.send("Группы не добавлены. Используй /addgroup когда будешь готов.", {
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
      await context.send("Ссылка получена, пробую присоединиться...", {
        reply_markup: { remove_keyboard: true },
      });
      await addGroupForUser(context, userId, group);
    } else {
      await context.send("Неверный формат. Отправь ссылку вида t.me/+XXX или нажми Пропустить.");
    }
    return;
  }

  // Handle text input for group metadata (country, city, currency)
  if (currentState === "collectingGroupMetadata" && c.pendingGroupMetadata?.awaitingTextInput) {
    const meta = c.pendingGroupMetadata;
    const step = meta.step;
    const inputText = text.trim();

    let matchedValue: string | null = null;
    let displayName: string | null = null;

    switch (step) {
      case "country": {
        const match = matchCountry(inputText);
        if (match) {
          matchedValue = match.code;
          displayName = `${match.name} (${match.code})`;
        }
        break;
      }
      case "city": {
        const match = matchCity(inputText);
        if (match) {
          matchedValue = match.city;
          displayName = match.city;
        } else {
          // Accept any city name if no match (just normalize case)
          matchedValue = inputText;
          displayName = inputText;
        }
        break;
      }
      case "currency": {
        const match = matchCurrency(inputText);
        if (match) {
          matchedValue = match.code;
          displayName = `${match.name} (${match.code})`;
        }
        break;
      }
    }

    if (matchedValue && displayName) {
      // Send the matched value
      send(userId, { type: "METADATA_TEXT", text: matchedValue });

      const updatedMeta = ctx(userId).pendingGroupMetadata;
      const isLastStep = step === "currency";

      if (isLastStep) {
        await context.send(`${displayName}`);
        // Save metadata and finish
        await finishMetadataCollection(context, userId);

        // Check if there are more groups in queue
        const updatedCtx = ctx(userId);
        if (updatedCtx.metadataQueue && updatedCtx.metadataQueue.groups.length > 0) {
          // Start next group
          const nextGroup = updatedCtx.metadataQueue.groups[0]!;
          const prefilled = parseGroupTitle(nextGroup.groupTitle);
          send(userId, {
            type: "START_METADATA_COLLECTION",
            groupId: nextGroup.groupId,
            groupTitle: nextGroup.groupTitle,
            prefilled,
          });

          await askNextMetadataQuestion(context, userId);
        } else {
          await showAddGroupPrompt(context, userId);
        }
      } else {
        await context.send(`${displayName}`);
        // Ask next question
        await askNextMetadataQuestion(context, userId);
      }
    } else {
      // No match found
      let hint = "";
      switch (step) {
        case "country":
          hint = "Не могу распознать страну. Попробуй написать по-другому (например: Сербия, Serbia, RS)";
          break;
        case "currency":
          hint = "Не могу распознать валюту. Попробуй написать код (EUR, RSD) или название (евро, динар)";
          break;
      }
      await context.send(hint, { reply_markup: metadataSkipKeyboard() });
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
      await context.send("Нужно указать хотя бы одно слово.");
      return;
    }

    const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
    if (!sub) {
      send(userId, { type: "CANCEL" });
      await context.send("Подписка не найдена.");
      return;
    }

    const combined = [...sub.positive_keywords, ...newKeywords];
    const unique = [...new Set(combined)];
    queries.updatePositiveKeywords(c.editingSubscriptionId, userId, unique);
    invalidateSubscriptionsCache();

    send(userId, { type: "CANCEL" });
    await context.send(`✅ Добавлено: ${newKeywords.join(", ")}\nТекущие: ${unique.join(", ")}`);
    return;
  }

  // Handle editing existing subscription negative keywords
  if (currentState === "editingSubNegative" && c.editingSubscriptionId) {
    const newKeywords = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (newKeywords.length === 0) {
      await context.send("Нужно указать хотя бы одно слово.");
      return;
    }

    const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
    if (!sub) {
      send(userId, { type: "CANCEL" });
      await context.send("Подписка не найдена.");
      return;
    }

    const combined = [...sub.negative_keywords, ...newKeywords];
    const unique = [...new Set(combined)];
    queries.updateNegativeKeywords(c.editingSubscriptionId, userId, unique);
    invalidateSubscriptionsCache();

    send(userId, { type: "CANCEL" });
    await context.send(`✅ Добавлено: ${newKeywords.join(", ")}\nТекущие: ${unique.join(", ")}`);
    return;
  }

  // Handle editing existing subscription description
  if (currentState === "editingSubDescription" && c.editingSubscriptionId) {
    if (text.length < 5) {
      await context.send("Описание слишком короткое.");
      return;
    }

    queries.updateLlmDescription(c.editingSubscriptionId, userId, text);
    send(userId, { type: "TEXT_DESCRIPTION", text });
    await context.send("✅ Описание обновлено");
    return;
  }

  // Handle adding positive keywords
  if (currentState === "addingPositive") {
    const newKeywords = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (newKeywords.length === 0) {
      await context.send("Нужно указать хотя бы одно слово.");
      return;
    }

    // Pending subscription (during confirmation)
    if (c.pendingSub) {
      const combined = [...c.pendingSub.positiveKeywords, ...newKeywords];
      const unique = [...new Set(combined)];
      const queryId = `${userId}_${Date.now()}`;

      send(userId, { type: "TEXT_KEYWORDS", keywords: newKeywords });
      await context.send(
        format`✅ Добавлено: ${newKeywords.join(", ")}

${bold("Позитивные:")}
${code(unique.join(", "))}

${bold("Негативные:")}
${code(c.pendingSub.negativeKeywords.join(", ") || "нет")}
        `,
        { reply_markup: confirmKeyboard(queryId) }
      );
      return;
    }

    // Existing subscription
    if (c.editingSubscriptionId) {
      const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
      if (!sub) {
        send(userId, { type: "CANCEL" });
        await context.send("Подписка не найдена.");
        return;
      }

      const combined = [...sub.positive_keywords, ...newKeywords];
      const unique = [...new Set(combined)];
      queries.updatePositiveKeywords(c.editingSubscriptionId, userId, unique);
      invalidateSubscriptionsCache();

      send(userId, { type: "CANCEL" });
      await context.send(`✅ Добавлено: ${newKeywords.join(", ")}\nТекущие: ${unique.join(", ")}`);
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
      await context.send("Нужно указать хотя бы одно слово.");
      return;
    }

    // Pending subscription (during confirmation)
    if (c.pendingSub) {
      const combined = [...c.pendingSub.negativeKeywords, ...newKeywords];
      const unique = [...new Set(combined)];
      const queryId = `${userId}_${Date.now()}`;

      send(userId, { type: "TEXT_KEYWORDS", keywords: newKeywords });
      await context.send(
        format`✅ Добавлено: ${newKeywords.join(", ")}

${bold("Позитивные:")}
${code(c.pendingSub.positiveKeywords.join(", "))}

${bold("Негативные:")}
${code(unique.join(", "))}
        `,
        { reply_markup: confirmKeyboard(queryId) }
      );
      return;
    }

    // Existing subscription
    if (c.editingSubscriptionId) {
      const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
      if (!sub) {
        send(userId, { type: "CANCEL" });
        await context.send("Подписка не найдена.");
        return;
      }

      const combined = [...sub.negative_keywords, ...newKeywords];
      const unique = [...new Set(combined)];
      queries.updateNegativeKeywords(c.editingSubscriptionId, userId, unique);
      invalidateSubscriptionsCache();

      send(userId, { type: "CANCEL" });
      await context.send(`✅ Добавлено: ${newKeywords.join(", ")}\nТекущие: ${unique.join(", ")}`);
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
      await context.send("Отправь номера слов через запятую (например: 1, 3)");
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
        await context.send("Неверные номера.");
        return;
      }

      if (type === "positive" && keywords.length === 0) {
        await context.send("Нельзя удалить все позитивные слова.");
        return;
      }

      const queryId = `${userId}_${Date.now()}`;

      // Send REMOVE_KEYWORD for each removed index (in reverse order)
      for (const idx of sortedIndices) {
        send(userId, { type: "REMOVE_KEYWORD", index: idx });
      }

      const updatedC = ctx(userId);
      await context.send(
        format`✅ Удалено: ${removed.join(", ")}

${bold("Позитивные:")}
${code(updatedC.pendingSub?.positiveKeywords.join(", ") || "")}

${bold("Негативные:")}
${code(updatedC.pendingSub?.negativeKeywords.join(", ") || "нет")}
        `,
        { reply_markup: confirmKeyboard(queryId) }
      );
      return;
    }

    // Existing subscription
    if (c.editingSubscriptionId) {
      const sub = queries.getSubscriptionById(c.editingSubscriptionId, userId);
      if (!sub) {
        send(userId, { type: "CANCEL" });
        await context.send("Подписка не найдена.");
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
        await context.send("Неверные номера.");
        return;
      }

      if (type === "positive" && keywords.length === 0) {
        await context.send("Нельзя удалить все позитивные слова.");
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
        `✅ Удалено: ${removed.join(", ")}` + (keywords.length > 0 ? `\nОсталось: ${keywords.join(", ")}` : "")
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

    await context.send("Корректирую (может занять до минуты)...");

    try {
      const result = await runWithRecovery(
        userId,
        "AI_EDIT",
        undefined, // MessageContext.send() doesn't return message_id
        () => interpretEditCommand(text, currentSnake, conversation)
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
      if (addedPos.length) diffText += `+ Добавлено: ${addedPos.join(", ")}\n`;
      if (removedPos.length) diffText += `- Удалено: ${removedPos.join(", ")}\n`;
      if (addedNeg.length) diffText += `+ Исключения: ${addedNeg.join(", ")}\n`;
      if (removedNeg.length) diffText += `- Из исключений: ${removedNeg.join(", ")}\n`;
      if (currentSnake.llm_description !== result.llm_description) {
        diffText += `Описание: ${result.llm_description}\n`;
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
        format`${bold("Изменения:")}
${diffText || "Без изменений"}
${bold("ИИ:")} ${result.summary}

${bold("Примеры сообщений:")}
${examplesText}
Можешь продолжить редактирование или применить:`,
        {
          reply_markup: aiEditKeyboard(subscriptionId),
        }
      );
    } catch (error) {
      botLog.error({ err: error, userId }, "AI edit interpretation failed");
      await context.send("Ошибка обработки. Попробуй переформулировать.");
    }
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

    await context.send("Корректирую (может занять до минуты)...");

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
          format`${bold("Новое описание:")}
${descResult.description}

${bold("ИИ:")} ${descResult.summary}

Ключевые слова будут перегенерированы автоматически.
Можешь продолжить уточнение или применить:`,
          {
            reply_markup: pendingAiEditKeyboard(),
          }
        );
      } else {
        // Advanced mode: full control over keywords
        const result = await runWithRecovery(
          userId,
          "AI_CORRECT",
          undefined,
          () => interpretEditCommand(text, currentSnake, conversation)
        );

        // Format diff
        const addedPos = result.positive_keywords.filter((k: string) => !currentSnake.positive_keywords.includes(k));
        const removedPos = currentSnake.positive_keywords.filter((k: string) => !result.positive_keywords.includes(k));
        const addedNeg = result.negative_keywords.filter((k: string) => !currentSnake.negative_keywords.includes(k));
        const removedNeg = currentSnake.negative_keywords.filter((k: string) => !result.negative_keywords.includes(k));

        let diffText = "";
        if (addedPos.length) diffText += `+ Добавлено: ${addedPos.join(", ")}\n`;
        if (removedPos.length) diffText += `- Удалено: ${removedPos.join(", ")}\n`;
        if (addedNeg.length) diffText += `+ Исключения: ${addedNeg.join(", ")}\n`;
        if (removedNeg.length) diffText += `- Из исключений: ${removedNeg.join(", ")}\n`;
        if (currentSnake.llm_description !== result.llm_description) {
          diffText += `Описание: ${result.llm_description}\n`;
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
          format`${bold("Изменения:")}
${diffText || "Без изменений"}
${bold("ИИ:")} ${result.summary}

Можешь продолжить редактирование или применить:`,
          {
            reply_markup: pendingAiEditKeyboard(),
          }
        );
      }
    } catch (error) {
      botLog.error({ err: error, userId }, "AI correction for pending failed");
      await context.send("Ошибка обработки. Попробуй переформулировать.");
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
      await context.send(format`${bold("Уточняющий вопрос")} ${questionNumber}\n\n${nextQuestion}`, {
        reply_markup: skipQuestionKeyboard(),
      });
    } else {
      // All questions answered — start rating flow (semantic search by query)
      await context.send("Анализирую ответы...");
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
      "Сначала нужно добавить хотя бы одну группу для мониторинга.\n\nВыбери группу:",
      { reply_markup: groupPickerKeyboard(nextRequestId()) }
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

  let data: { action: string; id?: string | number; type?: string; idx?: number; msgId?: number; grpId?: number; kw?: string };
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
    };
  } catch {
    return;
  }

  const c = ctx(userId);
  const currentState = fsmState(userId);

  switch (data.action) {
    case "confirm": {
      if (currentState !== "awaitingConfirmation" || !c.pendingSub) {
        await context.answer({ text: "Сессия истекла. Отправь новый запрос." });
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
        await context.answer({ text: "Подписка создана" });
        await context.editText(
          "Подписка создана!\n\nУ тебя нет добавленных групп. Используй /addgroup для добавления."
        );
        return;
      }

      // Move to group selection
      const groups = userGroups.map((g) => ({ id: g.id, title: g.title }));
      send(userId, { type: "START_GROUP_SELECTION", available: groups });

      await context.answer({ text: "Выбери группы" });
      await context.editText(
        format`
${bold("Выбери группы для мониторинга:")}

Выбрано: 0 из ${groups.length}
        `,
        {
          reply_markup: groupsKeyboard(groups, new Set()),
        }
      );
      break;
    }

    case "edit": {
      // Legacy - redirect to positive keywords submenu
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }
      await context.answer({ text: "Выбери действие" });
      await context.editText(
        `Позитивные слова: ${c.pendingSub.positiveKeywords.join(", ")}\n\nЧто сделать?`,
        { reply_markup: keywordEditSubmenuPending("positive") }
      );
      break;
    }

    // Pending subscription: show submenu for positive keywords
    case "edit_positive_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }
      await context.answer({ text: "Выбери действие" });
      await context.editText(
        `Позитивные слова: ${c.pendingSub.positiveKeywords.join(", ")}\n\nЧто сделать?`,
        { reply_markup: keywordEditSubmenuPending("positive") }
      );
      break;
    }

    // Pending subscription: show submenu for negative keywords
    case "edit_negative_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }
      await context.answer({ text: "Выбери действие" });
      await context.editText(
        `Негативные слова: ${c.pendingSub.negativeKeywords.join(", ") || "нет"}\n\nЧто сделать?`,
        { reply_markup: keywordEditSubmenuPending("negative") }
      );
      break;
    }

    // Pending: add positive keywords
    case "add_positive_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }
      send(userId, { type: "ADD_POSITIVE" });
      await context.answer({ text: "Отправь слова" });
      await context.editText(
        `Текущие: ${c.pendingSub.positiveKeywords.join(", ")}\n\nОтправь слова для добавления через запятую:`
      );
      break;
    }

    // Pending: add negative keywords
    case "add_negative_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }
      send(userId, { type: "ADD_NEGATIVE" });
      await context.answer({ text: "Отправь слова" });
      await context.editText(
        `Текущие: ${c.pendingSub.negativeKeywords.join(", ") || "нет"}\n\nОтправь слова для добавления через запятую:`
      );
      break;
    }

    // Pending: remove positive keywords (show UI)
    case "remove_positive_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }
      const keywords = c.pendingSub.positiveKeywords;
      if (keywords.length === 0) {
        await context.answer({ text: "Нет слов для удаления" });
        return;
      }
      send(userId, { type: "REMOVE_POSITIVE" });
      const list = keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
      await context.answer({ text: "Выбери слова" });
      await context.editText(
        `Позитивные слова:\n${list}\n\nНажми на слово или отправь номера через запятую:`,
        { reply_markup: removeKeywordsKeyboard(keywords, "positive", null) }
      );
      break;
    }

    // Pending: remove negative keywords (show UI)
    case "remove_negative_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }
      const keywords = c.pendingSub.negativeKeywords;
      if (keywords.length === 0) {
        await context.answer({ text: "Нет слов для удаления" });
        return;
      }
      send(userId, { type: "REMOVE_NEGATIVE" });
      const list = keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
      await context.answer({ text: "Выбери слова" });
      await context.editText(
        `Негативные слова:\n${list}\n\nНажми на слово или отправь номера через запятую:`,
        { reply_markup: removeKeywordsKeyboard(keywords, "negative", null) }
      );
      break;
    }

    // Pending: remove keyword by clicking button
    case "rm_kw_pending": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
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
        await context.answer({ text: "Слово не найдено" });
        return;
      }

      keywords.splice(idx, 1);

      if (type === "positive" && keywords.length === 0) {
        await context.answer({ text: "Нельзя удалить последнее слово" });
        return;
      }

      // Remove keyword via FSM event
      send(userId, { type: "REMOVE_KEYWORD", index: idx });

      await context.answer({ text: `Удалено: ${removed}` });

      // Re-read context after FSM update
      const updatedC = ctx(userId);

      if (keywords.length === 0) {
        // No more keywords, go back to confirm
        const queryId = `${userId}_${Date.now()}`;
        send(userId, { type: "BACK_TO_CONFIRM" });
        await context.editText(
          format`
${bold("Ключевые слова:")}

${bold("Позитивные:")}
${code(updatedC.pendingSub?.positiveKeywords.join(", ") ?? "")}

${bold("Негативные:")}
${code(updatedC.pendingSub?.negativeKeywords.join(", ") || "нет")}

${bold("Описание для LLM:")}
${updatedC.pendingSub?.llmDescription ?? ""}
          `,
          { reply_markup: confirmKeyboard(queryId) }
        );
      } else {
        const list = keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
        const label = type === "positive" ? "Позитивные" : "Негативные";
        await context.editText(
          `${label} слова:\n${list}\n\nНажми на слово или отправь номера через запятую:`,
          { reply_markup: removeKeywordsKeyboard(keywords, type, null) }
        );
      }
      break;
    }

    // Pending: back to confirmation screen
    case "back_to_confirm": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }
      const queryId = `${userId}_${Date.now()}`;
      send(userId, { type: "BACK_TO_CONFIRM" });
      await context.answer({ text: "OK" });
      await context.editText(
        format`
${bold("Ключевые слова:")}

${bold("Позитивные:")}
${code(c.pendingSub.positiveKeywords.join(", "))}

${bold("Негативные:")}
${code(c.pendingSub.negativeKeywords.join(", ") || "нет")}

${bold("Описание для LLM:")}
${c.pendingSub.llmDescription}
        `,
        { reply_markup: confirmKeyboard(queryId) }
      );
      break;
    }

    case "cancel": {
      send(userId, { type: "CANCEL" });
      await context.answer({ text: "Отменено" });
      await context.editText("Отменено. Отправь новый запрос когда будешь готов.");
      break;
    }

    case "skip_question": {
      if (currentState !== "clarifyingQuery" || !c.clarification) {
        await context.answer({ text: "Сессия истекла" });
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
        await context.answer({ text: "Пропущено" });
        await context.editText(format`${bold("Уточняющий вопрос")} ${questionNumber}\n\n${nextQuestion}`, {
          reply_markup: skipQuestionKeyboard(),
        });
      } else {
        // All questions done — start rating flow (semantic search by query)
        await context.answer({ text: "Генерирую..." });
        await context.editText("Анализирую ответы...");
        const clarificationContext = formatClarificationContext(questions, answers);

        await startRatingFlow(context, userId, originalQuery, clarificationContext);
      }
      break;
    }

    case "disable": {
      const subscriptionId = Number(data.id);
      queries.deactivateSubscription(subscriptionId, userId);
      invalidateSubscriptionsCache();
      await context.answer({ text: "Подписка отключена" });
      await context.editText("Подписка отключена.");
      break;
    }

    case "edit_positive": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      send(userId, { type: "CANCEL" }); // Reset to idle
      await context.answer({ text: "Выбери действие" });
      await context.editText(
        `Позитивные слова: ${sub.positive_keywords.join(", ")}\n\nЧто сделать?`,
        { reply_markup: keywordEditSubmenu("positive", subscriptionId) }
      );
      break;
    }

    case "edit_negative": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      send(userId, { type: "CANCEL" }); // Reset to idle
      await context.answer({ text: "Выбери действие" });
      await context.editText(
        `Негативные слова: ${sub.negative_keywords.join(", ") || "нет"}\n\nЧто сделать?`,
        { reply_markup: keywordEditSubmenu("negative", subscriptionId) }
      );
      break;
    }

    case "edit_description": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      send(userId, { type: "EDIT_SUB_DESCRIPTION", subscriptionId });
      await context.answer({ text: "Отправь новое описание" });
      await context.send(
        `Текущее описание:\n${sub.llm_description}\n\n` +
          "Отправь новое описание для LLM верификации:"
      );
      break;
    }

    case "toggle_negative": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      const hasNeg = sub.negative_keywords.length > 0;
      queries.toggleNegativeKeywords(subscriptionId, userId, !hasNeg);
      invalidateSubscriptionsCache();

      // Refresh subscription data
      const updated = queries.getSubscriptionById(subscriptionId, userId)!;
      const newHasNeg = updated.negative_keywords.length > 0;
      const newHasDisabled = (updated.disabled_negative_keywords?.length ?? 0) > 0;

      let exclusionsText = "нет";
      if (newHasNeg) {
        exclusionsText = updated.negative_keywords.join(", ");
      } else if (newHasDisabled) {
        exclusionsText = `(отключены: ${updated.disabled_negative_keywords!.join(", ")})`;
      }

      await context.answer({
        text: hasNeg ? "Исключения отключены" : "Исключения включены",
      });
      await context.editText(
        format`
${bold("Подписка #" + updated.id)}
${bold("Запрос:")} ${updated.original_query}
${bold("Ключевые слова:")} ${code(updated.positive_keywords.join(", "))}
${bold("Исключения:")} ${code(exclusionsText)}
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
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      await context.answer({ text: "Генерирую..." });

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
        await context.send("Ошибка генерации. Попробуй позже.");
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
${bold("Перегенерированные ключевые слова:")}

${bold("Позитивные:")}
${code(result.positive_keywords.join(", "))}

${bold("Негативные:")}
${code(result.negative_keywords.join(", ") || "нет")}

${bold("Описание:")}
${result.llm_description}

Подтверди или измени:
        `,
        {
          reply_markup: confirmKeyboard(queryId),
        }
      );
      break;
    }

    case "regenerate_sub": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: "Подписка не найдена" });
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

      await context.answer({ text: "Режим редактирования" });

      // Show current params and instructions
      const posPreview = sub.positive_keywords.slice(0, 10).join(", ");
      const posMore = sub.positive_keywords.length > 10 ? ` (+${sub.positive_keywords.length - 10})` : "";

      await context.editText(
        format`${bold("Режим ИИ-редактирования")}

${bold("Текущие параметры:")}
${bold("+ слова:")} ${code(posPreview + posMore)}
${bold("- слова:")} ${code(sub.negative_keywords.join(", ") || "нет")}
${bold("Описание:")} ${sub.llm_description}

Напиши что изменить, например:
• "добавь слово аренда"
• "убери слово продажа"
• "добавь в исключения офис"
• "измени описание на ..."`,
        {
          reply_markup: aiEditKeyboard(subscriptionId),
        }
      );
      break;
    }

    case "apply_ai_edit": {
      if (currentState !== "editingSubAi" || !c.pendingAiEdit?.proposed) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const { subscriptionId, proposed } = c.pendingAiEdit;

      // Apply changes
      queries.updatePositiveKeywords(subscriptionId, userId, proposed.positiveKeywords);
      queries.updateNegativeKeywords(subscriptionId, userId, proposed.negativeKeywords);
      queries.updateLlmDescription(subscriptionId, userId, proposed.llmDescription);
      invalidateSubscriptionsCache();

      send(userId, { type: "APPLY_AI_EDIT" });

      await context.answer({ text: "Применено!" });
      await context.editText("✅ Изменения применены.");
      break;
    }

    case "cancel_ai_edit": {
      send(userId, { type: "CANCEL" });
      await context.answer({ text: "Отменено" });
      await context.editText("Редактирование отменено.");
      break;
    }

    case "correct_pending": {
      // Enter AI correction mode for pending subscription
      if (currentState !== "awaitingConfirmation" || !c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
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

      await context.answer({ text: "Режим коррекции" });

      if (userMode === "normal") {
        // Normal mode: only description, keywords will be regenerated
        await context.editText(
          format`${bold("Уточнение запроса")}

${bold("Текущее описание:")}
${pending.llmDescription}

Опиши что ты хочешь найти точнее:
• "ищу только новые, не б/у"
• "не нужны услуги, только товары"
• "добавь что нужна доставка"`,
          {
            reply_markup: pendingAiCorrectionStartKeyboard(),
          }
        );
      } else {
        // Advanced mode: full control over keywords
        const posPreview = pending.positiveKeywords.slice(0, 10).join(", ");
        const posMore = pending.positiveKeywords.length > 10 ? ` (+${pending.positiveKeywords.length - 10})` : "";

        await context.editText(
          format`${bold("Режим ИИ-коррекции")}

${bold("Текущие параметры:")}
${bold("+ слова:")} ${code(posPreview + posMore)}
${bold("- слова:")} ${code(pending.negativeKeywords.join(", ") || "нет")}
${bold("Описание:")} ${pending.llmDescription}

Напиши что изменить, например:
• "убери размеры и бренды"
• "добавь слово аренда"
• "добавь в исключения ремонт"`,
          {
            reply_markup: pendingAiCorrectionStartKeyboard(),
          }
        );
      }
      break;
    }

    case "apply_pending_ai": {
      if (currentState !== "correctingPendingAi" || !c.pendingAiCorrection?.proposed) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const { proposed } = c.pendingAiCorrection;
      const queryId = `${userId}_${Date.now()}`;

      // Apply correction via FSM
      send(userId, { type: "APPLY_AI_CORRECTION" });

      await context.answer({ text: "Применено!" });

      const mode = queries.getUserMode(userId);

      if (mode === "advanced") {
        await context.editText(
          format`
${bold("Скорректированные ключевые слова:")}

${bold("Позитивные:")}
${code(proposed.positiveKeywords.join(", "))}

${bold("Негативные:")}
${code(proposed.negativeKeywords.join(", ") || "нет")}

${bold("Описание:")}
${proposed.llmDescription}

Подтверди или измени:
          `,
          { reply_markup: confirmKeyboard(queryId) }
        );
      } else {
        await context.editText("Подтверди или измени:", {
          reply_markup: confirmKeyboard(queryId),
        });
      }
      break;
    }

    case "cancel_pending_ai": {
      if (!c.pendingSub) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const pending = c.pendingSub;
      const queryId = `${userId}_${Date.now()}`;

      // Return to awaiting_confirmation
      send(userId, { type: "CANCEL" });

      await context.answer({ text: "Отменено" });

      await context.editText(
        format`
${bold("Ключевые слова:")}

${bold("Позитивные:")}
${code(pending.positiveKeywords.join(", "))}

${bold("Негативные:")}
${code(pending.negativeKeywords.join(", ") || "нет")}

${bold("Описание:")}
${pending.llmDescription}

Подтверди или измени:
        `,
        {
          reply_markup: confirmKeyboard(queryId),
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
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      send(userId, { type: "CANCEL" });

      let exclusionsText = "нет";
      if (sub.negative_keywords.length > 0) {
        exclusionsText = sub.negative_keywords.join(", ");
      } else if ((sub.disabled_negative_keywords?.length ?? 0) > 0) {
        exclusionsText = `(отключены: ${sub.disabled_negative_keywords!.join(", ")})`;
      }

      await context.answer({ text: "OK" });
      await context.editText(
        format`
${bold("Подписка #" + sub.id)}
${bold("Запрос:")} ${sub.original_query}
${bold("Ключевые слова:")} ${code(sub.positive_keywords.join(", "))}
${bold("Исключения:")} ${code(exclusionsText)}
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
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      send(userId, { type: "EDIT_SUB_POSITIVE", subscriptionId });
      await context.answer({ text: "Отправь слова" });
      await context.editText(
        `Текущие: ${sub.positive_keywords.join(", ")}\n\nОтправь слова для добавления через запятую:`
      );
      break;
    }

    // Add negative keywords to existing subscription
    case "add_negative": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      send(userId, { type: "EDIT_SUB_NEGATIVE", subscriptionId });
      await context.answer({ text: "Отправь слова" });
      await context.editText(
        `Текущие: ${sub.negative_keywords.join(", ") || "нет"}\n\nОтправь слова для добавления через запятую:`
      );
      break;
    }

    // Show remove keywords UI for existing subscription
    case "remove_positive": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      if (sub.positive_keywords.length === 0) {
        await context.answer({ text: "Нет слов для удаления" });
        return;
      }

      send(userId, { type: "EDIT_SUB_POSITIVE", subscriptionId });

      const list = sub.positive_keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
      await context.answer({ text: "Выбери слова" });
      await context.editText(
        `Позитивные слова:\n${list}\n\nНажми на слово или отправь номера через запятую:`,
        { reply_markup: removeKeywordsKeyboard(sub.positive_keywords, "positive", subscriptionId) }
      );
      break;
    }

    // Show remove keywords UI for existing subscription (negative)
    case "remove_negative": {
      const subscriptionId = Number(data.id);
      const sub = queries.getSubscriptionById(subscriptionId, userId);
      if (!sub) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      if (sub.negative_keywords.length === 0) {
        await context.answer({ text: "Нет слов для удаления" });
        return;
      }

      send(userId, { type: "EDIT_SUB_NEGATIVE", subscriptionId });

      const list = sub.negative_keywords.map((k, i) => `${i + 1}. ${k}`).join("\n");
      await context.answer({ text: "Выбери слова" });
      await context.editText(
        `Негативные слова:\n${list}\n\nНажми на слово или отправь номера через запятую:`,
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
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      const keywords = type === "positive" ? [...sub.positive_keywords] : [...sub.negative_keywords];
      const removed = keywords[idx];
      if (!removed) {
        await context.answer({ text: "Слово не найдено" });
        return;
      }

      keywords.splice(idx, 1);

      if (type === "positive") {
        if (keywords.length === 0) {
          await context.answer({ text: "Нельзя удалить последнее слово" });
          return;
        }
        queries.updatePositiveKeywords(subscriptionId, userId, keywords);
      } else {
        queries.updateNegativeKeywords(subscriptionId, userId, keywords);
      }
      invalidateSubscriptionsCache();

      await context.answer({ text: `Удалено: ${removed}` });

      if (keywords.length === 0) {
        // No more keywords to remove, go back to subscription
        const updated = queries.getSubscriptionById(subscriptionId, userId)!;
        let exclusionsText = "нет";
        if (updated.negative_keywords.length > 0) {
          exclusionsText = updated.negative_keywords.join(", ");
        }
        await context.editText(
          format`
${bold("Подписка #" + updated.id)}
${bold("Запрос:")} ${updated.original_query}
${bold("Ключевые слова:")} ${code(updated.positive_keywords.join(", "))}
${bold("Исключения:")} ${code(exclusionsText)}
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
        const label = type === "positive" ? "Позитивные" : "Негативные";
        await context.editText(
          `${label} слова:\n${list}\n\nНажми на слово или отправь номера через запятую:`,
          { reply_markup: removeKeywordsKeyboard(keywords, type, subscriptionId) }
        );
      }
      break;
    }

    case "skip_invite_link": {
      if (currentState !== "awaitingInviteLink") {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      // Skip - go back to adding_group
      send(userId, { type: "SKIP_INVITE" });
      await context.answer({ text: "Пропущено" });
      await context.editText("Группа пропущена.");
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
        await context.answer({ text: "Сессия истекла" });
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
      await context.answer({ text: isSelected ? "Выбрано" : "Снято" });
      await context.editText(
        format`
${bold("Выбери группы для мониторинга:")}

Выбрано: ${updatedC.selectedGroups.length} из ${updatedC.availableGroups.length}
        `,
        {
          reply_markup: groupsKeyboard(updatedC.availableGroups, selectedIds),
        }
      );
      break;
    }

    case "select_all_groups": {
      if (currentState !== "selectingGroups" || c.availableGroups.length === 0) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      send(userId, { type: "SELECT_ALL" });

      const updatedC = ctx(userId);
      const selectedIds = new Set(updatedC.availableGroups.map((g) => g.id));
      await context.answer({ text: "Выбраны все" });
      await context.editText(
        format`
${bold("Выбери группы для мониторинга:")}

Выбрано: ${updatedC.availableGroups.length} из ${updatedC.availableGroups.length}
        `,
        {
          reply_markup: groupsKeyboard(updatedC.availableGroups, selectedIds),
        }
      );
      break;
    }

    case "deselect_all_groups": {
      if (currentState !== "selectingGroups" || c.availableGroups.length === 0) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      send(userId, { type: "DESELECT_ALL" });

      await context.answer({ text: "Сняты все" });
      await context.editText(
        format`
${bold("Выбери группы для мониторинга:")}

Выбрано: 0 из ${c.availableGroups.length}
        `,
        {
          reply_markup: groupsKeyboard(c.availableGroups, new Set()),
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
        await context.answer({ text: "Сессия истекла. Отправь новый запрос." });
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
            msg.text,
            originalQuery,
            msg.id,
            msg.groupId,
            dbMsg.sender_name ?? undefined,
            dbMsg.sender_username ?? undefined,
            undefined, // no media for cached examples
            "🔥 Ты отметил как релевантный"
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

      await context.answer({ text: "Подписка создана!" });

      if (selectedGroups.length > 0) {
        const groupNames = selectedGroups.map((g) => g.title).join(", ");
        await context.editText(
          `Подписка создана! Мониторинг групп: ${groupNames}\n\n⏳ Сканирую историю сообщений...`
        );

        // Scan cache in background
        const groupIds = selectedGroups.map((g) => g.id);
        scanFromCache(groupIds, subscriptionId, { limit: 5, offset: 0, notify: true })
          .then((result) => {
            botLog.info({ total: result.total, subscriptionId }, "Cache scan complete");
            let resultText: string;
            if (result.total > 0) {
              resultText = `✅ Подписка создана! Мониторинг групп: ${groupNames}\n\n📬 Найдено ${messages(result.total)} в истории.`;
              if (result.total > 5) {
                resultText += `\n\n📤 Отправлено первые 5 из ${result.total}. Остальные появятся в ленте при новых совпадениях.`;
              }
            } else {
              resultText = `✅ Подписка создана! Мониторинг групп: ${groupNames}\n\n📭 В истории совпадений не найдено.`;
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
                `✅ Подписка создана! Мониторинг групп: ${groupNames}\n\n⚠️ Ошибка сканирования истории.`
              )
              .catch(() => {});
          });
      } else {
        await context.editText(
          "Подписка создана! Группы не выбраны, мониторинг будет по всем доступным."
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
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const { messages, currentIndex } = c.ratingExamples;
      const currentExample = messages[currentIndex];
      if (!currentExample) {
        await context.answer({ text: "Ошибка" });
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
      await context.answer({ text: `${ratingEmoji} Записано` });

      // Send rating via FSM event
      send(userId, { type: "RATE", messageId: currentExample.id, rating });

      const nextIndex = currentIndex + 1;

      if (nextIndex < messages.length) {
        // Show next example
        await context.editText("Переходим к следующему...");
        await showExampleForRating(
          context,
          userId,
          messages[nextIndex]!,
          nextIndex,
          messages.length
        );
      } else {
        // All examples rated, generate final keywords
        await context.editText("Все примеры оценены!");
        await finishRatingAndGenerateKeywords(context, userId);
      }
      break;
    }

    case "skip_rating": {
      if (currentState !== "ratingExamples" || !c.ratingExamples) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      send(userId, { type: "SKIP_RATING" });
      await context.answer({ text: "Пропускаем..." });
      await context.editText("Примеры пропущены.");
      await finishRatingAndGenerateKeywords(context, userId);
      break;
    }

    // =====================================================
    // Settings handlers
    // =====================================================

    case "set_mode_normal": {
      queries.setUserMode(userId, "normal");
      await context.answer({ text: "Режим изменён" });
      await context.editText(
        format`${bold("Настройки")}

${bold("Текущий режим:")} 📊 Обычный

В обычном режиме бот не показывает ключевые слова и не задаёт уточняющих вопросов.`,
        {
          reply_markup: settingsKeyboard("normal"),
        }
      );
      break;
    }

    case "set_mode_advanced": {
      queries.setUserMode(userId, "advanced");
      await context.answer({ text: "Режим изменён" });
      await context.editText(
        format`${bold("Настройки")}

${bold("Текущий режим:")} 🔬 Продвинутый

В продвинутом режиме ты видишь ключевые слова, можешь их редактировать и отвечаешь на уточняющие вопросы.`,
        {
          reply_markup: settingsKeyboard("advanced"),
        }
      );
      break;
    }

    case "noop": {
      // Do nothing (already selected option)
      await context.answer({ text: "Уже выбрано" });
      break;
    }

    // Forward analysis actions
    case "analyze_forward": {
      // Get forwarded message from reply_to_message
      const replyMsg = context.message?.replyMessage;
      if (!replyMsg) {
        await context.answer({ text: "Не найдено исходное сообщение" });
        return;
      }

      const messageText = replyMsg.text || replyMsg.caption || "";
      if (!messageText) {
        await context.answer({ text: "Сообщение не содержит текста" });
        return;
      }

      // Extract forward info from the replied message
      const forwardInfo = extractForwardInfo(replyMsg as import("gramio").Message);

      await context.answer({ text: "Анализирую..." });

      const userSubs = queries.getUserSubscriptions(userId);
      if (userSubs.length === 0) {
        await context.editText("У тебя нет активных подписок для анализа.");
        return;
      }

      // Analyze against all subscriptions
      const results = await analyzeForwardedMessage(
        userId,
        forwardInfo || { messageId: null },
        messageText
      );

      if (results.length === 0) {
        await context.editText("Нет подписок для анализа этого сообщения.");
        return;
      }

      // Edit original message to remove button
      await context.editText("Результаты анализа:");

      // Send each result as separate message
      for (const { analysis } of results) {
        const text = formatAnalysisResult(analysis);
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
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      const subscription = queries.getSubscriptionById(subscriptionId, userId);
      if (!subscription) {
        await context.answer({ text: "Подписка не найдена" });
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
        await context.answer({ text: "Текст сообщения не найден" });
        return;
      }

      await context.answer({ text: "Расширяю критерии..." });
      await editCallbackMessage(context, "⏳ Извлекаю ключевые слова и обновляю подписку...");

      try {
        // Generate keywords from the message text
        const { extractKeywordsFromText } = await import("../llm/keywords.ts");
        const newKeywords = await extractKeywordsFromText(messageText);

        if (newKeywords.length === 0) {
          await editCallbackMessage(context, "Не удалось извлечь ключевые слова из сообщения.");
          return;
        }

        // Merge with existing keywords
        const combined = [...new Set([...subscription.positive_keywords, ...newKeywords])];
        queries.updatePositiveKeywords(subscriptionId, userId, combined);

        // Regenerate embeddings in background
        regenerateEmbeddings(subscriptionId);

        await editCallbackMessage(
          context,
          `✅ Критерии расширены!\n\nДобавлены слова: ${newKeywords.join(", ")}`
        );
      } catch (e) {
        botLog.error({ err: e, subscriptionId }, "Failed to expand criteria");
        await editCallbackMessage(context, "Ошибка при расширении критериев. Попробуй позже.");
      }
      break;
    }

    case "ai_fwd":
    case "ai_correct_forward": {
      const subscriptionId = data.id as number;

      if (!subscriptionId) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      const subscription = queries.getSubscriptionById(subscriptionId, userId);
      if (!subscription) {
        await context.answer({ text: "Подписка не найдена" });
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
      await context.answer({ text: "Корректировка с ИИ" });
      await context.editText(
        `Опиши, как изменить критерии поиска для подписки "${subscription.original_query}".\n\n` +
          `Например: «добавь слова про скидки» или «убери слишком строгие фильтры»`,
        { reply_markup: aiEditKeyboard(subscriptionId) }
      );
      break;
    }

    case "rm_neg": {
      const subscriptionId = data.id as number;
      const keyword = data.kw;

      if (!subscriptionId || !keyword) {
        await context.answer({ text: "Ошибка: нет данных" });
        return;
      }

      const subscription = queries.getSubscriptionById(subscriptionId, userId);
      if (!subscription) {
        await context.answer({ text: "Подписка не найдена" });
        return;
      }

      // Remove keyword from negative_keywords
      const currentNegative = subscription.negative_keywords;
      const newNegative = currentNegative.filter(
        (kw) => kw.toLowerCase() !== keyword.toLowerCase()
      );

      if (newNegative.length === currentNegative.length) {
        await context.answer({ text: "Слово не найдено" });
        return;
      }

      queries.updateNegativeKeywords(subscriptionId, userId, newNegative);
      invalidateSubscriptionsCache();

      await context.answer({ text: "Слово удалено" });
      await editCallbackMessage(
        context,
        `✅ Слово "${keyword}" удалено из исключений.\n\n` +
          `Подписка: "${subscription.original_query}"\n` +
          `Исключающие слова: ${newNegative.length > 0 ? newNegative.join(", ") : "нет"}`
      );
      break;
    }

    case "add_group_quick": {
      const groupId = data.id as number;
      const groupTitle = (data as { title?: string }).title || "Неизвестная группа";

      await context.answer({ text: "Добавляю группу..." });
      await editCallbackMessage(context, `⏳ Добавляю группу "${groupTitle}"...`);

      try {
        // Check if userbot is member
        const isMember = await isUserbotMember(groupId);
        if (!isMember) {
          await editCallbackMessage(
            context,
            `Бот не может читать эту группу. Используй /addgroup и отправь пригласительную ссылку.`
          );
          return;
        }

        // Add group for user
        queries.addUserGroup(userId, groupId, groupTitle, false);
        await editCallbackMessage(context, `✅ Группа "${groupTitle}" добавлена в мониторинг.`);
      } catch (e) {
        botLog.error({ err: e, groupId }, "Failed to add group quick");
        await editCallbackMessage(context, "Не удалось добавить группу. Используй /addgroup.");
      }
      break;
    }

    // =====================================================
    // Group metadata collection handlers
    // =====================================================

    case "metadata_marketplace": {
      if (currentState !== "collectingGroupMetadata" || !c.pendingGroupMetadata) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const isMarketplace = (data as { value?: boolean }).value ?? false;
      send(userId, { type: "METADATA_MARKETPLACE", isMarketplace });

      await context.answer({ text: isMarketplace ? "Да" : "Нет" });

      // Ask next question (country)
      await askNextMetadataQuestion(
        { send: (text, opts) => bot.api.sendMessage({ chat_id: userId, text, ...opts }) },
        userId
      );
      break;
    }

    case "metadata_skip": {
      if (currentState !== "collectingGroupMetadata" || !c.pendingGroupMetadata) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const meta = c.pendingGroupMetadata;
      const isLastStep = meta.step === "currency";

      send(userId, { type: "METADATA_SKIP" });
      await context.answer({ text: "Пропущено" });

      if (isLastStep) {
        // Save metadata and finish
        const ctxWrapper = { send: (text: string, opts?: object) => bot.api.sendMessage({ chat_id: userId, text, ...opts }) };
        await finishMetadataCollection(ctxWrapper, userId);

        // Check if there are more groups in queue
        const updatedCtx = ctx(userId);
        if (updatedCtx.metadataQueue && updatedCtx.metadataQueue.groups.length > 0) {
          // Start next group
          const nextGroup = updatedCtx.metadataQueue.groups[0]!;
          const prefilled = parseGroupTitle(nextGroup.groupTitle);
          send(userId, {
            type: "START_METADATA_COLLECTION",
            groupId: nextGroup.groupId,
            groupTitle: nextGroup.groupTitle,
            prefilled,
          });

          await askNextMetadataQuestion(ctxWrapper, userId);
        } else {
          // No more groups, show add group prompt
          await showAddGroupPrompt(ctxWrapper, userId);
        }
      } else {
        // Ask next question
        await askNextMetadataQuestion(
          { send: (text, opts) => bot.api.sendMessage({ chat_id: userId, text, ...opts }) },
          userId
        );
      }
      break;
    }

    case "metadata_confirm": {
      if (currentState !== "collectingGroupMetadata" || !c.pendingGroupMetadata) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const value = (data as { value?: string }).value;
      if (!value) {
        await context.answer({ text: "Ошибка данных" });
        return;
      }

      const meta = c.pendingGroupMetadata;
      const isLastStep = meta.step === "currency";

      // Confirm prefilled value (sends METADATA_TEXT which advances step)
      send(userId, { type: "METADATA_TEXT", text: value });
      await context.answer({ text: "Подтверждено" });

      if (isLastStep) {
        // Save metadata and finish
        const ctxWrapper = { send: (text: string, opts?: object) => bot.api.sendMessage({ chat_id: userId, text, ...opts }) };
        await finishMetadataCollection(ctxWrapper, userId);

        // Check if there are more groups in queue
        const updatedCtx = ctx(userId);
        if (updatedCtx.metadataQueue && updatedCtx.metadataQueue.groups.length > 0) {
          // Start next group
          const nextGroup = updatedCtx.metadataQueue.groups[0]!;
          const prefilled = parseGroupTitle(nextGroup.groupTitle);
          send(userId, {
            type: "START_METADATA_COLLECTION",
            groupId: nextGroup.groupId,
            groupTitle: nextGroup.groupTitle,
            prefilled,
          });

          await askNextMetadataQuestion(ctxWrapper, userId);
        } else {
          // No more groups, show add group prompt
          await showAddGroupPrompt(ctxWrapper, userId);
        }
      } else {
        // Ask next question
        await askNextMetadataQuestion(
          { send: (text, opts) => bot.api.sendMessage({ chat_id: userId, text, ...opts }) },
          userId
        );
      }
      break;
    }

    case "metadata_change": {
      if (currentState !== "collectingGroupMetadata" || !c.pendingGroupMetadata) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      // Switch to text input mode
      send(userId, { type: "METADATA_CHANGE_PREFILLED" });
      await context.answer({ text: "Введи значение" });

      const meta = ctx(userId).pendingGroupMetadata!;
      let prompt = "";
      switch (meta.step) {
        case "country":
          prompt = "Введи страну (например: Сербия, Россия, Черногория):";
          break;
        case "city":
          prompt = "Введи город (например: Белград, Москва):";
          break;
        case "currency":
          prompt = "Введи валюту (например: динар, евро, рубль):";
          break;
      }

      await bot.api.sendMessage({
        chat_id: userId,
        text: prompt,
        reply_markup: metadataSkipKeyboard(),
      });
      break;
    }

    case "analyze": {
      // Deep analysis of matched message
      const msgId = data.msgId as number;
      const grpId = data.grpId as number;

      if (!msgId || !grpId) {
        await context.answer({ text: "Данные не найдены" });
        return;
      }

      await context.answer({ text: "Анализирую..." });
      await editCallbackMessage(context, "⏳ Анализирую объявление...\nЭто может занять 10-30 секунд.");

      try {
        // Get message text from DB
        const storedMsg = queries.getMessage(msgId, grpId);
        if (!storedMsg) {
          await editCallbackMessage(context, "Сообщение не найдено в базе данных.");
          return;
        }

        // Run deep analysis with automatic photo fetching
        const { analyzeWithMedia } = await import("../llm/deep-analyze.ts");
        const { formatDeepAnalysisHtml } = await import("./formatters.ts");

        const result = await analyzeWithMedia({
          text: storedMsg.text,
          messageId: msgId,
          groupId: grpId,
          groupTitle: storedMsg.group_title,
        });

        const resultText = formatDeepAnalysisHtml(result);
        await editCallbackMessage(context, resultText, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      } catch (error) {
        botLog.error({ err: error }, "Deep analysis failed");
        await editCallbackMessage(context, "Ошибка анализа. Попробуйте позже.");
      }
      break;
    }
  }
});

// Error handler
bot.onError(({ context, error }) => {
  botLog.error({ err: error }, "Bot error");
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
 */
function buildNotificationCaption(
  groupTitle: string,
  subscriptionQuery: string,
  messageText: string,
  senderName?: string,
  senderUsername?: string,
  reasoning?: string,
  maxLength: number = 1000 // Telegram caption limit is 1024
): string {
  let authorLine = "";
  if (senderName) {
    authorLine = senderUsername
      ? `\nАвтор: ${senderName} (@${senderUsername})`
      : `\nАвтор: ${senderName}`;
  }

  // Add reasoning line if available
  const reasonLine = reasoning ? `\n\n💡 Причина: ${reasoning}` : "";

  const prefix = `🔔 Найдено совпадение!\n\nГруппа: ${groupTitle}\n\nЗапрос: ${subscriptionQuery}${authorLine}${reasonLine}\n\nСообщение:\n`;
  const availableForText = maxLength - prefix.length - 3; // -3 for "..."
  const truncatedText = messageText.length > availableForText
    ? messageText.slice(0, availableForText) + "..."
    : messageText;

  return prefix + truncatedText;
}

/**
 * Build inline keyboard for notification
 */
function buildNotificationKeyboard(
  messageId?: number,
  groupId?: number
): { inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>> } | undefined {
  if (!messageId || !groupId) return undefined;

  const messageUrl = buildMessageLink(groupId, messageId);
  return {
    inline_keyboard: [
      [{ text: "📎 Перейти к посту", url: messageUrl }],
      [{
        text: "🔍 Анализ цены",
        callback_data: JSON.stringify({ action: "analyze", msgId: messageId, grpId: groupId }),
      }],
    ],
  };
}

/**
 * Send notification to user about matched message
 */
export async function notifyUser(
  telegramId: number,
  groupTitle: string,
  messageText: string,
  subscriptionQuery: string,
  messageId?: number,
  groupId?: number,
  senderName?: string,
  senderUsername?: string,
  media?: MediaItem[],
  reasoning?: string
): Promise<void> {
  try {
    const keyboard = buildNotificationKeyboard(messageId, groupId);

    // If we have media, send with photo/video
    if (media && media.length > 0) {
      const caption = buildNotificationCaption(
        groupTitle,
        subscriptionQuery,
        messageText,
        senderName,
        senderUsername,
        reasoning,
        1000 // Leave some room for Telegram formatting
      );

      if (media.length === 1) {
        // Single photo or video
        const item = media[0]!;
        const blob = new Blob([item.buffer], { type: item.mimeType });

        if (item.type === "photo") {
          await bot.api.sendPhoto({
            chat_id: telegramId,
            photo: blob,
            caption,
            reply_markup: keyboard,
          });
        } else {
          await bot.api.sendVideo({
            chat_id: telegramId,
            video: blob,
            caption,
            reply_markup: keyboard,
          });
        }
      } else {
        // Album (2-10 media items)
        const mediaGroup = media.slice(0, 10).map((item, i) => {
          const blob = new Blob([item.buffer], { type: item.mimeType });
          return {
            type: item.type as "photo" | "video",
            media: blob,
            caption: i === 0 ? caption : undefined,
          };
        });

        await bot.api.sendMediaGroup({
          chat_id: telegramId,
          media: mediaGroup as Parameters<typeof bot.api.sendMediaGroup>[0]["media"],
        });

        // Send keyboard separately (Telegram API limitation for media groups)
        if (keyboard) {
          await bot.api.sendMessage({
            chat_id: telegramId,
            text: "👆 Детали",
            reply_markup: keyboard,
          });
        }
      }
    } else {
      // Text-only notification
      const caption = buildNotificationCaption(
        groupTitle,
        subscriptionQuery,
        messageText,
        senderName,
        senderUsername,
        reasoning,
        4000 // Telegram message limit is 4096
      );

      await bot.api.sendMessage({
        chat_id: telegramId,
        text: caption,
        reply_markup: keyboard,
      });
    }

    botLog.debug({ userId: telegramId, groupTitle, hasMedia: !!media?.length }, "Notification sent");
  } catch (error) {
    botLog.error({ err: error, userId: telegramId }, "Failed to notify user");
  }
}
