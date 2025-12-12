-- Add free publication credits for failed publications
ALTER TABLE users ADD COLUMN free_pub_credits INTEGER DEFAULT 0;
