import { Database } from "bun:sqlite";
import { tableExists } from "../migrations";

/**
 * Migration: Copy data from matched_messages to found_posts_analyzes
 * This is a one-time migration for existing data.
 * After this migration is successful, matched_messages table can be removed.
 */
export function migrate(db: Database) {
  // Skip if matched_messages doesn't exist (new database)
  if (!tableExists(db, "matched_messages")) {
    return;
  }

  // Skip if found_posts_analyzes doesn't exist (shouldn't happen but be safe)
  if (!tableExists(db, "found_posts_analyzes")) {
    return;
  }

  // Migrate data: all matched_messages are 'matched' results
  db.exec(`
    INSERT OR IGNORE INTO found_posts_analyzes
      (subscription_id, message_id, group_id, result, analyzed_at, notified_at)
    SELECT
      subscription_id,
      message_id,
      group_id,
      'matched',
      CAST(strftime('%s', matched_at) AS INTEGER),
      CAST(strftime('%s', matched_at) AS INTEGER)
    FROM matched_messages
  `);
}
