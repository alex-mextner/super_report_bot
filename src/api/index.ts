import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { queries } from "../db/index.ts";
import { validateInitData, parseInitDataUser } from "./auth.ts";
import { apiLog } from "../logger.ts";
import { getMessages, getAllCachedMessages, getCachedGroups, getCachedMessageById, getTopicsByGroup } from "../cache/messages.ts";
import { analyzeMessage, analyzeMessagesBatch, type BatchItem } from "../llm/analyze.ts";
import { deepAnalyze } from "../llm/deep-analyze.ts";
import { generateNgrams, generateWordShingles } from "../matcher/normalize.ts";
import { fetchMediaForMessage } from "../listener/index.ts";

const ADMIN_ID = Number(process.env.ADMIN_ID) || 0;

type Variables = {
  userId: number | null;
  isAdmin: boolean;
};

const app = new Hono();
const api = new Hono<{ Variables: Variables }>();

// CORS for WebApp
api.use(
  "/*",
  cors({
    origin: "*",
  })
);

// Strict auth middleware - only works inside Telegram WebApp
api.use("/*", async (c, next) => {
  // Health check and media files are public
  if (c.req.path === "/api/health" || c.req.path.startsWith("/api/media/")) {
    await next();
    return;
  }

  const initData = c.req.header("X-Telegram-Init-Data");

  apiLog.debug(
    {
      path: c.req.path,
      hasInitData: !!initData,
      initDataLength: initData?.length ?? 0,
    },
    "Auth middleware"
  );

  if (!initData || !validateInitData(initData)) {
    apiLog.warn({ path: c.req.path, hasInitData: !!initData }, "Auth failed");
    return c.json({ error: "Unauthorized - Telegram WebApp only" }, 401);
  }

  const user = parseInitDataUser(initData);
  const userId = user?.id ?? null;
  c.set("userId", userId);
  c.set("isAdmin", userId === ADMIN_ID);

  apiLog.debug({ userId, isAdmin: userId === ADMIN_ID }, "Auth success");

  await next();
});

// GET /api/me - current user info
api.get("/me", (c) => {
  return c.json({
    userId: c.get("userId"),
    isAdmin: c.get("isAdmin"),
  });
});

// GET /api/groups - list of groups with cached messages
api.get("/groups", (c) => {
  const groups = getCachedGroups();
  apiLog.debug({ count: groups.length }, "GET /api/groups");
  return c.json(groups);
});

// GET /api/groups/:id/topics - list of topics in a group
api.get("/groups/:id/topics", (c) => {
  const groupId = Number(c.req.param("id"));
  const topics = getTopicsByGroup(groupId);
  apiLog.debug({ groupId, count: topics.length }, "GET /api/groups/:id/topics");
  return c.json({ items: topics });
});

// GET /api/products
api.get("/products", (c) => {
  const search = c.req.query("search");
  const groupId = c.req.query("group_id");
  const offset = Number(c.req.query("offset")) || 0;
  const limit = Math.min(Number(c.req.query("limit")) || 20, 100);

  const groupIdNum = groupId ? Number(groupId) : undefined;
  const result = getProductsFromCache(search, groupIdNum, offset, limit);
  apiLog.debug({ total: result.total, itemsCount: result.items.length }, "GET /api/products");
  return c.json(result);
});

// GET /api/products/:id
api.get("/products/:id", (c) => {
  const id = Number(c.req.param("id"));
  const msg = getCachedMessageById(id);

  if (!msg) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({
    id: msg.id,
    message_id: msg.id,
    group_id: msg.groupId,
    group_title: msg.groupTitle,
    text: msg.text,
    sender_id: msg.senderId ?? null,
    sender_name: msg.senderName ?? null,
    message_date: msg.date,
    contacts: [],
    messageLink: buildTelegramLink(msg.groupId, msg.id),
  });
});

// GET /api/products/:id/similar - returns empty for now (no classification)
api.get("/products/:id/similar", (c) => {
  return c.json({ items: [] });
});

// POST /api/analyze - analyze single message with AI (admin only)
api.post("/analyze", async (c) => {
  if (!c.get("isAdmin")) {
    return c.json({ error: "Premium feature" }, 403);
  }

  const body = await c.req.json<{ text: string }>();
  if (!body.text) {
    return c.json({ error: "Text required" }, 400);
  }

  try {
    const result = await analyzeMessage(body.text);
    return c.json(result);
  } catch (error) {
    apiLog.error({ err: error }, "AI analysis failed");
    return c.json({ error: "Analysis failed" }, 500);
  }
});

// POST /api/analyze-batch - analyze all cached messages (admin only)
api.post("/analyze-batch", async (c) => {
  if (!c.get("isAdmin")) {
    return c.json({ error: "Premium feature" }, 403);
  }

  const body = await c.req.json<{ group_id?: number; limit?: number }>();
  const groupId = body.group_id;
  const limit = Math.min(body.limit ?? 50, 100);

  // Get messages from cache
  let messages = getAllCachedMessages();

  if (groupId !== undefined) {
    messages = messages.filter((m) => m.groupId === groupId);
  }

  // Sort by date and limit
  messages.sort((a, b) => b.date - a.date);
  messages = messages.slice(0, limit);

  if (messages.length === 0) {
    return c.json({ results: [] });
  }

  const items: BatchItem[] = messages.map((m) => ({
    id: m.id,
    text: m.text,
  }));

  try {
    apiLog.info({ count: items.length, groupId }, "Starting batch analysis");
    const results = await analyzeMessagesBatch(items);
    return c.json({ results });
  } catch (error) {
    apiLog.error({ err: error }, "Batch AI analysis failed");
    return c.json({ error: "Analysis failed" }, 500);
  }
});

// === Subscriptions API ===

// GET /api/subscriptions - list user's subscriptions
api.get("/subscriptions", (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const subscriptions = queries.getUserSubscriptions(userId);

  // Add groups for each subscription
  const items = subscriptions.map((sub) => {
    const groups = queries.getSubscriptionGroups(sub.id);
    return {
      id: sub.id,
      original_query: sub.original_query,
      positive_keywords: sub.positive_keywords,
      negative_keywords: sub.negative_keywords,
      llm_description: sub.llm_description,
      is_active: sub.is_active,
      created_at: sub.created_at,
      groups: groups.map((g) => ({
        id: g.group_id,
        title: g.group_title,
      })),
    };
  });

  apiLog.debug({ userId, count: items.length }, "GET /api/subscriptions");
  return c.json({ items });
});

// GET /api/subscriptions/:id - single subscription
api.get("/subscriptions/:id", (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = Number(c.req.param("id"));
  const subscription = queries.getSubscriptionById(id, userId);

  if (!subscription) {
    return c.json({ error: "Not found" }, 404);
  }

  const groups = queries.getSubscriptionGroups(id);

  return c.json({
    id: subscription.id,
    original_query: subscription.original_query,
    positive_keywords: subscription.positive_keywords,
    negative_keywords: subscription.negative_keywords,
    llm_description: subscription.llm_description,
    is_active: subscription.is_active,
    created_at: subscription.created_at,
    groups: groups.map((g) => ({
      id: g.group_id,
      title: g.group_title,
    })),
  });
});

// DELETE /api/subscriptions/:id - deactivate subscription
api.delete("/subscriptions/:id", (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = Number(c.req.param("id"));

  // Check if subscription exists
  const subscription = queries.getSubscriptionById(id, userId);
  if (!subscription) {
    return c.json({ error: "Not found" }, 404);
  }

  queries.deactivateSubscription(id, userId);
  apiLog.info({ userId, subscriptionId: id }, "Subscription deactivated");

  return c.json({ success: true });
});

// GET /api/subscriptions/:id/groups - groups for subscription
api.get("/subscriptions/:id/groups", (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = Number(c.req.param("id"));

  // Check if subscription belongs to user
  const subscription = queries.getSubscriptionById(id, userId);
  if (!subscription) {
    return c.json({ error: "Not found" }, 404);
  }

  const groups = queries.getSubscriptionGroups(id);

  return c.json({
    items: groups.map((g) => ({
      id: g.group_id,
      title: g.group_title,
    })),
  });
});

// POST /api/analyze-deep - deep product analysis with market prices
api.post("/analyze-deep", async (c) => {
  const body = await c.req.json<{ text: string; groupTitle?: string }>();
  if (!body.text) {
    return c.json({ error: "Text required" }, 400);
  }

  try {
    const result = await deepAnalyze(body.text, body.groupTitle);
    return c.json(result);
  } catch (error) {
    apiLog.error({ err: error }, "Deep analysis failed");
    return c.json({ error: "Analysis failed" }, 500);
  }
});

// Health check
api.get("/health", (c) => {
  return c.json({ status: "ok" });
});

/**
 * Get products from cache
 */
function getProductsFromCache(search?: string, groupId?: number, offset = 0, limit = 20) {
  // Get all messages from cache
  let messages = getAllCachedMessages();

  // Filter by group
  if (groupId !== undefined) {
    messages = messages.filter((m) => m.groupId === groupId);
  }

  // Map to product format
  let allMessages = messages.map((msg) => ({
    id: msg.id,
    message_id: msg.id,
    group_id: msg.groupId,
    group_title: msg.groupTitle,
    topic_id: msg.topicId ?? null,
    topic_title: msg.topicTitle ?? null,
    text: msg.text,
    sender_id: msg.senderId ?? null,
    sender_name: msg.senderName ?? null,
    message_date: msg.date,
    messageLink: buildTelegramLink(msg.groupId, msg.id, msg.topicId),
  }));

  // Sort by date descending
  allMessages.sort((a, b) => b.message_date - a.message_date);

  // Fuzzy search with n-gram similarity
  if (search) {
    const results = fuzzySearch(allMessages, search, 0.15); // min threshold to filter garbage

    // Add score and matchType to items
    const scoredItems = results.map((r) => ({
      ...r.item,
      _score: r.score,
      _matchType: r.score >= 0.8 ? "exact" : r.score >= 0.5 ? "good" : "partial",
    }));

    const total = scoredItems.length;
    const items = scoredItems.slice(offset, offset + limit);

    // Count by match type
    const exactCount = results.filter((r) => r.score >= 0.8).length;
    const goodCount = results.filter((r) => r.score >= 0.5 && r.score < 0.8).length;
    const partialCount = results.filter((r) => r.score < 0.5).length;

    return {
      items,
      offset,
      limit,
      total,
      hasMore: offset + items.length < total,
      searchStats: {
        exactCount,
        goodCount,
        partialCount,
      },
    };
  }

  const total = allMessages.length;
  const items = allMessages.slice(offset, offset + limit);

  return {
    items,
    offset,
    limit,
    total,
    hasMore: offset + items.length < total,
  };
}

/**
 * Jaccard similarity between two sets
 */
export function jaccardSimilarity<T>(setA: Set<T>, setB: Set<T>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

export interface FuzzySearchResult<T> {
  item: T;
  score: number;
}

/**
 * Calculate what fraction of query n-grams are found in text
 * Asymmetric: checks if query is IN text, not symmetric similarity
 */
function queryCoverage(textNgrams: Set<string>, queryNgrams: Set<string>): number {
  if (queryNgrams.size === 0) return 1;

  let found = 0;
  for (const ng of queryNgrams) {
    if (textNgrams.has(ng)) found++;
  }
  return found / queryNgrams.size;
}

/**
 * Fuzzy search with n-gram similarity
 * Uses asymmetric coverage: what fraction of query is found in text
 * Returns items sorted by relevance score
 */
export function fuzzySearch<T extends { text: string }>(
  items: T[],
  query: string,
  threshold: number = 0.3
): FuzzySearchResult<T>[] {
  if (!query || query.trim().length === 0) {
    return items.map((item) => ({ item, score: 1 }));
  }

  const queryNgrams = generateNgrams(query, 3);
  const queryShingles = generateWordShingles(query, 2);
  const isSingleWord = queryShingles.size === 1;

  const scored = items.map((item) => {
    const textNgrams = generateNgrams(item.text, 3);
    const textShingles = generateWordShingles(item.text, 2);

    // Asymmetric: how much of the query is found in the text
    const charCoverage = queryCoverage(textNgrams, queryNgrams);
    const wordCoverage = queryCoverage(textShingles, queryShingles);

    // For single-word queries, rely more on character n-grams
    // (word shingles won't match because text has bigrams like "word1 word2")
    const score = isSingleWord
      ? charCoverage
      : charCoverage * 0.4 + wordCoverage * 0.6;

    return { item, score };
  });

  return scored
    .filter((r) => r.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/**
 * Build Telegram message link
 * For supergroups: https://t.me/c/{chat_id}/{message_id}
 * For forum topics: https://t.me/c/{chat_id}/{topic_id}/{message_id}
 */
function buildTelegramLink(groupId: number, messageId: number, topicId?: number): string {
  // Supergroup IDs start with -100
  const chatIdStr = String(groupId);
  const cleanChatId = chatIdStr.startsWith("-100")
    ? chatIdStr.slice(4)
    : chatIdStr.replace("-", "");

  if (topicId) {
    return `https://t.me/c/${cleanChatId}/${topicId}/${messageId}`;
  }
  return `https://t.me/c/${cleanChatId}/${messageId}`;
}

// ==============================
// Media endpoints
// ==============================

// GET /api/products/:messageId/:groupId/media - Get media info for a message
api.get("/products/:messageId/:groupId/media", async (c) => {
  const messageId = Number(c.req.param("messageId"));
  const groupId = Number(c.req.param("groupId"));

  let media = queries.getMediaForMessage(messageId, groupId);

  // If no media in DB, try to fetch from Telegram
  if (media.length === 0) {
    await fetchMediaForMessage(messageId, groupId);
    // Re-query after fetching
    media = queries.getMediaForMessage(messageId, groupId);
  }

  return c.json({
    items: media.map((m) => ({
      index: m.media_index,
      type: m.media_type,
      path: m.file_path,
      width: m.width,
      height: m.height,
      duration: m.duration,
      url: `/api/media/${m.file_path}`,
    })),
  });
});

// GET /api/media/:groupId/:filename - Serve media file
api.get("/media/:groupId/:filename", async (c) => {
  const groupId = c.req.param("groupId");
  const filename = c.req.param("filename");

  // Validate filename to prevent path traversal
  if (filename.includes("..") || filename.includes("/")) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const filePath = `data/media/${groupId}/${filename}`;
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return c.json({ error: "Media not found" }, 404);
  }

  // Determine content type
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "mp4"
          ? "video/mp4"
          : "application/octet-stream";

  return new Response(file, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000", // Cache for 1 year
    },
  });
});

// GET /api/media/check/:messageId/:groupId - Check if message has media
api.get("/media/check/:messageId/:groupId", (c) => {
  const messageId = Number(c.req.param("messageId"));
  const groupId = Number(c.req.param("groupId"));

  const hasMedia = queries.hasMediaForMessage(messageId, groupId);

  return c.json({ hasMedia });
});

// Mount API routes
app.route("/api", api);

// Serve webapp static files
app.use("/*", serveStatic({ root: "./webapp/dist" }));

// SPA fallback - serve index.html for all non-API routes
app.get("*", serveStatic({ path: "./webapp/dist/index.html" }));

export { app, api };

/**
 * Start API server with static file serving
 */
export function startApiServer(port: number = 3000): void {
  Bun.serve({
    fetch: app.fetch,
    port,
  });

  apiLog.info({ port }, "API server started (with webapp static files)");
}
