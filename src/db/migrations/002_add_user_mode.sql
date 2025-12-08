-- Add mode column to users table for normal/advanced mode
ALTER TABLE users ADD COLUMN mode TEXT DEFAULT 'normal' CHECK (mode IN ('normal', 'advanced'));
