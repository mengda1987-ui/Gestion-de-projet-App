-- Add language preference column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'en';
