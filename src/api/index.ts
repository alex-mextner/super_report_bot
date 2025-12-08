import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { queries } from "../db/index.ts";
import { validateInitData } from "./auth.ts";
import { apiLog } from "../logger.ts";
import { getMessages } from "../cache/messages.ts";
import { extractPrice } from "../utils/price.ts";

const app = new Hono();
const api = new Hono();

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

  // Skip auth in development
  if (process.env.NODE_ENV === "development") {
    await next();
    return;
  }

  if (!initData || !validateInitData(initData)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
});

// GET /api/categories
api.get("/categories", (c) => {
  const categories = queries.getCategories();
  return c.json(categories);
});

// GET /api/products
api.get("/products", (c) => {
  const category = c.req.query("category");
  const search = c.req.query("search");
  const offset = Number(c.req.query("offset")) || 0;
  const limit = Math.min(Number(c.req.query("limit")) || 20, 100);

  // Check if we have classified products
  const totalClassified = queries.getProductsCount();

  // If no classified products yet, return raw messages from cache
  if (totalClassified === 0) {
    return c.json(getProductsFromCache(search, offset, limit));
  }

  const products = queries.getProducts({ category, search, offset, limit });
  const total = queries.getProductsCount(category);

  return c.json({
    items: products.map((p) => ({
      ...p,
      messageLink: buildTelegramLink(p.group_id, p.message_id),
    })),
    offset,
    limit,
    total,
    hasMore: offset + products.length < total,
  });
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

// Health check
api.get("/health", (c) => {
  return c.json({ status: "ok" });
});

/**
 * Get products from cache (fallback when classification not done)
 */
function getProductsFromCache(search?: string, offset = 0, limit = 20) {
  const groupIds = queries.getAllSubscriptionGroupIds();
  let allMessages: Array<{
    id: number;
    message_id: number;
    group_id: number;
    group_title: string;
    text: string;
    price_raw: string | null;
    price_normalized: number | null;
    sender_id: number | null;
    sender_name: string | null;
    message_date: number;
    category_code: null;
    messageLink: string;
  }> = [];

  for (const groupId of groupIds) {
    const messages = getMessages(groupId);
    for (const msg of messages) {
      const { raw, normalized } = extractPrice(msg.text);
      allMessages.push({
        id: msg.id, // use message_id as id for cache items
        message_id: msg.id,
        group_id: msg.groupId,
        group_title: msg.groupTitle,
        text: msg.text,
        price_raw: raw,
        price_normalized: normalized,
        sender_id: msg.senderId ?? null,
        sender_name: msg.senderName ?? null,
        message_date: msg.date,
        category_code: null,
        messageLink: buildTelegramLink(msg.groupId, msg.id),
      });
    }
  }

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
