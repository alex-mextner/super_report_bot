/**
 * Interactive Publication Flow
 *
 * After payment, guides user through approving each post:
 * 1. Generate AI version for next group
 * 2. Show to user for approval
 * 3. Wait for approve/edit/skip
 * 4. Send and move to next group
 */

import { Bot } from "gramio";
import { InlineKeyboard } from "@gramio/keyboards";
import { queries } from "../db/index.ts";
import { rephraseAdText, type GroupStyleContext } from "../llm/rephrase.ts";
import { sendTextAsUser, sendMediaAsUser, getClientForUser, analyzeGroupStyle } from "./index.ts";
import { botLog } from "../logger.ts";

// Track active publication sessions (userId -> publicationId)
const activeSessions = new Map<number, number>();

// Track posts being edited (userId -> postId)
const editingSessions = new Map<number, number>();

/**
 * Start interactive publication flow after payment
 */
export async function startInteractivePublication(
  bot: Bot,
  userId: number,
  publicationId: number
): Promise<void> {
  const publication = queries.getPublication(publicationId);
  if (!publication) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: "Ошибка: публикация не найдена.",
    });
    return;
  }

  // Check user session
  const client = await getClientForUser(userId);
  if (!client) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: "Ошибка: сессия Telegram не найдена. Подключи аккаунт снова через /publish",
    });
    queries.updatePublicationStatus(publicationId, "failed", "No active session");
    return;
  }

  // Create posts for all groups
  const presetGroups = queries.getPresetGroups(publication.preset_id);
  if (presetGroups.length === 0) {
    await bot.api.sendMessage({
      chat_id: userId,
      text: "Ошибка: в пресете нет групп.",
    });
    queries.updatePublicationStatus(publicationId, "failed", "No groups in preset");
    return;
  }

  // Set total groups and create posts
  queries.setPublicationTotalGroups(publicationId, presetGroups.length);
  const groupIds = presetGroups.map((g) => g.group_id);
  queries.createPublicationPosts(publicationId, groupIds);

  // Mark as processing
  queries.updatePublicationStatus(publicationId, "processing");

  // Store active session
  activeSessions.set(userId, publicationId);

  await bot.api.sendMessage({
    chat_id: userId,
    text: `🚀 *Начинаем публикацию!*

Всего групп: ${presetGroups.length}

Сейчас для каждой группы бот сгенерирует уникальную версию текста. Ты сможешь проверить и подтвердить каждое сообщение.`,
    parse_mode: "Markdown",
  });

  // Process first post
  await processNextPost(bot, userId, publicationId);
}

/**
 * Process next pending post in publication
 */
export async function processNextPost(
  bot: Bot,
  userId: number,
  publicationId: number
): Promise<void> {
  const publication = queries.getPublication(publicationId);
  if (!publication) return;

  // Check if there's already a post awaiting approval
  const awaitingPost = queries.getPostAwaitingApproval(publicationId);
  if (awaitingPost) {
    // Show it again
    await showPostForApproval(bot, userId, awaitingPost.id);
    return;
  }

  // Get next pending post
  const nextPost = queries.getNextPendingPost(publicationId);
  if (!nextPost) {
    // No more posts - check if done
    await checkPublicationComplete(bot, userId, publicationId);
    return;
  }

  // Get group name
  const groupTitle = queries.getGroupTitle(nextPost.group_id) || `Группа ${nextPost.group_id}`;

  // Show "generating" message with skip button
  const skipKeyboard = new InlineKeyboard()
    .text("⏭️ Пропустить", JSON.stringify({ action: "pub_skip", id: nextPost.id }))
    .text("🛑 Стоп", JSON.stringify({ action: "pub_stop", id: publicationId }));

  const genMsg = await bot.api.sendMessage({
    chat_id: userId,
    text: `⏳ Анализирую стиль группы *${groupTitle}*...`,
    parse_mode: "Markdown",
    reply_markup: skipKeyboard,
  });

  // Analyze group style first
  const styleAnalysis = await analyzeGroupStyle(userId, nextPost.group_id);

  // Build style context for rephrase
  let styleContext: GroupStyleContext | undefined;
  if (styleAnalysis) {
    styleContext = {
      groupName: groupTitle,
      avgLength: styleAnalysis.avgLength,
      hasEmojis: styleAnalysis.hasEmojis,
      hasHashtags: styleAnalysis.hasHashtags,
      styleHints: styleAnalysis.styleHints,
      sampleMessages: styleAnalysis.sampleMessages,
    };
    botLog.debug({ groupTitle, styleHints: styleAnalysis.styleHints }, "Group style analyzed");
  } else {
    styleContext = { groupName: groupTitle };
  }

  // Update message to show generation phase
  try {
    await bot.api.editMessageText({
      chat_id: userId,
      message_id: genMsg.message_id,
      text: `⏳ Генерирую версию для: *${groupTitle}*...`,
      parse_mode: "Markdown",
      reply_markup: skipKeyboard,
    });
  } catch {
    // Ignore edit errors
  }

  // Generate AI version with style context
  const result = await rephraseAdText(publication.text, styleContext);

  // Delete "generating" message
  try {
    await bot.api.deleteMessage({
      chat_id: userId,
      message_id: genMsg.message_id,
    });
  } catch {
    // Ignore delete errors
  }

  // Check if post was skipped/stopped while generating
  const postAfterGen = queries.getPublicationPost(nextPost.id);
  if (!postAfterGen || postAfterGen.status !== "pending") {
    // User skipped or stopped - don't show approval
    return;
  }

  // Save AI text and mark as awaiting approval
  queries.setPublicationPostAiText(nextPost.id, result.text, groupTitle);

  // Show for approval
  await showPostForApproval(bot, userId, nextPost.id);
}

/**
 * Show post to user for approval
 */
async function showPostForApproval(
  bot: Bot,
  userId: number,
  postId: number
): Promise<void> {
  const post = queries.getPublicationPost(postId);
  if (!post) return;

  const publication = queries.getPublication(post.publication_id);
  if (!publication) return;

  const counts = queries.countRemainingPosts(post.publication_id);
  const progress = publication.total_groups - counts.total;

  const keyboard = new InlineKeyboard()
    .text("✅ Отправить", JSON.stringify({ action: "pub_approve", id: postId }))
    .text("✏️ Редактировать", JSON.stringify({ action: "pub_edit", id: postId }))
    .row()
    .text("⏭️ Пропустить", JSON.stringify({ action: "pub_skip", id: postId }))
    .text("🛑 Остановить всё", JSON.stringify({ action: "pub_stop", id: post.publication_id }));

  await bot.api.sendMessage({
    chat_id: userId,
    text: `📝 *${post.group_name || "Группа"}* (${progress + 1}/${publication.total_groups})

─────────────────
${post.ai_text || publication.text}
─────────────────

Проверь текст и выбери действие:`,
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
}

/**
 * Handle post approval
 */
export async function handlePostApprove(
  bot: Bot,
  userId: number,
  postId: number
): Promise<void> {
  const post = queries.getPublicationPost(postId);
  if (!post) return;

  const publication = queries.getPublication(post.publication_id);
  if (!publication) return;

  // Send message with optional photos
  const textToSend = post.ai_text || publication.text;
  const photoFileIds: string[] = publication.media ? JSON.parse(publication.media) : [];

  const result = photoFileIds.length > 0
    ? await sendMediaAsUser(userId, post.group_id, textToSend, photoFileIds)
    : await sendTextAsUser(userId, post.group_id, textToSend);

  if ("error" in result) {
    queries.updatePublicationPostStatus(postId, "failed", undefined, result.error);
    await bot.api.sendMessage({
      chat_id: userId,
      text: `❌ Ошибка отправки в *${post.group_name}*: ${result.error}`,
      parse_mode: "Markdown",
    });
  } else {
    queries.updatePublicationPostStatus(postId, "sent", result.messageId);
    queries.incrementPublicationProgress(post.publication_id, true);
    await bot.api.sendMessage({
      chat_id: userId,
      text: `✅ Отправлено в *${post.group_name}*`,
      parse_mode: "Markdown",
    });
  }

  // Small delay to avoid flood
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Process next
  await processNextPost(bot, userId, post.publication_id);
}

/**
 * Handle post skip
 */
export async function handlePostSkip(
  bot: Bot,
  userId: number,
  postId: number
): Promise<void> {
  const post = queries.getPublicationPost(postId);
  if (!post) return;

  queries.updatePublicationPostStatus(postId, "skipped");

  await bot.api.sendMessage({
    chat_id: userId,
    text: `⏭️ Пропущено: *${post.group_name}*`,
    parse_mode: "Markdown",
  });

  // Process next
  await processNextPost(bot, userId, post.publication_id);
}

/**
 * Start editing a post
 */
export async function handlePostEdit(
  bot: Bot,
  userId: number,
  postId: number
): Promise<void> {
  const post = queries.getPublicationPost(postId);
  if (!post) return;

  const publication = queries.getPublication(post.publication_id);
  if (!publication) return;

  // Store editing session
  editingSessions.set(userId, postId);

  await bot.api.sendMessage({
    chat_id: userId,
    text: `✏️ *Редактирование для ${post.group_name}*

Отправь исправленный текст:

─────────────────
${post.ai_text || publication.text}
─────────────────`,
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard()
      .text("❌ Отмена", JSON.stringify({ action: "pub_cancel_edit", id: postId })),
  });
}

/**
 * Handle edited text from user
 */
export async function handleEditedText(
  bot: Bot,
  userId: number,
  newText: string
): Promise<boolean> {
  const postId = editingSessions.get(userId);
  if (!postId) return false;

  // Clear editing session
  editingSessions.delete(userId);

  // Update AI text
  queries.updatePostAiText(postId, newText);

  await bot.api.sendMessage({
    chat_id: userId,
    text: "✅ Текст обновлён",
  });

  // Show for approval again
  await showPostForApproval(bot, userId, postId);
  return true;
}

/**
 * Cancel editing
 */
export async function handleCancelEdit(
  bot: Bot,
  userId: number,
  postId: number
): Promise<void> {
  editingSessions.delete(userId);
  await showPostForApproval(bot, userId, postId);
}

/**
 * Stop entire publication
 */
export async function handleStopPublication(
  bot: Bot,
  userId: number,
  publicationId: number
): Promise<void> {
  activeSessions.delete(userId);
  editingSessions.delete(userId);

  queries.updatePublicationStatus(publicationId, "cancelled");

  const publication = queries.getPublication(publicationId);
  const sent = publication?.published_groups || 0;
  const total = publication?.total_groups || 0;

  await bot.api.sendMessage({
    chat_id: userId,
    text: `🛑 *Публикация остановлена*

Отправлено: ${sent}/${total} групп`,
    parse_mode: "Markdown",
  });
}

/**
 * Check if publication is complete
 */
async function checkPublicationComplete(
  bot: Bot,
  userId: number,
  publicationId: number
): Promise<void> {
  activeSessions.delete(userId);

  const publication = queries.getPublication(publicationId);
  if (!publication) return;

  queries.updatePublicationStatus(publicationId, "completed");

  // If no messages were sent successfully, grant a free credit
  if (publication.published_groups === 0) {
    queries.grantPublicationCredit(userId);

    await bot.api.sendMessage({
      chat_id: userId,
      text: `😔 *Публикация не удалась*

Ни одно сообщение не было отправлено.

🎁 Мы начислили тебе *бесплатную публикацию* — используй её в следующий раз!`,
      parse_mode: "Markdown",
    });

    botLog.info(
      { publicationId, userId },
      "Publication failed completely, credit granted"
    );
    return;
  }

  await bot.api.sendMessage({
    chat_id: userId,
    text: `🎉 *Публикация завершена!*

✅ Отправлено: ${publication.published_groups}/${publication.total_groups} групп

Спасибо за использование бота!`,
    parse_mode: "Markdown",
  });

  botLog.info(
    { publicationId, userId, sent: publication.published_groups, total: publication.total_groups },
    "Publication completed"
  );
}

/**
 * Check if user is in editing mode
 */
export function isEditing(userId: number): boolean {
  return editingSessions.has(userId);
}

/**
 * Check if user has active publication
 */
export function hasActivePublication(userId: number): boolean {
  return activeSessions.has(userId);
}

/**
 * Get active publication ID for user
 */
export function getActivePublicationId(userId: number): number | undefined {
  return activeSessions.get(userId);
}

/**
 * Recover interrupted publications after bot restart
 * Call this on bot startup
 */
export async function recoverInterruptedPublications(bot: Bot): Promise<void> {
  const processing = queries.getProcessingPublications();

  if (processing.length === 0) {
    botLog.info("No interrupted publications to recover");
    return;
  }

  botLog.info({ count: processing.length }, "Recovering interrupted publications");

  for (const pub of processing) {
    // Restore session
    activeSessions.set(pub.telegram_id, pub.id);

    // Notify user
    await bot.api.sendMessage({
      chat_id: pub.telegram_id,
      text: `🔄 *Бот был перезапущен*

Твоя публикация продолжается!
Прогресс: ${pub.published_groups}/${pub.total_groups} групп`,
      parse_mode: "Markdown",
    });

    // Continue with next post
    await processNextPost(bot, pub.telegram_id, pub.id);
  }
}
