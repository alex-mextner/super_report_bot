import { TelegramClient, Message, ForumTopic } from "@mtcute/bun";
import { tl } from "@mtcute/bun";
import { queries } from "../db/index.ts";
import { matchMessageAgainstAll, passesNgramFilter } from "../matcher/index.ts";
import { verifyMatch } from "../llm/verify.ts";
import { notifyUser } from "../bot/index.ts";
import { listenerLog } from "../logger.ts";
import type { IncomingMessage, Subscription } from "../types.ts";
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

// Convert mtcute Message to our IncomingMessage
function toIncomingMessage(msg: Message): IncomingMessage | null {
  if (!msg.text) return null;

  const chat = msg.chat;
  // Only process messages from groups (Chat type, not User)
  if (chat.type !== "chat") {
    return null; // Skip DMs
  }

  // Filter to groups/supergroups only
  if (!chat.isGroup) {
    return null; // Skip channels
  }

  return {
    id: msg.id,
    group_id: chat.id,
    group_title: chat.title || "Unknown",
    text: msg.text,
    sender_name: msg.sender?.displayName || "Unknown",
    timestamp: msg.date,
  };
}

// Process incoming message
async function processMessage(msg: Message): Promise<void> {
  const incomingMsg = toIncomingMessage(msg);
  if (!incomingMsg) return;

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

  // Stage 1-2: N-gram + BGE-M3 semantic matching
  const candidates = await matchMessageAgainstAll(incomingMsg, subscriptions);
  if (candidates.length === 0) return;

  listenerLog.info(
    {
      event: "candidates_found",
      count: candidates.length,
      topScore: candidates[0]?.score.toFixed(3),
      textPreview: incomingMsg.text.slice(0, 50),
    },
    "Candidates found"
  );

  // Stage 3: LLM verification for each candidate
  for (const candidate of candidates) {
    const { subscription } = candidate;

    // Check deduplication
    if (queries.isMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id)) {
      listenerLog.debug(
        { subscriptionId: subscription.id, messageId: incomingMsg.id },
        "Duplicate skipped"
      );
      continue;
    }

    try {
      const verification = await verifyMatch(incomingMsg, subscription);

      if (verification.isMatch) {
        listenerLog.info(
          {
            event: "llm_verified",
            subscriptionId: subscription.id,
            confidence: verification.confidence.toFixed(3),
            ngramScore: candidate.score.toFixed(3),
          },
          "Match verified"
        );

        // Mark as matched
        queries.markMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id);

        // Get user telegram_id from subscription
        const userTelegramId = await getUserTelegramId(subscription.user_id);
        if (userTelegramId) {
          await notifyUser(
            userTelegramId,
            incomingMsg.group_title,
            incomingMsg.text,
            subscription.original_query,
            incomingMsg.id,
            incomingMsg.group_id
          );
          listenerLog.info(
            {
              event: "notification_sent",
              userId: userTelegramId,
              subscriptionId: subscription.id,
              groupTitle: incomingMsg.group_title,
            },
            "User notified"
          );
        }
      } else {
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
      if (candidate.score > 0.7) {
        listenerLog.warn(
          { subscriptionId: subscription.id, score: candidate.score.toFixed(3) },
          "Fallback: notifying due to high score"
        );
        queries.markMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id);
        const userTelegramId = await getUserTelegramId(subscription.user_id);
        if (userTelegramId) {
          await notifyUser(
            userTelegramId,
            incomingMsg.group_title,
            incomingMsg.text,
            subscription.original_query,
            incomingMsg.id,
            incomingMsg.group_id
          );
        }
      }
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
        for await (const msg of mtClient.iterHistory(groupId, { limit })) {
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
      if (!msg.text) continue;

      const incomingMsg = toIncomingMessage(msg);
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
            score: topCandidate.score.toFixed(3),
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

            const userTelegramId = await getUserTelegramId(subscription.user_id);
            if (userTelegramId) {
              await notifyUser(
                userTelegramId,
                incomingMsg.group_title,
                incomingMsg.text,
                subscription.original_query,
                incomingMsg.id,
                incomingMsg.group_id
              );
            }
          }
        } catch (error) {
          // On LLM error, use score threshold
          if (candidate.score > 0.7) {
            matchCount++;
            queries.markMessageMatched(subscription.id, incomingMsg.id, incomingMsg.group_id);
            const userTelegramId = await getUserTelegramId(subscription.user_id);
            if (userTelegramId) {
              await notifyUser(
                userTelegramId,
                incomingMsg.group_title,
                incomingMsg.text,
                subscription.original_query,
                incomingMsg.id,
                incomingMsg.group_id
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

  // Wait for cache to be ready for all groups
  for (const groupId of groupIds) {
    let waitCount = 0;
    while (!isCacheReady(groupId)) {
      waitCount++;
      if (waitCount === 1) {
        listenerLog.info({ groupId }, "Waiting for cache to be ready...");
      }
      await sleep(1000);

      // Timeout after 5 minutes
      if (waitCount > 300) {
        listenerLog.warn({ groupId }, "Cache wait timeout, skipping group");
        break;
      }
    }
  }

  // Phase 1: Collect n-gram candidates (cheap)
  interface NgramCandidate {
    msg: CachedMessage;
    incomingMsg: IncomingMessage;
    score: number;
  }
  const ngramCandidates: NgramCandidate[] = [];
  let processedCount = 0;

  for (const groupId of groupIds) {
    if (!isCacheReady(groupId)) continue;

    const messages = getMessages(groupId);
    listenerLog.debug({ groupId, messageCount: messages.length }, "Scanning cached messages");

    for (const msg of messages) {
      processedCount++;

      // Check deduplication
      if (queries.isMessageMatched(subscriptionId, msg.id, groupId)) {
        continue;
      }

      // Convert to IncomingMessage format
      const incomingMsg: IncomingMessage = {
        id: msg.id,
        group_id: msg.groupId,
        group_title: msg.groupTitle,
        text: msg.text,
        sender_name: msg.senderName || "Unknown",
        timestamp: new Date(msg.date * 1000),
      };

      // N-gram + semantic matching (cheap, local)
      const candidates = await matchMessageAgainstAll(incomingMsg, [subscription]);
      if (candidates.length === 0) continue;

      const topCandidate = candidates[0];
      if (topCandidate) {
        ngramCandidates.push({
          msg,
          incomingMsg,
          score: topCandidate.score,
        });
      }
    }
  }

  // Sort by n-gram score descending
  ngramCandidates.sort((a, b) => b.score - a.score);

  // Phase 2: LLM verification only for top candidates (expensive)
  const topCandidates = ngramCandidates.slice(0, MAX_LLM_VERIFICATIONS);
  const allMatches: HistoryScanMatch[] = [];
  let llmMatchCount = 0;

  listenerLog.info({
    ngramCandidates: ngramCandidates.length,
    verifying: topCandidates.length,
  }, "N-gram phase complete, starting LLM verification");

  for (const { msg, incomingMsg, score } of topCandidates) {
    try {
      const verification = await verifyMatch(incomingMsg, subscription);

      if (verification.isMatch) {
        llmMatchCount++;
        allMatches.push({
          messageId: msg.id,
          groupId: msg.groupId,
          groupTitle: msg.groupTitle,
          text: msg.text,
          score,
        });
        queries.markMessageMatched(subscriptionId, msg.id, msg.groupId);
      }
    } catch (error) {
      // On LLM error, use high n-gram score threshold only
      if (score > 0.8) {
        llmMatchCount++;
        allMatches.push({
          messageId: msg.id,
          groupId: msg.groupId,
          groupTitle: msg.groupTitle,
          text: msg.text,
          score,
        });
        queries.markMessageMatched(subscriptionId, msg.id, msg.groupId);

        listenerLog.warn({ msgId: msg.id, score: score.toFixed(3) }, "LLM error, high score fallback");
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
      ngramCandidates: ngramCandidates.length,
      llmVerified: topCandidates.length,
      llmMatches: llmMatchCount,
      total: allMatches.length,
      returned: paginatedMatches.length,
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
          match.text,
          subscription.original_query,
          match.messageId,
          match.groupId
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
