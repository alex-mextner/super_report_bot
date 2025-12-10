import { getMessages, getCacheStats } from "../cache/messages.ts";
import { classifyBatch, DEFAULT_CATEGORIES } from "../llm/classify.ts";
import { queries } from "../db/index.ts";
import { extractPrice } from "../utils/price.ts";
import { parseContacts } from "../utils/contacts.ts";
import { llmLog } from "../logger.ts";

const BATCH_SIZE = 50;
const CLASSIFY_INTERVAL = 60000; // 1 minute

let isRunning = false;

/**
 * Seed default categories if empty
 */
export function seedCategories(): void {
  const existing = queries.getCategories();
  if (existing.length === 0) {
    for (const cat of DEFAULT_CATEGORIES) {
      queries.upsertCategory(cat.code, cat.name_ru);
    }
    llmLog.info({ count: DEFAULT_CATEGORIES.length }, "Seeded default categories");
  }
}

/**
 * Run classification job once
 */
export async function runClassificationJob(): Promise<void> {
  if (isRunning) {
    llmLog.debug("Classification job already running, skipping");
    return;
  }

  isRunning = true;

  try {
    const stats = getCacheStats();
    if (stats.totalMessages === 0) {
      llmLog.debug("No messages in cache, skipping classification");
      return;
    }

    llmLog.info(stats, "Starting classification job");

    // Get all group IDs from subscriptions
    const groupIds = queries.getAllSubscriptionGroupIds();

    for (const groupId of groupIds) {
      const messages = getMessages(groupId);

      // Filter already classified
      const unclassified = messages.filter(
        (m) => !queries.isProductClassified(m.id, m.groupId)
      );

      if (unclassified.length === 0) continue;

      llmLog.debug({ groupId, count: unclassified.length }, "Found unclassified messages");

      // Process in batches
      for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
        const batch = unclassified.slice(i, i + BATCH_SIZE);

        try {
          const result = await classifyBatch(
            batch.map((m) => ({ id: m.id, text: m.text }))
          );

          // Save new categories
          for (const cat of result.new_categories) {
            queries.upsertCategory(cat.code, cat.name_ru);
          }

          // Save products
          for (const item of result.items) {
            const msg = batch.find((m) => m.id === item.id);
            if (!msg) continue;

            // Extract price from text
            const { raw: priceRaw, value: priceValue, currency: priceCurrency } = extractPrice(msg.text);

            const productId = queries.createProduct({
              message_id: msg.id,
              group_id: msg.groupId,
              group_title: msg.groupTitle,
              text: msg.text,
              category_code: item.category,
              price_raw: priceRaw,
              price_value: priceValue,
              price_currency: priceCurrency,
              sender_id: msg.senderId || null,
              sender_name: msg.senderName || null,
              message_date: msg.date,
            });

            // Save contacts from LLM
            for (const contact of item.contacts) {
              queries.addSellerContact(productId, contact.type, contact.value, "llm_parse");
            }

            // Parse contacts from text (backup)
            const textContacts = parseContacts(msg.text);
            for (const contact of textContacts) {
              // Avoid duplicates from LLM
              const exists = item.contacts.some(
                (c) => c.value === contact.value
              );
              if (!exists) {
                queries.addSellerContact(productId, contact.type, contact.value, "text_parse");
              }
            }

            // Add sender profile as fallback contact
            if (msg.senderId) {
              queries.addSellerContact(
                productId,
                "profile",
                `tg://user?id=${msg.senderId}`,
                "sender_profile"
              );
            }
          }

          llmLog.info(
            { groupId, batchSize: batch.length, classified: result.items.length },
            "Batch classified"
          );
        } catch (error) {
          llmLog.error({ err: error, groupId }, "Batch classification failed");
        }

        // Rate limiting between batches
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Start background classification scheduler
 */
export function startClassificationScheduler(): void {
  // Seed categories on start
  seedCategories();

  // Run immediately
  runClassificationJob();

  // Schedule periodic runs
  setInterval(runClassificationJob, CLASSIFY_INTERVAL);

  llmLog.info({ interval: CLASSIFY_INTERVAL }, "Classification scheduler started");
}
