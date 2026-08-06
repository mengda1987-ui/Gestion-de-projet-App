-- Add missing fields to boards table for icon/emoji persistence and ordering
ALTER TABLE boards ADD COLUMN IF NOT EXISTS emoji TEXT;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS "iconBg" TEXT;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS "iconImage" TEXT;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS "visibleTo" JSONB DEFAULT '[]'::jsonb;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS "order" INTEGER;
