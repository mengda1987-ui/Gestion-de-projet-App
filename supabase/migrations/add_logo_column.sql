-- Add logo column to workspace_settings
ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS logo TEXT DEFAULT '';
