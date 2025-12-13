/**
 * Unify region_presets.region_code format to match users.region_code
 * belgrade -> rs_belgrade
 * novi_sad -> rs_novi_sad
 */
import { Database } from "bun:sqlite";

export function migrate(db: Database) {
  db.prepare(
    "UPDATE region_presets SET region_code = 'rs_belgrade' WHERE region_code = 'belgrade'"
  ).run();

  db.prepare(
    "UPDATE region_presets SET region_code = 'rs_novi_sad' WHERE region_code = 'novi_sad'"
  ).run();
}
