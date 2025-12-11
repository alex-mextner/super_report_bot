/**
 * Add tables for user publications feature:
 * - user_sessions: MTProto sessions for publishing from user's account
 * - publications: pending/completed publication requests
 * - publication_posts: individual posts to groups within a publication
 */
import { Database } from "bun:sqlite";
import { tableExists } from "../migrations";

export function migrate(db: Database) {
  // User MTProto sessions for publishing
  if (!tableExists(db, "user_sessions")) {
    db.exec(`
      CREATE TABLE user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone TEXT NOT NULL,
        session_string TEXT NOT NULL,    -- encrypted MTProto session
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (unixepoch()),
        last_used_at INTEGER,
        UNIQUE(user_id)
      )
    `);
    db.exec(`CREATE INDEX idx_user_sessions_user ON user_sessions(user_id)`);
  }

  // Publications (user's listing to publish across preset groups)
  if (!tableExists(db, "publications")) {
    db.exec(`
      CREATE TABLE publications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        preset_id INTEGER NOT NULL REFERENCES region_presets(id),
        text TEXT NOT NULL,
        media TEXT,                       -- JSON array of file_ids or paths
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
        total_groups INTEGER DEFAULT 0,
        published_groups INTEGER DEFAULT 0,
        failed_groups INTEGER DEFAULT 0,
        error_message TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        started_at INTEGER,
        completed_at INTEGER
      )
    `);
    db.exec(`CREATE INDEX idx_publications_user ON publications(user_id)`);
    db.exec(`CREATE INDEX idx_publications_status ON publications(status)`);
  }

  // Individual posts within a publication
  if (!tableExists(db, "publication_posts")) {
    db.exec(`
      CREATE TABLE publication_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL,        -- telegram group id
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'sent', 'failed')),
        message_id INTEGER,               -- telegram message id after posting
        scheduled_at INTEGER,             -- when to post
        sent_at INTEGER,
        error_message TEXT
      )
    `);
    db.exec(`CREATE INDEX idx_publication_posts_pub ON publication_posts(publication_id)`);
    db.exec(`CREATE INDEX idx_publication_posts_status ON publication_posts(status, scheduled_at)`);
  }

  // Daily publication limits tracking
  if (!tableExists(db, "publication_limits")) {
    db.exec(`
      CREATE TABLE publication_limits (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,               -- YYYY-MM-DD
        count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, date)
      )
    `);
  }
}
