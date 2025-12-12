-- Track which promotions were shown to which users
-- Each user sees each promotion at most once

CREATE TABLE IF NOT EXISTS promotion_views (
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context TEXT,                          -- 'bot_analyzing', 'bot_keywords', 'webapp_loading'
  viewed_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (promotion_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_promotion_views_user ON promotion_views(user_id);
CREATE INDEX IF NOT EXISTS idx_promotion_views_promo ON promotion_views(promotion_id);
