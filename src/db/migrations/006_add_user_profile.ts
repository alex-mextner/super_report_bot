import { Database } from "bun:sqlite";
import { columnExists } from "../migrations";

export function migrate(db: Database) {
  if (!columnExists(db, "users", "first_name")) {
    db.exec("ALTER TABLE users ADD COLUMN first_name TEXT");
  }
  if (!columnExists(db, "users", "username")) {
    db.exec("ALTER TABLE users ADD COLUMN username TEXT");
  }
}
