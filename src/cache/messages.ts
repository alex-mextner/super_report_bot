import { listenerLog } from "../logger.ts";

export interface CachedMessage {
  id: number;
  groupId: number;
  groupTitle: string;
  text: string;
  senderId?: number;
  senderName?: string;
  date: number; // unix timestamp
}

// Cache: groupId → Map<messageId, CachedMessage>
const messageCache = new Map<number, Map<number, CachedMessage>>();

// Cache readiness status per group
const cacheReady = new Map<number, boolean>();

const MAX_MESSAGES_PER_GROUP = 1000;

export function addMessage(msg: CachedMessage): void {
  let groupCache = messageCache.get(msg.groupId);
  if (!groupCache) {
    groupCache = new Map();
    messageCache.set(msg.groupId, groupCache);
  }

  groupCache.set(msg.id, msg);

  // Trim old messages if over limit
  if (groupCache.size > MAX_MESSAGES_PER_GROUP) {
    trimOldMessages(msg.groupId);
  }
}

export function updateMessage(groupId: number, messageId: number, newText: string): void {
  const groupCache = messageCache.get(groupId);
  if (!groupCache) return;

  const msg = groupCache.get(messageId);
  if (msg) {
    msg.text = newText;
    listenerLog.debug({ groupId, messageId }, "Message updated in cache");
  }
}

export function deleteMessage(groupId: number, messageId: number): void {
  const groupCache = messageCache.get(groupId);
  if (!groupCache) return;

  if (groupCache.delete(messageId)) {
    listenerLog.debug({ groupId, messageId }, "Message deleted from cache");
  }
}

export function getMessages(groupId: number): CachedMessage[] {
  const groupCache = messageCache.get(groupId);
  if (!groupCache) return [];

  return Array.from(groupCache.values());
}

export function isCacheReady(groupId: number): boolean {
  return cacheReady.get(groupId) ?? false;
}

export function setCacheReady(groupId: number, ready: boolean): void {
  cacheReady.set(groupId, ready);
  listenerLog.info({ groupId, ready }, "Cache ready status changed");
}

export function clearCache(): void {
  messageCache.clear();
  cacheReady.clear();
  listenerLog.info("Message cache cleared");
}

export function getCacheStats(): { groups: number; totalMessages: number } {
  let totalMessages = 0;
  for (const groupCache of messageCache.values()) {
    totalMessages += groupCache.size;
  }
  return { groups: messageCache.size, totalMessages };
}

export function getAllCachedGroupIds(): number[] {
  return Array.from(messageCache.keys());
}

export function getAllCachedMessages(): CachedMessage[] {
  const all: CachedMessage[] = [];
  for (const groupCache of messageCache.values()) {
    all.push(...groupCache.values());
  }
  return all;
}

export function getCachedMessageById(messageId: number): CachedMessage | undefined {
  for (const groupCache of messageCache.values()) {
    const msg = groupCache.get(messageId);
    if (msg) return msg;
  }
  return undefined;
}

export function getCachedGroups(): Array<{ id: number; title: string; count: number }> {
  const groups: Array<{ id: number; title: string; count: number }> = [];
  for (const [groupId, groupCache] of messageCache.entries()) {
    const firstMsg = groupCache.values().next().value;
    groups.push({
      id: groupId,
      title: firstMsg?.groupTitle ?? `Group ${groupId}`,
      count: groupCache.size,
    });
  }
  return groups;
}

// Remove oldest messages when over limit
function trimOldMessages(groupId: number): void {
  const groupCache = messageCache.get(groupId);
  if (!groupCache || groupCache.size <= MAX_MESSAGES_PER_GROUP) return;

  // Sort by date and remove oldest
  const messages = Array.from(groupCache.values()).sort((a, b) => a.date - b.date);
  const toRemove = messages.slice(0, groupCache.size - MAX_MESSAGES_PER_GROUP);

  for (const msg of toRemove) {
    groupCache.delete(msg.id);
  }

  listenerLog.debug({ groupId, removed: toRemove.length }, "Trimmed old messages");
}
