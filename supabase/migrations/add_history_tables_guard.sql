-- ============================================================================
-- 历史快照表（补齐 add_boards_history.sql 的落地缺口）
--
-- 背景：2026-11-11 白盒审计时用 anon key 实测发现
--   GET /rest/v1/boards_history → 404 (PGRST205)
-- 即 add_boards_history.sql 从未在线上执行过。前端 BoardContext.tsx:338 的
-- insert 错误被静默吞掉，导致「覆盖前自动快照」这道防线实际上不存在。
--
-- 本迁移做的事：
--   1. 幂等建三张 history 表（结构与 add_boards_history.sql 一致）
--   2. RLS 收紧：仅 service_role（服务端）可读写，anon / authenticated 全撤
--      —— 快照里含完整看板与用户口令，绝不能匿名可读
--   3. 提供快照写入函数与保留期清理函数
--
-- 执行位置：Supabase Dashboard → SQL Editor，可重复执行（幂等）。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 建表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boards_history (
  id BIGSERIAL PRIMARY KEY,
  board_id UUID NOT NULL,
  title TEXT,
  payload JSONB NOT NULL,          -- 被覆盖前的完整看板行
  card_count INTEGER DEFAULT 0,    -- 快照时的卡片总数，便于快速比对
  reason TEXT DEFAULT 'save',      -- save / delete / bulk-overwrite / restore
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boards_history_board_id
  ON boards_history (board_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boards_history_created_at
  ON boards_history (created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_settings_history (
  id BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  reason TEXT DEFAULT 'save',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ws_settings_history_created_at
  ON workspace_settings_history (created_at DESC);

CREATE TABLE IF NOT EXISTS crm_modules_history (
  id BIGSERIAL PRIMARY KEY,
  module_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  contact_count INTEGER DEFAULT 0,
  reason TEXT DEFAULT 'save',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 兼容 add_boards_history.sql 里把 module_id 定义成 UUID 的情况：
-- crm_modules.id 实际是 TEXT（见 add_crm_modules.sql），UUID 类型会插入失败。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_modules_history'
      AND column_name = 'module_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE crm_modules_history
      ALTER COLUMN module_id TYPE TEXT USING module_id::text;
    RAISE NOTICE 'crm_modules_history.module_id: UUID → TEXT';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_crm_history_module_id
  ON crm_modules_history (module_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) RLS：仅服务端可访问
--    历史表只服务于「事故回溯 / 恢复脚本」，不参与前端读取与 Realtime 推送。
-- ---------------------------------------------------------------------------
ALTER TABLE boards_history             ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_settings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_modules_history        ENABLE ROW LEVEL SECURITY;

-- 清掉旧迁移里可能存在的「匿名全开放」策略
DROP POLICY IF EXISTS "allow_all_boards_history"      ON boards_history;
DROP POLICY IF EXISTS "allow_all_ws_settings_history" ON workspace_settings_history;
DROP POLICY IF EXISTS "allow_all_crm_history"         ON crm_modules_history;

-- 撤销匿名/登录用户的全部权限（service_role 不受 RLS 约束，无需显式授权）
REVOKE ALL ON boards_history, workspace_settings_history, crm_modules_history
  FROM anon, authenticated;

-- 序列权限一并撤销，防止绕过表权限直接 nextval 探测 ID
REVOKE ALL ON SEQUENCE boards_history_id_seq,
                    workspace_settings_history_id_seq,
                    crm_modules_history_id_seq
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) 快照写入函数：让「写快照失败」能真正报错，而不是被静默吞掉
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_board(
  p_board_id UUID,
  p_payload  JSONB,
  p_reason   TEXT DEFAULT 'save'
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id    BIGINT;
  v_cards INTEGER;
BEGIN
  SELECT COALESCE(SUM(jsonb_array_length(COALESCE(col->'cards', '[]'::jsonb))), 0)
    INTO v_cards
  FROM jsonb_array_elements(COALESCE(p_payload->'data'->'columns', '[]'::jsonb)) AS col;

  INSERT INTO boards_history (board_id, title, payload, card_count, reason)
  VALUES (p_board_id, p_payload->>'title', p_payload, v_cards, p_reason)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.snapshot_board(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_board(UUID, JSONB, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) 保留期清理（默认 90 天；需 pg_cron 才能自动调度）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_history(p_keep_days INTEGER DEFAULT 90)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b INTEGER; w INTEGER; c INTEGER;
BEGIN
  IF p_keep_days < 1 THEN
    RAISE EXCEPTION 'p_keep_days must be >= 1';
  END IF;

  DELETE FROM boards_history
   WHERE created_at < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS b = ROW_COUNT;

  DELETE FROM workspace_settings_history
   WHERE created_at < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS w = ROW_COUNT;

  DELETE FROM crm_modules_history
   WHERE created_at < now() - make_interval(days => p_keep_days);
  GET DIAGNOSTICS c = ROW_COUNT;

  RETURN jsonb_build_object('boards', b, 'workspace_settings', w, 'crm', c,
                            'keep_days', p_keep_days);
END $$;

REVOKE ALL ON FUNCTION public.prune_history(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_history(INTEGER) TO service_role;

-- 可选：若已启用 pg_cron，每天 04:00 清理 90 天前的快照
-- SELECT cron.schedule('prune-trello-history', '0 4 * * *',
--                      $$ SELECT public.prune_history(90); $$);

-- ---------------------------------------------------------------------------
-- 5) 让 PostgREST 重建 schema 缓存（否则仍可能返回 PGRST205）
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 6) 自检（执行后应返回三行，rls_enabled 均为 true，anon_privs 均为 0）
-- ---------------------------------------------------------------------------
SELECT c.relname                                AS table_name,
       c.relrowsecurity                         AS rls_enabled,
       COUNT(p.polname)                          AS policy_count,
       (SELECT COUNT(*)
          FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public'
           AND g.table_name = c.relname
           AND g.grantee = 'anon')               AS anon_privs
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('boards_history', 'workspace_settings_history', 'crm_modules_history')
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
