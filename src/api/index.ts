import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { queries } from "../db/index.ts";
import { validateInitData } from "./auth.ts";
import { apiLog } from "../logger.ts";

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
