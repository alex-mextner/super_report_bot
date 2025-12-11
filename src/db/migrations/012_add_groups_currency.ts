import { Database } from "bun:sqlite";
import { columnExists } from "../migrations";

export function migrate(db: Database) {
  // Add currency column to groups table
  if (!columnExists(db, "groups", "currency")) {
    db.exec("ALTER TABLE groups ADD COLUMN currency TEXT");
  }

  // Set default currency based on country for existing groups
  db.exec(`
    UPDATE groups
    SET currency = CASE
      WHEN country = 'RS' THEN 'RSD'
      WHEN country = 'RU' THEN 'RUB'
      WHEN country = 'AM' THEN 'AMD'
      WHEN country = 'GE' THEN 'GEL'
      WHEN country = 'ME' THEN 'EUR'
      WHEN country = 'BA' THEN 'BAM'
      ELSE NULL
    END
    WHERE currency IS NULL AND country IS NOT NULL
  `);
}
