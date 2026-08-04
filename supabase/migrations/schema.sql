-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  color TEXT DEFAULT '#3B82F6',
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Workspace settings (app-wide)
CREATE TABLE IF NOT EXISTS workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_background TEXT DEFAULT '#f5f5f7',
  login_background TEXT DEFAULT 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Boards
CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  background TEXT DEFAULT '#f5f5f7',
  labels JSONB DEFAULT '[]'::jsonb,
  data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE workspace_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE boards;

-- Seed: admin user
INSERT INTO users (name, email, avatar, color, role, password)
VALUES ('Da MENG', 'dameng@trello.com', '', '#3B82F6', 'admin', '123456')
ON CONFLICT DO NOTHING;

-- Seed: member users
INSERT INTO users (name, email, avatar, color, role, password)
VALUES ('李娜', 'lina@trello.com', '', '#EC4899', 'member', '123456')
ON CONFLICT DO NOTHING;

INSERT INTO users (name, email, avatar, color, role, password)
VALUES ('王磊', 'wanglei@trello.com', '', '#10B981', 'member', '123456')
ON CONFLICT DO NOTHING;

-- Seed: workspace settings
INSERT INTO workspace_settings (id, workspace_background, login_background)
VALUES ('00000000-0000-0000-0000-000000000001', '#f5f5f7', 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)')
ON CONFLICT DO NOTHING;

-- Seed: default board with 3 columns
INSERT INTO boards (title, background, data)
VALUES (
  '我的第一个看板',
  'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #14b8a6 100%)',
  '{"columns":[{"id":"col-1","title":"待办","order":0,"archived":false,"cards":[]},{"id":"col-2","title":"进行中","order":1,"archived":false,"cards":[]},{"id":"col-3","title":"已完成","order":2,"archived":false,"cards":[]}]}'::jsonb
);
