-- Subscription feedback table for deletion flow
CREATE TABLE IF NOT EXISTS subscription_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('bought', 'not_bought', 'complicated')),
  review TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscription_feedback_user ON subscription_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_feedback_sub ON subscription_feedback(subscription_id);
