-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  telegram_id INTEGER UNIQUE NOT NULL,
  first_name TEXT,
  username TEXT,
  mode TEXT DEFAULT 'normal' CHECK (mode IN ('normal', 'advanced')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  original_query TEXT NOT NULL,
  positive_keywords TEXT NOT NULL,  -- JSON array
  negative_keywords TEXT NOT NULL,  -- JSON array
  llm_description TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Monitored groups (userbot)
CREATE TABLE IF NOT EXISTS monitored_groups (
  id INTEGER PRIMARY KEY,
  telegram_id INTEGER UNIQUE NOT NULL,
  title TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Matched messages (deduplication) - DEPRECATED, use found_posts_analyzes
CREATE TABLE IF NOT EXISTS matched_messages (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  message_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  matched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subscription_id, message_id, group_id)
);

-- Analysis results for all messages (matched and rejected)
CREATE TABLE IF NOT EXISTS found_posts_analyzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,

  -- Result of analysis
  result TEXT NOT NULL CHECK (result IN (
    'matched',           -- passed all stages
    'rejected_negative', -- rejected by negative keyword
    'rejected_ngram',    -- n-gram score < threshold
    'rejected_semantic', -- BGE-M3 semantic match failed
    'rejected_llm'       -- LLM verification rejected
  )),

  -- Scores
  ngram_score REAL,
  semantic_score REAL,
  llm_confidence REAL,

  -- Rejection details
  rejection_keyword TEXT,   -- which negative keyword triggered rejection
  llm_reasoning TEXT,       -- reasoning from LLM

  analyzed_at INTEGER DEFAULT (unixepoch()),  -- unix timestamp
  notified_at INTEGER,                        -- unix timestamp, NULL if rejected

  UNIQUE(subscription_id, message_id, group_id)
);

-- Subscription groups (which groups to monitor for each subscription)
CREATE TABLE IF NOT EXISTS subscription_groups (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL,
  group_title TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subscription_id, group_id)
);

-- Groups metadata (country, marketplace flag, etc.)
CREATE TABLE IF NOT EXISTS groups (
  telegram_id INTEGER PRIMARY KEY,
  title TEXT,
  country TEXT,              -- ISO 3166-1 alpha-2: 'RS', 'RU', 'AM', etc.
  city TEXT,                 -- 'Belgrade', 'Moscow', 'Yerevan'
  is_marketplace INTEGER DEFAULT 0,  -- 1 = marketplace/flea market
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- User groups (groups added by user for monitoring, userbot joins these)
CREATE TABLE IF NOT EXISTS user_groups (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL,
  group_title TEXT,
  is_channel INTEGER DEFAULT 0,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, group_id)
);

-- Message history (persistent storage, replaces in-memory cache)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  group_title TEXT,
  topic_id INTEGER,              -- for forum topics
  topic_title TEXT,              -- topic name
  text TEXT NOT NULL,
  sender_id INTEGER,
  sender_name TEXT,
  sender_username TEXT,          -- @username without @
  timestamp INTEGER NOT NULL,    -- unix timestamp
  is_deleted INTEGER DEFAULT 0,  -- soft delete
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, group_id)
);

-- Topics cache (for forum groups)
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  title TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, topic_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_matched_messages_sub ON matched_messages(subscription_id);
CREATE INDEX IF NOT EXISTS idx_fpa_lookup ON found_posts_analyzes(message_id, group_id);
CREATE INDEX IF NOT EXISTS idx_fpa_sub ON found_posts_analyzes(subscription_id);
CREATE INDEX IF NOT EXISTS idx_fpa_result ON found_posts_analyzes(result);
CREATE INDEX IF NOT EXISTS idx_subscription_groups_sub ON subscription_groups(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_groups_group ON subscription_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_user_groups_user ON user_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(group_id, topic_id);
CREATE INDEX IF NOT EXISTS idx_messages_deleted ON messages(is_deleted);
CREATE INDEX IF NOT EXISTS idx_topics_group ON topics(group_id);

-- ===========================================
-- WebApp: Categories and Products
-- ===========================================

-- Product categories (populated by LLM)
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,        -- "electronics", "clothing", "auto"
  name_ru TEXT NOT NULL,            -- "Электроника", "Одежда", "Авто"
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Classified products from messages
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  group_title TEXT NOT NULL,
  text TEXT NOT NULL,
  category_code TEXT REFERENCES categories(code),
  price_raw TEXT,                   -- "50000 руб", "50к", "$500"
  price_normalized INTEGER,         -- normalized price in RUB for comparison
  sender_id INTEGER,
  sender_name TEXT,
  message_date INTEGER NOT NULL,    -- unix timestamp
  classified_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, group_id)
);

-- Seller contacts (extracted from text or sender profile)
CREATE TABLE IF NOT EXISTS seller_contacts (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL,       -- "phone", "username", "telegram_link", "whatsapp", "profile"
  contact_value TEXT NOT NULL,
  source TEXT NOT NULL,             -- "text_parse" | "sender_profile"
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Product indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_code);
CREATE INDEX IF NOT EXISTS idx_products_group ON products(group_id);
CREATE INDEX IF NOT EXISTS idx_products_date ON products(message_date DESC);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price_normalized);
CREATE INDEX IF NOT EXISTS idx_seller_contacts_product ON seller_contacts(product_id);

-- ===========================================
-- Message Media (photos and videos)
-- ===========================================

-- Media files attached to messages
CREATE TABLE IF NOT EXISTS message_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  media_index INTEGER NOT NULL,           -- order in album (0, 1, 2...)
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  file_path TEXT NOT NULL,                -- relative path to file
  width INTEGER,
  height INTEGER,
  duration INTEGER,                       -- for video, in seconds
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, group_id, media_index)
);

-- Media indexes
CREATE INDEX IF NOT EXISTS idx_message_media_msg ON message_media(message_id, group_id);
