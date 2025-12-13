import type { Database } from "bun:sqlite";
import { columnExists } from "../migrations";

export function migrate(db: Database) {
  if (!columnExists(db, "users", "language")) {
    db.exec(`
      ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'ru'
      CHECK (language IN ('ru', 'en', 'rs'))
    `);
  }
}
