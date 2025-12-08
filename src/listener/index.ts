import { TelegramClient, Message } from "@mtcute/bun";
import { queries } from "../db/index.ts";
import { matchMessageAgainstAll } from "../matcher/index.ts";
import { verifyMatch } from "../llm/verify.ts";
import { notifyUser } from "../bot/index.ts";
import { listenerLog } from "../logger.ts";
import type { IncomingMessage, Subscription } from "../types.ts";

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;

if (!API_ID || !API_HASH) {
  throw new Error("API_ID and API_HASH are required for MTProto");
}

export const mtClient = new TelegramClient({
  apiId: API_ID,
  apiHash: API_HASH,
  storage: "userbot.session",
});

// Cache subscriptions to avoid DB queries on every message
let subscriptionsCache: Subscription[] = [];
let cacheLastUpdate = 0;
const CACHE_TTL = 60000; // 1 minute

function getSubscriptions(): Subscription[] {
  const now = Date.now();
  if (now - cacheLastUpdate > CACHE_TTL) {
    subscriptionsCache = queries.getActiveSubscriptions();
    cacheLastUpdate = now;
    listenerLog.debug({ count: subscriptionsCache.length }, "Cache refreshed");
  }
  return subscriptionsCache;
}

// Invalidate cache when subscription changes
export function invalidateSubscriptionsCache(): void {
  cacheLastUpdate = 0;
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

  const subscriptions = getSubscriptions();
  if (subscriptions.length === 0) return;

  // Stage 1-2: BM25 + N-gram matching
  const candidates = matchMessageAgainstAll(incomingMsg, subscriptions);
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
            subscription.original_query
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
            subscription.original_query
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
  mtClient.onNewMessage.add(async (msg) => {
    try {
      await processMessage(msg);
    } catch (error) {
      listenerLog.error({ err: error }, "Error processing message");
    }
  });

  listenerLog.info("Message handler registered");
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

  setupMessageHandler();
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

  const subscription = getSubscriptions().find((s) => s.id === subscriptionId);
  if (!subscription) {
    listenerLog.warn({ subscriptionId }, "Subscription not found");
    return 0;
  }

  const subscriptions = [subscription];

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
      const candidates = matchMessageAgainstAll(incomingMsg, subscriptions);
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
                subscription.original_query
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
                subscription.original_query
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
