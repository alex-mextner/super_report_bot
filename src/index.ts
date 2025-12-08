/**
 * Super Report Bot
 *
 * Telegram bot for monitoring group messages with fuzzy matching.
 *
 * Architecture:
 * - gramio: Bot API for user interface
 * - mtcute: MTProto for listening to group messages (userbot)
 * - BM25 + N-gram: Fast text matching
 * - HuggingFace: LLM for keyword generation and match verification
 */

import { bot } from "./bot/index.ts";
import { startListener, stopListener, invalidateSubscriptionsCache } from "./listener/index.ts";

// Re-export for external use
export { invalidateSubscriptionsCache };

async function main() {
  console.log("Starting Super Report Bot...\n");

  // Check required env vars
  const requiredEnvVars = ["BOT_TOKEN", "API_ID", "API_HASH"];
  const missing = requiredEnvVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Copy .env.example to .env and fill in the values.");
    process.exit(1);
  }

  if (!process.env.HF_TOKEN) {
    console.warn("Warning: HF_TOKEN not set. LLM features will be disabled.");
  }

  // Start gramio bot
  console.log("[bot] Starting gramio bot...");
  bot.start();
  console.log("[bot] Bot started");

  // Start MTProto listener
  try {
    await startListener();
  } catch (error) {
    console.error("[listener] Failed to start MTProto client:", error);
    console.error("Run 'bun run auth' first to authenticate the userbot.");
    // Continue running the bot even if listener fails
  }

  console.log("\n✓ Super Report Bot is running");
  console.log("Press Ctrl+C to stop\n");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");

    try {
      await stopListener();
    } catch (e) {
      // Ignore
    }

    try {
      await bot.stop();
    } catch (e) {
      // Ignore
    }

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
