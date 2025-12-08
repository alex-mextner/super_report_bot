-- Add field for storing disabled negative keywords (for toggle feature)
ALTER TABLE subscriptions ADD COLUMN disabled_negative_keywords TEXT DEFAULT '[]';
