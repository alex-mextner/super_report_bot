-- Index for searching messages by exact text match
CREATE INDEX IF NOT EXISTS idx_messages_text ON messages(text);
