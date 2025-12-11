import { Database } from "bun:sqlite";
import { columnExists, tableExists } from "../migrations";

export function migrate(db: Database) {
  // Add last_active column to users
  if (!columnExists(db, "users", "last_active")) {
    db.exec("ALTER TABLE users ADD COLUMN last_active INTEGER");
  }

  // Create index for last_active
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_last_active
    ON users(last_active DESC)
  `);

  // Create bot_messages table
  if (!tableExists(db, "bot_messages")) {
    db.exec(`
      CREATE TABLE bot_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        telegram_id INTEGER NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        message_type TEXT NOT NULL CHECK (message_type IN ('text', 'command', 'callback', 'forward', 'other')),
        text TEXT,
        command TEXT,
        callback_data TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.exec(`
      CREATE INDEX idx_bot_messages_telegram
      ON bot_messages(telegram_id, created_at DESC)
    `);
  }
}
