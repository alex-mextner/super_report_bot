/**
 * Fix publication_posts status CHECK constraint
 * Old: ('pending', 'scheduled', 'sent', 'failed')
 * New: ('pending', 'awaiting_approval', 'approved', 'skipped', 'sent', 'failed')
 *
 * SQLite doesn't support ALTER CHECK, so we recreate the table
 */
import { Database } from "bun:sqlite";

export function migrate(db: Database) {
  // Check if we need to migrate (look for old constraint)
  const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='publication_posts'").get() as { sql: string } | null;

  if (!tableInfo) {
    // Table doesn't exist - will be created by schema.sql
    return;
  }

  // Check if constraint already has 'awaiting_approval'
  if (tableInfo.sql.includes("awaiting_approval")) {
    return; // Already migrated
  }

  db.exec("BEGIN TRANSACTION");

  try {
    // Create new table with correct constraint
    db.exec(`
      CREATE TABLE publication_posts_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL,
        group_name TEXT,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'awaiting_approval', 'approved', 'skipped', 'sent', 'failed')),
        ai_text TEXT,
        message_id INTEGER,
        scheduled_at INTEGER,
        sent_at INTEGER,
        error_message TEXT
      )
    `);

    // Copy data, mapping 'scheduled' to 'pending' (closest equivalent)
    db.exec(`
      INSERT INTO publication_posts_new (id, publication_id, group_id, group_name, status, ai_text, message_id, scheduled_at, sent_at, error_message)
      SELECT id, publication_id, group_id, group_name,
        CASE status WHEN 'scheduled' THEN 'pending' ELSE status END,
        ai_text, message_id, scheduled_at, sent_at, error_message
      FROM publication_posts
    `);

    // Drop old table and rename
    db.exec("DROP TABLE publication_posts");
    db.exec("ALTER TABLE publication_posts_new RENAME TO publication_posts");

    // Recreate indexes
    db.exec("CREATE INDEX IF NOT EXISTS idx_publication_posts_pub ON publication_posts(publication_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_publication_posts_status ON publication_posts(status, scheduled_at)");

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
