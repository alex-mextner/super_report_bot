-- Add keyword_embeddings column to subscriptions
-- Stores JSON: {"pos": [{"keyword": "...", "vec": [...]}], "neg": [...]}
ALTER TABLE subscriptions ADD COLUMN keyword_embeddings TEXT;
