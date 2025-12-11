/**
 * Seed initial region presets for Serbia (Belgrade, Novi Sad)
 * and populate them with existing groups from those cities
 */
import { Database } from "bun:sqlite";

export function migrate(db: Database) {
  // Insert Belgrade preset
  db.prepare(`
    INSERT OR IGNORE INTO region_presets (region_code, region_name, country_code, currency)
    VALUES ('belgrade', 'Все барахолки Белграда', 'RS', 'EUR')
  `).run();

  // Insert Novi Sad preset
  db.prepare(`
    INSERT OR IGNORE INTO region_presets (region_code, region_name, country_code, currency)
    VALUES ('novi_sad', 'Все барахолки Нови-Сада', 'RS', 'EUR')
  `).run();

  // Get preset IDs
  const belgradePreset = db.prepare<{ id: number }, []>(
    "SELECT id FROM region_presets WHERE region_code = 'belgrade'"
  ).get();

  const noviSadPreset = db.prepare<{ id: number }, []>(
    "SELECT id FROM region_presets WHERE region_code = 'novi_sad'"
  ).get();

  // Populate Belgrade preset with groups from Belgrade
  // Match city variations: Belgrade, Beograd, Белград
  if (belgradePreset) {
    db.prepare(`
      INSERT OR IGNORE INTO preset_groups (preset_id, group_id)
      SELECT ?, telegram_id
      FROM groups
      WHERE country = 'RS'
        AND (
          LOWER(city) LIKE '%belgrad%'
          OR LOWER(city) LIKE '%beograd%'
          OR city LIKE '%Белград%'
          OR city LIKE '%белград%'
        )
    `).run(belgradePreset.id);
  }

  // Populate Novi Sad preset with groups from Novi Sad
  // Match city variations: Novi Sad, Нови-Сад, Новый Сад
  if (noviSadPreset) {
    db.prepare(`
      INSERT OR IGNORE INTO preset_groups (preset_id, group_id)
      SELECT ?, telegram_id
      FROM groups
      WHERE country = 'RS'
        AND (
          LOWER(city) LIKE '%novi%sad%'
          OR city LIKE '%Нови%Сад%'
          OR city LIKE '%нови%сад%'
          OR city LIKE '%Новый%Сад%'
          OR city LIKE '%новый%сад%'
        )
    `).run(noviSadPreset.id);
  }
}
