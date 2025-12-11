/**
 * Migration: Add message_embeddings virtual table for semantic search
 *
 * Uses sqlite-vec extension for KNN vector search.
 * BGE-M3 embeddings have 1024 dimensions.
 */
import { Database } from "bun:sqlite";

export function migrate(db: Database) {
  // vec0 virtual table for KNN search
  // Note: sqlite-vec must be loaded before this migration runs
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS message_embeddings USING vec0(
      message_id INTEGER PRIMARY KEY,
      embedding FLOAT[1024]
    );
  `);
}
