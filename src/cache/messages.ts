import { queries } from "../db/index.ts";
import { listenerLog } from "../logger.ts";
import { queueForEmbedding } from "../embeddings/queue.ts";
import type { StoredMessage } from "../types.ts";

export interface CachedMessage {
  id: number;
  groupId: number;
  groupTitle: string;
  topicId?: number;
  topicTitle?: string;
  text: string;
  senderId?: number;
  senderName?: string;
  senderUsername?: string;
  date: number; // unix timestamp
}

// Convert StoredMessage from DB to CachedMessage interface
function toCache(m: StoredMessage): CachedMessage {
  return {
    id: m.message_id,
    groupId: m.group_id,
    groupTitle: m.group_title ?? "",
    topicId: m.topic_id ?? undefined,
    topicTitle: m.topic_title ?? undefined,
    text: m.text,
    senderId: m.sender_id ?? undefined,
    senderName: m.sender_name ?? undefined,
    senderUsername: m.sender_username ?? undefined,
    date: m.timestamp,
  };
}

// Cache readiness status per group (still in-memory, used during startup)
const cacheReady = new Map<number, boolean>();

export function addMessage(msg: CachedMessage): void {
  queries.saveMessage({
    message_id: msg.id,
    group_id: msg.groupId,
    group_title: msg.groupTitle || null,
    topic_id: msg.topicId ?? null,
    topic_title: msg.topicTitle ?? null,
    text: msg.text,
    sender_id: msg.senderId ?? null,
    sender_name: msg.senderName ?? null,
    sender_username: msg.senderUsername ?? null,
    timestamp: msg.date,
  });

  // Queue for embedding indexing (async, non-blocking)
  // Skip very short messages that won't produce meaningful embeddings
  if (msg.text.length > 20) {
    const stored = queries.getMessage(msg.id, msg.groupId);
    if (stored) {
      queueForEmbedding(stored.id, msg.text);
    }
  }
}

export function updateMessage(groupId: number, messageId: number, newText: string): void {
  queries.updateMessageText(messageId, groupId, newText);
  listenerLog.debug({ groupId, messageId }, "Message updated in DB");
}

export function deleteMessage(groupId: number, messageId: number): void {
  queries.softDeleteMessage(messageId, groupId);
  listenerLog.debug({ groupId, messageId }, "Message soft-deleted in DB");
}

export function getMessages(groupId: number): CachedMessage[] {
  const messages = queries.getMessages({ groupId, limit: 1000 });
  return messages.map(toCache);
}

export function isCacheReady(groupId: number): boolean {
  return cacheReady.get(groupId) ?? false;
}

export function setCacheReady(groupId: number, ready: boolean): void {
  cacheReady.set(groupId, ready);
  listenerLog.info({ groupId, ready }, "Cache ready status changed");
}

export function clearCache(): void {
  // Don't clear DB, only reset ready status
  cacheReady.clear();
  listenerLog.info("Cache ready flags cleared");
}

export function getCacheStats(): { groups: number; totalMessages: number } {
  const groups = queries.getDistinctMessageGroups();
  const totalMessages = queries.getMessagesCount();
  return { groups: groups.length, totalMessages };
}

export function getAllCachedGroupIds(): number[] {
  const groups = queries.getDistinctMessageGroups();
  return groups.map((g) => g.group_id);
}

export function getAllCachedMessages(): CachedMessage[] {
  const messages = queries.getMessages({ limit: 10000 });
  return messages.map(toCache);
}

export function getCachedMessageById(messageId: number): CachedMessage | undefined {
  // Search in all groups - need to find by message_id only
  // Since we don't have groupId, we need a different approach
  const messages = queries.getMessages({ limit: 10000 });
  const found = messages.find((m) => m.message_id === messageId);
  return found ? toCache(found) : undefined;
}

export function getCachedGroups(): Array<{ id: number; title: string; count: number }> {
  const groups = queries.getDistinctMessageGroups();
  return groups.map((g) => ({
    id: g.group_id,
    title: g.group_title || `Group ${g.group_id}`,
    count: g.count,
  }));
}

// Topics support
export function saveTopic(groupId: number, topicId: number, title: string | null): void {
  queries.saveTopic(groupId, topicId, title);
}

export function getTopicsByGroup(groupId: number): Array<{ id: number; title: string | null }> {
  const topics = queries.getTopicsByGroup(groupId);
  return topics.map((t) => ({ id: t.topic_id, title: t.title }));
}
