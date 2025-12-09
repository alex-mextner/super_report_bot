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
} from "./keyboards.ts";
import { runWithRecovery } from "./operations.ts";
import { interpretEditCommand } from "../llm/edit.ts";
import { generateKeywordEmbeddings, checkBgeHealth } from "../llm/embeddings.ts";

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
import { findSimilarWithFallback, toRatingExamples } from "./similar.ts";
import {
  invalidateSubscriptionsCache,
  isUserbotMember,
  ensureUserbotInGroup,
  scanFromCache,
} from "../listener/index.ts";
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
  const sourceLabel = example.isGenerated
    ? "🤖 Сгенерированный пример"
    : `📍 ${example.groupTitle}`;

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
  draftKeywords: string[],
  clarificationContext?: string
): Promise<void> {
  // Get user's groups
  const userGroups = queries.getUserGroups(userId);
  const groupIds = userGroups.map((g) => g.id);

  // Search for similar messages in cache
  let examples: RatingExample[] = [];

  if (groupIds.length > 0) {
    const similar = findSimilarWithFallback(draftKeywords, groupIds, 3);
    examples = toRatingExamples(similar);
    botLog.debug({ userId, found: examples.length }, "Found similar messages for rating");
  }

  // If not enough examples, generate them via LLM
  if (examples.length < 3) {
    botLog.debug({ userId, existing: examples.length }, "Generating synthetic examples");
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
      })),
      ratings: [],
      currentIndex: 0,
    },
  });

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

// /start command
bot.command("start", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId);
  ensureIdle(userId);

  await context.send(format`
Привет! Я бот для мониторинга сообщений в группах.

${bold("Как использовать:")}
1. Отправь мне описание того, что ищешь (например: "продажа iPhone 14 до 50к в Москве")
2. Я сгенерирую ключевые слова для поиска
3. Подтверди или отредактируй их
4. Получай уведомления при появлении подходящих сообщений

${bold("Команды:")}
/list - показать мои подписки
/help - помощь
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
3. Подтверди ключевые слова и выбери группы
4. Получай уведомления

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

  queries.getOrCreateUser(userId);
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

  queries.getOrCreateUser(userId);
  ensureIdle(userId);

  send(userId, { type: "ADDGROUP" });

  await context.send("Выбери группу или канал для добавления:", {
    reply_markup: groupPickerKeyboard(nextRequestId()),
  });
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
async function addGroupForUser(
  context: { send: (text: string, options?: object) => Promise<unknown> },
  userId: number,
  group: PendingGroup
): Promise<void> {
  const icon = group.isChannel ? "📢" : "👥";

  // Try to join
  const result = await ensureUserbotInGroup(group.id, group.username, group.inviteLink);

  if (result.success) {
    // Save to DB
    queries.addUserGroup(userId, group.id, group.title || "Unknown", group.isChannel);
    await context.send(`${icon} "${group.title}" добавлена!`, {
      reply_markup: { remove_keyboard: true },
    });
    await showAddGroupPrompt(context, userId);
  } else {
    await context.send(`Не удалось добавить "${group.title}": ${result.error}`, {
      reply_markup: { remove_keyboard: true },
    });
    await showAddGroupPrompt(context, userId);
  }
}

// Handle text messages (new subscription requests)
bot.on("message", async (context) => {
  if (!context.text || context.text.startsWith("/")) return;

  const userId = context.from?.id;
  if (!userId) return;

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
    send(userId, { type: "DONE_ADDING_GROUPS" });
    const groups = queries.getUserGroups(userId);
    if (groups.length > 0) {
      await context.send(`Добавлено групп: ${groups.length}. Теперь отправь описание того, что ищешь.`, {
        reply_markup: { remove_keyboard: true },
      });
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

  // Handle editing existing subscription positive keywords
  if (currentState === "editingSubPositive" && c.editingSubscriptionId) {
    const keywords = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (keywords.length === 0) {
      await context.send("Нужно указать хотя бы одно слово.");
      return;
    }

    queries.updatePositiveKeywords(c.editingSubscriptionId, userId, keywords);
    send(userId, { type: "TEXT_KEYWORDS", keywords });
    await context.send(`✅ Позитивные слова обновлены: ${keywords.join(", ")}`);
    return;
  }

  // Handle editing existing subscription negative keywords
  if (currentState === "editingSubNegative" && c.editingSubscriptionId) {
    const lowerText = text.toLowerCase();
    let keywords: string[];

    if (lowerText === "нет" || lowerText === "-" || lowerText === "очистить") {
      keywords = [];
    } else {
      keywords = text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    queries.updateNegativeKeywords(c.editingSubscriptionId, userId, keywords);
    send(userId, { type: "TEXT_KEYWORDS", keywords });
    await context.send(
      keywords.length > 0
        ? `✅ Негативные слова обновлены: ${keywords.join(", ")}`
        : "✅ Негативные слова очищены"
    );
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
      // All questions answered — generate draft keywords and start rating flow
      await context.send("Анализирую ответы...");
      const updatedC = ctx(userId);
      const finalAnswers = updatedC.clarification?.answers || [...answers, text];
      const clarificationContext = formatClarificationContext(questions, finalAnswers);

      let draftKeywords: string[];
      try {
        draftKeywords = await runWithRecovery(
          userId,
          "GENERATE_KEYWORDS",
          undefined,
          () => generateDraftKeywords(originalQuery)
        );
      } catch {
        draftKeywords = generateKeywordsFallback(originalQuery).positive_keywords;
      }

      await startRatingFlow(context, userId, originalQuery, draftKeywords, clarificationContext);
    }
    return;
  }

  // New subscription request — check mode and start appropriate flow
  const query = context.text;
  const mode = queries.getUserMode(userId);

  // Reset FSM to idle if stuck in another state (e.g. from previous session)
  ensureIdle(userId);

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

        const firstQuestion = analysis.questions[0]!
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

    // No clarification needed — go to draft keywords + rating
    let draftKeywords: string[];
    try {
      draftKeywords = await runWithRecovery(
        userId,
        "GENERATE_KEYWORDS",
        undefined,
        () => generateDraftKeywords(query)
      );
    } catch (error) {
      botLog.error({ err: error, userId }, "Draft keywords generation failed");
      draftKeywords = generateKeywordsFallback(query).positive_keywords;
    }

    await startRatingFlow(context, userId, query, draftKeywords);
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
      // Fallback: skip clarification, go to draft keywords + rating
      await context.send("Не удалось сгенерировать вопросы, перехожу к примерам...");

      let draftKeywords: string[];
      try {
        draftKeywords = await runWithRecovery(
          userId,
          "GENERATE_KEYWORDS",
          undefined,
          () => generateDraftKeywords(query)
        );
      } catch {
        draftKeywords = generateKeywordsFallback(query).positive_keywords;
      }

      await startRatingFlow(context, userId, query, draftKeywords);
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
});

// Handle callback queries (button clicks)
bot.on("callback_query", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  let data: { action: string; id?: string | number; type?: string; idx?: number; msgId?: number; grpId?: number };
  try {
    data = JSON.parse(context.data || "{}");
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
        // All questions done — start rating flow
        await context.answer({ text: "Генерирую..." });
        await context.editText("Анализирую ответы...");
        const clarificationContext = formatClarificationContext(questions, answers);

        let draftKeywords: string[];
        try {
          draftKeywords = await runWithRecovery(
            userId,
            "GENERATE_KEYWORDS",
            undefined,
            () => generateDraftKeywords(originalQuery)
          );
        } catch {
          draftKeywords = generateKeywordsFallback(originalQuery).positive_keywords;
        }

        await startRatingFlow(context, userId, originalQuery, draftKeywords, clarificationContext);
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
              resultText = `✅ Подписка создана! Мониторинг групп: ${groupNames}\n\n📬 Найдено ${result.total} сообщений в истории.`;
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

        // Get photo for visual analysis
        let photoPath: string | null = null;
        const mediaRows = queries.getMediaForMessage(msgId, grpId);
        let firstPhoto = mediaRows.find((m) => m.media_type === "photo");

        // If no photo in DB, try to fetch from Telegram
        if (!firstPhoto) {
          try {
            const { fetchMediaForMessage } = await import("../listener/index.ts");
            const fetched = await fetchMediaForMessage(msgId, grpId);
            if (fetched) {
              const updatedMedia = queries.getMediaForMessage(msgId, grpId);
              firstPhoto = updatedMedia.find((m) => m.media_type === "photo");
            }
          } catch {
            // Ignore fetch errors, continue without photo
          }
        }

        if (firstPhoto) {
          photoPath = `data/${firstPhoto.file_path}`;
        }

        // Run deep analysis (pass group title and photo path)
        const { deepAnalyze } = await import("../llm/deep-analyze.ts");
        const result = await deepAnalyze(storedMsg.text, storedMsg.group_title, photoPath);

        // Format result
        if (!result.isListing) {
          const reason = result.notListingReason || "Не удалось определить тип";
          await editCallbackMessage(context, `❌ Это не объявление\n\nПричина: ${reason}`);
          break;
        }

        const listingTypeLabels: Record<string, string> = {
          sale: "Продажа",
          rent: "Аренда",
          service: "Услуга",
          other: "Другое",
        };

        let resultText = `📊 <b>Анализ объявления</b>\n`;
        resultText += `Тип: ${listingTypeLabels[result.listingType || "other"] || "Неизвестно"}\n\n`;

        // Image analysis section (if available)
        if (result.imageAnalysis?.description) {
          resultText += `📷 <b>Фото:</b> ${result.imageAnalysis.description}\n`;
          if (result.imageAnalysis.condition !== "unknown") {
            const conditionLabels: Record<string, string> = {
              new: "новый",
              used: "б/у",
            };
            resultText += `   Состояние: ${conditionLabels[result.imageAnalysis.condition] || "—"}\n`;
          }
          resultText += `\n`;
        }

        // Scam risk section
        const riskEmoji = result.scamRisk.level === "high" ? "🚨" : result.scamRisk.level === "medium" ? "⚠️" : "✅";
        resultText += `${riskEmoji} <b>Риск мошенничества:</b> ${result.scamRisk.score}/100\n`;
        if (result.scamRisk.flags.length > 0) {
          resultText += `Флаги: ${result.scamRisk.flags.join(", ")}\n`;
        }
        resultText += `${result.scamRisk.recommendation}\n\n`;

        // Items table (expandable blockquote for Telegram)
        if (result.items.length > 0) {
          const verdictEmoji: Record<string, string> = {
            good_deal: "✅",
            overpriced: "❌",
            fair: "👍",
            unknown: "❓",
          };

          resultText += `<b>📋 Товары/услуги:</b>\n`;
          resultText += `<blockquote expandable>`;

          for (const item of result.items) {
            const verdict = verdictEmoji[item.priceVerdict] || "❓";
            const marketPrice = item.marketPriceAvg
              ? `~${item.marketPriceAvg.toLocaleString("ru-RU")}`
              : "н/д";
            resultText += `${verdict} <b>${item.name}</b>\n`;
            resultText += `   Цена: ${item.extractedPrice || "—"}\n`;
            resultText += `   Рынок: ${marketPrice}\n\n`;
          }

          resultText += `</blockquote>\n`;

          // Worth buying warnings
          const notWorth = result.items.filter((i) => !i.worthBuying);
          if (notWorth.length > 0) {
            resultText += `🚫 <b>Не рекомендуется:</b>\n`;
            for (const item of notWorth) {
              resultText += `• ${item.name}: ${item.worthBuyingReason}\n`;
            }
            resultText += `\n`;
          }

          // Sources
          const allSources = result.items.flatMap((i) => i.sources).filter((s) => s.price);
          if (allSources.length > 0) {
            resultText += `<b>🔗 Источники цен:</b>\n`;
            const uniqueSources = allSources.slice(0, 5);
            for (const src of uniqueSources) {
              const title = src.title.slice(0, 40);
              resultText += `• <a href="${src.url}">${title}</a>: ${src.price || "—"}\n`;
            }
            resultText += `\n`;
          }
        }

        // Overall verdict
        resultText += `<b>📝 Итог:</b>\n${result.overallVerdict}`;

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
