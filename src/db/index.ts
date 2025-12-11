import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import type {
  User,
  UserMode,
  Subscription,
  KeywordEmbeddings,
  MonitoredGroup,
  GroupMetadata,
  Category,
  Product,
  SellerContact,
  StoredMessage,
  Topic,
  StoredMedia,
  FoundPostAnalysis,
  AnalysisResult,
  BotMessage,
  BotMessageDirection,
  BotMessageType,
} from "../types.ts";
import { runMigrations } from "./migrations.ts";

// macOS builtin SQLite doesn't support extensions - use Homebrew's SQLite
// https://alexgarcia.xyz/sqlite-vec/js.html
if (process.platform === "darwin" && process.env.NODE_ENV !== "test") {
  try {
    // Try common Homebrew paths
    const sqlitePaths = [
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon
      "/usr/local/opt/sqlite3/lib/libsqlite3.dylib", // Intel Mac
    ];
    for (const path of sqlitePaths) {
      if (Bun.file(path).size > 0) {
        Database.setCustomSQLite(path);
        break;
      }
    }
  } catch {
    // Ignore, will try with default SQLite
  }
}

const db = new Database("data.db", { create: true });

// SQLite concurrency settings
db.exec("PRAGMA journal_mode=WAL");
db.exec("PRAGMA busy_timeout=5000");
db.exec("PRAGMA synchronous=NORMAL");

// Track if sqlite-vec was successfully loaded
let sqliteVecLoaded = false;

// Load sqlite-vec extension for vector search (skip in test env - dynamic extension loading not supported)
if (process.env.NODE_ENV !== "test") {
  try {
    sqliteVec.load(db);
    sqliteVecLoaded = true;
    console.log("sqlite-vec extension loaded successfully");
  } catch (e) {
    console.warn("sqlite-vec extension could not be loaded:", e);
  }
}

/** Check if sqlite-vec extension is available */
export function isSqliteVecAvailable(): boolean {
  return sqliteVecLoaded;
}

// Initialize schema
const schema = await Bun.file(new URL("./schema.sql", import.meta.url)).text();
db.exec(schema);

// Run migrations
await runMigrations(db);

// Prepared statements
const stmts = {
  // Users
  getUser: db.prepare<User, [number]>("SELECT * FROM users WHERE telegram_id = ?"),
  createUser: db.prepare<void, [number]>("INSERT OR IGNORE INTO users (telegram_id) VALUES (?)"),
  upsertUser: db.prepare<void, [number, string | null, string | null]>(
    `INSERT INTO users (telegram_id, first_name, username) VALUES (?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = COALESCE(excluded.first_name, first_name),
       username = COALESCE(excluded.username, username)`
  ),
  getUserMode: db.prepare<{ mode: UserMode }, [number]>(
    "SELECT COALESCE(mode, 'normal') as mode FROM users WHERE telegram_id = ?"
  ),
  setUserMode: db.prepare<void, [string, number]>(
    "UPDATE users SET mode = ? WHERE telegram_id = ?"
  ),

  // Subscriptions
  getActiveSubscriptions: db.prepare<Subscription, []>(
    "SELECT * FROM subscriptions WHERE is_active = 1 AND is_paused = 0"
  ),
  getSubscriptionsForGroup: db.prepare<Subscription, [number]>(
    `SELECT DISTINCT s.* FROM subscriptions s
     JOIN subscription_groups sg ON s.id = sg.subscription_id
     WHERE s.is_active = 1 AND s.is_paused = 0 AND sg.group_id = ?`
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
  pauseSubscription: db.prepare<void, [number, number]>(
    `UPDATE subscriptions SET is_paused = 1
     WHERE id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  resumeSubscription: db.prepare<void, [number, number]>(
    `UPDATE subscriptions SET is_paused = 0
     WHERE id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  getAllSubscriptionsWithUsers: db.prepare<
    Subscription & { telegram_id: number; first_name: string | null; username: string | null },
    []
  >(
    `SELECT s.*, u.telegram_id, u.first_name, u.username FROM subscriptions s
     JOIN users u ON s.user_id = u.id
     ORDER BY s.created_at DESC`
  ),
  adminUpdateKeywords: db.prepare<void, [string, string, number]>(
    `UPDATE subscriptions SET positive_keywords = ?, negative_keywords = ? WHERE id = ?`
  ),

  // Monitored groups
  getMonitoredGroups: db.prepare<MonitoredGroup, []>("SELECT * FROM monitored_groups"),
  addGroup: db.prepare<void, [number, string]>(
    "INSERT OR IGNORE INTO monitored_groups (telegram_id, title) VALUES (?, ?)"
  ),
  removeGroup: db.prepare<void, [number]>("DELETE FROM monitored_groups WHERE telegram_id = ?"),

  // All unique groups from user_groups
  getAllGroups: db.prepare<{ group_id: number; group_title: string }, []>(
    `SELECT DISTINCT group_id, group_title FROM user_groups ORDER BY group_title`
  ),
  getGroupTitleById: db.prepare<{ group_title: string } | null, [number]>(
    `SELECT group_title FROM user_groups WHERE group_id = ? LIMIT 1`
  ),

  // Groups metadata (country, currency, etc.)
  getGroupMetadata: db.prepare<GroupMetadata, [number]>(
    "SELECT * FROM groups WHERE telegram_id = ?"
  ),
  upsertGroupMetadata: db.prepare<void, [number, string | null, string | null, string | null, string | null, number]>(
    `INSERT INTO groups (telegram_id, title, country, city, currency, is_marketplace)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       title = COALESCE(excluded.title, title),
       country = COALESCE(excluded.country, country),
       city = COALESCE(excluded.city, city),
       currency = COALESCE(excluded.currency, currency),
       is_marketplace = COALESCE(excluded.is_marketplace, is_marketplace)`
  ),
  getAllGroupsMetadata: db.prepare<GroupMetadata, []>(
    "SELECT * FROM groups ORDER BY title"
  ),

  // Matched messages (deduplication) - DEPRECATED, use found_posts_analyzes
  isMessageMatched: db.prepare<{ found: number }, [number, number, number]>(
    `SELECT 1 as found FROM matched_messages
     WHERE subscription_id = ? AND message_id = ? AND group_id = ? LIMIT 1`
  ),
  markMessageMatched: db.prepare<void, [number, number, number]>(
    `INSERT OR IGNORE INTO matched_messages (subscription_id, message_id, group_id) VALUES (?, ?, ?)`
  ),

  // Found posts analyzes (new unified table for all analysis results)
  saveAnalysis: db.prepare<void, [number, number, number, string, number | null, number | null, number | null, string | null, string | null, number | null]>(
    `INSERT OR REPLACE INTO found_posts_analyzes
     (subscription_id, message_id, group_id, result, ngram_score, semantic_score, llm_confidence, rejection_keyword, llm_reasoning, notified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getAnalysisForSubscription: db.prepare<FoundPostAnalysis, [number, number, number]>(
    `SELECT * FROM found_posts_analyzes
     WHERE subscription_id = ? AND message_id = ? AND group_id = ?`
  ),
  getAnalysesForMessage: db.prepare<FoundPostAnalysis, [number, number]>(
    `SELECT * FROM found_posts_analyzes
     WHERE message_id = ? AND group_id = ?`
  ),
  getAnalysesForMessageByUser: db.prepare<FoundPostAnalysis & { original_query: string }, [number, number, number]>(
    `SELECT fpa.*, s.original_query FROM found_posts_analyzes fpa
     JOIN subscriptions s ON fpa.subscription_id = s.id
     JOIN users u ON s.user_id = u.id
     WHERE fpa.message_id = ? AND fpa.group_id = ? AND u.telegram_id = ?`
  ),
  isAnalysisMatched: db.prepare<{ found: number }, [number, number, number]>(
    `SELECT 1 as found FROM found_posts_analyzes
     WHERE subscription_id = ? AND message_id = ? AND group_id = ? AND result = 'matched' LIMIT 1`
  ),
  isMessageNotifiedToUser: db.prepare<{ found: number }, [number, number, number]>(
    `SELECT 1 as found FROM found_posts_analyzes fpa
     JOIN subscriptions s ON fpa.subscription_id = s.id
     WHERE s.user_id = ? AND fpa.message_id = ? AND fpa.group_id = ?
       AND fpa.result = 'matched' AND fpa.notified_at IS NOT NULL
     LIMIT 1`
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

  // User groups (groups added by user for monitoring)
  addUserGroup: db.prepare<void, [number, string, number, number]>(
    `INSERT OR REPLACE INTO user_groups (user_id, group_id, group_title, is_channel)
     SELECT id, ?, ?, ? FROM users WHERE telegram_id = ?`
  ),
  getUserGroups: db.prepare<{ group_id: number; group_title: string; is_channel: number }, [number]>(
    `SELECT group_id, group_title, is_channel FROM user_groups
     WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)
     ORDER BY added_at DESC`
  ),
  removeUserGroup: db.prepare<void, [number, number]>(
    `DELETE FROM user_groups
     WHERE group_id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  hasUserGroup: db.prepare<{ found: number }, [number, number]>(
    `SELECT 1 as found FROM user_groups
     WHERE group_id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?) LIMIT 1`
  ),

  // Subscription editing
  getSubscriptionById: db.prepare<Subscription, [number, number]>(
    `SELECT s.* FROM subscriptions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND u.telegram_id = ?`
  ),
  getSubscriptionByIdOnly: db.prepare<Subscription, [number]>(
    "SELECT * FROM subscriptions WHERE id = ?"
  ),
  updatePositiveKeywords: db.prepare<void, [string, number, number]>(
    `UPDATE subscriptions SET positive_keywords = ?
     WHERE id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  updateNegativeKeywords: db.prepare<void, [string, number, number]>(
    `UPDATE subscriptions SET negative_keywords = ?
     WHERE id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  updateLlmDescription: db.prepare<void, [string, number, number]>(
    `UPDATE subscriptions SET llm_description = ?
     WHERE id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  toggleNegativeKeywords: db.prepare<void, [string, string, number, number]>(
    `UPDATE subscriptions
     SET negative_keywords = ?, disabled_negative_keywords = ?
     WHERE id = ? AND user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  updateKeywordEmbeddings: db.prepare<void, [string, number]>(
    `UPDATE subscriptions SET keyword_embeddings = ? WHERE id = ?`
  ),
  getSubscriptionsWithoutEmbeddings: db.prepare<Subscription, []>(
    `SELECT * FROM subscriptions WHERE is_active = 1 AND is_paused = 0 AND keyword_embeddings IS NULL`
  ),

  // Get all unique group IDs from active subscription groups
  getAllSubscriptionGroupIds: db.prepare<{ group_id: number }, []>(
    `SELECT DISTINCT sg.group_id FROM subscription_groups sg
     JOIN subscriptions s ON sg.subscription_id = s.id
     WHERE s.is_active = 1 AND s.is_paused = 0`
  ),

  // Categories
  getCategories: db.prepare<Category, []>("SELECT * FROM categories ORDER BY name_ru"),
  upsertCategory: db.prepare<void, [string, string]>(
    "INSERT OR REPLACE INTO categories (code, name_ru) VALUES (?, ?)"
  ),

  // Products
  isProductClassified: db.prepare<{ found: number }, [number, number]>(
    "SELECT 1 as found FROM products WHERE message_id = ? AND group_id = ? LIMIT 1"
  ),
  createProduct: db.prepare<void, [number, number, string, string, string | null, string | null, number | null, string | null, number | null, string | null, number]>(
    `INSERT INTO products (message_id, group_id, group_title, text, category_code, price_raw, price_normalized, price_currency, sender_id, sender_name, message_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getProducts: db.prepare<Product, []>("SELECT * FROM products ORDER BY message_date DESC"),
  getProductsByCategory: db.prepare<Product, [string]>(
    "SELECT * FROM products WHERE category_code = ? ORDER BY message_date DESC"
  ),
  getProductById: db.prepare<Product, [number]>("SELECT * FROM products WHERE id = ?"),
  searchProducts: db.prepare<Product, [string]>(
    "SELECT * FROM products WHERE text LIKE ? ORDER BY message_date DESC LIMIT 100"
  ),
  getProductsByCategoryWithPrice: db.prepare<Product, [string]>(
    "SELECT * FROM products WHERE category_code = ? AND price_normalized IS NOT NULL ORDER BY price_normalized"
  ),

  // Seller contacts
  addSellerContact: db.prepare<void, [number, string, string, string]>(
    "INSERT INTO seller_contacts (product_id, contact_type, contact_value, source) VALUES (?, ?, ?, ?)"
  ),
  getProductContacts: db.prepare<SellerContact, [number]>(
    "SELECT * FROM seller_contacts WHERE product_id = ?"
  ),

  // Messages (persistent history)
  upsertMessage: db.prepare<void, [number, number, string | null, number | null, string | null, string, number | null, string | null, string | null, number]>(
    `INSERT INTO messages (message_id, group_id, group_title, topic_id, topic_title, text, sender_id, sender_name, sender_username, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id, group_id) DO UPDATE SET
       text = excluded.text,
       group_title = excluded.group_title,
       topic_id = excluded.topic_id,
       topic_title = excluded.topic_title,
       sender_id = excluded.sender_id,
       sender_name = excluded.sender_name,
       sender_username = excluded.sender_username,
       updated_at = CURRENT_TIMESTAMP`
  ),
  updateMessageText: db.prepare<void, [string, number, number]>(
    `UPDATE messages SET text = ?, updated_at = CURRENT_TIMESTAMP
     WHERE message_id = ? AND group_id = ?`
  ),
  softDeleteMessage: db.prepare<void, [number, number]>(
    `UPDATE messages SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
     WHERE message_id = ? AND group_id = ?`
  ),
  getMessage: db.prepare<StoredMessage, [number, number]>(
    "SELECT * FROM messages WHERE message_id = ? AND group_id = ?"
  ),
  getMessagesByGroup: db.prepare<StoredMessage, [number, number, number]>(
    `SELECT * FROM messages WHERE group_id = ? AND is_deleted = 0
     ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ),
  getMessagesByGroupIncludingDeleted: db.prepare<StoredMessage, [number, number, number]>(
    `SELECT * FROM messages WHERE group_id = ?
     ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ),
  getMessagesByGroupAndTopic: db.prepare<StoredMessage, [number, number, number, number]>(
    `SELECT * FROM messages WHERE group_id = ? AND topic_id = ? AND is_deleted = 0
     ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ),
  getAllMessages: db.prepare<StoredMessage, [number, number]>(
    `SELECT * FROM messages WHERE is_deleted = 0
     ORDER BY timestamp DESC LIMIT ? OFFSET ?`
  ),
  countMessagesByGroup: db.prepare<{ count: number }, [number]>(
    "SELECT COUNT(*) as count FROM messages WHERE group_id = ? AND is_deleted = 0"
  ),
  countAllMessages: db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM messages WHERE is_deleted = 0"
  ),
  getLastMessageId: db.prepare<{ message_id: number } | null, [number]>(
    "SELECT MAX(message_id) as message_id FROM messages WHERE group_id = ?"
  ),
  getDistinctGroups: db.prepare<{ group_id: number; group_title: string; count: number }, []>(
    `SELECT group_id, group_title, COUNT(*) as count FROM messages
     WHERE is_deleted = 0 GROUP BY group_id ORDER BY count DESC`
  ),
  searchMessages: db.prepare<StoredMessage, [string, number]>(
    `SELECT * FROM messages WHERE is_deleted = 0 AND text LIKE ?
     ORDER BY timestamp DESC LIMIT ?`
  ),
  findMessageByExactText: db.prepare<StoredMessage, [string]>(
    `SELECT * FROM messages WHERE is_deleted = 0 AND text = ? LIMIT 1`
  ),

  // Topics
  upsertTopic: db.prepare<void, [number, number, string | null]>(
    `INSERT INTO topics (group_id, topic_id, title)
     VALUES (?, ?, ?)
     ON CONFLICT(group_id, topic_id) DO UPDATE SET
       title = excluded.title,
       updated_at = CURRENT_TIMESTAMP`
  ),
  getTopicsByGroup: db.prepare<Topic, [number]>(
    "SELECT * FROM topics WHERE group_id = ? ORDER BY topic_id"
  ),
  getTopic: db.prepare<Topic, [number, number]>(
    "SELECT * FROM topics WHERE group_id = ? AND topic_id = ?"
  ),

  // User states (FSM persistence)
  getUserState: db.prepare<{ snapshot: string }, [number]>(
    `SELECT snapshot FROM user_states
     WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  upsertUserState: db.prepare<void, [string, number]>(
    `INSERT INTO user_states (user_id, snapshot, updated_at)
     SELECT id, ?, datetime('now') FROM users WHERE telegram_id = ?
     ON CONFLICT(user_id) DO UPDATE SET
       snapshot = excluded.snapshot,
       updated_at = excluded.updated_at`
  ),
  deleteUserState: db.prepare<void, [number]>(
    `DELETE FROM user_states
     WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)`
  ),
  getUsersWithPendingOperations: db.prepare<{ telegram_id: number; snapshot: string }, []>(
    `SELECT u.telegram_id, us.snapshot FROM user_states us
     JOIN users u ON us.user_id = u.id
     WHERE us.snapshot LIKE '%"pendingOperation":{%'`
  ),

  // Message media
  insertMedia: db.prepare<void, [number, number, number, string, string, number | null, number | null, number | null]>(
    `INSERT OR IGNORE INTO message_media (message_id, group_id, media_index, media_type, file_path, width, height, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getMediaForMessage: db.prepare<StoredMedia, [number, number]>(
    `SELECT * FROM message_media WHERE message_id = ? AND group_id = ? ORDER BY media_index`
  ),
  hasMediaForMessage: db.prepare<{ found: number }, [number, number]>(
    `SELECT 1 as found FROM message_media WHERE message_id = ? AND group_id = ? LIMIT 1`
  ),
  deleteMediaForMessage: db.prepare<void, [number, number]>(
    `DELETE FROM message_media WHERE message_id = ? AND group_id = ?`
  ),

  // Group analytics
  getGroupAnalytics: db.prepare<
    { id: number; group_id: number; stats_json: string; insights_text: string | null; insights_generated_at: number | null; computed_at: number; period_start: number; period_end: number },
    [number]
  >(
    `SELECT * FROM group_analytics WHERE group_id = ?`
  ),
  upsertGroupAnalytics: db.prepare<void, [number, string, number, number, number]>(
    `INSERT INTO group_analytics (group_id, stats_json, computed_at, period_start, period_end)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(group_id) DO UPDATE SET
       stats_json = excluded.stats_json,
       computed_at = excluded.computed_at,
       period_start = excluded.period_start,
       period_end = excluded.period_end,
       updated_at = CURRENT_TIMESTAMP`
  ),
  updateGroupInsights: db.prepare<void, [string, number, number]>(
    `UPDATE group_analytics SET insights_text = ?, insights_generated_at = ?, updated_at = CURRENT_TIMESTAMP WHERE group_id = ?`
  ),

  // Bot messages (conversation history)
  insertBotMessage: db.prepare<void, [number, number, string, string, string | null, string | null, string | null, string | null, number]>(
    `INSERT INTO bot_messages (user_id, telegram_id, direction, message_type, text, command, callback_data, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getBotMessages: db.prepare<BotMessage, [number, number, number]>(
    `SELECT * FROM bot_messages WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ),
  getLatestBotMessages: db.prepare<BotMessage, [number, number]>(
    `SELECT * FROM bot_messages WHERE telegram_id = ? AND created_at > ? ORDER BY created_at ASC`
  ),
  cleanupOldBotMessages: db.prepare<void, [number, number]>(
    `DELETE FROM bot_messages WHERE telegram_id = ? AND id NOT IN (
       SELECT id FROM bot_messages WHERE telegram_id = ? ORDER BY created_at DESC LIMIT 500
     )`
  ),
  updateUserLastActive: db.prepare<void, [number, number]>(
    `UPDATE users SET last_active = ? WHERE telegram_id = ?`
  ),
  getAllUsers: db.prepare<User, []>(
    `SELECT * FROM users ORDER BY last_active DESC NULLS LAST`
  ),
  getActiveUsers: db.prepare<User, [number]>(
    `SELECT * FROM users WHERE last_active IS NOT NULL AND last_active > ? ORDER BY last_active DESC`
  ),

  // Subscription feedback
  insertFeedback: db.prepare<void, [number, number, string, string | null]>(
    `INSERT INTO subscription_feedback (subscription_id, user_id, outcome, review)
     VALUES (?, (SELECT id FROM users WHERE telegram_id = ?), ?, ?)`
  ),
};

// Helper to parse JSON fields from subscription
function parseSubscription(row: Subscription): Subscription {
  const rawDisabled = (row as unknown as { disabled_negative_keywords?: string })
    .disabled_negative_keywords;
  const rawEmbeddings = (row as unknown as { keyword_embeddings?: string })
    .keyword_embeddings;
  return {
    ...row,
    positive_keywords: JSON.parse(row.positive_keywords as unknown as string),
    negative_keywords: JSON.parse(row.negative_keywords as unknown as string),
    disabled_negative_keywords: rawDisabled ? JSON.parse(rawDisabled) : [],
    keyword_embeddings: rawEmbeddings ? JSON.parse(rawEmbeddings) : undefined,
  };
}

export const queries = {
  // Users
  getOrCreateUser(telegramId: number, firstName?: string, username?: string): User {
    console.log("[getOrCreateUser]", { telegramId, firstName, username });
    stmts.upsertUser.run(telegramId, firstName ?? null, username ?? null);
    return stmts.getUser.get(telegramId)!;
  },

  getUserByTelegramId(telegramId: number): User | null {
    return stmts.getUser.get(telegramId) ?? null;
  },

  getUserMode(telegramId: number): UserMode {
    const result = stmts.getUserMode.get(telegramId);
    return result?.mode || "normal";
  },

  setUserMode(telegramId: number, mode: UserMode): void {
    stmts.setUserMode.run(mode, telegramId);
  },

  // Subscriptions
  getActiveSubscriptions(): Subscription[] {
    return stmts.getActiveSubscriptions.all().map(parseSubscription);
  },

  getSubscriptionsForGroup(groupId: number): Subscription[] {
    return stmts.getSubscriptionsForGroup.all(groupId).map(parseSubscription);
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

  pauseSubscription(subscriptionId: number, telegramId: number): void {
    stmts.pauseSubscription.run(subscriptionId, telegramId);
  },

  resumeSubscription(subscriptionId: number, telegramId: number): void {
    stmts.resumeSubscription.run(subscriptionId, telegramId);
  },

  getAllSubscriptionsWithUsers(): (Subscription & { telegram_id: number; first_name: string | null; username: string | null })[] {
    return stmts.getAllSubscriptionsWithUsers.all().map((row) => ({
      ...parseSubscription(row),
      telegram_id: row.telegram_id,
      first_name: row.first_name,
      username: row.username,
    }));
  },

  adminUpdateKeywords(subscriptionId: number, positive: string[], negative: string[]): void {
    stmts.adminUpdateKeywords.run(JSON.stringify(positive), JSON.stringify(negative), subscriptionId);
  },

  // Groups
  getMonitoredGroups(): MonitoredGroup[] {
    return stmts.getMonitoredGroups.all();
  },

  getAllGroups(): Array<{ id: number; title: string }> {
    return stmts.getAllGroups.all().map((g) => ({
      id: g.group_id,
      title: g.group_title,
    }));
  },

  getGroupTitleById(groupId: number): string | null {
    const row = stmts.getGroupTitleById.get(groupId);
    return row?.group_title ?? null;
  },

  addGroup(telegramId: number, title: string): void {
    stmts.addGroup.run(telegramId, title);
  },

  removeGroup(telegramId: number): void {
    stmts.removeGroup.run(telegramId);
  },

  // Groups metadata
  getGroupMetadata(telegramId: number): GroupMetadata | null {
    return stmts.getGroupMetadata.get(telegramId) ?? null;
  },

  upsertGroupMetadata(data: {
    telegramId: number;
    title?: string | null;
    country?: string | null;
    city?: string | null;
    currency?: string | null;
    isMarketplace?: boolean;
  }): void {
    stmts.upsertGroupMetadata.run(
      data.telegramId,
      data.title ?? null,
      data.country ?? null,
      data.city ?? null,
      data.currency ?? null,
      data.isMarketplace ? 1 : 0
    );
  },

  getAllGroupsMetadata(): GroupMetadata[] {
    return stmts.getAllGroupsMetadata.all();
  },

  // Deduplication (DEPRECATED - use analysis methods)
  isMessageMatched(subscriptionId: number, messageId: number, groupId: number): boolean {
    return stmts.isMessageMatched.get(subscriptionId, messageId, groupId) !== null;
  },

  markMessageMatched(subscriptionId: number, messageId: number, groupId: number): void {
    stmts.markMessageMatched.run(subscriptionId, messageId, groupId);
  },

  // Analysis results (found_posts_analyzes)
  saveAnalysis(data: {
    subscriptionId: number;
    messageId: number;
    groupId: number;
    result: AnalysisResult;
    ngramScore?: number;
    semanticScore?: number;
    llmConfidence?: number;
    rejectionKeyword?: string;
    llmReasoning?: string;
    notifiedAt?: number;
  }): void {
    stmts.saveAnalysis.run(
      data.subscriptionId,
      data.messageId,
      data.groupId,
      data.result,
      data.ngramScore ?? null,
      data.semanticScore ?? null,
      data.llmConfidence ?? null,
      data.rejectionKeyword ?? null,
      data.llmReasoning ?? null,
      data.notifiedAt ?? null
    );
  },

  getAnalysisForSubscription(
    subscriptionId: number,
    messageId: number,
    groupId: number
  ): FoundPostAnalysis | null {
    return stmts.getAnalysisForSubscription.get(subscriptionId, messageId, groupId) ?? null;
  },

  getAnalysesForMessage(messageId: number, groupId: number): FoundPostAnalysis[] {
    return stmts.getAnalysesForMessage.all(messageId, groupId);
  },

  getAnalysesForMessageByUser(
    messageId: number,
    groupId: number,
    telegramId: number
  ): (FoundPostAnalysis & { original_query: string })[] {
    return stmts.getAnalysesForMessageByUser.all(messageId, groupId, telegramId);
  },

  isAnalysisMatched(subscriptionId: number, messageId: number, groupId: number): boolean {
    return stmts.isAnalysisMatched.get(subscriptionId, messageId, groupId) !== null;
  },

  /** Check if user was already notified about this message via any subscription */
  isMessageNotifiedToUser(userId: number, messageId: number, groupId: number): boolean {
    return stmts.isMessageNotifiedToUser.get(userId, messageId, groupId) !== null;
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

  // User groups
  addUserGroup(
    telegramId: number,
    groupId: number,
    groupTitle: string,
    isChannel: boolean
  ): void {
    stmts.addUserGroup.run(groupId, groupTitle, isChannel ? 1 : 0, telegramId);
  },

  getUserGroups(
    telegramId: number
  ): { id: number; title: string; isChannel: boolean }[] {
    return stmts.getUserGroups.all(telegramId).map((row) => ({
      id: row.group_id,
      title: row.group_title,
      isChannel: row.is_channel === 1,
    }));
  },

  removeUserGroup(telegramId: number, groupId: number): void {
    stmts.removeUserGroup.run(groupId, telegramId);
  },

  hasUserGroup(telegramId: number, groupId: number): boolean {
    return stmts.hasUserGroup.get(groupId, telegramId) !== null;
  },

  // Subscription editing
  getSubscriptionById(subscriptionId: number, telegramId: number): Subscription | null {
    const row = stmts.getSubscriptionById.get(subscriptionId, telegramId);
    return row ? parseSubscription(row) : null;
  },

  getSubscriptionByIdOnly(subscriptionId: number): Subscription | null {
    const row = stmts.getSubscriptionByIdOnly.get(subscriptionId);
    return row ? parseSubscription(row) : null;
  },

  updatePositiveKeywords(
    subscriptionId: number,
    telegramId: number,
    keywords: string[]
  ): void {
    stmts.updatePositiveKeywords.run(
      JSON.stringify(keywords),
      subscriptionId,
      telegramId
    );
  },

  updateNegativeKeywords(
    subscriptionId: number,
    telegramId: number,
    keywords: string[]
  ): void {
    stmts.updateNegativeKeywords.run(
      JSON.stringify(keywords),
      subscriptionId,
      telegramId
    );
  },

  updateLlmDescription(
    subscriptionId: number,
    telegramId: number,
    description: string
  ): void {
    stmts.updateLlmDescription.run(description, subscriptionId, telegramId);
  },

  toggleNegativeKeywords(
    subscriptionId: number,
    telegramId: number,
    enable: boolean
  ): void {
    const sub = this.getSubscriptionById(subscriptionId, telegramId);
    if (!sub) return;

    if (enable) {
      // Restore from disabled
      stmts.toggleNegativeKeywords.run(
        JSON.stringify(sub.disabled_negative_keywords || []),
        "[]",
        subscriptionId,
        telegramId
      );
    } else {
      // Move to disabled
      stmts.toggleNegativeKeywords.run(
        "[]",
        JSON.stringify(sub.negative_keywords),
        subscriptionId,
        telegramId
      );
    }
  },

  // Get all unique group IDs from active subscriptions
  getAllSubscriptionGroupIds(): number[] {
    return stmts.getAllSubscriptionGroupIds.all().map((row) => row.group_id);
  },

  // Keyword embeddings
  updateKeywordEmbeddings(subscriptionId: number, embeddings: KeywordEmbeddings): void {
    stmts.updateKeywordEmbeddings.run(JSON.stringify(embeddings), subscriptionId);
  },

  getSubscriptionsWithoutEmbeddings(): Subscription[] {
    return stmts.getSubscriptionsWithoutEmbeddings.all().map(parseSubscription);
  },

  // === WebApp: Categories ===
  getCategories(): Category[] {
    return stmts.getCategories.all();
  },

  upsertCategory(code: string, nameRu: string): void {
    stmts.upsertCategory.run(code, nameRu);
  },

  // === WebApp: Products ===
  isProductClassified(messageId: number, groupId: number): boolean {
    return stmts.isProductClassified.get(messageId, groupId) !== null;
  },

  createProduct(data: {
    message_id: number;
    group_id: number;
    group_title: string;
    text: string;
    category_code: string | null;
    price_raw: string | null;
    price_value: number | null;
    price_currency: string | null;
    sender_id: number | null;
    sender_name: string | null;
    message_date: number;
  }): number {
    stmts.createProduct.run(
      data.message_id,
      data.group_id,
      data.group_title,
      data.text,
      data.category_code,
      data.price_raw,
      data.price_value, // stored in price_normalized column for backward compat
      data.price_currency,
      data.sender_id,
      data.sender_name,
      data.message_date
    );
    const result = db.prepare<{ id: number }, []>("SELECT last_insert_rowid() as id").get();
    return result!.id;
  },

  getProducts(opts?: {
    category?: string;
    search?: string;
    offset?: number;
    limit?: number;
  }): Product[] {
    const { category, search, offset = 0, limit = 20 } = opts || {};

    let sql = "SELECT * FROM products WHERE 1=1";
    const params: (string | number)[] = [];

    if (category) {
      sql += " AND category_code = ?";
      params.push(category);
    }
    if (search) {
      sql += " AND text LIKE ?";
      params.push(`%${search}%`);
    }

    sql += " ORDER BY message_date DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare<Product, (string | number)[]>(sql).all(...params);
  },

  getProductById(id: number): Product | null {
    return stmts.getProductById.get(id) || null;
  },

  getProductContacts(productId: number): SellerContact[] {
    return stmts.getProductContacts.all(productId);
  },

  addSellerContact(
    productId: number,
    contactType: string,
    contactValue: string,
    source: string
  ): void {
    stmts.addSellerContact.run(productId, contactType, contactValue, source);
  },

  getSimilarProducts(productId: number, categoryCode: string | null, limit: number = 5): Product[] {
    if (!categoryCode) return [];
    return db
      .prepare<Product, [string, number, number]>(
        `SELECT * FROM products
         WHERE category_code = ? AND id != ?
         ORDER BY message_date DESC
         LIMIT ?`
      )
      .all(categoryCode, productId, limit);
  },

  getProductsCount(category?: string): number {
    if (category) {
      const result = db
        .prepare<{ count: number }, [string]>("SELECT COUNT(*) as count FROM products WHERE category_code = ?")
        .get(category);
      return result?.count || 0;
    }
    const result = db.prepare<{ count: number }, []>("SELECT COUNT(*) as count FROM products").get();
    return result?.count || 0;
  },

  // === Messages (persistent history) ===
  saveMessage(data: {
    message_id: number;
    group_id: number;
    group_title: string | null;
    topic_id: number | null;
    topic_title: string | null;
    text: string;
    sender_id: number | null;
    sender_name: string | null;
    sender_username: string | null;
    timestamp: number;
  }): void {
    stmts.upsertMessage.run(
      data.message_id,
      data.group_id,
      data.group_title,
      data.topic_id,
      data.topic_title,
      data.text,
      data.sender_id,
      data.sender_name,
      data.sender_username,
      data.timestamp
    );
  },

  updateMessageText(messageId: number, groupId: number, text: string): void {
    stmts.updateMessageText.run(text, messageId, groupId);
  },

  softDeleteMessage(messageId: number, groupId: number): void {
    stmts.softDeleteMessage.run(messageId, groupId);
  },

  getMessage(messageId: number, groupId: number): StoredMessage | null {
    return stmts.getMessage.get(messageId, groupId) || null;
  },

  findMessageByExactText(text: string): StoredMessage | null {
    return stmts.findMessageByExactText.get(text) || null;
  },

  getMessages(opts?: {
    groupId?: number;
    topicId?: number;
    offset?: number;
    limit?: number;
  }): StoredMessage[] {
    const { groupId, topicId, offset = 0, limit = 100 } = opts || {};

    if (groupId && topicId) {
      return stmts.getMessagesByGroupAndTopic.all(groupId, topicId, limit, offset);
    }
    if (groupId) {
      return stmts.getMessagesByGroup.all(groupId, limit, offset);
    }
    return stmts.getAllMessages.all(limit, offset);
  },

  // Get messages including soft-deleted (for example search)
  getMessagesIncludingDeleted(groupId: number, limit: number = 1000, offset: number = 0): StoredMessage[] {
    return stmts.getMessagesByGroupIncludingDeleted.all(groupId, limit, offset);
  },

  getMessagesCount(groupId?: number): number {
    if (groupId) {
      return stmts.countMessagesByGroup.get(groupId)?.count || 0;
    }
    return stmts.countAllMessages.get()?.count || 0;
  },

  getLastMessageId(groupId: number): number | null {
    const row = stmts.getLastMessageId.get(groupId);
    return row?.message_id ?? null;
  },

  getDistinctMessageGroups(): { group_id: number; group_title: string; count: number }[] {
    return stmts.getDistinctGroups.all();
  },

  searchMessagesLike(query: string, limit: number = 100): StoredMessage[] {
    return stmts.searchMessages.all(`%${query}%`, limit);
  },

  // === Topics ===
  saveTopic(groupId: number, topicId: number, title: string | null): void {
    stmts.upsertTopic.run(groupId, topicId, title);
  },

  getTopicsByGroup(groupId: number): Topic[] {
    return stmts.getTopicsByGroup.all(groupId);
  },

  getTopic(groupId: number, topicId: number): Topic | null {
    return stmts.getTopic.get(groupId, topicId) || null;
  },

  // === User States (FSM persistence) ===
  getUserStateSnapshot(telegramId: number): string | null {
    const row = stmts.getUserState.get(telegramId);
    return row?.snapshot ?? null;
  },

  saveUserStateSnapshot(telegramId: number, snapshot: string): void {
    stmts.upsertUserState.run(snapshot, telegramId);
  },

  deleteUserState(telegramId: number): void {
    stmts.deleteUserState.run(telegramId);
  },

  getUsersWithPendingOperations(): { telegramId: number; snapshot: string }[] {
    return stmts.getUsersWithPendingOperations.all().map((row) => ({
      telegramId: row.telegram_id,
      snapshot: row.snapshot,
    }));
  },

  // === Message Media ===
  saveMedia(data: {
    message_id: number;
    group_id: number;
    media_index: number;
    media_type: "photo" | "video";
    file_path: string;
    width: number | null;
    height: number | null;
    duration: number | null;
  }): void {
    stmts.insertMedia.run(
      data.message_id,
      data.group_id,
      data.media_index,
      data.media_type,
      data.file_path,
      data.width,
      data.height,
      data.duration
    );
  },

  getMediaForMessage(messageId: number, groupId: number): StoredMedia[] {
    return stmts.getMediaForMessage.all(messageId, groupId);
  },

  hasMediaForMessage(messageId: number, groupId: number): boolean {
    return stmts.hasMediaForMessage.get(messageId, groupId) !== null;
  },

  deleteMediaForMessage(messageId: number, groupId: number): void {
    stmts.deleteMediaForMessage.run(messageId, groupId);
  },

  // === Group Analytics ===
  getGroupAnalytics(groupId: number): {
    group_id: number;
    stats_json: string;
    insights_text: string | null;
    insights_generated_at: number | null;
    computed_at: number;
    period_start: number;
    period_end: number;
  } | null {
    return stmts.getGroupAnalytics.get(groupId) ?? null;
  },

  saveGroupAnalytics(
    groupId: number,
    statsJson: string,
    periodStart: number,
    periodEnd: number
  ): void {
    const computedAt = Math.floor(Date.now() / 1000);
    stmts.upsertGroupAnalytics.run(groupId, statsJson, computedAt, periodStart, periodEnd);
  },

  updateGroupInsights(groupId: number, insightsText: string): void {
    const generatedAt = Math.floor(Date.now() / 1000);
    stmts.updateGroupInsights.run(insightsText, generatedAt, groupId);
  },

  // === Bot Messages (conversation history) ===
  logBotMessage(data: {
    telegramId: number;
    direction: BotMessageDirection;
    messageType: BotMessageType;
    text?: string;
    command?: string;
    callbackData?: string;
    metadata?: Record<string, unknown>;
  }): BotMessage | null {
    const user = this.getOrCreateUser(data.telegramId);
    const now = Math.floor(Date.now() / 1000);

    stmts.insertBotMessage.run(
      user.id,
      data.telegramId,
      data.direction,
      data.messageType,
      data.text ?? null,
      data.command ?? null,
      data.callbackData ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now
    );

    // Update user last_active
    stmts.updateUserLastActive.run(now, data.telegramId);

    // Cleanup old messages (keep last 500)
    stmts.cleanupOldBotMessages.run(data.telegramId, data.telegramId);

    // Return the inserted message
    const result = db.prepare<{ id: number }, []>("SELECT last_insert_rowid() as id").get();
    if (!result) return null;

    return {
      id: result.id,
      user_id: user.id,
      telegram_id: data.telegramId,
      direction: data.direction,
      message_type: data.messageType,
      text: data.text ?? null,
      command: data.command ?? null,
      callback_data: data.callbackData ?? null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      created_at: now,
    };
  },

  getBotMessages(telegramId: number, opts?: { offset?: number; limit?: number }): BotMessage[] {
    const { offset = 0, limit = 100 } = opts || {};
    return stmts.getBotMessages.all(telegramId, limit, offset);
  },

  getLatestBotMessages(telegramId: number, sinceTimestamp: number): BotMessage[] {
    return stmts.getLatestBotMessages.all(telegramId, sinceTimestamp);
  },

  updateUserLastActive(telegramId: number): void {
    const now = Math.floor(Date.now() / 1000);
    stmts.updateUserLastActive.run(now, telegramId);
  },

  getAllUsers(): User[] {
    return stmts.getAllUsers.all();
  },

  getRecentlyActiveUsers(sinceTimestamp: number): User[] {
    return stmts.getActiveUsers.all(sinceTimestamp);
  },

  // === Message Embeddings (semantic search) ===

  saveMessageEmbedding(messageId: number, embedding: number[]): void {
    const vec = new Float32Array(embedding);
    const bytes = new Uint8Array(vec.buffer);
    db.prepare(`
      INSERT OR REPLACE INTO message_embeddings (message_id, embedding)
      VALUES (?, ?)
    `).run(messageId, bytes);
  },

  findSimilarByEmbedding(
    embedding: number[],
    limit: number,
    groupIds?: number[]
  ): Array<StoredMessage & { distance: number }> {
    const vec = new Float32Array(embedding);
    const bytes = new Uint8Array(vec.buffer);

    if (groupIds && groupIds.length > 0) {
      // Filter by specific groups
      const placeholders = groupIds.map(() => "?").join(",");
      return db
        .prepare<StoredMessage & { distance: number }, [Uint8Array, number, ...number[]]>(`
          SELECT m.*, e.distance
          FROM message_embeddings e
          JOIN messages m ON m.id = e.message_id
          WHERE e.embedding MATCH ?
            AND k = ?
            AND m.group_id IN (${placeholders})
            AND m.is_deleted = 0
          ORDER BY e.distance
        `)
        .all(bytes, limit, ...groupIds);
    }

    // All groups
    return db
      .prepare<StoredMessage & { distance: number }, [Uint8Array, number]>(`
        SELECT m.*, e.distance
        FROM message_embeddings e
        JOIN messages m ON m.id = e.message_id
        WHERE e.embedding MATCH ?
          AND k = ?
          AND m.is_deleted = 0
        ORDER BY e.distance
      `)
      .all(bytes, limit);
  },

  getMessagesWithoutEmbedding(limit: number): StoredMessage[] {
    return db
      .prepare<StoredMessage, [number]>(`
        SELECT m.* FROM messages m
        LEFT JOIN message_embeddings e ON m.id = e.message_id
        WHERE e.message_id IS NULL
          AND m.is_deleted = 0
          AND LENGTH(m.text) > 20
        ORDER BY m.id
        LIMIT ?
      `)
      .all(limit);
  },

  countMessagesWithoutEmbedding(): number {
    const result = db
      .prepare<{ count: number }, []>(`
        SELECT COUNT(*) as count FROM messages m
        LEFT JOIN message_embeddings e ON m.id = e.message_id
        WHERE e.message_id IS NULL
          AND m.is_deleted = 0
          AND LENGTH(m.text) > 20
      `)
      .get();
    return result?.count || 0;
  },

  hasEmbedding(messageId: number): boolean {
    const result = db
      .prepare<{ found: number }, [number]>(
        "SELECT 1 as found FROM message_embeddings WHERE message_id = ? LIMIT 1"
      )
      .get(messageId);
    return result !== null;
  },

  // === Subscription Feedback ===
  saveFeedback(data: {
    subscriptionId: number;
    telegramId: number;
    outcome: "bought" | "not_bought" | "complicated";
    review: string | null;
  }): void {
    stmts.insertFeedback.run(data.subscriptionId, data.telegramId, data.outcome, data.review);
  },

  // ===========================================
  // Monetization: Plans, Payments, Presets
  // ===========================================

  // --- User Plan ---
  getUserPlan(telegramId: number): {
    plan: "free" | "basic" | "pro" | "business";
    plan_expires_at: string | null;
    telegram_subscription_id: string | null;
    region_code: string | null;
  } {
    const result = db
      .prepare<
        {
          plan: string | null;
          plan_expires_at: string | null;
          telegram_subscription_id: string | null;
          region_code: string | null;
        },
        [number]
      >("SELECT plan, plan_expires_at, telegram_subscription_id, region_code FROM users WHERE telegram_id = ?")
      .get(telegramId);
    return {
      plan: (result?.plan as "free" | "basic" | "pro" | "business") || "free",
      plan_expires_at: result?.plan_expires_at ?? null,
      telegram_subscription_id: result?.telegram_subscription_id ?? null,
      region_code: result?.region_code ?? null,
    };
  },

  updateUserPlan(
    telegramId: number,
    plan: "free" | "basic" | "pro" | "business",
    expiresAt: string | null,
    subscriptionId: string | null
  ): void {
    db.prepare(
      "UPDATE users SET plan = ?, plan_expires_at = ?, telegram_subscription_id = ? WHERE telegram_id = ?"
    ).run(plan, expiresAt, subscriptionId, telegramId);
  },

  setUserRegion(telegramId: number, regionCode: string): void {
    db.prepare("UPDATE users SET region_code = ? WHERE telegram_id = ?").run(
      regionCode,
      telegramId
    );
  },

  // --- Plan Limits ---
  getPlanLimits(plan: "free" | "basic" | "pro" | "business"): {
    maxSubscriptions: number;
    maxGroupsPerSubscription: number;
    hasPriority: boolean;
    hasFora: boolean;
    analyzePrice: number; // 0 = free
  } {
    const limits = {
      free: { maxSubscriptions: 3, maxGroupsPerSubscription: 5, hasPriority: false, hasFora: false, analyzePrice: 20 },
      basic: { maxSubscriptions: 10, maxGroupsPerSubscription: 20, hasPriority: true, hasFora: false, analyzePrice: 20 },
      pro: { maxSubscriptions: 50, maxGroupsPerSubscription: Infinity, hasPriority: true, hasFora: true, analyzePrice: 10 },
      business: { maxSubscriptions: Infinity, maxGroupsPerSubscription: Infinity, hasPriority: true, hasFora: true, analyzePrice: 0 },
    };
    return limits[plan];
  },

  getUserSubscriptionCount(telegramId: number): number {
    const result = db
      .prepare<{ count: number }, [number]>(
        `SELECT COUNT(*) as count FROM subscriptions s
         JOIN users u ON s.user_id = u.id
         WHERE u.telegram_id = ? AND s.is_active = 1`
      )
      .get(telegramId);
    return result?.count ?? 0;
  },

  getSubscriptionGroupCount(subscriptionId: number): number {
    const result = db
      .prepare<{ count: number }, [number]>(
        "SELECT COUNT(*) as count FROM subscription_groups WHERE subscription_id = ?"
      )
      .get(subscriptionId);
    return result?.count ?? 0;
  },

  // --- Free Usage (Analyzes) ---
  getFreeAnalyzesUsed(telegramId: number): number {
    const user = this.getUserByTelegramId(telegramId);
    if (!user) return 0;

    const result = db
      .prepare<{ free_analyzes_used: number; last_reset_at: number }, [number]>(
        "SELECT free_analyzes_used, last_reset_at FROM free_usage WHERE user_id = ?"
      )
      .get(user.id);

    if (!result) return 0;

    // Reset every 6 months
    const sixMonthsAgo = Math.floor(Date.now() / 1000) - 6 * 30 * 24 * 60 * 60;
    if (result.last_reset_at < sixMonthsAgo) {
      db.prepare("UPDATE free_usage SET free_analyzes_used = 0, last_reset_at = ? WHERE user_id = ?").run(
        Math.floor(Date.now() / 1000),
        user.id
      );
      return 0;
    }

    return result.free_analyzes_used;
  },

  incrementFreeAnalyzes(telegramId: number): void {
    const user = this.getUserByTelegramId(telegramId);
    if (!user) return;

    db.prepare(`
      INSERT INTO free_usage (user_id, free_analyzes_used, last_reset_at)
      VALUES (?, 1, unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET free_analyzes_used = free_analyzes_used + 1
    `).run(user.id);
  },

  // --- Payments ---
  logPayment(data: {
    telegramId: number;
    chargeId: string;
    type: "analyze" | "subscription" | "preset" | "promotion_group" | "promotion_product" | "publication";
    amount: number;
    payload?: Record<string, unknown>;
  }): void {
    const user = this.getUserByTelegramId(data.telegramId);
    if (!user) return;

    db.prepare(`
      INSERT INTO payments (user_id, telegram_charge_id, type, amount, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, data.chargeId, data.type, data.amount, data.payload ? JSON.stringify(data.payload) : null);
  },

  getPaymentByChargeId(chargeId: string): { id: number; type: string; payload: string | null } | null {
    return db
      .prepare<{ id: number; type: string; payload: string | null }, [string]>(
        "SELECT id, type, payload FROM payments WHERE telegram_charge_id = ?"
      )
      .get(chargeId) ?? null;
  },

  // --- Region Presets ---
  getRegionPresets(): Array<{
    id: number;
    region_code: string;
    region_name: string;
    country_code: string | null;
    currency: string | null;
    group_count: number;
  }> {
    return db
      .prepare<
        {
          id: number;
          region_code: string;
          region_name: string;
          country_code: string | null;
          currency: string | null;
          group_count: number;
        },
        []
      >(`
        SELECT rp.*, COUNT(pg.group_id) as group_count
        FROM region_presets rp
        LEFT JOIN preset_groups pg ON rp.id = pg.preset_id
        GROUP BY rp.id
      `)
      .all();
  },

  getPresetByCode(regionCode: string): {
    id: number;
    region_code: string;
    region_name: string;
    country_code: string | null;
    currency: string | null;
  } | null {
    return db
      .prepare<
        {
          id: number;
          region_code: string;
          region_name: string;
          country_code: string | null;
          currency: string | null;
        },
        [string]
      >("SELECT * FROM region_presets WHERE region_code = ?")
      .get(regionCode) ?? null;
  },

  getPresetGroups(presetId: number): Array<{ group_id: number; is_paid: number }> {
    return db
      .prepare<{ group_id: number; is_paid: number }, [number]>(
        "SELECT group_id, is_paid FROM preset_groups WHERE preset_id = ?"
      )
      .all(presetId);
  },

  // --- User Preset Access ---
  hasPresetAccess(telegramId: number, presetId: number): boolean {
    const user = this.getUserByTelegramId(telegramId);
    if (!user) return false;

    const result = db
      .prepare<{ expires_at: string | null; access_type: string }, [number, number]>(
        "SELECT expires_at, access_type FROM user_preset_access WHERE user_id = ? AND preset_id = ?"
      )
      .get(user.id, presetId);

    if (!result) return false;
    if (result.access_type === "lifetime") return true;

    // Check subscription expiry
    if (result.expires_at) {
      return new Date(result.expires_at) > new Date();
    }
    return false;
  },

  grantPresetAccess(
    telegramId: number,
    presetId: number,
    accessType: "lifetime" | "subscription",
    expiresAt: string | null
  ): void {
    const user = this.getUserByTelegramId(telegramId);
    if (!user) return;

    db.prepare(`
      INSERT INTO user_preset_access (user_id, preset_id, access_type, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, preset_id) DO UPDATE SET
        access_type = excluded.access_type,
        expires_at = excluded.expires_at,
        purchased_at = unixepoch()
    `).run(user.id, presetId, accessType, expiresAt);
  },

  // --- Promotions ---
  getActivePromotions(type: "group" | "product"): Array<{
    id: number;
    user_id: number;
    group_id: number | null;
    message_id: number | null;
    product_group_id: number | null;
    ends_at: number;
  }> {
    const now = Math.floor(Date.now() / 1000);
    return db
      .prepare<
        {
          id: number;
          user_id: number;
          group_id: number | null;
          message_id: number | null;
          product_group_id: number | null;
          ends_at: number;
        },
        [string, number]
      >("SELECT * FROM promotions WHERE type = ? AND is_active = 1 AND ends_at > ?")
      .all(type, now);
  },

  createPromotion(data: {
    telegramId: number;
    type: "group" | "product";
    groupId?: number;
    messageId?: number;
    productGroupId?: number;
    durationDays: number;
  }): void {
    const user = this.getUserByTelegramId(data.telegramId);
    if (!user) return;

    const now = Math.floor(Date.now() / 1000);
    const endsAt = now + data.durationDays * 24 * 60 * 60;

    db.prepare(`
      INSERT INTO promotions (user_id, type, group_id, message_id, product_group_id, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      data.type,
      data.groupId ?? null,
      data.messageId ?? null,
      data.productGroupId ?? null,
      now,
      endsAt
    );
  },

  // --- Premium Users for Priority Notifications ---
  getPremiumUsersForMessage(
    messageText: string,
    groupId: number
  ): number[] {
    // Get all users with active subscriptions for this group who have premium plan
    return db
      .prepare<{ telegram_id: number }, [number]>(`
        SELECT DISTINCT u.telegram_id
        FROM users u
        JOIN subscriptions s ON s.user_id = u.id
        JOIN subscription_groups sg ON sg.subscription_id = s.id
        WHERE sg.group_id = ?
          AND s.is_active = 1
          AND s.is_paused = 0
          AND u.plan IN ('basic', 'pro', 'business')
          AND (u.plan_expires_at IS NULL OR u.plan_expires_at > datetime('now'))
      `)
      .all(groupId)
      .map((r) => r.telegram_id);
  },

  /**
   * Get Premium users who were already notified about this specific message
   * Used for priority notification system - if a Premium user was notified,
   * Free users should have their notification delayed
   */
  getPremiumUsersNotifiedForMessage(
    messageId: number,
    groupId: number
  ): number[] {
    return db
      .prepare<{ telegram_id: number }, [number, number]>(`
        SELECT DISTINCT u.telegram_id
        FROM users u
        JOIN subscriptions s ON s.user_id = u.id
        JOIN found_posts_analyzes fpa ON fpa.subscription_id = s.id
        WHERE fpa.message_id = ?
          AND fpa.group_id = ?
          AND fpa.result = 'matched'
          AND fpa.notified_at IS NOT NULL
          AND u.plan IN ('basic', 'pro', 'business')
          AND (u.plan_expires_at IS NULL OR u.plan_expires_at > datetime('now'))
      `)
      .all(messageId, groupId)
      .map((r) => r.telegram_id);
  },
};

export { db };
