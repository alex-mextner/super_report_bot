import { Bot, format, bold, code } from "gramio";
import { queries } from "../db/index.ts";
import { generateKeywords, generateKeywordsFallback } from "../llm/keywords.ts";
import {
  confirmKeyboard,
  subscriptionKeyboard,
  groupPickerKeyboard,
  inviteLinkKeyboard,
  groupsKeyboard,
  nextRequestId,
} from "./keyboards.ts";
import {
  invalidateSubscriptionsCache,
  isUserbotMember,
  ensureUserbotInGroup,
} from "../listener/index.ts";
import { botLog } from "../logger.ts";
import type { UserState, KeywordGenerationResult, PendingGroup } from "../types.ts";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required");
}

// In-memory user state (for conversation flow)
const userStates = new Map<number, UserState>();

function getUserState(userId: number): UserState {
  return userStates.get(userId) || { step: "idle" };
}

function setUserState(userId: number, state: UserState): void {
  userStates.set(userId, state);
}

export const bot = new Bot(BOT_TOKEN);

// /start command
bot.command("start", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId);

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

  const subscriptions = queries.getUserSubscriptions(userId);

  if (subscriptions.length === 0) {
    await context.send("У тебя пока нет активных подписок. Отправь описание того, что хочешь найти.");
    return;
  }

  for (const sub of subscriptions) {
    await context.send(
      format`
${bold("Подписка #" + sub.id)}
${bold("Запрос:")} ${sub.original_query}
${bold("Ключевые слова:")} ${code(sub.positive_keywords.join(", "))}
${bold("Исключения:")} ${code(sub.negative_keywords.join(", ") || "нет")}
      `,
      {
        reply_markup: subscriptionKeyboard(sub.id),
      }
    );
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
  `);
});

// /addgroup command - add a new group for monitoring
bot.command("addgroup", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  queries.getOrCreateUser(userId);

  setUserState(userId, {
    step: "adding_group",
    pending_groups: [],
  });

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

  const state = getUserState(userId);
  if (state.step !== "adding_group") return;

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
    // Ask for invite link
    setUserState(userId, {
      ...state,
      step: "awaiting_invite_link",
      current_pending_group: newGroup,
    });

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
  setUserState(userId, { step: "adding_group", pending_groups: [] });
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

  const state = getUserState(userId);
  const text = context.text;

  // Handle "Готово" button in adding_group state
  if (text === "Готово" && state.step === "adding_group") {
    setUserState(userId, { step: "idle" });
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
  if (state.step === "awaiting_invite_link" && state.current_pending_group) {
    const inviteLinkRegex = /t\.me\/(\+|joinchat\/)/;
    if (inviteLinkRegex.test(text)) {
      const group: PendingGroup = {
        ...state.current_pending_group,
        inviteLink: text.trim(),
        needsInviteLink: false,
      };
      await context.send("Ссылка получена, пробую присоединиться...", {
        reply_markup: { remove_keyboard: true },
      });
      await addGroupForUser(context, userId, group);
    } else {
      await context.send("Неверный формат. Отправь ссылку вида t.me/+XXX или нажми Пропустить.");
    }
    return;
  }

  // If user is editing keywords
  if (state.step === "editing_keywords" && state.pending_subscription) {
    const text = context.text;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    let positiveKeywords: string[] | null = null;
    let negativeKeywords: string[] | null = null;

    for (const line of lines) {
      const posMatch = line.match(/^позитивные:\s*(.+)$/i);
      const negMatch = line.match(/^негативные:\s*(.+)$/i);

      if (posMatch?.[1]) {
        positiveKeywords = posMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      } else if (negMatch?.[1]) {
        negativeKeywords = negMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      }
    }

    if (positiveKeywords === null && negativeKeywords === null) {
      await context.send(
        "Не удалось распознать формат. Используй:\n" +
          "позитивные: слово1, слово2\n" +
          "негативные: слово1, слово2"
      );
      return;
    }

    // Update pending subscription
    const updated = {
      ...state.pending_subscription,
      positive_keywords: positiveKeywords ?? state.pending_subscription.positive_keywords,
      negative_keywords: negativeKeywords ?? state.pending_subscription.negative_keywords,
    };

    const queryId = `${userId}_${Date.now()}`;

    setUserState(userId, {
      step: "awaiting_confirmation",
      pending_subscription: updated,
    });

    await context.send(
      format`
${bold("Обновлённые ключевые слова:")}

${bold("Позитивные:")}
${code(updated.positive_keywords.join(", "))}

${bold("Негативные:")}
${code(updated.negative_keywords.join(", ") || "нет")}

Подтверди или измени ещё раз:
      `,
      {
        reply_markup: confirmKeyboard(queryId),
      }
    );
    return;
  }

  // New subscription request
  const query = context.text;

  await context.send("Генерирую ключевые слова...");

  let result: KeywordGenerationResult;
  try {
    result = await generateKeywords(query);
  } catch (error) {
    botLog.error({ err: error, userId }, "LLM keyword generation failed");
    result = generateKeywordsFallback(query);
    await context.send("Не удалось использовать AI, использую простой алгоритм.");
  }

  // Generate unique ID for this pending subscription
  const queryId = `${userId}_${Date.now()}`;

  // Save state
  setUserState(userId, {
    step: "awaiting_confirmation",
    pending_subscription: {
      original_query: query,
      positive_keywords: result.positive_keywords,
      negative_keywords: result.negative_keywords,
      llm_description: result.llm_description,
    },
  });

  await context.send(
    format`
${bold("Результат анализа:")}

${bold("Позитивные ключевые слова:")}
${code(result.positive_keywords.join(", "))}

${bold("Негативные ключевые слова:")}
${code(result.negative_keywords.join(", ") || "нет")}

${bold("Описание для проверки:")}
${result.llm_description}

Подтверди или измени параметры:
    `,
    {
      reply_markup: confirmKeyboard(queryId),
    }
  );
});

// Handle callback queries (button clicks)
bot.on("callback_query", async (context) => {
  const userId = context.from?.id;
  if (!userId) return;

  let data: { action: string; id: string | number };
  try {
    data = JSON.parse(context.data || "{}");
  } catch {
    return;
  }

  const state = getUserState(userId);

  switch (data.action) {
    case "confirm": {
      if (state.step !== "awaiting_confirmation" || !state.pending_subscription) {
        await context.answer({ text: "Сессия истекла. Отправь новый запрос." });
        return;
      }

      // Get user's groups from DB
      const userGroups = queries.getUserGroups(userId);

      if (userGroups.length === 0) {
        // No groups - create subscription without them
        const { original_query, positive_keywords, negative_keywords, llm_description } =
          state.pending_subscription;

        queries.createSubscription(
          userId,
          original_query,
          positive_keywords,
          negative_keywords,
          llm_description
        );
        invalidateSubscriptionsCache();

        setUserState(userId, { step: "idle" });
        await context.answer({ text: "Подписка создана" });
        await context.editText(
          "Подписка создана!\n\nУ тебя нет добавленных групп. Используй /addgroup для добавления."
        );
        return;
      }

      // Move to group selection
      const groups = userGroups.map((g) => ({ id: g.id, title: g.title }));
      setUserState(userId, {
        ...state,
        step: "selecting_groups",
        available_groups: groups,
        selected_groups: [],
      });

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
      setUserState(userId, { ...state, step: "editing_keywords" });
      await context.answer({ text: "Отправь исправленные ключевые слова" });
      await context.editText(
        "Отправь исправленные ключевые слова в формате:\n" +
          "позитивные: слово1, слово2\n" +
          "негативные: слово1, слово2"
      );
      break;
    }

    case "cancel": {
      setUserState(userId, { step: "idle" });
      await context.answer({ text: "Отменено" });
      await context.editText("Отменено. Отправь новый запрос когда будешь готов.");
      break;
    }

    case "disable": {
      const subscriptionId = Number(data.id);
      queries.deactivateSubscription(subscriptionId, userId);
      await context.answer({ text: "Подписка отключена" });
      await context.editText("Подписка отключена.");
      break;
    }

    case "back": {
      setUserState(userId, { step: "idle" });
      await context.answer({ text: "OK" });
      break;
    }

    case "skip_invite_link": {
      if (state.step !== "awaiting_invite_link") {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      // Skip - go back to adding_group
      await context.answer({ text: "Пропущено" });
      await context.editText("Группа пропущена.");
      await showAddGroupPrompt(
        { send: (text, opts) => bot.api.sendMessage({ chat_id: userId, text, ...opts }) },
        userId
      );
      break;
    }

    case "toggle_group": {
      if (state.step !== "selecting_groups" || !state.available_groups) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const groupId = Number(data.id);
      const group = state.available_groups.find((g) => g.id === groupId);
      if (!group) return;

      const selected = state.selected_groups || [];
      const isSelected = selected.some((g) => g.id === groupId);

      const newSelected = isSelected
        ? selected.filter((g) => g.id !== groupId)
        : [...selected, group];

      setUserState(userId, { ...state, selected_groups: newSelected });

      const selectedIds = new Set(newSelected.map((g) => g.id));
      await context.answer({ text: isSelected ? "Снято" : "Выбрано" });
      await context.editText(
        format`
${bold("Выбери группы для мониторинга:")}

Выбрано: ${newSelected.length} из ${state.available_groups.length}
        `,
        {
          reply_markup: groupsKeyboard(state.available_groups, selectedIds),
        }
      );
      break;
    }

    case "select_all_groups": {
      if (state.step !== "selecting_groups" || !state.available_groups) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const allGroups = state.available_groups;
      setUserState(userId, { ...state, selected_groups: [...allGroups] });

      const selectedIds = new Set(allGroups.map((g) => g.id));
      await context.answer({ text: "Выбраны все" });
      await context.editText(
        format`
${bold("Выбери группы для мониторинга:")}

Выбрано: ${allGroups.length} из ${allGroups.length}
        `,
        {
          reply_markup: groupsKeyboard(allGroups, selectedIds),
        }
      );
      break;
    }

    case "deselect_all_groups": {
      if (state.step !== "selecting_groups" || !state.available_groups) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      setUserState(userId, { ...state, selected_groups: [] });

      await context.answer({ text: "Сняты все" });
      await context.editText(
        format`
${bold("Выбери группы для мониторинга:")}

Выбрано: 0 из ${state.available_groups.length}
        `,
        {
          reply_markup: groupsKeyboard(state.available_groups, new Set()),
        }
      );
      break;
    }

    case "confirm_groups":
    case "skip_groups": {
      if (
        state.step !== "selecting_groups" ||
        !state.pending_subscription ||
        !state.available_groups
      ) {
        await context.answer({ text: "Сессия истекла. Отправь новый запрос." });
        return;
      }

      const { original_query, positive_keywords, negative_keywords, llm_description } =
        state.pending_subscription;

      // Create subscription
      const subscriptionId = queries.createSubscription(
        userId,
        original_query,
        positive_keywords,
        negative_keywords,
        llm_description
      );

      const selectedGroups = state.selected_groups || [];

      // Save selected groups
      if (selectedGroups.length > 0) {
        queries.setSubscriptionGroups(subscriptionId, selectedGroups);
      }

      invalidateSubscriptionsCache();
      setUserState(userId, { step: "idle" });

      await context.answer({ text: "Подписка создана!" });

      if (selectedGroups.length > 0) {
        const groupNames = selectedGroups.map((g) => g.title).join(", ");
        await context.editText(`Подписка создана! Мониторинг групп: ${groupNames}`);
      } else {
        await context.editText(
          "Подписка создана! Группы не выбраны, мониторинг будет по всем доступным."
        );
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
 * Send notification to user about matched message
 */
export async function notifyUser(
  telegramId: number,
  groupTitle: string,
  messageText: string,
  subscriptionQuery: string
): Promise<void> {
  try {
    await bot.api.sendMessage({
      chat_id: telegramId,
      text: `🔔 Найдено совпадение!\n\nГруппа: ${groupTitle}\n\nЗапрос: ${subscriptionQuery}\n\nСообщение:\n${messageText.slice(0, 500)}${messageText.length > 500 ? "..." : ""}`,
    });
    botLog.debug({ userId: telegramId, groupTitle }, "Notification sent");
  } catch (error) {
    botLog.error({ err: error, userId: telegramId }, "Failed to notify user");
  }
}
