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
import { getTranslator } from "../i18n/index.ts";
import {
  publishMenuKeyboard,
  publishPresetKeyboard,
  publishConfirmKeyboard,
  cancelAuthKeyboard,
  contentInputKeyboard,
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
  step: "awaiting_phone" | "awaiting_code" | "awaiting_password" | "awaiting_content" | "awaiting_confirm";
  phone?: string;
  presetId?: number;
  text?: string;
  photoFileIds?: string[];
}

const publicationStates = new Map<number, PublicationState>();

/**
 * Handle /publish command
 */
export async function handlePublishCommand(
  bot: Bot,
  userId: number
): Promise<void> {
  const tr = getTranslator(userId);

  if (!isPublisherEnabled()) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: tr("pub_disabled"),
    });
    return;
  }

  const hasSession = hasActiveSession(userId);

  await bot.api.sendMessage({
    chat_id: userId,
    text: `${tr("pub_title")}\n\n${tr("pub_intro")}\n\n${hasSession ? tr("pub_connected") : tr("pub_need_connect")}\n\n${tr("pub_price", { price: 100 })}`,
    parse_mode: "Markdown",
    reply_markup: publishMenuKeyboard(hasSession, tr),
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
  const tr = getTranslator(userId);
  await answerCallback();

  // Set state to awaiting phone
  publicationStates.set(userId, { step: "awaiting_phone" });

  await editMessage(
    `${tr("pub_connect_title")}\n\n${tr("pub_connect_intro")}\n\n${tr("pub_send_phone")}`,
    { reply_markup: cancelAuthKeyboard(tr) }
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

  const tr = getTranslator(userId);

  switch (state.step) {
    case "awaiting_phone": {
      // Validate phone format
      const phone = text.trim().replace(/\s/g, "");
      if (!phone.startsWith("+") || phone.length < 10) {
        await bot.api.sendMessage({
          chat_id: userId,
          text: tr("pub_invalid_phone"),
        });
        return true;
      }

      // Start auth
      const result = await startUserAuth(userId, phone);
      if ("error" in result) {
        await bot.api.sendMessage({
          chat_id: userId,
          text: tr("pub_error", { error: result.error }),
        });
        publicationStates.delete(userId);
        return true;
      }

      // Move to awaiting code
      publicationStates.set(userId, { step: "awaiting_code", phone });

      await bot.api.sendMessage({
        chat_id: userId,
        text: tr("pub_code_sent"),
        reply_markup: cancelAuthKeyboard(tr),
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
            text: tr("pub_enter_2fa"),
            reply_markup: cancelAuthKeyboard(tr),
          });
          return true;
        }

        await bot.api.sendMessage({
          chat_id: userId,
          text: tr("pub_error_retry", { error: result.error }),
        });
        publicationStates.delete(userId);
        cancelPendingAuth(userId);
        return true;
      }

      // Success!
      publicationStates.delete(userId);

      await bot.api.sendMessage({
        chat_id: userId,
        text: tr("pub_connected_success"),
        parse_mode: "Markdown",
        reply_markup: publishMenuKeyboard(true, tr),
      });
      return true;
    }

    case "awaiting_password": {
      const password = text.trim();

      const result = await completeUserAuth(userId, "", password);

      if ("error" in result) {
        await bot.api.sendMessage({
          chat_id: userId,
          text: tr("pub_error_retry", { error: result.error }),
        });
        publicationStates.delete(userId);
        cancelPendingAuth(userId);
        return true;
      }

      // Success!
      publicationStates.delete(userId);

      await bot.api.sendMessage({
        chat_id: userId,
        text: tr("pub_connected_success"),
        parse_mode: "Markdown",
        reply_markup: publishMenuKeyboard(true, tr),
      });
      return true;
    }

    case "awaiting_content": {
      // Save/append text to state
      const currentText = state.text || "";
      const newText = currentText ? `${currentText}\n\n${text.trim()}` : text.trim();

      publicationStates.set(userId, { ...state, text: newText });

      const photoCount = state.photoFileIds?.length || 0;

      await bot.api.sendMessage({
        chat_id: userId,
        text: photoCount > 0
          ? `${tr("pub_text_saved_photos", { count: photoCount })}\n\n${tr("pub_add_more")}`
          : `${tr("pub_text_saved")}\n\n${tr("pub_add_more")}`,
        reply_markup: contentInputKeyboard(true, tr),
      });
      return true;
    }

    default:
      return false;
  }
}

/**
 * Handle photo message during publication flow
 * @param caption - optional caption text sent with photo
 */
export async function handlePublicationPhoto(
  bot: Bot,
  userId: number,
  photoFileId: string,
  caption?: string
): Promise<boolean> {
  const state = publicationStates.get(userId);
  if (!state || state.step !== "awaiting_content") return false;

  const tr = getTranslator(userId);
  const photos = state.photoFileIds || [];

  if (photos.length >= 10) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: tr("pub_max_photos"),
      reply_markup: contentInputKeyboard(!!state.text, tr),
    });
    return true;
  }

  photos.push(photoFileId);

  // If caption provided, use it as text (or append to existing)
  let newText = state.text;
  if (caption?.trim()) {
    newText = state.text
      ? `${state.text}\n\n${caption.trim()}`
      : caption.trim();
  }

  publicationStates.set(userId, { ...state, photoFileIds: photos, text: newText });

  const hasText = !!newText;

  await bot.api.sendMessage({
    chat_id: userId,
    text: caption
      ? tr("pub_photo_added_text", { current: photos.length })
      : tr("pub_photo_added", { current: photos.length }) + (hasText ? "" : tr("pub_add_text_reminder")),
    reply_markup: contentInputKeyboard(hasText, tr),
  });

  return true;
}

/**
 * Handle content_done callback - show confirmation
 */
export async function handleContentDone(
  bot: Bot,
  userId: number,
  answerCallback: () => Promise<void>
): Promise<void> {
  const tr = getTranslator(userId);
  await answerCallback();

  const state = publicationStates.get(userId);
  if (!state || state.step !== "awaiting_content") {
    await bot.api.sendMessage({
      chat_id: userId,
      text: tr("pub_no_active"),
    });
    return;
  }

  if (!state.text) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: tr("pub_need_text"),
      reply_markup: contentInputKeyboard(false, tr),
    });
    return;
  }

  const presetId = state.presetId;
  if (!presetId) {
    publicationStates.delete(userId);
    return;
  }

  // Create publication in DB
  const publicationId = queries.createPublication({
    telegramId: userId,
    presetId,
    text: state.text,
    media: state.photoFileIds,
  });

  if (!publicationId) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: tr("pub_create_error"),
    });
    publicationStates.delete(userId);
    return;
  }

  // Get preset info
  const presets = queries.getRegionPresets();
  const preset = presets.find((p) => p.id === presetId);
  const presetGroups = queries.getPresetGroups(presetId);
  const presetName = preset?.region_name || tr("pub_region");

  publicationStates.set(userId, { ...state, step: "awaiting_confirm" });

  const photoCount = state.photoFileIds?.length || 0;

  // Show full text for review
  await bot.api.sendMessage({
    chat_id: userId,
    text: `${tr("pub_review_title")}\n\n─────────────────\n${state.text}\n─────────────────\n\n${photoCount > 0 ? `${tr("pub_review_photos", { count: photoCount })}\n` : ""}${tr("pub_review_dest", { preset: presetName, groups: presetGroups.length })}\n${tr("pub_review_price", { price: 100 })}`,
    parse_mode: "Markdown",
  });

  // Check for free credits
  const credits = queries.getPublicationCredits(userId);

  // Explain AI flow separately
  await bot.api.sendMessage({
    chat_id: userId,
    text: `${tr("pub_how_it_works_title")}\n\n${tr("pub_how_it_works")}${credits > 0 ? `\n\n${tr("pub_free_credits", { count: credits })}` : ""}`,
    parse_mode: "Markdown",
    reply_markup: publishConfirmKeyboard(publicationId, credits > 0, tr),
  });
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
  const tr = getTranslator(userId);
  await answerCallback();

  // Check daily limit
  if (!queries.canPublishToday(userId)) {
    await editMessage(tr("pub_daily_limit"));
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
    await editMessage(tr("pub_no_presets"));
    return;
  }

  await editMessage(
    tr("pub_select_region"),
    { reply_markup: publishPresetKeyboard(presetsWithGroups, tr) }
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
  const tr = getTranslator(userId);
  await answerCallback();

  // Set state to awaiting content (text + optional photos)
  publicationStates.set(userId, { step: "awaiting_content", presetId, photoFileIds: [] });

  const presets = queries.getRegionPresets();
  const preset = presets.find((p) => p.id === presetId);
  const presetName = preset?.region_name || tr("pub_unknown_region");

  await editMessage(
    `${tr("pub_create_title")}\n\n${tr("pub_create_region", { region: presetName })}\n\n${tr("pub_create_instructions")}`,
    { reply_markup: contentInputKeyboard(false, tr) }
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
  const tr = getTranslator(userId);
  await answerCallback();

  const publication = queries.getPublication(publicationId);
  if (!publication) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: tr("pub_not_found"),
    });
    publicationStates.delete(userId);
    return;
  }

  // Send payment invoice
  await sendPaymentInvoice(bot, userId, {
    type: "publication",
    title: tr("pub_invoice_title"),
    description: tr("pub_invoice_desc"),
    amount: 100,
    payload: {
      type: "publication",
      publicationId,
    },
  });

  publicationStates.delete(userId);
}

/**
 * Handle use_pub_credit callback - use free credit instead of payment
 */
export async function handleUsePubCredit(
  bot: Bot,
  userId: number,
  publicationId: number,
  answerCallback: () => Promise<void>
): Promise<void> {
  const tr = getTranslator(userId);
  await answerCallback();

  const publication = queries.getPublication(publicationId);
  if (!publication) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: tr("pub_not_found"),
    });
    publicationStates.delete(userId);
    return;
  }

  // Try to use credit
  const used = queries.usePublicationCredit(userId);
  if (!used) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: tr("pub_no_credits"),
    });
    return;
  }

  await bot.api.sendMessage({
    chat_id: userId,
    text: tr("pub_credit_used"),
  });

  publicationStates.delete(userId);

  // Start interactive publication directly
  const { startInteractivePublication } = await import("../publisher/interactive.ts");
  await startInteractivePublication(bot, userId, publicationId);
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
  const tr = getTranslator(userId);
  await answerCallback();

  const publications = queries.getUserPublications(userId, 5);

  if (publications.length === 0) {
    await editMessage(
      tr("pub_no_publications"),
      { reply_markup: publishMenuKeyboard(true, tr) }
    );
    return;
  }

  const lines = publications.map((p) => {
    const statusMap: Record<string, string> = {
      pending: tr("pub_status_pending"),
      processing: tr("pub_status_processing"),
      completed: tr("pub_status_completed"),
      failed: tr("pub_status_failed"),
      cancelled: tr("pub_status_cancelled"),
    };
    const status = statusMap[p.status] || p.status;

    const progress = p.total_groups > 0 ? ` (${p.published_groups}/${p.total_groups})` : "";
    const textPreview = p.text.slice(0, 30) + (p.text.length > 30 ? "..." : "");

    return `${status}${progress}: ${textPreview}`;
  });

  await editMessage(
    `${tr("pub_my_title")}\n\n${lines.join("\n")}`,
    { reply_markup: publishMenuKeyboard(true, tr) }
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
  const tr = getTranslator(userId);
  await answerCallback();

  await disconnectUser(userId);

  await editMessage(
    tr("pub_disconnected"),
    { reply_markup: publishMenuKeyboard(false, tr) }
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
  const tr = getTranslator(userId);
  await answerCallback();

  cancelPendingAuth(userId);
  publicationStates.delete(userId);

  await editMessage(tr("pub_cancelled"), { reply_markup: publishMenuKeyboard(hasActiveSession(userId), tr) });
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
  const tr = getTranslator(userId);
  await answerCallback();
  publicationStates.delete(userId);

  await editMessage(tr("pub_publication_cancelled"), { reply_markup: publishMenuKeyboard(hasActiveSession(userId), tr) });
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
