-- Allow public read/write access to all tables
-- (App has its own password-based auth, so Supabase RLS is not needed)

-- === Users ===
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access" ON users;
CREATE POLICY "Public access" ON users
  FOR ALL USING (true) WITH CHECK (true);

-- === Workspace Settings ===
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access" ON workspace_settings;
CREATE POLICY "Public access" ON workspace_settings
  FOR ALL USING (true) WITH CHECK (true);

-- === Boards ===
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access" ON boards;
CREATE POLICY "Public access" ON boards
  FOR ALL USING (true) WITH CHECK (true);
