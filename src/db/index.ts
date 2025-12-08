import { Database } from "bun:sqlite";
import type { User, Subscription, MonitoredGroup, MatchedMessage } from "../types.ts";

const db = new Database("data.db", { create: true });

// Initialize schema
const schema = await Bun.file(new URL("./schema.sql", import.meta.url)).text();
db.exec(schema);

// Prepared statements
const stmts = {
  // Users
  getUser: db.prepare<User, [number]>("SELECT * FROM users WHERE telegram_id = ?"),
  createUser: db.prepare<void, [number]>("INSERT OR IGNORE INTO users (telegram_id) VALUES (?)"),

  // Subscriptions
  getActiveSubscriptions: db.prepare<Subscription, []>(
    "SELECT * FROM subscriptions WHERE is_active = 1"
  ),
  getUserSubscriptions: db.prepare<Subscription, [number]>(
    `SELECT s.* FROM subscriptions s
     JOIN users u ON s.user_id = u.id
     WHERE u.telegram_id = ? AND s.is_active = 1`
  ),
  createSubscription: db.prepare<void, [string, string, string, string, number]>(
    `INSERT INTO subscriptions (user_id, original_query, positive_keywords, negative_keywords, llm_description)
     SELECT id, ?, ?, ?, ? FROM users WHERE telegram_id = ?`
  ),
  deactivateSubscription: db.prepare<void, [number, number]>(
    `UPDATE subscriptions SET is_active = 0
     WHERE id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),

  // Monitored groups
  getMonitoredGroups: db.prepare<MonitoredGroup, []>("SELECT * FROM monitored_groups"),
  addGroup: db.prepare<void, [number, string]>(
    "INSERT OR IGNORE INTO monitored_groups (telegram_id, title) VALUES (?, ?)"
  ),
  removeGroup: db.prepare<void, [number]>("DELETE FROM monitored_groups WHERE telegram_id = ?"),

  // Matched messages (deduplication)
  isMessageMatched: db.prepare<{ found: number }, [number, number, number]>(
    `SELECT 1 as found FROM matched_messages
     WHERE subscription_id = ? AND message_id = ? AND group_id = ? LIMIT 1`
  ),
  markMessageMatched: db.prepare<void, [number, number, number]>(
    `INSERT OR IGNORE INTO matched_messages (subscription_id, message_id, group_id) VALUES (?, ?, ?)`
  ),

  // Subscription groups
  addSubscriptionGroup: db.prepare<void, [number, number, string]>(
    `INSERT OR IGNORE INTO subscription_groups (subscription_id, group_id, group_title) VALUES (?, ?, ?)`
  ),
  getSubscriptionGroups: db.prepare<{ group_id: number; group_title: string }, [number]>(
    `SELECT group_id, group_title FROM subscription_groups WHERE subscription_id = ?`
  ),
  removeSubscriptionGroups: db.prepare<void, [number]>(
    `DELETE FROM subscription_groups WHERE subscription_id = ?`
  ),
};

// Helper to parse JSON fields from subscription
function parseSubscription(row: Subscription): Subscription {
  return {
    ...row,
    positive_keywords: JSON.parse(row.positive_keywords as unknown as string),
    negative_keywords: JSON.parse(row.negative_keywords as unknown as string),
  };
}

export const queries = {
  // Users
  getOrCreateUser(telegramId: number): User {
    stmts.createUser.run(telegramId);
    return stmts.getUser.get(telegramId)!;
  },

  // Subscriptions
  getActiveSubscriptions(): Subscription[] {
    return stmts.getActiveSubscriptions.all().map(parseSubscription);
  },

  getUserSubscriptions(telegramId: number): Subscription[] {
    return stmts.getUserSubscriptions.all(telegramId).map(parseSubscription);
  },

  createSubscription(
    telegramId: number,
    originalQuery: string,
    positiveKeywords: string[],
    negativeKeywords: string[],
    llmDescription: string
  ): number {
    stmts.createSubscription.run(
      originalQuery,
      JSON.stringify(positiveKeywords),
      JSON.stringify(negativeKeywords),
      llmDescription,
      telegramId
    );
    // Return the ID of newly created subscription
    const result = db.prepare<{ id: number }, []>("SELECT last_insert_rowid() as id").get();
    return result!.id;
  },

  deactivateSubscription(subscriptionId: number, telegramId: number): void {
    stmts.deactivateSubscription.run(subscriptionId, telegramId);
  },

  // Groups
  getMonitoredGroups(): MonitoredGroup[] {
    return stmts.getMonitoredGroups.all();
  },

  addGroup(telegramId: number, title: string): void {
    stmts.addGroup.run(telegramId, title);
  },

  removeGroup(telegramId: number): void {
    stmts.removeGroup.run(telegramId);
  },

  // Deduplication
  isMessageMatched(subscriptionId: number, messageId: number, groupId: number): boolean {
    return stmts.isMessageMatched.get(subscriptionId, messageId, groupId) !== null;
  },

  markMessageMatched(subscriptionId: number, messageId: number, groupId: number): void {
    stmts.markMessageMatched.run(subscriptionId, messageId, groupId);
  },

  // Subscription groups
  addSubscriptionGroup(subscriptionId: number, groupId: number, groupTitle: string): void {
    stmts.addSubscriptionGroup.run(subscriptionId, groupId, groupTitle);
  },

  getSubscriptionGroups(subscriptionId: number): { group_id: number; group_title: string }[] {
    return stmts.getSubscriptionGroups.all(subscriptionId);
  },

  setSubscriptionGroups(
    subscriptionId: number,
    groups: { id: number; title: string }[]
  ): void {
    stmts.removeSubscriptionGroups.run(subscriptionId);
    for (const group of groups) {
      stmts.addSubscriptionGroup.run(subscriptionId, group.id, group.title);
    }
  },
};

export { db };
