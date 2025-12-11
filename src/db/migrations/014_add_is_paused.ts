import { Database } from "bun:sqlite";
import { columnExists } from "../migrations";

export function migrate(db: Database) {
  if (!columnExists(db, "subscriptions", "is_paused")) {
    db.exec(
      "ALTER TABLE subscriptions ADD COLUMN is_paused INTEGER DEFAULT 0"
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_subscriptions_paused ON subscriptions(is_paused)"
  );
}
