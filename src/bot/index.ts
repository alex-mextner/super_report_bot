import { Bot, format, bold, code } from "gramio";
import { queries } from "../db/index.ts";
import { generateKeywords, generateKeywordsFallback } from "../llm/keywords.ts";
import {
  generateClarificationQuestions,
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
  nextRequestId,
} from "./keyboards.ts";
import { interpretEditCommand } from "../llm/edit.ts";
import { getExamplesForSubscription } from "./examples.ts";
import {
  invalidateSubscriptionsCache,
  isUserbotMember,
  ensureUserbotInGroup,
  scanFromCache,
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

// Helper: generate keywords and show confirmation to user
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateKeywordsAndShowResult(
  context: any,
  userId: number,
  query: string,
  clarificationContext?: string
): Promise<void> {
  let result: KeywordGenerationResult;
  try {
    result = await generateKeywords(query, clarificationContext);
  } catch (error) {
    botLog.error({ err: error, userId }, "LLM keyword generation failed");
    result = generateKeywordsFallback(query);
    await context.send("Не удалось использовать AI, использую простой алгоритм.");
  }

  const queryId = `${userId}_${Date.now()}`;

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
    const hasNeg = sub.negative_keywords.length > 0;
    const hasDisabledNeg = (sub.disabled_negative_keywords?.length ?? 0) > 0;

    let exclusionsText = "нет";
    if (hasNeg) {
      exclusionsText = sub.negative_keywords.join(", ");
    } else if (hasDisabledNeg) {
      exclusionsText = `(отключены: ${sub.disabled_negative_keywords!.join(", ")})`;
    }

    await context.send(
      format`
${bold("Подписка #" + sub.id)}
${bold("Запрос:")} ${sub.original_query}
${bold("Ключевые слова:")} ${code(sub.positive_keywords.join(", "))}
${bold("Исключения:")} ${code(exclusionsText)}
      `,
      {
        reply_markup: subscriptionKeyboard(sub.id, hasNeg, hasDisabledNeg),
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

  // Handle editing existing subscription positive keywords
  if (state.step === "editing_sub_positive" && state.editing_subscription_id) {
    const keywords = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (keywords.length === 0) {
      await context.send("Нужно указать хотя бы одно слово.");
      return;
    }

    queries.updatePositiveKeywords(state.editing_subscription_id, userId, keywords);
    setUserState(userId, { step: "idle" });
    await context.send(`✅ Позитивные слова обновлены: ${keywords.join(", ")}`);
    return;
  }

  // Handle editing existing subscription negative keywords
  if (state.step === "editing_sub_negative" && state.editing_subscription_id) {
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

    queries.updateNegativeKeywords(state.editing_subscription_id, userId, keywords);
    setUserState(userId, { step: "idle" });
    await context.send(
      keywords.length > 0
        ? `✅ Негативные слова обновлены: ${keywords.join(", ")}`
        : "✅ Негативные слова очищены"
    );
    return;
  }

  // Handle editing existing subscription description
  if (state.step === "editing_sub_description" && state.editing_subscription_id) {
    if (text.length < 5) {
      await context.send("Описание слишком короткое.");
      return;
    }

    queries.updateLlmDescription(state.editing_subscription_id, userId, text);
    setUserState(userId, { step: "idle" });
    await context.send("✅ Описание обновлено");
    return;
  }

  // Handle AI editing flow
  if (state.step === "editing_sub_ai" && state.pending_ai_edit) {
    const { current, conversation, subscription_id } = state.pending_ai_edit;

    await context.send("Обрабатываю запрос...");

    try {
      const result = await interpretEditCommand(text, current, conversation);

      // Get examples for new parameters
      const examples = getExamplesForSubscription(
        subscription_id,
        result.positive_keywords,
        result.negative_keywords,
        2
      );

      // Format diff
      const addedPos = result.positive_keywords.filter((k) => !current.positive_keywords.includes(k));
      const removedPos = current.positive_keywords.filter((k) => !result.positive_keywords.includes(k));
      const addedNeg = result.negative_keywords.filter((k) => !current.negative_keywords.includes(k));
      const removedNeg = current.negative_keywords.filter((k) => !result.negative_keywords.includes(k));

      let diffText = "";
      if (addedPos.length) diffText += `+ Добавлено: ${addedPos.join(", ")}\n`;
      if (removedPos.length) diffText += `- Удалено: ${removedPos.join(", ")}\n`;
      if (addedNeg.length) diffText += `+ Исключения: ${addedNeg.join(", ")}\n`;
      if (removedNeg.length) diffText += `- Из исключений: ${removedNeg.join(", ")}\n`;
      if (current.llm_description !== result.llm_description) {
        diffText += `Описание: ${result.llm_description}\n`;
      }

      // Format examples
      let examplesText = "";
      for (const ex of examples) {
        const source = ex.isFromCache ? `[${ex.groupTitle}]` : ex.groupTitle;
        examplesText += `${source}\n"${ex.text}"\n\n`;
      }

      // Update state with proposed changes
      setUserState(userId, {
        ...state,
        pending_ai_edit: {
          ...state.pending_ai_edit,
          proposed: {
            positive_keywords: result.positive_keywords,
            negative_keywords: result.negative_keywords,
            llm_description: result.llm_description,
          },
          conversation: [
            ...conversation,
            { role: "user", content: text },
            { role: "assistant", content: result.summary },
          ],
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
          reply_markup: aiEditKeyboard(subscription_id),
        }
      );
    } catch (error) {
      botLog.error({ err: error, userId }, "AI edit interpretation failed");
      await context.send("Ошибка обработки. Попробуй переформулировать.");
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

  // Handle clarification question answers
  if (state.step === "clarifying_query" && state.clarification) {
    const { questions, answers, current_index, original_query } = state.clarification;

    // Save answer to current question
    answers.push(text);

    const nextIndex = current_index + 1;

    if (nextIndex < questions.length) {
      // More questions to ask
      setUserState(userId, {
        ...state,
        clarification: {
          ...state.clarification,
          answers,
          current_index: nextIndex,
        },
      });

      const nextQuestion = questions[nextIndex] ?? "";
      const questionNumber = `(${nextIndex + 1}/${questions.length})`;
      await context.send(format`${bold("Уточняющий вопрос")} ${questionNumber}\n\n${nextQuestion}`, {
        reply_markup: skipQuestionKeyboard(),
      });
    } else {
      // All questions answered — generate keywords with context
      await context.send("Генерирую ключевые слова на основе твоих ответов...");
      const clarificationContext = formatClarificationContext(questions, answers);
      await generateKeywordsAndShowResult(context, userId, original_query, clarificationContext);
    }
    return;
  }

  // New subscription request — start clarification flow
  const query = context.text;

  await context.send("Генерирую уточняющие вопросы...");

  let questions: string[];
  try {
    questions = await generateClarificationQuestions(query);
  } catch (error) {
    botLog.error({ err: error, userId }, "LLM clarification generation failed");
    // Fallback: skip clarification, go directly to keyword generation
    await context.send("Не удалось сгенерировать вопросы, перехожу к генерации ключевых слов...");
    await generateKeywordsAndShowResult(context, userId, query);
    return;
  }

  // Save clarification state
  setUserState(userId, {
    step: "clarifying_query",
    clarification: {
      original_query: query,
      questions,
      answers: [],
      current_index: 0,
    },
  });

  // Send first question
  const firstQuestion = questions[0] ?? "Какие конкретные характеристики важны?";
  const questionNumber = `(1/${questions.length})`;
  await context.send(format`${bold("Уточняющий вопрос")} ${questionNumber}\n\n${firstQuestion}`, {
    reply_markup: skipQuestionKeyboard(),
  });
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

    case "skip_question": {
      if (state.step !== "clarifying_query" || !state.clarification) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const { questions, answers, current_index, original_query } = state.clarification;

      // Add empty answer for skipped question
      answers.push("");

      const nextIndex = current_index + 1;

      if (nextIndex < questions.length) {
        // More questions
        setUserState(userId, {
          ...state,
          clarification: {
            ...state.clarification,
            answers,
            current_index: nextIndex,
          },
        });

        const nextQuestion = questions[nextIndex] ?? "";
        const questionNumber = `(${nextIndex + 1}/${questions.length})`;
        await context.answer({ text: "Пропущено" });
        await context.editText(format`${bold("Уточняющий вопрос")} ${questionNumber}\n\n${nextQuestion}`, {
          reply_markup: skipQuestionKeyboard(),
        });
      } else {
        // All questions done — generate keywords
        await context.answer({ text: "Генерирую..." });
        await context.editText("Генерирую ключевые слова...");
        const clarificationContext = formatClarificationContext(questions, answers);
        await generateKeywordsAndShowResult(context, userId, original_query, clarificationContext);
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

      setUserState(userId, {
        step: "editing_sub_positive",
        editing_subscription_id: subscriptionId,
      });
      await context.answer({ text: "Отправь новые слова" });
      await context.send(
        `Текущие позитивные слова: ${sub.positive_keywords.join(", ")}\n\n` +
          "Отправь новые позитивные ключевые слова через запятую:"
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

      setUserState(userId, {
        step: "editing_sub_negative",
        editing_subscription_id: subscriptionId,
      });
      await context.answer({ text: "Отправь новые слова" });
      await context.send(
        `Текущие негативные слова: ${sub.negative_keywords.join(", ") || "нет"}\n\n` +
          'Отправь новые негативные ключевые слова через запятую (или "нет" для очистки):'
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

      setUserState(userId, {
        step: "editing_sub_description",
        editing_subscription_id: subscriptionId,
      });
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
      if (state.step !== "awaiting_confirmation" || !state.pending_subscription) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      await context.answer({ text: "Генерирую..." });

      let result: KeywordGenerationResult;
      try {
        result = await generateKeywords(state.pending_subscription.original_query);
      } catch (error) {
        botLog.error({ err: error, userId }, "LLM regeneration failed");
        await context.send("Ошибка генерации. Попробуй позже.");
        return;
      }

      const queryId = `${userId}_${Date.now()}`;

      setUserState(userId, {
        step: "awaiting_confirmation",
        pending_subscription: {
          original_query: state.pending_subscription.original_query,
          positive_keywords: result.positive_keywords,
          negative_keywords: result.negative_keywords,
          llm_description: result.llm_description,
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
      setUserState(userId, {
        step: "editing_sub_ai",
        editing_subscription_id: subscriptionId,
        pending_ai_edit: {
          subscription_id: subscriptionId,
          current: {
            positive_keywords: sub.positive_keywords,
            negative_keywords: sub.negative_keywords,
            llm_description: sub.llm_description,
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
      if (state.step !== "editing_sub_ai" || !state.pending_ai_edit?.proposed) {
        await context.answer({ text: "Сессия истекла" });
        return;
      }

      const { subscription_id, proposed } = state.pending_ai_edit;

      // Apply changes
      queries.updatePositiveKeywords(subscription_id, userId, proposed.positive_keywords);
      queries.updateNegativeKeywords(subscription_id, userId, proposed.negative_keywords);
      queries.updateLlmDescription(subscription_id, userId, proposed.llm_description);
      invalidateSubscriptionsCache();

      setUserState(userId, { step: "idle" });

      await context.answer({ text: "Применено!" });
      await context.editText("✅ Изменения применены.");
      break;
    }

    case "cancel_ai_edit": {
      setUserState(userId, { step: "idle" });
      await context.answer({ text: "Отменено" });
      await context.editText("Редактирование отменено.");
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
        await context.editText(
          `Подписка создана! Мониторинг групп: ${groupNames}\n\n⏳ Сканирую историю сообщений...`
        );

        // Scan cache in background
        const groupIds = selectedGroups.map((g) => g.id);
        scanFromCache(groupIds, subscriptionId)
          .then((count) => {
            botLog.info({ count, subscriptionId }, "Cache scan complete");
          })
          .catch((e) => botLog.error(e, "Cache scan failed"));
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
