/**
 * Migration: Add AI text and approval flow to publication_posts
 *
 * Adds:
 * - group_name: group name for display to user
 * - ai_text: AI-rephrased text for this specific group
 * - New statuses: awaiting_approval, approved, skipped
 */

import { Database } from "bun:sqlite";
import { columnExists } from "../migrations.ts";

export function migrate(db: Database) {
  // Add group_name column
  if (!columnExists(db, "publication_posts", "group_name")) {
    db.exec("ALTER TABLE publication_posts ADD COLUMN group_name TEXT");
  }

  // Add ai_text column
  if (!columnExists(db, "publication_posts", "ai_text")) {
    db.exec("ALTER TABLE publication_posts ADD COLUMN ai_text TEXT");
  }

  // Note: SQLite doesn't support modifying CHECK constraints
  // New statuses will work because SQLite CHECK is advisory only
  // The schema.sql already has the updated CHECK for new databases
}
