import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { queries } from "../db/index.ts";
import { validateInitData, parseInitDataUser } from "./auth.ts";
import { apiLog } from "../logger.ts";
import { getMessages, getAllCachedMessages, getCachedGroups } from "../cache/messages.ts";
import { analyzeMessage, analyzeMessagesBatch, type BatchItem } from "../llm/analyze.ts";

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

// Auth middleware (skip in dev mode)
api.use("/*", async (c, next) => {
  const initData = c.req.header("X-Telegram-Init-Data");

  // Skip auth in development (use ADMIN_ID as default user)
  if (process.env.NODE_ENV === "development") {
    c.set("userId", ADMIN_ID);
    c.set("isAdmin", true);
    await next();
    return;
  }

  if (!initData || !validateInitData(initData)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Parse user from initData
  const user = parseInitDataUser(initData);
  const userId = user?.id ?? null;
  c.set("userId", userId);
  c.set("isAdmin", userId === ADMIN_ID);

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
  const product = queries.getProductById(id);

  if (!product) {
    return c.json({ error: "Not found" }, 404);
  }

  const contacts = queries.getProductContacts(id);

  return c.json({
    ...product,
    contacts,
    messageLink: buildTelegramLink(product.group_id, product.message_id),
  });
});

// GET /api/products/:id/similar
api.get("/products/:id/similar", (c) => {
  const id = Number(c.req.param("id"));
  const product = queries.getProductById(id);

  if (!product) {
    return c.json({ error: "Not found" }, 404);
  }

  const similar = queries.getSimilarProducts(id, product.category_code, 5);

  return c.json({
    items: similar.map((p) => ({
      ...p,
      messageLink: buildTelegramLink(p.group_id, p.message_id),
      priceDiff:
        p.price_normalized && product.price_normalized
          ? p.price_normalized - product.price_normalized
          : null,
    })),
  });
});

// POST /api/analyze - analyze single message with AI (admin only)
api.post("/analyze", async (c) => {
  const isAdmin = c.get("isAdmin");

  if (!isAdmin) {
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
  const isAdmin = c.get("isAdmin");

  if (!isAdmin) {
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
    text: msg.text,
    sender_id: msg.senderId ?? null,
    sender_name: msg.senderName ?? null,
    message_date: msg.date,
    messageLink: buildTelegramLink(msg.groupId, msg.id),
  }));

  // Sort by date descending
  allMessages.sort((a, b) => b.message_date - a.message_date);

  // Filter by search
  if (search) {
    const searchLower = search.toLowerCase();
    allMessages = allMessages.filter((m) =>
      m.text.toLowerCase().includes(searchLower)
    );
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
 * Build Telegram message link
 * For supergroups: https://t.me/c/{chat_id}/{message_id}
 */
function buildTelegramLink(groupId: number, messageId: number): string {
  // Supergroup IDs start with -100
  const chatIdStr = String(groupId);
  const cleanChatId = chatIdStr.startsWith("-100")
    ? chatIdStr.slice(4)
    : chatIdStr.replace("-", "");

  return `https://t.me/c/${cleanChatId}/${messageId}`;
}

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
