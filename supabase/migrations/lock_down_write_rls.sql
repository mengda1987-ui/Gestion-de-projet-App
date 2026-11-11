-- ============================================================================
-- P2：撤销 anon 对业务表的写权限（关闭「匿名整板覆盖」）
--
-- 背景（2026-11-11 线上探测实证）：
--   anon key 直接 POST /rest/v1/boards          → HTTP 201
--   anon key 直接 PATCH /rest/v1/boards         → HTTP 204
--   anon key 直接 DELETE /rest/v1/boards        → HTTP 204
-- 即任何拿到前端公开 anon key 的人都能覆盖或删除全部数据。
-- 这是审计 C1，也是 2025-11-05 数据丢失事故的原始成因。
--
-- ⚠️ 执行前提（缺一不可，否则前端会全面无法保存）：
--   1. 已执行 add_server_write_rpc.sql
--   2. 前端已部署到含以下接口的版本：
--        /api/board/patch        （卡片/列/心智图增量写入，带版本校验）
--        /api/boards             （新建/重命名/软删除/排序）
--        /api/boards/metadata    （看板元数据批量同步）
--        /api/workspace-settings （工作区外观设置）
--        /api/crm/modules        （CRM 模块增删改）
--   3. Vercel 已配置 SUPABASE_SERVICE_ROLE_KEY / SESSION_SECRET
--   4. 所有用户已刷新页面（旧标签页会写失败）
--
-- 本迁移做的事：
--   boards / workspace_settings / crm_modules：保留匿名**只读**，撤销一切写权限
--   历史表：继续全撤（此前已撤）
--
-- 幂等：可重复执行。
-- 执行位置：Supabase Dashboard → SQL Editor
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 清理旧的「全开放」策略
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public access" ON boards;
DROP POLICY IF EXISTS "Public access" ON workspace_settings;
DROP POLICY IF EXISTS "Public access" ON crm_modules;

-- ---------------------------------------------------------------------------
-- 2) 只保留匿名只读
--    前端仍需要读：加载看板内容、Realtime 订阅、refetch 轮询
--    写入一律经服务端 API（service_role）
-- ---------------------------------------------------------------------------
ALTER TABLE boards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_modules        ENABLE ROW LEVEL SECURITY;

-- 注意：CREATE POLICY 不支持 IF NOT EXISTS，重复执行会报 DuplicateObject，
-- 因此先 DROP 再建，保证脚本幂等。
DROP POLICY IF EXISTS "anon_read_boards"             ON boards;
DROP POLICY IF EXISTS "anon_read_workspace_settings" ON workspace_settings;
DROP POLICY IF EXISTS "anon_read_crm_modules"        ON crm_modules;
DROP POLICY IF EXISTS "crm_modules_realtime_select"  ON crm_modules;

CREATE POLICY "anon_read_boards" ON boards
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "anon_read_workspace_settings" ON workspace_settings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "anon_read_crm_modules" ON crm_modules
  FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 3) 撤销写权限（这是本次的核心）
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON boards, workspace_settings, crm_modules
  FROM anon, authenticated;

-- 显式确认只读
GRANT SELECT ON boards, workspace_settings, crm_modules TO anon, authenticated;

-- service_role 需要完整权限（服务端 API 用）
GRANT SELECT, INSERT, UPDATE, DELETE ON boards, workspace_settings, crm_modules TO service_role;

-- ---------------------------------------------------------------------------
-- 4) 历史表：继续完全不对客户端开放
-- ---------------------------------------------------------------------------
REVOKE ALL ON boards_history, workspace_settings_history, crm_modules_history
  FROM anon, authenticated;
GRANT SELECT, INSERT ON boards_history, workspace_settings_history, crm_modules_history
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5) 统计 RPC 改为 SECURITY INVOKER（原 SECURITY DEFINER + anon 可执行
--    = 一条绕过 RLS 的读通道）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='count_all_cards') THEN
    EXECUTE 'ALTER FUNCTION public.count_all_cards() SECURITY INVOKER';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='workspace_stats') THEN
    EXECUTE 'ALTER FUNCTION public.workspace_stats() SECURITY INVOKER';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6) 自检：写完权限后应该是
--      boards/ws/crm : anon SELECT=true，其余 false
--      users         : anon 全 false
--      *_history     : anon 全 false
-- ---------------------------------------------------------------------------
SELECT t.tbl AS table_name,
       has_table_privilege('anon', t.tbl, 'SELECT') AS anon_select,
       has_table_privilege('anon', t.tbl, 'INSERT') AS anon_insert,
       has_table_privilege('anon', t.tbl, 'UPDATE') AS anon_update,
       has_table_privilege('anon', t.tbl, 'DELETE') AS anon_delete
FROM (VALUES ('boards'), ('workspace_settings'), ('crm_modules'),
             ('users'), ('boards_history'),
             ('workspace_settings_history'), ('crm_modules_history')) AS t(tbl)
ORDER BY t.tbl;
