/**
 * Publication Handlers
 *
 * Handles the /publish command and publication flow.
 * Manages user MTProto authorization and message publishing.
 */

import { Bot } from "gramio";
import { format, bold } from "@gramio/format";
import { queries } from "../db/index.ts";
import { botLog } from "../logger.ts";
import {
  publishMenuKeyboard,
  publishPresetKeyboard,
  publishConfirmKeyboard,
  cancelAuthKeyboard,
} from "./keyboards.ts";
import {
  hasActiveSession,
  isPublisherEnabled,
  startUserAuth,
  completeUserAuth,
  hasPendingAuth,
  getPendingAuthPhone,
  cancelPendingAuth,
  disconnectUser,
} from "../publisher/index.ts";
import { sendPaymentInvoice } from "./payments.ts";

// In-memory state for publication flow
interface PublicationState {
  step: "awaiting_phone" | "awaiting_code" | "awaiting_password" | "awaiting_text" | "awaiting_confirm";
  phone?: string;
  presetId?: number;
  text?: string;
}

const publicationStates = new Map<number, PublicationState>();

/**
 * Handle /publish command
 */
export async function handlePublishCommand(
  bot: Bot,
  userId: number
): Promise<void> {
  if (!isPublisherEnabled()) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: "⚠️ Публикация временно недоступна. Обратитесь к администратору.",
    });
    return;
  }

  const hasSession = hasActiveSession(userId);

  await bot.api.sendMessage({
    chat_id: userId,
    text: format`📢 ${bold("Публикация объявлений")}

Публикуй объявления на все барахолки региона одним нажатием!

${hasSession
    ? "✅ Твой Telegram аккаунт подключён"
    : "Для публикации нужно подключить твой Telegram аккаунт. Объявления будут отправляться от твоего имени."}

Цена: 100⭐ за публикацию во всех группах пресета
`,
    parse_mode: "Markdown",
    reply_markup: publishMenuKeyboard(hasSession),
  });
}

/**
 * Handle connect_telegram callback - start auth flow
 */
export async function handleConnectTelegram(
  bot: Bot,
  userId: number,
  answerCallback: () => Promise<void>,
  editMessage: (text: string, keyboard?: object) => Promise<void>
): Promise<void> {
  await answerCallback();

  // Set state to awaiting phone
  publicationStates.set(userId, { step: "awaiting_phone" });

  await editMessage(
    `🔗 *Подключение Telegram*

Для публикации объявлений нужно авторизовать твой Telegram аккаунт.

📱 Отправь свой номер телефона в формате:
+79001234567`,
    { reply_markup: cancelAuthKeyboard() }
  );
}

/**
 * Handle text message during publication flow
 */
export async function handlePublicationText(
  bot: Bot,
  userId: number,
  text: string
): Promise<boolean> {
  const state = publicationStates.get(userId);
  if (!state) return false;

  switch (state.step) {
    case "awaiting_phone": {
      // Validate phone format
      const phone = text.trim().replace(/\s/g, "");
      if (!phone.startsWith("+") || phone.length < 10) {
        await bot.api.sendMessage({
          chat_id: userId,
          text: "❌ Неверный формат. Отправь номер с кодом страны, например: +79001234567",
        });
        return true;
      }

      // Start auth
      const result = await startUserAuth(userId, phone);
      if ("error" in result) {
        await bot.api.sendMessage({
          chat_id: userId,
          text: `❌ Ошибка: ${result.error}`,
        });
        publicationStates.delete(userId);
        return true;
      }

      // Move to awaiting code
      publicationStates.set(userId, { step: "awaiting_code", phone });

      await bot.api.sendMessage({
        chat_id: userId,
        text: format`📨 Код отправлен в Telegram!

Введи код из сообщения:`,
        reply_markup: cancelAuthKeyboard(),
      });
      return true;
    }

    case "awaiting_code": {
      const code = text.trim().replace(/\s/g, "");

      const result = await completeUserAuth(userId, code);

      if ("error" in result) {
        if (result.needsPassword) {
          publicationStates.set(userId, { ...state, step: "awaiting_password" });
          await bot.api.sendMessage({
            chat_id: userId,
            text: "🔐 Введи пароль двухфакторной аутентификации:",
            reply_markup: cancelAuthKeyboard(),
          });
          return true;
        }

        await bot.api.sendMessage({
          chat_id: userId,
          text: `❌ Ошибка: ${result.error}\n\nПопробуй ещё раз с /publish`,
        });
        publicationStates.delete(userId);
        cancelPendingAuth(userId);
        return true;
      }

      // Success!
      publicationStates.delete(userId);

      await bot.api.sendMessage({
        chat_id: userId,
        text: format`✅ ${bold("Аккаунт подключён!")}

Теперь ты можешь публиковать объявления на барахолках.`,
        reply_markup: publishMenuKeyboard(true),
      });
      return true;
    }

    case "awaiting_password": {
      const password = text.trim();

      const result = await completeUserAuth(userId, "", password);

      if ("error" in result) {
        await bot.api.sendMessage({
          chat_id: userId,
          text: `❌ Ошибка: ${result.error}\n\nПопробуй ещё раз с /publish`,
        });
        publicationStates.delete(userId);
        cancelPendingAuth(userId);
        return true;
      }

      // Success!
      publicationStates.delete(userId);

      await bot.api.sendMessage({
        chat_id: userId,
        text: format`✅ ${bold("Аккаунт подключён!")}

Теперь ты можешь публиковать объявления на барахолках.`,
        reply_markup: publishMenuKeyboard(true),
      });
      return true;
    }

    case "awaiting_text": {
      // Save text and show confirmation
      const presetId = state.presetId;
      if (!presetId) {
        publicationStates.delete(userId);
        return true;
      }

      // Create publication in DB
      const publicationId = queries.createPublication({
        telegramId: userId,
        presetId,
        text: text.trim(),
      });

      if (!publicationId) {
        await bot.api.sendMessage({
          chat_id: userId,
          text: "❌ Ошибка создания публикации. Попробуй позже.",
        });
        publicationStates.delete(userId);
        return true;
      }

      // Get preset info
      const presets = queries.getRegionPresets();
      const preset = presets.find((p) => p.id === presetId);
      const presetGroups = queries.getPresetGroups(presetId);
      const presetName = preset?.region_name || "Регион";

      publicationStates.set(userId, { ...state, step: "awaiting_confirm", text: text.trim() });

      const textPreview = text.trim().slice(0, 500) + (text.length > 500 ? "..." : "");

      await bot.api.sendMessage({
        chat_id: userId,
        text: `📋 *Подтверди публикацию*

*Текст:*
${textPreview}

*Куда:* ${presetName} (${presetGroups.length} групп)
*Цена:* 100⭐

Объявление будет опубликовано от твоего имени с задержками между группами (анти-спам).`,
        parse_mode: "Markdown",
        reply_markup: publishConfirmKeyboard(publicationId),
      });
      return true;
    }

    default:
      return false;
  }
}

/**
 * Handle create_publication callback
 */
export async function handleCreatePublication(
  bot: Bot,
  userId: number,
  answerCallback: () => Promise<void>,
  editMessage: (text: string, keyboard?: object) => Promise<void>
): Promise<void> {
  await answerCallback();

  // Check daily limit
  if (!queries.canPublishToday(userId)) {
    await editMessage("❌ Достигнут дневной лимит публикаций (10). Попробуй завтра.");
    return;
  }

  // Get presets with groups
  const presets = queries.getRegionPresets();
  const presetsWithGroups = presets
    .map((p) => ({
      id: p.id,
      region_name: p.region_name,
      group_count: queries.getPresetGroups(p.id).length,
    }))
    .filter((p) => p.group_count > 0);

  if (presetsWithGroups.length === 0) {
    await editMessage("❌ Нет доступных пресетов с группами.");
    return;
  }

  await editMessage(
    `📝 *Создание объявления*

Выбери регион для публикации:`,
    { reply_markup: publishPresetKeyboard(presetsWithGroups) }
  );
}

/**
 * Handle publish_to_preset callback
 */
export async function handlePublishToPreset(
  bot: Bot,
  userId: number,
  presetId: number,
  answerCallback: () => Promise<void>,
  editMessage: (text: string, keyboard?: object) => Promise<void>
): Promise<void> {
  await answerCallback();

  // Set state to awaiting text
  publicationStates.set(userId, { step: "awaiting_text", presetId });

  const presets = queries.getRegionPresets();
  const preset = presets.find((p) => p.id === presetId);
  const presetName = preset?.region_name || "Неизвестный регион";

  await editMessage(
    `📝 *Напиши объявление*

Регион: ${presetName}

Отправь текст объявления. Можешь добавить:
• Описание товара
• Цену
• Контакты

Фото пока не поддерживаются.`,
    { reply_markup: cancelAuthKeyboard() }
  );
}

/**
 * Handle confirm_publication callback - send payment
 */
export async function handleConfirmPublication(
  bot: Bot,
  userId: number,
  publicationId: number,
  answerCallback: () => Promise<void>
): Promise<void> {
  await answerCallback();

  const publication = queries.getPublication(publicationId);
  if (!publication) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: "❌ Публикация не найдена.",
    });
    publicationStates.delete(userId);
    return;
  }

  // Send payment invoice
  await sendPaymentInvoice(bot, userId, {
    type: "publication",
    title: "Публикация объявления",
    description: "Публикация во все группы пресета",
    amount: 100,
    payload: {
      type: "publication",
      publicationId,
    },
  });

  publicationStates.delete(userId);
}

/**
 * Handle my_publications callback
 */
export async function handleMyPublications(
  bot: Bot,
  userId: number,
  answerCallback: () => Promise<void>,
  editMessage: (text: string, keyboard?: object) => Promise<void>
): Promise<void> {
  await answerCallback();

  const publications = queries.getUserPublications(userId, 5);

  if (publications.length === 0) {
    await editMessage(
      "📋 У тебя пока нет публикаций.",
      { reply_markup: publishMenuKeyboard(true) }
    );
    return;
  }

  const lines = publications.map((p) => {
    const statusMap: Record<string, string> = {
      pending: "⏳ Ожидает",
      processing: "🔄 Публикуется",
      completed: "✅ Готово",
      failed: "❌ Ошибка",
      cancelled: "🚫 Отменено",
    };
    const status = statusMap[p.status] || p.status;

    const progress = p.total_groups > 0 ? ` (${p.published_groups}/${p.total_groups})` : "";
    const textPreview = p.text.slice(0, 30) + (p.text.length > 30 ? "..." : "");

    return `${status}${progress}: ${textPreview}`;
  });

  await editMessage(
    `📋 *Мои публикации*

${lines.join("\n")}`,
    { reply_markup: publishMenuKeyboard(true) }
  );
}

/**
 * Handle disconnect_account callback
 */
export async function handleDisconnectAccount(
  bot: Bot,
  userId: number,
  answerCallback: () => Promise<void>,
  editMessage: (text: string, keyboard?: object) => Promise<void>
): Promise<void> {
  await answerCallback();

  await disconnectUser(userId);

  await editMessage(
    "✅ Аккаунт отключён. Для публикации нужно подключить его снова.",
    { reply_markup: publishMenuKeyboard(false) }
  );

  botLog.info({ userId }, "User disconnected publishing account");
}

/**
 * Handle cancel_auth callback
 */
export async function handleCancelAuth(
  bot: Bot,
  userId: number,
  answerCallback: () => Promise<void>,
  editMessage: (text: string, keyboard?: object) => Promise<void>
): Promise<void> {
  await answerCallback();

  cancelPendingAuth(userId);
  publicationStates.delete(userId);

  await editMessage("Отменено.", { reply_markup: publishMenuKeyboard(hasActiveSession(userId)) });
}

/**
 * Handle cancel_publication callback
 */
export async function handleCancelPublication(
  bot: Bot,
  userId: number,
  answerCallback: () => Promise<void>,
  editMessage: (text: string, keyboard?: object) => Promise<void>
): Promise<void> {
  await answerCallback();
  publicationStates.delete(userId);

  await editMessage("Публикация отменена.", { reply_markup: publishMenuKeyboard(hasActiveSession(userId)) });
}

/**
 * Check if user is in publication flow
 */
export function isInPublicationFlow(userId: number): boolean {
  return publicationStates.has(userId);
}

/**
 * Get publication state for user
 */
export function getPublicationState(userId: number): PublicationState | undefined {
  return publicationStates.get(userId);
}
