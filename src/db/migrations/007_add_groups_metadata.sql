-- Groups metadata table (country, marketplace flag, etc.)
CREATE TABLE IF NOT EXISTS groups (
  telegram_id INTEGER PRIMARY KEY,
  title TEXT,
  country TEXT,              -- ISO 3166-1 alpha-2: 'RS', 'RU', 'AM', etc.
  city TEXT,                 -- 'Belgrade', 'Moscow', 'Yerevan'
  is_marketplace INTEGER DEFAULT 0,  -- 1 = marketplace/flea market
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
