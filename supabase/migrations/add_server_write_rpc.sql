-- ============================================================================
-- P2：把「看板/设置/CRM 的写入」全部下沉到服务端 RPC
--
-- 背景（2026-11-11 线上探测实证）：
--   anon key 直接 POST /rest/v1/boards  → HTTP 201（写入成功）
--   anon key 直接 PATCH/DELETE boards   → HTTP 204
-- 即：任何拿到前端公开 anon key 的人都能整板覆盖或删除数据 ——
-- 这正是 2025-11-05 数据事故的原始成因，也是审计报告 C1。
--
-- 本迁移提供 RPC，使前端可以完全不再直写表；
-- 之后用 lock_down_write_rls.sql 撤销 anon 的 INSERT/UPDATE/DELETE，
-- 数据库层就再无「匿名整板覆盖」的可能。
--
-- 全部函数仅授权 service_role，通过服务端 API 调用。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 看板：新建（生成 id，服务端决定，避免客户端伪造）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_board(
  p_title      TEXT,
  p_background TEXT DEFAULT '#f5f5f7',
  p_owner      UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id   UUID := gen_random_uuid();
  v_max  INTEGER;
  v_row  boards;
BEGIN
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  END IF;

  SELECT COALESCE(MAX("order"), -1) + 1 INTO v_max FROM boards WHERE NOT is_deleted;

  -- 与 schema 对齐：title/background/data/labels + 排序字段
  INSERT INTO boards (id, title, background, data, labels, "order", version, updated_by)
  VALUES (v_id,
          btrim(p_title),
          COALESCE(p_background, '#f5f5f7'),
          jsonb_build_object('columns', '[]'::jsonb, 'mindmap', '[]'::jsonb),
          '[]'::jsonb,
          v_max,
          0,
          p_owner)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'board', to_jsonb(v_row));
END $$;

-- ---------------------------------------------------------------------------
-- 2) 看板：软删除（可恢复，替代原先的物理 DELETE）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_board_by_id(
  p_board_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old boards;
BEGIN
  SELECT * INTO v_old FROM boards
   WHERE id = p_board_id AND NOT is_deleted FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  INSERT INTO boards_history (board_id, title, payload, card_count, reason)
  VALUES (p_board_id, v_old.title, to_jsonb(v_old),
          public._board_card_count(v_old.data), 'delete');

  UPDATE boards
     SET is_deleted = true, deleted_at = now(), version = v_old.version + 1
   WHERE id = p_board_id;

  RETURN jsonb_build_object('ok', true, 'boardId', p_board_id);
END $$;

-- ---------------------------------------------------------------------------
-- 3) 看板：排序（只改 order，不动 data）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reorder_boards(
  p_ordered_ids UUID[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id  UUID;
  v_idx INTEGER := 0;
BEGIN
  IF p_ordered_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  END IF;

  FOREACH v_id IN ARRAY p_ordered_ids LOOP
    UPDATE boards SET "order" = v_idx, version = version + 1
     WHERE id = v_id AND NOT is_deleted;
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_idx);
END $$;

-- ---------------------------------------------------------------------------
-- 4) 工作区设置：单行 upsert（只写传入字段，保留未传字段）
--    固定 id 与前端一致：00000000-0000-0000-0000-000000000001
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_workspace_settings(
  p_fields JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id  UUID := '00000000-0000-0000-0000-000000000001';
  v_row workspace_settings;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  END IF;

  INSERT INTO workspace_settings (
    id, workspace_background, login_background, portal_background, crm_background,
    portal_image_opacity, crm_image_opacity, logo, updated_at
  ) VALUES (
    v_id,
    COALESCE(p_fields->>'workspace_background', '#f5f5f7'),
    COALESCE(p_fields->>'login_background', 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)'),
    COALESCE(p_fields->>'portal_background', '#f5f5f7'),
    COALESCE(p_fields->>'crm_background', '#f5f5f7'),
    COALESCE(NULLIF(p_fields->>'portal_image_opacity', '')::double precision, 1),
    COALESCE(NULLIF(p_fields->>'crm_image_opacity', '')::double precision, 1),
    COALESCE(p_fields->>'logo', ''),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    -- 注意：这里必须用 EXCLUDED（本次解析值）与现有值做 COALESCE，
    -- 但 EXCLUDED 里已含 INSERT 阶段的默认值，所以不能用它判断「是否传入」。
    -- 正确做法：直接用 p_fields 判断字段是否出现，未出现则保留原值。
    workspace_background = CASE WHEN p_fields ? 'workspace_background'
                                THEN p_fields->>'workspace_background' ELSE workspace_settings.workspace_background END,
    login_background     = CASE WHEN p_fields ? 'login_background'
                                THEN p_fields->>'login_background'     ELSE workspace_settings.login_background END,
    portal_background    = CASE WHEN p_fields ? 'portal_background'
                                THEN p_fields->>'portal_background'    ELSE workspace_settings.portal_background END,
    crm_background       = CASE WHEN p_fields ? 'crm_background'
                                THEN p_fields->>'crm_background'       ELSE workspace_settings.crm_background END,
    portal_image_opacity = CASE WHEN p_fields ? 'portal_image_opacity'
                                THEN NULLIF(p_fields->>'portal_image_opacity','')::double precision
                                ELSE workspace_settings.portal_image_opacity END,
    crm_image_opacity    = CASE WHEN p_fields ? 'crm_image_opacity'
                                THEN NULLIF(p_fields->>'crm_image_opacity','')::double precision
                                ELSE workspace_settings.crm_image_opacity END,
    logo                 = CASE WHEN p_fields ? 'logo'
                                THEN p_fields->>'logo'                 ELSE workspace_settings.logo END,
    updated_at           = now()
  RETURNING * INTO v_row;

  -- 变更后快照（与 boards 的「变更前」策略互补，便于任意时点回溯）
  INSERT INTO workspace_settings_history (payload, reason)
  VALUES (to_jsonb(v_row), 'save');

  RETURN jsonb_build_object('ok', true, 'settings', to_jsonb(v_row));
END $$;


-- ---------------------------------------------------------------------------
-- 5) CRM 模块：upsert（按 id 整体覆盖 data —— CRM 模块本身就是整体编辑语义）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_crm_modules(
  p_modules JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_id   TEXT;
  v_old  crm_modules;
  v_cnt  INTEGER := 0;
BEGIN
  IF p_modules IS NULL OR jsonb_typeof(p_modules) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_modules) LOOP
    v_id := v_item->>'id';
    IF v_id IS NULL OR v_id = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
    END IF;

    SELECT * INTO v_old FROM crm_modules WHERE id = v_id;
    IF FOUND THEN
      INSERT INTO crm_modules_history (module_id, payload, contact_count, reason)
      VALUES (v_id, to_jsonb(v_old),
              COALESCE(jsonb_array_length(COALESCE(v_old.data->'contacts', '[]'::jsonb)), 0),
              'save');
    END IF;

    INSERT INTO crm_modules (id, name, name_en, emoji, color, data, "order", updated_at)
    VALUES (v_id,
            COALESCE(v_item->>'name', ''),
            COALESCE(v_item->>'nameEn', ''),
            COALESCE(v_item->>'emoji', '📋'),
            COALESCE(v_item->>'color', '#007AFF'),
            COALESCE(v_item->'data', '{}'::jsonb),
            COALESCE((v_item->>'order')::int, 0),
            now())
    ON CONFLICT (id) DO UPDATE SET
      name       = EXCLUDED.name,
      name_en    = EXCLUDED.name_en,
      emoji      = EXCLUDED.emoji,
      color      = EXCLUDED.color,
      data       = EXCLUDED.data,
      "order"    = EXCLUDED."order",
      updated_at = now();

    v_cnt := v_cnt + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_cnt);
END $$;

-- ---------------------------------------------------------------------------
-- 6) CRM 模块：删除（带变更前快照，可回溯）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_crm_modules(
  p_ids TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id  TEXT;
  v_old crm_modules;
  v_cnt INTEGER := 0;
BEGIN
  IF p_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    SELECT * INTO v_old FROM crm_modules WHERE id = v_id;
    IF FOUND THEN
      INSERT INTO crm_modules_history (module_id, payload, contact_count, reason)
      VALUES (v_id, to_jsonb(v_old),
              COALESCE(jsonb_array_length(COALESCE(v_old.data->'contacts', '[]'::jsonb)), 0),
              'delete');
      DELETE FROM crm_modules WHERE id = v_id;
      v_cnt := v_cnt + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'count', v_cnt);
END $$;


-- ---------------------------------------------------------------------------
-- 7) 权限：全部仅 service_role（连 PUBLIC 也不给）
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_board(TEXT, TEXT, UUID)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.soft_delete_board_by_id(UUID)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reorder_boards(UUID[])            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_workspace_settings(JSONB)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_crm_modules(JSONB)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_crm_modules(TEXT[])        FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_board(TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_board_by_id(UUID)   TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_boards(UUID[])          TO service_role;
GRANT EXECUTE ON FUNCTION public.save_workspace_settings(JSONB)  TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_crm_modules(JSONB)       TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_crm_modules(TEXT[])      TO service_role;

-- 表级权限显式授予 service_role（与 lock_down_users_rls.sql 做法一致，
-- 保证自建 Postgres / 本地环境行为一致）
GRANT SELECT, INSERT, UPDATE, DELETE
  ON boards, workspace_settings, crm_modules TO service_role;
GRANT SELECT, INSERT
  ON boards_history, workspace_settings_history, crm_modules_history TO service_role;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 8) 自检：确认函数存在且 anon 无法执行
-- ---------------------------------------------------------------------------
SELECT p.proname                                               AS function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE')         AS anon_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_board','soft_delete_board_by_id','reorder_boards',
                    'save_workspace_settings','upsert_crm_modules','delete_crm_modules')
ORDER BY p.proname;

