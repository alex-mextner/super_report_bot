#!/usr/bin/env bun
/**
 * Migration script: Generate BGE-M3 embeddings for existing subscriptions
 *
 * Run: bun run scripts/migrate-embeddings.ts
 *
 * This script:
 * 1. Finds all active subscriptions without keyword_embeddings
 * 2. Generates embeddings using BGE-M3 server
 * 3. Saves embeddings to DB
 */

import { queries } from "../src/db/index.ts";
import { generateKeywordEmbeddings, checkBgeHealth } from "../src/llm/embeddings.ts";

async function main() {
  console.log("Checking BGE server health...");

  const isHealthy = await checkBgeHealth();
  if (!isHealthy) {
    console.error("ERROR: BGE server is not available at", process.env.BGE_URL || "http://localhost:8080");
    console.log("Make sure the BGE-M3 server is running:");
    console.log("  cd bge-server && docker-compose up -d bge-server");
    process.exit(1);
  }

  console.log("BGE server is healthy!");

  const subscriptions = queries.getSubscriptionsWithoutEmbeddings();
  console.log(`Found ${subscriptions.length} subscriptions without embeddings`);

  if (subscriptions.length === 0) {
    console.log("Nothing to migrate. All subscriptions have embeddings.");
    return;
  }

  let success = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    console.log(`\nProcessing subscription ${sub.id}:`);
    console.log(`  Query: ${sub.original_query.slice(0, 50)}...`);
    console.log(`  Positive: ${sub.positive_keywords.join(", ")}`);
    console.log(`  Negative: ${sub.negative_keywords.join(", ")}`);

    try {
      const embeddings = await generateKeywordEmbeddings(
        sub.positive_keywords,
        sub.negative_keywords
      );

      queries.updateKeywordEmbeddings(sub.id, embeddings);
      console.log(`  ✅ Generated ${embeddings.pos.length} pos + ${embeddings.neg.length} neg embeddings`);
      success++;
    } catch (error) {
      console.error(`  ❌ Failed:`, error);
      failed++;
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=== Migration complete ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
