import { Database } from "bun:sqlite";
import { columnExists, tableExists } from "../migrations";

export function migrate(db: Database) {
  // Add monetization columns to users table
  if (!columnExists(db, "users", "plan")) {
    db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'");
  }
  if (!columnExists(db, "users", "plan_expires_at")) {
    db.exec("ALTER TABLE users ADD COLUMN plan_expires_at TEXT");
  }
  if (!columnExists(db, "users", "telegram_subscription_id")) {
    db.exec("ALTER TABLE users ADD COLUMN telegram_subscription_id TEXT");
  }
  if (!columnExists(db, "users", "region_code")) {
    db.exec("ALTER TABLE users ADD COLUMN region_code TEXT");
  }

  // Create free_usage table
  db.exec(`
    CREATE TABLE IF NOT EXISTS free_usage (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      free_analyzes_used INTEGER DEFAULT 0,
      last_reset_at INTEGER DEFAULT (unixepoch())
    )
  `);

  // Create payments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      telegram_charge_id TEXT UNIQUE,
      type TEXT NOT NULL CHECK (type IN ('analyze', 'subscription', 'preset', 'promotion_group', 'promotion_product', 'publication')),
      amount INTEGER NOT NULL,
      payload TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_payments_type ON payments(type)");

  // Create region_presets table
  db.exec(`
    CREATE TABLE IF NOT EXISTS region_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region_code TEXT UNIQUE NOT NULL,
      region_name TEXT NOT NULL,
      country_code TEXT,
      currency TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create preset_groups table
  db.exec(`
    CREATE TABLE IF NOT EXISTS preset_groups (
      preset_id INTEGER NOT NULL REFERENCES region_presets(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL,
      is_paid INTEGER DEFAULT 0,
      added_by INTEGER,
      paid_until TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (preset_id, group_id)
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_preset_groups_preset ON preset_groups(preset_id)"
  );

  // Create user_preset_access table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preset_access (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset_id INTEGER NOT NULL REFERENCES region_presets(id) ON DELETE CASCADE,
      access_type TEXT NOT NULL CHECK (access_type IN ('lifetime', 'subscription')),
      expires_at TEXT,
      purchased_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, preset_id)
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_user_preset_access_user ON user_preset_access(user_id)"
  );

  // Create promotions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('group', 'product')),
      group_id INTEGER,
      message_id INTEGER,
      product_group_id INTEGER,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions(is_active, ends_at)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_promotions_user ON promotions(user_id)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_promotions_group ON promotions(group_id)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_promotions_product ON promotions(message_id, product_group_id)"
  );

  // Seed initial region presets for Serbia
  const existingPresets = db
    .query("SELECT COUNT(*) as count FROM region_presets")
    .get() as { count: number };
  if (existingPresets.count === 0) {
    db.exec(`
      INSERT INTO region_presets (region_code, region_name, country_code, currency)
      VALUES
        ('belgrade', 'Все барахолки Белграда', 'RS', 'EUR'),
        ('novi_sad', 'Все барахолки Нови-Сада', 'RS', 'EUR')
    `);
  }
}
