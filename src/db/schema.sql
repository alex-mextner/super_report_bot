-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  telegram_id INTEGER UNIQUE NOT NULL,
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

-- Matched messages (deduplication)
CREATE TABLE IF NOT EXISTS matched_messages (
  id INTEGER PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  message_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  matched_at TEXT DEFAULT CURRENT_TIMESTAMP,
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_matched_messages_sub ON matched_messages(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_groups_sub ON subscription_groups(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_groups_group ON subscription_groups(group_id);
CREATE INDEX IF NOT EXISTS idx_user_groups_user ON user_groups(user_id);
