-- Precomputed analytics per group
CREATE TABLE IF NOT EXISTS group_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL UNIQUE,
  stats_json TEXT NOT NULL,
  insights_text TEXT,
  insights_generated_at INTEGER,
  computed_at INTEGER NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_group_analytics_group ON group_analytics(group_id);
