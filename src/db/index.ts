import { Database } from "bun:sqlite";
import type {
  User,
  UserMode,
  Subscription,
  MonitoredGroup,
  MatchedMessage,
  Category,
  Product,
  SellerContact,
} from "../types.ts";
import { runMigrations } from "./migrations.ts";

const db = new Database("data.db", { create: true });

// Initialize schema
const schema = await Bun.file(new URL("./schema.sql", import.meta.url)).text();
db.exec(schema);

// Run migrations
runMigrations(db);

// Prepared statements
const stmts = {
  // Users
  getUser: db.prepare<User, [number]>("SELECT * FROM users WHERE telegram_id = ?"),
  createUser: db.prepare<void, [number]>("INSERT OR IGNORE INTO users (telegram_id) VALUES (?)"),
  getUserMode: db.prepare<{ mode: UserMode }, [number]>(
    "SELECT COALESCE(mode, 'normal') as mode FROM users WHERE telegram_id = ?"
  ),
  setUserMode: db.prepare<void, [string, number]>(
    "UPDATE users SET mode = ? WHERE telegram_id = ?"
  ),

  // Subscriptions
  getActiveSubscriptions: db.prepare<Subscription, []>(
    "SELECT * FROM subscriptions WHERE is_active = 1"
  ),
  getSubscriptionsForGroup: db.prepare<Subscription, [number]>(
    `SELECT DISTINCT s.* FROM subscriptions s
     JOIN subscription_groups sg ON s.id = sg.subscription_id
     WHERE s.is_active = 1 AND sg.group_id = ?`
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

  // Get all unique group IDs from active subscription groups
  getAllSubscriptionGroupIds: db.prepare<{ group_id: number }, []>(
    `SELECT DISTINCT sg.group_id FROM subscription_groups sg
     JOIN subscriptions s ON sg.subscription_id = s.id
     WHERE s.is_active = 1`
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
  createProduct: db.prepare<void, [number, number, string, string, string | null, string | null, number | null, number | null, string | null, number]>(
    `INSERT INTO products (message_id, group_id, group_title, text, category_code, price_raw, price_normalized, sender_id, sender_name, message_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
};

// Helper to parse JSON fields from subscription
function parseSubscription(row: Subscription): Subscription {
  const rawDisabled = (row as unknown as { disabled_negative_keywords?: string })
    .disabled_negative_keywords;
  return {
    ...row,
    positive_keywords: JSON.parse(row.positive_keywords as unknown as string),
    negative_keywords: JSON.parse(row.negative_keywords as unknown as string),
    disabled_negative_keywords: rawDisabled ? JSON.parse(rawDisabled) : [],
  };
}

export const queries = {
  // Users
  getOrCreateUser(telegramId: number): User {
    stmts.createUser.run(telegramId);
    return stmts.getUser.get(telegramId)!;
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
    price_normalized: number | null;
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
      data.price_normalized,
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
};

export { db };
