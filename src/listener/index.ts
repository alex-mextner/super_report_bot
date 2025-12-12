import { TelegramClient, Message, ForumTopic } from "@mtcute/bun";
import { tl } from "@mtcute/bun";
import { queries } from "../db/index.ts";
import { matchMessageAgainstAll, getPassedMatches } from "../matcher/index.ts";
import { verifyMatch, verifyMatchBatch, verifyMatchWithItems } from "../llm/verify.ts";
import { semanticSearch, isSemanticSearchAvailable } from "../embeddings/search.ts";
import { notifyUser } from "../bot/index.ts";
import {
  shouldDelayNotification,
  queueDelayedNotification,
} from "../bot/notifications.ts";
import { listenerLog } from "../logger.ts";
import type { IncomingMessage, Subscription, MediaItem } from "../types.ts";
import {
  addMessage,
  updateMessage,
  deleteMessage,
  getMessages,
  isCacheReady,
  setCacheReady,
  getCacheStats,
  saveTopic,
  type CachedMessage,
} from "../cache/messages.ts";
import { generateNgrams, generateWordShingles } from "../matcher/normalize.ts";
import { isUrlOnlyMessage, enrichMessageWithUrlContent } from "../utils/url.ts";

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;

if (!API_ID || !API_HASH) {
  throw new Error("API_ID and API_HASH are required for MTProto");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HISTORY_LIMIT = 1000;
const RATE_LIMIT_DELAY = 2000; // 2 seconds between groups
const RETRY_ATTEMPTS = 10;
const RETRY_BASE_DELAY = 2000; // 2s -> 4s -> 8s -> ... exponential backoff
const RETRY_MAX_DELAY = 120000; // cap at 2 minutes
const FUZZY_FALLBACK_THRESHOLD = 0.3; // Threshold for fuzzy search fallback

// Cache for processed album groupedIds to avoid duplicate notifications
// Key: groupedId (bigint as string), Value: timestamp when added
const processedAlbums = new Map<string, number>();
const ALBUM_CACHE_TTL = 30000; // 30 seconds - albums arrive within ~1-2 seconds

// In-memory lock to prevent race condition in LLM verification
// Key: `${subscriptionId}:${messageId}:${groupId}`
const processingMessages = new Set<string>();

// Clean old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedAlbums) {
    if (now - timestamp > ALBUM_CACHE_TTL) {
      processedAlbums.delete(key);
    }
  }
}, 10000); // Every 10 seconds

/**
 * Calculate fuzzy search score between text and query
 * Uses asymmetric coverage: what fraction of query is found in text
 * Same algorithm as webapp search
 */
function fuzzySearchScore(text: string, query: string): number {
  if (!query || query.trim().length === 0) return 1;

  const queryNgrams = generateNgrams(query, 3);
  const queryShingles = generateWordShingles(query, 2);
  const isSingleWord = queryShingles.size === 1;

  const textNgrams = generateNgrams(text, 3);
  const textShingles = generateWordShingles(text, 2);

  // Asymmetric: how much of the query is found in the text
  const charCoverage = queryCoverage(textNgrams, queryNgrams);
  const wordCoverage = queryCoverage(textShingles, queryShingles);

  // For single-word queries, rely more on character n-grams
  return isSingleWord
    ? charCoverage
    : charCoverage * 0.4 + wordCoverage * 0.6;
}

/**
 * Calculate what fraction of query n-grams are found in text
 */
function queryCoverage(textNgrams: Set<string>, queryNgrams: Set<string>): number {
  if (queryNgrams.size === 0) return 1;

  let found = 0;
  for (const ng of queryNgrams) {
    if (textNgrams.has(ng)) found++;
  }
  return found / queryNgrams.size;
}

export let mtClient = new TelegramClient({
  apiId: API_ID,
  apiHash: API_HASH,
  storage: "userbot.session",
});

// Enrich mtcute logs with group names
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logMgr = mtClient.log as any;
const originalLogHandler = logMgr.handler;
logMgr.handler = (color: number, level: number, tag: string, fmt: string, args: unknown[]) => {
  const enrichedArgs = args.map((arg) => {
    // If arg looks like a channel ID (large number), try to find group name
    if (typeof arg === "number" && arg > 1000000) {
      const title = queries.getGroupTitleById(arg);
      if (title) {
        return `${arg} (${title})`;
      }
    }
    return arg;
  });
  originalLogHandler(color, level, tag, fmt, enrichedArgs);
};

// Cache subscriptions per group to avoid DB queries on every message
const subscriptionsByGroup = new Map<number, { subscriptions: Subscription[]; updatedAt: number }>();
const CACHE_TTL = 60000; // 1 minute

function getSubscriptionsForGroup(groupId: number): Subscription[] {
  const now = Date.now();
  const cached = subscriptionsByGroup.get(groupId);

  if (cached && now - cached.updatedAt < CACHE_TTL) {
    return cached.subscriptions;
  }

  const subscriptions = queries.getSubscriptionsForGroup(groupId);
  subscriptionsByGroup.set(groupId, { subscriptions, updatedAt: now });
  listenerLog.debug({ groupId, count: subscriptions.length }, "Group subscriptions cache refreshed");
  return subscriptions;
}

// Invalidate cache when subscription changes
export function invalidateSubscriptionsCache(): void {
  subscriptionsByGroup.clear();
}

/**
 * Check if a Telegram user is admin/creator of a group/channel via MTProto
 * Used for promotion permission checks
 */
export async function isUserGroupAdmin(
  userTelegramId: number,
  groupId: number
): Promise<boolean> {
  try {
    const member = await mtClient.getChatMember({
      chatId: groupId,
      userId: userTelegramId,
    });
    if (!member) return false;
    // ChatMemberStatus: 'creator' | 'admin' | 'member' | 'restricted' | 'banned' | 'left'
    return member.status === "creator" || member.status === "admin";
  } catch (error) {
    listenerLog.warn({ userTelegramId, groupId, error }, "Failed to check group admin status");
    return false;
  }
}

// Download single media from message
async function downloadSingleMedia(msg: Message): Promise<MediaItem[] | undefined> {
  if (!msg.media) return undefined;

  try {
    if (msg.media.type === "photo") {
      const buffer = await mtClient.downloadAsBuffer(msg.media);
      return [
        {
          type: "photo",
          buffer,
          width: msg.media.width,
          height: msg.media.height,
          mimeType: "image/jpeg",
        },
      ];
    }

    if (msg.media.type === "video") {
      const buffer = await mtClient.downloadAsBuffer(msg.media);
      return [
        {
          type: "video",
          buffer,
          width: msg.media.width,
          height: msg.media.height,
          duration: msg.media.duration,
          mimeType: msg.media.mimeType || "video/mp4",
        },
      ];
    }
  } catch (error) {
    listenerLog.warn({ err: error, msgId: msg.id }, "Failed to download media");
  }

  return undefined;
}

// Download all media from album (grouped messages)
async function downloadMediaFromAlbum(messages: Message[]): Promise<MediaItem[]> {
  const items: MediaItem[] = [];
  for (const msg of messages) {
    const item = await downloadSingleMedia(msg);
    if (item) items.push(...item);
  }
  return items;
}

// Extract text/caption from album messages (can be on any photo in the album)
function extractTextFromAlbum(messages: Message[]): string {
  for (const msg of messages) {
    if (msg.text && msg.text.trim()) {
      return msg.text;
    }
  }
  return "";
}

// Directory for media storage
const MEDIA_DIR = "data/media";

// Save media to disk and DB
async function saveMediaToDisk(
  messageId: number,
  groupId: number,
  media: MediaItem[]
): Promise<void> {
  const dir = `${MEDIA_DIR}/${groupId}`;

  // Create directory if not exists
  try {
    await Bun.write(`${dir}/.keep`, "");
  } catch {
    // Directory might already exist
  }

  for (const [i, item] of media.entries()) {
    const ext = item.type === "photo" ? "jpg" : "mp4";
    const filename = `${messageId}_${i}.${ext}`;
    const filePath = `${dir}/${filename}`;

    try {
      await Bun.write(filePath, item.buffer);

      // Save reference to DB
      queries.saveMedia({
        message_id: messageId,
        group_id: groupId,
        media_index: i,
        media_type: item.type,
        file_path: `${groupId}/${filename}`, // relative path
        width: item.width ?? null,
        height: item.height ?? null,
        duration: item.duration ?? null,
      });

      listenerLog.debug(
        { messageId, groupId, index: i, type: item.type },
        "Media saved to disk"
      );
    } catch (error) {
      listenerLog.error(
        { err: error, messageId, groupId, index: i },
        "Failed to save media"
      );
    }
  }
}

// Fetch media for existing message (on-demand loading)
// Returns true if media was fetched/exists, false otherwise
export async function fetchMediaForMessage(
  messageId: number,
  groupId: number
): Promise<boolean> {
  // Check if media already exists in DB
  const existingMedia = queries.getMediaForMessage(messageId, groupId);
  if (existingMedia.length > 0) {
    return true; // Already have media
  }

  // Fetch message from Telegram
  try {
    const messages = await mtClient.getMessages(groupId, [messageId]);
    const msg = messages[0];

    if (!msg) {
      listenerLog.debug({ messageId, groupId }, "Message not found in Telegram");
      return false;
    }

    // Check if it's an album (grouped message)
    let media: MediaItem[] = [];
    if (msg.groupedId) {
      const albumMessages = await mtClient.getMessageGroup({ chatId: groupId, message: messageId });
      media = await downloadMediaFromAlbum(albumMessages);
    } else {
      const singleMedia = await downloadSingleMedia(msg);
      if (singleMedia) media = singleMedia;
    }

    if (media.length === 0) {
      listenerLog.debug({ messageId, groupId }, "No media in message");
      return false;
    }

    // Save to disk and DB
    await saveMediaToDisk(messageId, groupId, media);

    listenerLog.info(
      { messageId, groupId, count: media.length },
      "Media fetched on demand"
    );

    return true;
  } catch (error) {
    listenerLog.error({ err: error, messageId, groupId }, "Failed to fetch media on demand");
    return false;
  }
}

// Convert mtcute Message to our IncomingMessage
async function toIncomingMessage(msg: Message): Promise<IncomingMessage | null> {
  const chat = msg.chat;
  // Only process messages from groups (Chat type, not User)
  if (chat.type !== "chat") {
    return null; // Skip DMs
  }

  // Filter to groups/supergroups only
  if (!chat.isGroup) {
    return null; // Skip channels
  }

  // Check if message has text or media
  const hasMedia = msg.media?.type === "photo" || msg.media?.type === "video";
  if (!msg.text && !hasMedia) {
    return null; // Skip messages without text AND without photo/video
  }

  // Download media and extract text (caption can be on any photo in album)
  let media: MediaItem[] | undefined;
  let text = msg.text || "";

  try {
    if (msg.groupedId) {
      // Album — get all grouped messages
      const group = await mtClient.getMessageGroup({ chatId: chat.id, message: msg.id });
      media = await downloadMediaFromAlbum(group);
      // Caption can be on any photo in the album, not just the first one
      text = extractTextFromAlbum(group) || text;
    } else if (hasMedia) {
      // Single photo/video
      media = await downloadSingleMedia(msg);
    }
  } catch (error) {
    listenerLog.warn({ err: error, msgId: msg.id }, "Failed to download media");
  }

  return {
    id: msg.id,
    group_id: chat.id,
    group_title: chat.title || "Unknown",
    group_username: (chat as { username?: string }).username ?? undefined,
    text,
    sender_name: msg.sender?.displayName || "Unknown",
    sender_username: msg.sender?.username ?? undefined,
    timestamp: msg.date,
    media,
  };
}

// Process incoming message
async function processMessage(msg: Message): Promise<void> {
  // Skip duplicate album messages — only process the first one
  // Albums arrive as multiple messages with the same groupedId
  if (msg.groupedId) {
    const albumKey = msg.groupedId.toString();
    if (processedAlbums.has(albumKey)) {
      listenerLog.debug(
        { groupedId: albumKey, messageId: msg.id },
        "Album message skipped (already processing)"
      );
      return;
    }
    processedAlbums.set(albumKey, Date.now());
  }

  const incomingMsg = await toIncomingMessage(msg);
  if (!incomingMsg) return;

  // Save group username if available (for publisher to join groups)
  if (incomingMsg.group_username) {
    queries.updateGroupUsername(incomingMsg.group_id, incomingMsg.group_username);
  }

  // Enrich URL-only messages with fetched content
  // This prevents false positives from URL n-grams matching arbitrary queries
  const originalText = incomingMsg.text;
  if (isUrlOnlyMessage(incomingMsg.text)) {
    try {
      const { enrichedText, wasEnriched, fetchedUrls } = await enrichMessageWithUrlContent(
        incomingMsg.text,
        { timeout: 5000, maxLength: 2000 }
      );
      if (wasEnriched) {
        incomingMsg.text = enrichedText;
        listenerLog.debug(
          {
            event: "url_enriched",
            urls: fetchedUrls,
            originalLength: originalText.length,
            enrichedLength: enrichedText.length,
          },
          "URL-only message enriched with page content"
        );
      } else {
        // Couldn't fetch content — skip this message to avoid false positives
        listenerLog.debug(
          { event: "url_only_skipped", textPreview: originalText.slice(0, 100) },
          "URL-only message skipped (no content fetched)"
        );
        return;
      }
    } catch (error) {
      listenerLog.warn({ err: error }, "URL enrichment failed, skipping message");
      return;
    }
  }

  listenerLog.debug(
    {
      event: "message_received",
      groupId: incomingMsg.group_id,
      groupTitle: incomingMsg.group_title,
      textPreview: incomingMsg.text.slice(0, 60),
      sender: incomingMsg.sender_name,
    },
    "New message"
  );

  const subscriptions = getSubscriptionsForGroup(incomingMsg.group_id);
  if (subscriptions.length === 0) return;

  // Stage 1-2: N-gram + BGE-M3 semantic matching (returns all results)
  const allAnalyses = await matchMessageAgainstAll(incomingMsg, subscriptions);
  const candidates = getPassedMatches(allAnalyses);

  // Save rejected analyses immediately
  for (const analysis of allAnalyses) {
    if (!analysis.passed) {
      queries.saveAnalysis({
        subscriptionId: analysis.subscription.id,
        messageId: incomingMsg.id,
        groupId: incomingMsg.group_id,
        result: analysis.result,
        ngramScore: analysis.ngramScore,
        semanticScore: analysis.semanticScore,
        rejectionKeyword: analysis.rejectionKeyword,
      });
    }
  }

  if (candidates.length === 0) return;

  // Count unique users from candidates for "fora" feature (rounded up to nearest 5)
  const uniqueUserIds = new Set(candidates.map((c) => c.subscription.user_id));
  const totalCandidateUsers = uniqueUserIds.size;
  // Round up to nearest 5 for privacy (minimum 5 if more than 1 user)
  const roundedCompetitorCount = totalCandidateUsers > 1
    ? Math.ceil(totalCandidateUsers / 5) * 5
    : 0; // Don't show if user is alone

  listenerLog.info(
    {
      event: "candidates_found",
      count: candidates.length,
      uniqueUsers: totalCandidateUsers,
      competitorCount: roundedCompetitorCount,
      topScore: candidates[0]?.ngramScore?.toFixed(3),
      textPreview: incomingMsg.text.slice(0, 50),
    },
    "Candidates found"
  );

  // Stage 3: LLM verification for each candidate
  for (const candidate of candidates) {
    const { subscription } = candidate;

    // In-memory lock to prevent race condition during LLM verification
    const lockKey = `${subscription.id}:${incomingMsg.id}:${incomingMsg.group_id}`;
    if (processingMessages.has(lockKey)) {
      listenerLog.debug({ lockKey }, "Already processing, skipping");
      continue;
    }

    // Check deduplication (same subscription already processed this message)
    if (queries.isAnalysisMatched(subscription.id, incomingMsg.id, incomingMsg.group_id)) {
      listenerLog.debug(
        { subscriptionId: subscription.id, messageId: incomingMsg.id },
        "Duplicate skipped"
      );
      continue;
    }

    // Check if user was already notified about this message via another subscription
    if (queries.isMessageNotifiedToUser(subscription.user_id, incomingMsg.id, incomingMsg.group_id)) {
      listenerLog.debug(
        { userId: subscription.user_id, messageId: incomingMsg.id, subscriptionId: subscription.id },
        "User already notified via another subscription, skipping"
      );
      continue;
    }

    // Acquire lock before LLM verification
    processingMessages.add(lockKey);

    try {
      // Use multi-item verification - splits message and verifies each item
      const verification = await verifyMatchWithItems(incomingMsg, subscription);

      if (verification.isMatch) {
        listenerLog.info(
          {
            event: "llm_verified",
            subscriptionId: subscription.id,
            confidence: verification.confidence.toFixed(3),
            ngramScore: candidate.ngramScore?.toFixed(3),
            matchedItems: verification.matchedItems.length,
            matchedPhotos: verification.matchedPhotoIndices.length,
          },
          "Match verified"
        );

        // Save analysis as matched
        const notifiedAt = Math.floor(Date.now() / 1000);
        queries.saveAnalysis({
          subscriptionId: subscription.id,
          messageId: incomingMsg.id,
          groupId: incomingMsg.group_id,
          result: "matched",
          ngramScore: candidate.ngramScore,
          semanticScore: candidate.semanticScore,
          llmConfidence: verification.confidence,
          llmReasoning: verification.reasoning,
          notifiedAt,
        });

        // Also mark in old table for backward compatibility
        queries.markMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id);

        // Save media to disk if present
        if (incomingMsg.media && incomingMsg.media.length > 0) {
          await saveMediaToDisk(incomingMsg.id, incomingMsg.group_id, incomingMsg.media);
        }

        // Get user telegram_id from subscription
        const userTelegramId = await getUserTelegramId(subscription.user_id);
        if (userTelegramId) {
          // Build notification text from matched items only
          const notificationText =
            verification.matchedItems.length > 0
              ? verification.matchedItems.map(item => `・${item.trim()}`).join("\n")
              : originalText;

          // Filter media to only include photos from matched items
          let notificationMedia = incomingMsg.media;
          if (
            verification.matchedPhotoIndices.length > 0 &&
            incomingMsg.media &&
            incomingMsg.media.length > verification.matchedPhotoIndices.length
          ) {
            // Only filter if we actually have fewer matched photos than total
            notificationMedia = verification.matchedPhotoIndices.map((i) => incomingMsg.media![i]!);
          }

          // Check if notification should be delayed (priority system)
          const { shouldDelay, hasPremiumCompetition } = shouldDelayNotification(
            userTelegramId,
            incomingMsg.id,
            incomingMsg.group_id
          );

          if (shouldDelay) {
            // Queue for delayed delivery
            queueDelayedNotification({
              telegramId: userTelegramId,
              groupTitle: incomingMsg.group_title,
              groupUsername: incomingMsg.group_username,
              messageText: notificationText,
              subscriptionQuery: subscription.original_query,
              messageId: incomingMsg.id,
              groupId: incomingMsg.group_id,
              senderName: incomingMsg.sender_name,
              senderUsername: incomingMsg.sender_username,
              media: notificationMedia,
              reasoning: verification.reasoning,
              subscriptionId: subscription.id,
              competitorCount: roundedCompetitorCount,
            });
            listenerLog.info(
              {
                event: "notification_delayed",
                userId: userTelegramId,
                subscriptionId: subscription.id,
                hasPremiumCompetition,
              },
              "Notification delayed for Free user"
            );
          } else {
            // Send immediately (Premium user OR no Premium competition)
            await notifyUser(
              userTelegramId,
              incomingMsg.group_title,
              incomingMsg.group_username,
              notificationText,
              subscription.original_query,
              incomingMsg.id,
              incomingMsg.group_id,
              incomingMsg.sender_name,
              incomingMsg.sender_username,
              notificationMedia,
              verification.reasoning,
              subscription.id,
              roundedCompetitorCount
            );
            listenerLog.info(
              {
                event: "notification_sent",
                userId: userTelegramId,
                subscriptionId: subscription.id,
                groupTitle: incomingMsg.group_title,
                hasMedia: !!notificationMedia?.length,
                filteredMedia: notificationMedia?.length !== incomingMsg.media?.length,
              },
              "User notified"
            );
          }
        }
      } else {
        // Save analysis as LLM rejected
        queries.saveAnalysis({
          subscriptionId: subscription.id,
          messageId: incomingMsg.id,
          groupId: incomingMsg.group_id,
          result: "rejected_llm",
          ngramScore: candidate.ngramScore,
          semanticScore: candidate.semanticScore,
          llmConfidence: verification.confidence,
          llmReasoning: verification.reasoning,
        });

        listenerLog.debug(
          {
            event: "llm_rejected",
            subscriptionId: subscription.id,
            confidence: verification.confidence.toFixed(3),
          },
          "LLM rejected"
        );
      }
    } catch (error) {
      listenerLog.error({ err: error, subscriptionId: subscription.id }, "LLM verification failed");
      // On LLM error, skip verification and notify anyway if score is high enough
      if ((candidate.ngramScore ?? 0) > 0.7) {
        listenerLog.warn(
          { subscriptionId: subscription.id, score: candidate.ngramScore?.toFixed(3) },
          "Fallback: notifying due to high score"
        );

        const notifiedAt = Math.floor(Date.now() / 1000);
        queries.saveAnalysis({
          subscriptionId: subscription.id,
          messageId: incomingMsg.id,
          groupId: incomingMsg.group_id,
          result: "matched",
          ngramScore: candidate.ngramScore,
          semanticScore: candidate.semanticScore,
          notifiedAt,
        });
        queries.markMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id);

        // Save media to disk if present
        if (incomingMsg.media && incomingMsg.media.length > 0) {
          await saveMediaToDisk(incomingMsg.id, incomingMsg.group_id, incomingMsg.media);
        }

        const userTelegramId = await getUserTelegramId(subscription.user_id);
        if (userTelegramId) {
          // Use originalText for notification (shows URL instead of fetched content)
          await notifyUser(
            userTelegramId,
            incomingMsg.group_title,
            incomingMsg.group_username,
            originalText,
            subscription.original_query,
            incomingMsg.id,
            incomingMsg.group_id,
            incomingMsg.sender_name,
            incomingMsg.sender_username,
            incomingMsg.media,
            `Высокий скор совпадения: ${((candidate.ngramScore ?? 0) * 100).toFixed(0)}%`,
            subscription.id,
            roundedCompetitorCount
          );
        }
      }
    } finally {
      // Release lock
      processingMessages.delete(lockKey);
    }
  }
}

// Helper to get user telegram_id
async function getUserTelegramId(userId: number): Promise<number | null> {
  // We need to add this query to db/index.ts
  // For now, query directly
  const { db } = await import("../db/index.ts");
  const result = db
    .prepare<{ telegram_id: number }, [number]>("SELECT telegram_id FROM users WHERE id = ?")
    .get(userId);
  return result?.telegram_id ?? null;
}

// Setup message handler
export function setupMessageHandler(): void {
  // Handle new messages
  mtClient.onNewMessage.add(async (msg) => {
    try {
      // Add to cache
      const cached = messageToCached(msg);
      if (cached) {
        addMessage(cached);
      }

      // Process for subscriptions
      await processMessage(msg);
    } catch (error) {
      listenerLog.error({ err: error }, "Error processing message");
    }
  });

  // Handle edited messages
  mtClient.onEditMessage.add((msg) => {
    try {
      if (msg.chat.type === "chat" && msg.chat.isGroup && msg.text) {
        updateMessage(msg.chat.id, msg.id, msg.text);
      }
    } catch (error) {
      listenerLog.error({ err: error }, "Error handling edit");
    }
  });

  // Handle deleted messages
  mtClient.onDeleteMessage.add((upd) => {
    try {
      // upd contains messageIds and optionally channelId
      const chatId = upd.channelId ?? 0;
      for (const msgId of upd.messageIds) {
        deleteMessage(chatId, msgId);
      }
    } catch (error) {
      listenerLog.error({ err: error }, "Error handling delete");
    }
  });

  listenerLog.info("Message handlers registered");
}

// Reconnect MTProto client (for retry logic)
async function reconnectClient(): Promise<void> {
  listenerLog.info("Reconnecting MTProto client...");

  try {
    await mtClient.destroy();
  } catch (e) {
    listenerLog.warn({ err: e }, "Error destroying client (continuing anyway)");
  }

  // Create NEW client instance (destroyed client cannot be restarted)
  mtClient = new TelegramClient({
    apiId: API_ID,
    apiHash: API_HASH!,
    storage: "userbot.session",
  });

  const user = await mtClient.start({
    phone: () => mtClient.input("Phone number: "),
    code: () => mtClient.input("Code: "),
    password: () => mtClient.input("2FA Password: "),
  });

  setupMessageHandler();
  listenerLog.info({ userId: user.id, name: user.displayName }, "MTProto client reconnected");
}

// Extract topic ID from message reply info (for forum groups)
function extractTopicId(msg: Message): number | undefined {
  // In forum groups, messages have replyTo.topMsgId pointing to the topic
  const replyTo = msg.replyToMessage;
  if (replyTo && "topMsgId" in replyTo) {
    return (replyTo as { topMsgId?: number }).topMsgId;
  }
  // Also check raw if available
  const raw = msg.raw as { reply_to?: { reply_to_top_id?: number } };
  if (raw?.reply_to?.reply_to_top_id) {
    return raw.reply_to.reply_to_top_id;
  }
  return undefined;
}

// Convert Message to CachedMessage
function messageToCached(msg: Message): CachedMessage | null {
  if (!msg.text) return null;

  const chat = msg.chat;
  if (chat.type !== "chat" || !chat.isGroup) return null;

  const topicId = extractTopicId(msg);

  return {
    id: msg.id,
    groupId: chat.id,
    groupTitle: chat.title || "Unknown",
    topicId,
    text: msg.text,
    senderId: msg.sender?.id,
    senderName: msg.sender?.displayName,
    senderUsername: msg.sender?.username ?? undefined,
    date: Math.floor(msg.date.getTime() / 1000),
  };
}

// Start the MTProto client
export async function startListener(): Promise<void> {
  listenerLog.info("Starting MTProto client...");

  const user = await mtClient.start({
    phone: () => mtClient.input("Phone number: "),
    code: () => mtClient.input("Code: "),
    password: () => mtClient.input("2FA Password: "),
  });

  listenerLog.info({ userId: user.id, name: user.displayName }, "Logged in");

  // Setup handlers immediately - bot is ready
  setupMessageHandler();

  // Load history in background (non-blocking)
  loadAllGroupsHistory().catch((e) => listenerLog.error({ err: e }, "Failed to load history"));
}

// Load history for all monitored groups
async function loadAllGroupsHistory(): Promise<void> {
  // Get all unique groups from subscriptions
  const groupIds = queries.getAllSubscriptionGroupIds();

  listenerLog.info({ groupCount: groupIds.length }, "Starting history load for groups");

  for (const groupId of groupIds) {
    try {
      await loadGroupHistory(groupId, HISTORY_LIMIT);
      setCacheReady(groupId, true);
      listenerLog.info({ groupId, ...getCacheStats() }, "Group history loaded");
    } catch (error) {
      listenerLog.error({ err: error, groupId }, "Failed to load group history");
    }

    // Rate limit delay between groups
    if (groupIds.indexOf(groupId) < groupIds.length - 1) {
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  listenerLog.info({ ...getCacheStats() }, "All groups history loaded");
}

// Load history for a single group with retry logic and client reconnection
async function loadGroupHistory(groupId: number, limit: number): Promise<void> {
  let groupTitle = "Unknown";

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const chat = await mtClient.getChat(groupId);
      groupTitle = chat.title || "Unknown";

      // Check if this is a forum group with topics
      const isForum = chat.chatType === "supergroup" && chat.isForum;

      // Check for existing messages to enable incremental load
      const lastMessageId = queries.getLastMessageId(groupId);
      if (lastMessageId) {
        listenerLog.info({ groupId, groupTitle, lastMessageId }, "Incremental load from last message");
      } else {
        listenerLog.info({ groupId, groupTitle }, "Full history load (first run)");
      }

      if (isForum) {
        // Load forum topics first
        const topics: ForumTopic[] = [];
        for await (const topic of mtClient.iterForumTopics(groupId)) {
          topics.push(topic);
          saveTopic(groupId, topic.id, topic.title);
        }

        listenerLog.info({ groupId, groupTitle, topicCount: topics.length }, "Loading forum history");

        const limitPerTopic = Math.max(100, Math.ceil(limit / Math.max(topics.length, 1)));
        let totalCount = 0;

        for (const topic of topics) {
          let topicCount = 0;
          for await (const msg of mtClient.iterSearchMessages({
            chatId: groupId,
            threadId: topic.id,
            query: "",
            limit: limitPerTopic,
            minId: lastMessageId ?? undefined,
          })) {
            if (msg.text) {
              addMessage({
                id: msg.id,
                groupId,
                groupTitle,
                topicId: topic.id,
                topicTitle: topic.title,
                text: msg.text,
                senderId: msg.sender?.id,
                senderName: msg.sender?.displayName,
                date: Math.floor(msg.date.getTime() / 1000),
              });
              topicCount++;
            }
          }
          totalCount += topicCount;
          listenerLog.debug({ topicId: topic.id, topicTitle: topic.title, count: topicCount }, "Topic loaded");
          await sleep(500); // Rate limit between topics
        }

        listenerLog.debug({ groupId, groupTitle, messagesLoaded: totalCount }, "Forum history loaded");
      } else {
        // Regular group - use iterHistory
        let count = 0;
        for await (const msg of mtClient.iterHistory(groupId, { limit, minId: lastMessageId ?? undefined })) {
          if (msg.text) {
            const topicId = extractTopicId(msg);
            addMessage({
              id: msg.id,
              groupId,
              groupTitle,
              topicId,
              text: msg.text,
              senderId: msg.sender?.id,
              senderName: msg.sender?.displayName,
              date: Math.floor(msg.date.getTime() / 1000),
            });
            count++;
          }
        }
        listenerLog.debug({ groupId, groupTitle, messagesLoaded: count }, "History loaded");
      }

      return; // success
    } catch (e) {
      // FloodWait — wait the specified time
      if (tl.RpcError.is(e, "FLOOD_WAIT_%d")) {
        const seconds = (e as tl.RpcError & { seconds: number }).seconds;
        listenerLog.warn({ seconds, groupId, groupTitle }, "FloodWait, waiting...");
        await sleep(seconds * 1000);
        continue;
      }

      // Retry for CHANNEL_INVALID and network errors
      const isRetryable =
        tl.RpcError.is(e, "CHANNEL_INVALID") ||
        (e instanceof Error && e.message.includes("network"));

      if (isRetryable && attempt < RETRY_ATTEMPTS) {
        const delay = Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt - 1), RETRY_MAX_DELAY);

        listenerLog.warn(
          {
            groupId,
            groupTitle,
            attempt: `${attempt}/${RETRY_ATTEMPTS}`,
            delayMs: delay,
            errorCode: e instanceof tl.RpcError ? e.code : null,
            errorText: e instanceof tl.RpcError ? e.text : null,
            errorMessage: e instanceof Error ? e.message : String(e),
          },
          `Retrying in ${delay / 1000}s with client reconnect...`
        );

        await sleep(delay);

        // Reconnect client before next attempt
        try {
          await reconnectClient();
        } catch (reconnectErr) {
          listenerLog.error({ err: reconnectErr }, "Failed to reconnect client");
        }
        continue;
      }

      // All attempts exhausted or non-retryable error
      listenerLog.error(
        {
          groupId,
          groupTitle,
          attemptsExhausted: attempt,
          errorCode: e instanceof tl.RpcError ? e.code : null,
          errorText: e instanceof tl.RpcError ? e.text : null,
          errorMessage: e instanceof Error ? e.message : String(e),
        },
        "Failed to load group history after all retries"
      );
      throw e;
    }
  }
}

// Stop the client
export async function stopListener(): Promise<void> {
  listenerLog.info("Stopping MTProto client...");
  await mtClient.destroy();
}

// Get list of groups where userbot is a member
export interface UserGroup {
  id: number;
  title: string;
  type: "group" | "supergroup";
}

export async function getUserGroups(): Promise<UserGroup[]> {
  const groups: UserGroup[] = [];

  for await (const dialog of mtClient.iterDialogs()) {
    const peer = dialog.peer;
    // peer.type is "chat" for Chat and "user" for User
    if (peer.type === "chat" && peer.isGroup) {
      const chatType = peer.chatType; // "group" | "supergroup" | "channel" | "gigagroup"
      if (chatType === "group" || chatType === "supergroup" || chatType === "gigagroup") {
        groups.push({
          id: peer.id,
          title: peer.title || "Unknown",
          type: chatType === "group" ? "group" : "supergroup",
        });
      }
    }
  }

  return groups;
}

// Scan group history for matches
export async function scanGroupHistory(
  groupId: number,
  subscriptionId: number,
  limit: number = 100
): Promise<number> {
  listenerLog.info({ groupId, subscriptionId, limit }, "Scanning history");

  const subscription = queries.getSubscriptionByIdOnly(subscriptionId);
  if (!subscription) {
    listenerLog.warn({ subscriptionId }, "Subscription not found");
    return 0;
  }

  listenerLog.debug(
    {
      positiveKw: subscription.positive_keywords,
      negativeKw: subscription.negative_keywords,
    },
    "Subscription keywords"
  );

  let matchCount = 0;
  let processedCount = 0;
  let candidateCount = 0;

  try {
    for await (const msg of mtClient.iterHistory(groupId, { limit })) {
      // Skip messages without text and without photo/video
      const hasMedia = msg.media?.type === "photo" || msg.media?.type === "video";
      if (!msg.text && !hasMedia) continue;

      const incomingMsg = await toIncomingMessage(msg);
      if (!incomingMsg) continue;

      processedCount++;

      // Debug: show first few messages
      if (processedCount <= 3) {
        listenerLog.debug(
          { n: processedCount, textPreview: incomingMsg.text.slice(0, 100) },
          "Sample message"
        );
      }

      // Check against the specific subscription
      const candidates = await matchMessageAgainstAll(incomingMsg, [subscription]);
      if (candidates.length === 0) continue;

      candidateCount++;
      const topCandidate = candidates[0];
      if (topCandidate) {
        listenerLog.info(
          {
            textPreview: incomingMsg.text.slice(0, 60),
            score: (topCandidate.ngramScore ?? 0).toFixed(3),
          },
          "Candidate found"
        );
      }

      for (const candidate of candidates) {
        const { subscription } = candidate;

        // Check deduplication
        if (queries.isMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id)) {
          continue;
        }

        try {
          const verification = await verifyMatch(incomingMsg, subscription);

          if (verification.isMatch) {
            matchCount++;
            queries.markMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id);

            // Save media to disk if present
            if (incomingMsg.media && incomingMsg.media.length > 0) {
              await saveMediaToDisk(incomingMsg.id, incomingMsg.group_id, incomingMsg.media);
            }

            const userTelegramId = await getUserTelegramId(subscription.user_id);
            if (userTelegramId) {
              await notifyUser(
                userTelegramId,
                incomingMsg.group_title,
                incomingMsg.group_username,
                incomingMsg.text,
                subscription.original_query,
                incomingMsg.id,
                incomingMsg.group_id,
                incomingMsg.sender_name,
                incomingMsg.sender_username,
                incomingMsg.media,
                verification.reasoning,
                subscription.id
              );
            }
          }
        } catch (error) {
          // On LLM error, use score threshold
          const candidateScore = candidate.ngramScore ?? 0;
          if (candidateScore > 0.7) {
            matchCount++;
            queries.markMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id);

            // Save media to disk if present
            if (incomingMsg.media && incomingMsg.media.length > 0) {
              await saveMediaToDisk(incomingMsg.id, incomingMsg.group_id, incomingMsg.media);
            }

            const userTelegramId = await getUserTelegramId(subscription.user_id);
            if (userTelegramId) {
              await notifyUser(
                userTelegramId,
                incomingMsg.group_title,
                incomingMsg.group_username,
                incomingMsg.text,
                subscription.original_query,
                incomingMsg.id,
                incomingMsg.group_id,
                incomingMsg.sender_name,
                incomingMsg.sender_username,
                incomingMsg.media,
                `Высокий скор совпадения: ${(candidateScore * 100).toFixed(0)}%`,
                subscription.id
              );
            }
          }
        }
      }
    }
  } catch (error) {
    listenerLog.error({ err: error, groupId }, "Error scanning group");
  }

  listenerLog.info(
    { processed: processedCount, candidates: candidateCount, matches: matchCount },
    "Scan complete"
  );
  return matchCount;
}

// Result of a history scan match
export interface HistoryScanMatch {
  messageId: number;
  groupId: number;
  groupTitle: string;
  text: string;
  score: number;
  senderName?: string;
  senderUsername?: string;
  reasoning?: string;
}

export interface HistoryScanResult {
  matches: HistoryScanMatch[];
  total: number;
  processed: number;
}

// Max candidates to verify with LLM (cost control)
const MAX_LLM_VERIFICATIONS = 20;

// Scan messages from in-memory cache with LLM verification
// Returns paginated results - caller handles notifications
export async function scanFromCache(
  groupIds: number[],
  subscriptionId: number,
  options: { limit?: number; offset?: number; notify?: boolean } = {}
): Promise<HistoryScanResult> {
  const { limit = 5, offset = 0, notify = false } = options;

  listenerLog.info({ groupIds, subscriptionId, limit, offset }, "Scanning from cache");

  const subscription = queries.getSubscriptionByIdOnly(subscriptionId);
  if (!subscription) {
    listenerLog.warn({ subscriptionId }, "Subscription not found for cache scan");
    return { matches: [], total: 0, processed: 0 };
  }

  // Phase 1: Find candidates via semantic search (fast, uses embeddings in SQLite)
  interface SearchCandidate {
    id: number;
    messageId: number;
    groupId: number;
    groupTitle: string;
    text: string;
    score: number;
    senderName?: string;
    senderUsername?: string;
  }

  let candidates: SearchCandidate[] = [];
  let processedCount = 0;
  const useSemanticSearch = await isSemanticSearchAvailable();

  if (useSemanticSearch) {
    // Semantic search: fast vector search in SQLite
    listenerLog.info({ subscriptionId, groupIds }, "Using semantic search for history scan");

    try {
      const searchResults = await semanticSearch(
        subscription.llm_description,
        MAX_LLM_VERIFICATIONS * 2, // fetch extra for deduplication
        groupIds.length > 0 ? groupIds : undefined
      );

      processedCount = searchResults.length;

      // Filter out already matched and convert to candidates
      for (const result of searchResults) {
        if (queries.isMessageMatched(subscriptionId, result.messageId, result.groupId)) {
          continue;
        }

        candidates.push({
          id: result.id,
          messageId: result.messageId,
          groupId: result.groupId,
          groupTitle: result.groupTitle ?? "",
          text: result.text,
          score: 1 - result.distance, // distance → score
          senderName: result.senderName ?? undefined,
          senderUsername: result.senderUsername ?? undefined,
        });
      }

      // Limit to max verifications
      candidates = candidates.slice(0, MAX_LLM_VERIFICATIONS);
    } catch (error) {
      listenerLog.warn({ error }, "Semantic search failed, falling back to N-gram");
      candidates = [];
    }
  }

  // Fallback: N-gram search if semantic unavailable or failed
  if (candidates.length === 0 && !useSemanticSearch) {
    listenerLog.info({ subscriptionId, groupIds }, "Using N-gram fallback for history scan");

    for (const groupId of groupIds) {
      const messages = getMessages(groupId);
      listenerLog.debug({ groupId, messageCount: messages.length }, "Scanning cached messages");

      for (const msg of messages) {
        processedCount++;

        if (queries.isMessageMatched(subscriptionId, msg.id, groupId)) {
          continue;
        }

        const incomingMsg: IncomingMessage = {
          id: msg.id,
          group_id: msg.groupId,
          group_title: msg.groupTitle,
          text: msg.text,
          sender_name: msg.senderName || "Unknown",
          sender_username: msg.senderUsername,
          timestamp: new Date(msg.date * 1000),
        };

        const matchResults = await matchMessageAgainstAll(incomingMsg, [subscription]);
        if (matchResults.length > 0 && matchResults[0]) {
          candidates.push({
            id: 0,
            messageId: msg.id,
            groupId: msg.groupId,
            groupTitle: msg.groupTitle,
            text: msg.text,
            score: matchResults[0].ngramScore ?? 0,
            senderName: msg.senderName,
            senderUsername: msg.senderUsername,
          });
        }
      }
    }

    // Sort by score and limit
    candidates.sort((a, b) => b.score - a.score);
    candidates = candidates.slice(0, MAX_LLM_VERIFICATIONS);
  }

  listenerLog.info({
    candidates: candidates.length,
    processed: processedCount,
    method: useSemanticSearch ? "semantic" : "ngram",
  }, "Phase 1 complete, starting batch LLM verification");

  // Phase 2: Batch LLM verification
  const allMatches: HistoryScanMatch[] = [];

  if (candidates.length > 0) {
    // Prepare batch input
    const batchInput = candidates.map((c, index) => ({
      index,
      message: {
        id: c.messageId,
        group_id: c.groupId,
        group_title: c.groupTitle,
        text: c.text,
        sender_name: c.senderName || "Unknown",
        sender_username: c.senderUsername,
        timestamp: new Date(),
      } as IncomingMessage,
    }));

    try {
      const batchResults = await verifyMatchBatch(batchInput, subscription);

      for (const [index, result] of batchResults) {
        const candidate = candidates[index];
        if (!candidate) continue;

        if (result.isMatch) {
          allMatches.push({
            messageId: candidate.messageId,
            groupId: candidate.groupId,
            groupTitle: candidate.groupTitle,
            text: candidate.text,
            score: candidate.score,
            senderName: candidate.senderName,
            senderUsername: candidate.senderUsername,
            reasoning: result.reasoning,
          });
          queries.markMessageMatched(subscriptionId, candidate.messageId, candidate.groupId);
        }
      }
    } catch (error) {
      listenerLog.error({ error }, "Batch verification failed, falling back to sequential");

      // Fallback: sequential verification
      for (const candidate of candidates) {
        try {
          const incomingMsg: IncomingMessage = {
            id: candidate.messageId,
            group_id: candidate.groupId,
            group_title: candidate.groupTitle,
            text: candidate.text,
            sender_name: candidate.senderName || "Unknown",
            sender_username: candidate.senderUsername,
            timestamp: new Date(),
          };

          const verification = await verifyMatch(incomingMsg, subscription);
          if (verification.isMatch) {
            allMatches.push({
              messageId: candidate.messageId,
              groupId: candidate.groupId,
              groupTitle: candidate.groupTitle,
              text: candidate.text,
              score: candidate.score,
              senderName: candidate.senderName,
              senderUsername: candidate.senderUsername,
              reasoning: verification.reasoning,
            });
            queries.markMessageMatched(subscriptionId, candidate.messageId, candidate.groupId);
          }
        } catch {
          // Skip on error
        }
      }
    }
  }

  // Sort by score descending
  allMatches.sort((a, b) => b.score - a.score);

  // Apply pagination
  const paginatedMatches = allMatches.slice(offset, offset + limit);

  listenerLog.info(
    {
      subscriptionId,
      processed: processedCount,
      candidates: candidates.length,
      matches: allMatches.length,
      returned: paginatedMatches.length,
      method: useSemanticSearch ? "semantic" : "ngram",
    },
    "Cache scan complete"
  );

  // Optionally notify for this page of results
  if (notify && paginatedMatches.length > 0) {
    const userTelegramId = await getUserTelegramId(subscription.user_id);
    if (userTelegramId) {
      for (const match of paginatedMatches) {
        await notifyUser(
          userTelegramId,
          match.groupTitle,
          undefined, // no group username in cache scan
          match.text,
          subscription.original_query,
          match.messageId,
          match.groupId,
          match.senderName,
          match.senderUsername,
          undefined, // no media in cache scan
          match.reasoning,
          subscription.id
        );
      }
    }
  }

  return {
    matches: paginatedMatches,
    total: allMatches.length,
    processed: processedCount,
  };
}

// Check if userbot is member of a chat by trying to resolve it
export async function isUserbotMember(chatId: number): Promise<boolean> {
  try {
    // Try to get chat info - if it works, we're a member
    await mtClient.getChat(chatId);
    return true;
  } catch {
    return false;
  }
}

// Join a chat by username or invite link
export async function joinGroupByUserbot(
  target: string // @username or t.me/+XXX invite link
): Promise<{ success: true; chatId: number; title: string } | { success: false; error: string }> {
  try {
    const chat = await mtClient.joinChat(target);
    listenerLog.info({ chatId: chat.id, title: chat.title, target }, "Userbot joined chat");
    return { success: true, chatId: chat.id, title: chat.title || "" };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    listenerLog.error({ err: error, target }, "Failed to join chat");

    if (errMsg.includes("USER_ALREADY_PARTICIPANT")) {
      // Already member - try to get chat info
      try {
        const chat = await mtClient.getChat(target);
        return { success: true, chatId: chat.id, title: chat.title || "" };
      } catch {
        return { success: false, error: "Already member but cannot get info" };
      }
    }

    if (errMsg.includes("INVITE_REQUEST_SENT")) {
      return { success: false, error: "Запрос отправлен администраторам" };
    }

    if (errMsg.includes("INVITE_HASH_EXPIRED")) {
      return { success: false, error: "Ссылка устарела" };
    }

    if (errMsg.includes("INVITE_HASH_INVALID")) {
      return { success: false, error: "Неверная ссылка" };
    }

    return { success: false, error: errMsg || "Join failed" };
  }
}

// Ensure userbot is in group (join if needed)
export async function ensureUserbotInGroup(
  chatId: number,
  username?: string,
  inviteLink?: string
): Promise<{ success: boolean; error?: string }> {
  // Check if already a member
  if (await isUserbotMember(chatId)) {
    listenerLog.debug({ chatId }, "Already member");
    return { success: true };
  }

  // Try join by username
  if (username) {
    const cleanUsername = username.replace(/^@/, "");
    const result = await joinGroupByUserbot(`@${cleanUsername}`);
    if (result.success) return { success: true };
    // Don't return error yet, try invite link
  }

  // Try join by invite link
  if (inviteLink) {
    const result = await joinGroupByUserbot(inviteLink);
    if (result.success) return { success: true };
    return { success: false, error: result.error };
  }

  return { success: false, error: "Нет username или invite link для присоединения" };
}
