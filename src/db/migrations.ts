import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const MIGRATIONS_DIR = join(import.meta.dir, "migrations");

// Helpers for TS migrations
export function columnExists(
  db: Database,
  table: string,
  column: string
): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as { name: string }[];
  return columns.some((c) => c.name === column);
}

export function tableExists(db: Database, table: string): boolean {
  const result = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  return result !== null;
}

export async function runMigrations(db: Database): Promise<void> {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get applied migrations
  const applied = new Set(
    db
      .prepare<{ name: string }, []>("SELECT name FROM _migrations")
      .all()
      .map((r) => r.name)
  );

  // Find and apply new migrations
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql") || f.endsWith(".ts"))
      .sort();
  } catch {
    // No migrations directory yet
    return;
  }

  for (const file of files) {
    if (applied.has(file)) continue;

    const filePath = join(MIGRATIONS_DIR, file);

    if (file.endsWith(".ts")) {
      // TS migration — import and run
      const module = await import(filePath);
      await module.migrate(db);
    } else {
      // SQL migration — execute directly
      const sql = readFileSync(filePath, "utf-8");
      db.exec(sql);
    }

    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    console.log(`Migration applied: ${file}`);
  }
}
