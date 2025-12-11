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
 * - Hono: API server for WebApp
 */

import { bot, notifyUser } from "./bot/index.ts";
import { recoverPendingOperations } from "./bot/recovery.ts";
import { startListener, stopListener, invalidateSubscriptionsCache } from "./listener/index.ts";
import { startApiServer } from "./api/index.ts";
import { logger } from "./logger.ts";
import { scheduleNightlyAnalytics, stopAnalyticsScheduler } from "./analytics/scheduler.ts";
import {
  startDelayedQueueProcessor,
  stopDelayedQueueProcessor,
  setNotifyUserFn,
} from "./bot/notifications.ts";

// Re-export for external use
export { invalidateSubscriptionsCache };

async function main() {
  logger.info("Starting Super Report Bot...");

  // Build webapp
  logger.info("Building webapp...");
  const buildResult = Bun.spawnSync(["bun", "run", "webapp:build"], {
    cwd: import.meta.dir + "/..",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (buildResult.exitCode !== 0) {
    logger.warn("Webapp build failed, continuing without webapp");
  } else {
    logger.info("Webapp built successfully");
  }

  // Check required env vars
  const requiredEnvVars = ["BOT_TOKEN", "API_ID", "API_HASH"];
  const missing = requiredEnvVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    logger.fatal({ missing }, "Missing required environment variables");
    logger.fatal("Copy .env.example to .env and fill in the values.");
    process.exit(1);
  }

  if (!process.env.HF_TOKEN) {
    logger.warn("HF_TOKEN not set. LLM features will be disabled.");
  }

  // Start gramio bot
  logger.info({ component: "bot" }, "Starting gramio bot...");
  bot.start();
  logger.info({ component: "bot" }, "Bot started");

  // Setup delayed notifications processor
  setNotifyUserFn(notifyUser);
  startDelayedQueueProcessor();

  // Recover any interrupted operations from previous run (non-blocking)
  recoverPendingOperations(bot);

  // Start MTProto listener
  try {
    await startListener();
  } catch (error) {
    logger.error({ err: error, component: "listener" }, "Failed to start MTProto client");
    logger.error("Run 'bun run auth' first to authenticate the userbot.");
    // Continue running the bot even if listener fails
  }

  // Start API server for WebApp
  const apiPort = Number(process.env.API_PORT) || 3000;
  startApiServer(apiPort);

  // Schedule nightly analytics (runs at 3:00 AM)
  scheduleNightlyAnalytics();

  logger.info("Super Report Bot is running. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");

    stopAnalyticsScheduler();
    stopDelayedQueueProcessor();

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
  logger.fatal({ err: error }, "Fatal error");
  process.exit(1);
});
