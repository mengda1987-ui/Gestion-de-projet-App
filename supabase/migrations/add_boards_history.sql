-- ============================================================================
-- 数据历史快照表（防止覆盖事故再次发生）
--
-- 背景：2026-11-05 发生一次严重数据覆盖事故，云端 boards 被一份旧数据整体
-- 覆盖，丢失了约一个月的内容。根因是 doSave() 使用裸 upsert 且无任何历史
-- 记录，事故后无法回溯。
--
-- 本迁移建立两份快照表：
--   1. boards_history       每次写入前保存被覆盖的旧版本
--   2. workspace_settings_history  背景设置的版本历史
--
-- 保留策略：默认保留 90 天，可通过下面的 SQL 定期清理。
-- ============================================================================

-- 看板历史快照
CREATE TABLE IF NOT EXISTS boards_history (
  id BIGSERIAL PRIMARY KEY,
  board_id UUID NOT NULL,
  title TEXT,
  payload JSONB NOT NULL,          -- 被覆盖前的完整看板行
  card_count INTEGER DEFAULT 0,    -- 快照时的卡片总数，便于快速比对
  reason TEXT DEFAULT 'save',      -- save / delete / bulk-overwrite
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_history_board_id
  ON boards_history (board_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_boards_history_created_at
  ON boards_history (created_at DESC);

-- 背景设置历史快照
CREATE TABLE IF NOT EXISTS workspace_settings_history (
  id BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  reason TEXT DEFAULT 'save',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ws_settings_history_created_at
  ON workspace_settings_history (created_at DESC);

-- CRM 模块历史快照
CREATE TABLE IF NOT EXISTS crm_modules_history (
  id BIGSERIAL PRIMARY KEY,
  module_id UUID NOT NULL,
  payload JSONB NOT NULL,
  contact_count INTEGER DEFAULT 0,
  reason TEXT DEFAULT 'save',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_history_module_id
  ON crm_modules_history (module_id, created_at DESC);

-- RLS：沿用项目现有的匿名访问策略（与 boards / workspace_settings 保持一致）
ALTER TABLE boards_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_settings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_modules_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_boards_history" ON boards_history;
CREATE POLICY "allow_all_boards_history" ON boards_history
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_ws_settings_history" ON workspace_settings_history;
CREATE POLICY "allow_all_ws_settings_history" ON workspace_settings_history
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_crm_history" ON crm_modules_history;
CREATE POLICY "allow_all_crm_history" ON crm_modules_history
  FOR ALL USING (true) WITH CHECK (true);

-- 保留 90 天，超期自动清理（可在 Supabase 里用 pg_cron 调度）
-- SELECT cron.schedule('cleanup-history', '0 4 * * *', $$
--   DELETE FROM boards_history WHERE created_at < now() - interval '90 days';
--   DELETE FROM workspace_settings_history WHERE created_at < now() - interval '90 days';
--   DELETE FROM crm_modules_history WHERE created_at < now() - interval '90 days';
-- $$);
