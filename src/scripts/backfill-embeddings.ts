#!/usr/bin/env bun
/**
 * Backfill script: Generate embeddings for existing messages
 *
 * Run: bun run backfill:embeddings
 */
import { queries } from "../db/index.ts";
import { getEmbeddings, checkBgeHealth } from "../llm/embeddings.ts";

const BATCH_SIZE = 100;

async function main() {
  console.log("🔍 Checking BGE server health...");

  const healthy = await checkBgeHealth();
  if (!healthy) {
    console.error("❌ BGE server is not available. Make sure it's running on BGE_URL.");
    process.exit(1);
  }

  console.log("✅ BGE server is healthy");

  const total = queries.countMessagesWithoutEmbedding();
  console.log(`📊 Found ${total} messages without embeddings`);

  if (total === 0) {
    console.log("✨ All messages already have embeddings!");
    return;
  }

  let processed = 0;
  let failed = 0;
  const startTime = Date.now();

  while (true) {
    const messages = queries.getMessagesWithoutEmbedding(BATCH_SIZE);

    if (messages.length === 0) {
      break;
    }

    try {
      const texts = messages.map((m) => m.text);
      const embeddings = await getEmbeddings(texts);

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const embedding = embeddings[i];
        if (msg && embedding) {
          queries.saveMessageEmbedding(msg.id, embedding);
        }
      }

      processed += messages.length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processed / parseFloat(elapsed)).toFixed(1);
      const remaining = total - processed;
      const eta = remaining > 0 ? Math.ceil(remaining / parseFloat(rate)) : 0;

      process.stdout.write(
        `\r📈 Progress: ${processed}/${total} (${((processed / total) * 100).toFixed(1)}%) | ${rate} msg/s | ETA: ${eta}s    `
      );
    } catch (error) {
      failed += messages.length;
      console.error(`\n❌ Batch failed:`, error);

      // Wait and retry
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log(
    `\n\n✅ Done! Processed: ${processed}, Failed: ${failed}, Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
