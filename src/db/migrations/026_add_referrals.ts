import { Database } from "bun:sqlite";
import { columnExists } from "../migrations";

export function migrate(db: Database) {
  // Add referral columns to users table
  if (!columnExists(db, "users", "referred_by")) {
    db.exec("ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)");
  }
  if (!columnExists(db, "users", "bonus_balance")) {
    db.exec("ALTER TABLE users ADD COLUMN bonus_balance INTEGER DEFAULT 0");
  }

  // Create referral_earnings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER NOT NULL REFERENCES users(id),
      referee_id INTEGER NOT NULL REFERENCES users(id),
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      amount INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_referral_earnings_referrer ON referral_earnings(referrer_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_referral_earnings_referee ON referral_earnings(referee_id)");
}
