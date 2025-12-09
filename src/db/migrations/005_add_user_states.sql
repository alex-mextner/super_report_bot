-- User states table for FSM persistence
CREATE TABLE IF NOT EXISTS user_states (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  snapshot TEXT NOT NULL DEFAULT '{}',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_states_user ON user_states(user_id);
