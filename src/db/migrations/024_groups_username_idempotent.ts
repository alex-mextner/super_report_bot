// Make 023 idempotent - add username column if missing (for new DBs where schema.sql has it)
import { Database } from "bun:sqlite";
import { columnExists } from "../migrations";

export function migrate(db: Database) {
  // 023 may have failed on new DBs where schema.sql already has this column
  // This migration ensures the column exists without erroring
  if (!columnExists(db, "groups", "username")) {
    db.exec("ALTER TABLE groups ADD COLUMN username TEXT");
  }
}
