import { Database } from "bun:sqlite";
import { columnExists } from "../migrations";

export function migrate(db: Database) {
  // Add price_currency column
  if (!columnExists(db, "products", "price_currency")) {
    db.exec("ALTER TABLE products ADD COLUMN price_currency TEXT");
  }

  // Set default currency for existing products that have price
  db.exec(`
    UPDATE products
    SET price_currency = 'RUB'
    WHERE price_currency IS NULL AND price_normalized IS NOT NULL
  `);
}
