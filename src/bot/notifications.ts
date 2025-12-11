/**
 * Priority Notifications System
 *
 * Logic:
 * - Premium users (Basic+) get instant notifications
 * - Free users wait 4 minutes IF Premium users also matched the same product
 * - If no Premium users matched → Free users also get instant notification
 *
 * This creates competitive advantage for paying users without blocking
 * Free users from receiving notifications entirely.
 */

import { queries } from "../db/index.ts";
import { hasPriorityNotifications } from "./payments.ts";
import { botLog } from "../logger.ts";
import type { MediaItem } from "../types.ts";

export const PRIORITY_DELAY_MS = 4 * 60 * 1000; // 4 minutes

export interface DelayedNotification {
  telegramId: number;
  groupTitle: string;
  groupUsername?: string;
  messageText: string;
  subscriptionQuery: string;
  messageId: number;
  groupId: number;
  senderName?: string;
  senderUsername?: string;
  media?: MediaItem[];
  reasoning?: string;
  subscriptionId: number;
  scheduledAt: number; // timestamp when to send
  wasDelayed: boolean; // true if delayed due to Premium competition
}

// In-memory queue for delayed notifications
const delayedQueue: DelayedNotification[] = [];

// Reference to notifyUser function (set from bot/index.ts to avoid circular import)
let notifyUserFn: ((
  telegramId: number,
  groupTitle: string,
  groupUsername: string | undefined,
  messageText: string,
  subscriptionQuery: string,
  messageId?: number,
  groupId?: number,
  senderName?: string,
  senderUsername?: string,
  media?: MediaItem[],
  reasoning?: string,
  subscriptionId?: number
) => Promise<void>) | null = null;

export function setNotifyUserFn(fn: typeof notifyUserFn): void {
  notifyUserFn = fn;
}

/**
 * Check if notification should be delayed for this user
 * Returns true if user is Free AND Premium users are hunting the same product
 */
export function shouldDelayNotification(
  telegramId: number,
  messageId: number,
  groupId: number
): { shouldDelay: boolean; hasPremiumCompetition: boolean } {
  // Premium users always get instant notifications
  if (hasPriorityNotifications(telegramId)) {
    return { shouldDelay: false, hasPremiumCompetition: false };
  }

  // Check if any Premium users have matched this specific message
  // We look at found_posts_analyzes to see if premium users already got notified
  const premiumUsers = queries.getPremiumUsersNotifiedForMessage(messageId, groupId);

  if (premiumUsers.length > 0) {
    return { shouldDelay: true, hasPremiumCompetition: true };
  }

  // No Premium competition → instant notification
  return { shouldDelay: false, hasPremiumCompetition: false };
}

/**
 * Queue notification for delayed send
 */
export function queueDelayedNotification(notification: Omit<DelayedNotification, "scheduledAt" | "wasDelayed">): void {
  const delayed: DelayedNotification = {
    ...notification,
    scheduledAt: Date.now() + PRIORITY_DELAY_MS,
    wasDelayed: true,
  };

  delayedQueue.push(delayed);
  botLog.info(
    {
      telegramId: notification.telegramId,
      messageId: notification.messageId,
      groupId: notification.groupId,
      scheduledAt: new Date(delayed.scheduledAt).toISOString(),
    },
    "Notification queued for delayed delivery"
  );
}

/**
 * Process delayed notifications queue
 * Called by interval every 30 seconds
 */
export async function processDelayedQueue(): Promise<void> {
  const now = Date.now();
  const readyToSend: DelayedNotification[] = [];

  // Find all ready notifications
  for (let i = delayedQueue.length - 1; i >= 0; i--) {
    const notification = delayedQueue[i];
    if (notification && notification.scheduledAt <= now) {
      readyToSend.push(notification);
      delayedQueue.splice(i, 1);
    }
  }

  if (readyToSend.length === 0) return;

  botLog.info({ count: readyToSend.length }, "Processing delayed notifications");

  for (const notification of readyToSend) {
    try {
      if (!notifyUserFn) {
        botLog.error("notifyUserFn not set, skipping delayed notification");
        continue;
      }

      // Add delay warning to reasoning
      const delayedReasoning = notification.wasDelayed
        ? `${notification.reasoning || ""}\n\n⏱ Этот пуш был задержан на 4 мин. Получай мгновенно с подпиской Basic!`
        : notification.reasoning;

      await notifyUserFn(
        notification.telegramId,
        notification.groupTitle,
        notification.groupUsername,
        notification.messageText,
        notification.subscriptionQuery,
        notification.messageId,
        notification.groupId,
        notification.senderName,
        notification.senderUsername,
        notification.media,
        delayedReasoning,
        notification.subscriptionId
      );

      botLog.info(
        {
          telegramId: notification.telegramId,
          messageId: notification.messageId,
          wasDelayed: notification.wasDelayed,
        },
        "Delayed notification sent"
      );
    } catch (error) {
      botLog.error({ error, telegramId: notification.telegramId }, "Failed to send delayed notification");
    }
  }
}

/**
 * Get queue stats for monitoring
 */
export function getDelayedQueueStats(): { pending: number; nextSendIn: number | null } {
  if (delayedQueue.length === 0) {
    return { pending: 0, nextSendIn: null };
  }

  const now = Date.now();
  const nextSend = Math.min(...delayedQueue.map((n) => n.scheduledAt));
  const nextSendIn = Math.max(0, nextSend - now);

  return { pending: delayedQueue.length, nextSendIn };
}

// Start the queue processor
let processorInterval: ReturnType<typeof setInterval> | null = null;

export function startDelayedQueueProcessor(): void {
  if (processorInterval) return;

  processorInterval = setInterval(() => {
    processDelayedQueue().catch((e) => botLog.error({ err: e }, "Queue processor error"));
  }, 30000); // Check every 30 seconds

  botLog.info("Delayed notification queue processor started");
}

export function stopDelayedQueueProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
    botLog.info("Delayed notification queue processor stopped");
  }
}
