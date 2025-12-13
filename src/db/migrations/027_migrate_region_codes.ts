import type { Database } from "bun:sqlite";

/**
 * Migration: Convert country codes to city-based region codes
 * RS -> rs_belgrade (assuming most Serbian users are in Belgrade)
 * belgrade -> rs_belgrade (normalize old format)
 */
export function migrate(db: Database) {
  // Convert RS country code to rs_belgrade
  db.prepare("UPDATE users SET region_code = 'rs_belgrade' WHERE region_code = 'RS'").run();
  // Normalize old format
  db.prepare("UPDATE users SET region_code = 'rs_belgrade' WHERE region_code = 'belgrade'").run();
  db.prepare("UPDATE users SET region_code = 'rs_novi_sad' WHERE region_code = 'novi_sad'").run();
}
