-- ============================================================================
-- P1：apply_board_patch —— 增量写入 + 乐观锁，切断「整板 JSON 全量覆盖」
--
-- 背景（2026-11-11 审计 C1）：
--   旧路径 BoardContext.tsx:379 用 boards.upsert(整板 JSON) 保存，任何持有旧
--   状态的客户端都能整体覆盖云端，且拖拽一次会重写整列 order。两次并发保存
--   必然互相覆盖（丢失更新），这是 11-05 数据事故的根因。
--
-- 本迁移提供：
--   1. boards.version / is_deleted / updated_by 列（乐观锁基础）
--   2. updated_at 由数据库触发器维护（不再信任客户端时钟）
--   3. _apply_board_patch_ops()  纯函数：把 patch ops 应用到当前 data
--   4. _board_card_count()       纯函数：统计卡片数（破坏性写入保护）
--   5. apply_board_patch()       入口：行锁 + 版本校验 + 快照 + 原子更新
--
-- 特性：
--   * 全部在单个事务内，任何一步失败都不会留下半截数据
--   * 冲突返回 VERSION_CONFLICT（含当前版本与当前数据），绝不静默覆盖
--   * 只允许 service_role 执行（前端必须经 /api/board/patch 服务端调用）
--   * 幂等：可重复执行
--
-- 执行位置：Supabase Dashboard → SQL Editor
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 数据模型
-- ---------------------------------------------------------------------------
ALTER TABLE boards ADD COLUMN IF NOT EXISTS version     BIGINT NOT NULL DEFAULT 0;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS updated_by  UUID;

CREATE INDEX IF NOT EXISTS idx_boards_version ON boards (version);
CREATE INDEX IF NOT EXISTS idx_boards_live    ON boards (id) WHERE NOT is_deleted;

-- updated_at 由数据库维护，杜绝客户端时钟偏差污染合并判断（审计 M1/M15）
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_boards_touch ON boards;
CREATE TRIGGER trg_boards_touch
  BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2) 纯函数：统计卡片总数（用于破坏性写入保护）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._board_card_count(p_data JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(SUM(jsonb_array_length(COALESCE(col->'cards', '[]'::jsonb))), 0)::int
  FROM jsonb_array_elements(COALESCE(p_data->'columns', '[]'::jsonb)) AS col;
$$;

-- ---------------------------------------------------------------------------
-- 3) 纯函数：把 patch ops 应用到 data（不写库，便于单测与复用）
--
--    支持的 op（每项只影响目标任务，未提供的字段保持原值）：
--      {op:'move_card',     cardId, toColumnId, position}  ← 拖拽只动 1 张卡
--      {op:'add_card',      columnId, card:{id,...}}
--      {op:'update_card',   cardId, fields:{...}}          ← 只合并指定字段
--      {op:'remove_card',   cardId}
--      {op:'add_column',    column:{id,title,...}}
--      {op:'update_column', columnId, fields:{...}}
--      {op:'move_column',   columnId, position}
--      {op:'remove_column', columnId}
--      {op:'upsert_mm_node',node:{id,...}}
--      {op:'update_mm_node',nodeId, fields:{...}}
--      {op:'remove_mm_node',nodeId}
--    顶层还可另带 {title, background, labels}（由 apply_board_patch 处理）。
--
--    返回 NULL = patch 非法（调用方必须回滚报错，绝不静默忽略）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._apply_board_patch_ops(
  p_data  JSONB,
  p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_data  JSONB := COALESCE(p_data, '{}'::jsonb);
  v_ops   JSONB;
  v_op    JSONB;
  v_cols  JSONB;
  v_mm    JSONB;
  v_idx   INT;
  v_card  JSONB;
BEGIN
  v_ops := CASE
             WHEN p_patch ? 'ops' THEN p_patch->'ops'
             WHEN p_patch ? 'op'  THEN jsonb_build_array(p_patch)
             ELSE '[]'::jsonb
           END;
  IF jsonb_typeof(v_ops) <> 'array' THEN
    RETURN NULL;
  END IF;

  IF jsonb_typeof(v_data->'columns') IS DISTINCT FROM 'array' THEN
    v_data := jsonb_set(v_data, '{columns}', '[]'::jsonb);
  END IF;
  v_cols := v_data->'columns';
  v_mm   := COALESCE(NULLIF(v_data->'mindmap', 'null'::jsonb), '[]'::jsonb);

  FOR v_op IN SELECT * FROM jsonb_array_elements(v_ops) LOOP
    BEGIN
      CASE v_op->>'op'

      -- 拖拽：整列只改这一张卡的 position，其余卡片一行不动
      WHEN 'move_card' THEN
        SELECT card INTO v_card
          FROM jsonb_array_elements(v_cols) AS c,
               jsonb_array_elements(c->'cards') AS card
         WHERE card->>'id' = v_op->>'cardId'
         LIMIT 1;
        IF v_card IS NULL THEN RETURN NULL; END IF;

        v_card := v_card || jsonb_build_object(
                    'position', COALESCE((v_op->>'position')::numeric, 0),
                    'updatedAt', now());

        -- 1. 从原列移除
        v_cols := (
          SELECT COALESCE(jsonb_agg(
                   jsonb_set(c, '{cards}', (
                     SELECT COALESCE(jsonb_agg(card), '[]'::jsonb)
                       FROM jsonb_array_elements(COALESCE(c->'cards', '[]'::jsonb)) AS card
                      WHERE card->>'id' <> v_op->>'cardId'))
                 ), '[]'::jsonb)
            FROM jsonb_array_elements(v_cols) AS c
        );
        -- 2. 追加到目标列
        SELECT ordinality - 1 INTO v_idx
          FROM jsonb_array_elements(v_cols) WITH ORDINALITY AS t(c, ordinality)
         WHERE c->>'id' = v_op->>'toColumnId';
        IF v_idx IS NULL THEN RETURN NULL; END IF;
        v_cols := jsonb_set(v_cols, ARRAY[v_idx::text, 'cards'],
                            (v_cols->v_idx->'cards') || jsonb_build_array(v_card));

      WHEN 'add_card' THEN
        IF v_op->'card' IS NULL OR v_op->'card'->>'id' IS NULL THEN RETURN NULL; END IF;
        SELECT ordinality - 1 INTO v_idx
          FROM jsonb_array_elements(v_cols) WITH ORDINALITY AS t(c, ordinality)
         WHERE c->>'id' = v_op->>'columnId';
        IF v_idx IS NULL THEN RETURN NULL; END IF;
        v_card := v_op->'card' || jsonb_build_object('updatedAt', now());
        v_cols := jsonb_set(v_cols, ARRAY[v_idx::text, 'cards'],
                            (v_cols->v_idx->'cards') || jsonb_build_array(v_card));

      -- 只合并指定字段：A 改标题、B 改截止日期不再互相覆盖（修复审计 M2）
      WHEN 'update_card' THEN
        IF v_op->>'cardId' IS NULL THEN RETURN NULL; END IF;
        v_cols := (
          SELECT COALESCE(jsonb_agg(
                   jsonb_set(c, '{cards}', COALESCE((
                     SELECT jsonb_agg(
                              CASE WHEN card->>'id' = v_op->>'cardId'
                                   THEN card || COALESCE(v_op->'fields', '{}'::jsonb)
                                             || jsonb_build_object('updatedAt', now())
                                   ELSE card END)
                       FROM jsonb_array_elements(COALESCE(c->'cards', '[]'::jsonb)) AS card
                   ), '[]'::jsonb))
                 ), '[]'::jsonb)
            FROM jsonb_array_elements(v_cols) AS c
        );

      WHEN 'remove_card' THEN
        v_cols := (
          SELECT COALESCE(jsonb_agg(
                   jsonb_set(c, '{cards}', (
                     SELECT COALESCE(jsonb_agg(card), '[]'::jsonb)
                       FROM jsonb_array_elements(COALESCE(c->'cards', '[]'::jsonb)) AS card
                      WHERE card->>'id' <> v_op->>'cardId'))
                 ), '[]'::jsonb)
            FROM jsonb_array_elements(v_cols) AS c
        );

      WHEN 'add_column' THEN
        IF v_op->'column' IS NULL OR v_op->'column'->>'id' IS NULL THEN RETURN NULL; END IF;
        v_cols := v_cols || jsonb_build_array(jsonb_build_object(
          'id',       v_op->'column'->>'id',
          'title',    COALESCE(v_op->'column'->>'title', ''),
          'archived', COALESCE((v_op->'column'->>'archived')::boolean, false),
          'position', COALESCE((v_op->'column'->>'position')::numeric, 0),
          'cards',    COALESCE(v_op->'column'->'cards', '[]'::jsonb)
        ));

      WHEN 'update_column' THEN
        IF v_op->>'columnId' IS NULL THEN RETURN NULL; END IF;
        v_cols := (
          SELECT COALESCE(jsonb_agg(
                   CASE WHEN c->>'id' = v_op->>'columnId'
                        THEN c || COALESCE(v_op->'fields', '{}'::jsonb)
                        ELSE c END), '[]'::jsonb)
            FROM jsonb_array_elements(v_cols) AS c
        );

      -- 列重排：只改这一列的 position（原来只重排数组、不写 order，见审计 M9）
      WHEN 'move_column' THEN
        IF v_op->>'columnId' IS NULL THEN RETURN NULL; END IF;
        v_cols := (
          SELECT COALESCE(jsonb_agg(
                   CASE WHEN c->>'id' = v_op->>'columnId'
                        THEN c || jsonb_build_object(
                               'position', COALESCE((v_op->>'position')::numeric, 0))
                        ELSE c END), '[]'::jsonb)
            FROM jsonb_array_elements(v_cols) AS c
        );

      WHEN 'remove_column' THEN
        v_cols := (
          SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
            FROM jsonb_array_elements(v_cols) AS c
           WHERE c->>'id' <> v_op->>'columnId'
        );

      WHEN 'upsert_mm_node' THEN
        IF v_op->'node' IS NULL OR v_op->'node'->>'id' IS NULL THEN RETURN NULL; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_mm) AS n
                    WHERE n->>'id' = v_op->'node'->>'id') THEN
          v_mm := (
            SELECT jsonb_agg(
                     CASE WHEN n->>'id' = v_op->'node'->>'id'
                          THEN n || v_op->'node' ELSE n END)
              FROM jsonb_array_elements(v_mm) AS n
          );
        ELSE
          v_mm := v_mm || jsonb_build_array(v_op->'node');
        END IF;

      WHEN 'update_mm_node' THEN
        IF v_op->>'nodeId' IS NULL THEN RETURN NULL; END IF;
        v_mm := (
          SELECT jsonb_agg(
                   CASE WHEN n->>'id' = v_op->>'nodeId'
                        THEN n || COALESCE(v_op->'fields', '{}'::jsonb)
                        ELSE n END)
            FROM jsonb_array_elements(v_mm) AS n
        );

      WHEN 'remove_mm_node' THEN
        v_mm := (
          SELECT COALESCE(jsonb_agg(n), '[]'::jsonb)
            FROM jsonb_array_elements(v_mm) AS n
           WHERE n->>'id' <> v_op->>'nodeId'
        );

      ELSE
        RETURN NULL;   -- 未知 op 整体拒绝，绝不静默忽略
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;     -- 类型转换等任何异常都视为非法 patch
    END;
  END LOOP;

  v_data := jsonb_set(v_data, '{columns}', v_cols);
  v_data := jsonb_set(v_data, '{mindmap}', v_mm);
  RETURN v_data;
END $$;

-- ---------------------------------------------------------------------------
-- 4) 主入口：行锁 + 版本校验 + 快照 + 原子更新
--    返回 JSON（不抛异常），客户端按 code 分支处理：
--      {ok:true,  version:N, cards:N}
--      {ok:false, code:'NOT_FOUND'}
--      {ok:false, code:'VERSION_CONFLICT', current_version:N, current_data:{...}}
--      {ok:false, code:'BAD_PATCH'}
--      {ok:false, code:'DESTRUCTIVE_WRITE_BLOCKED', before:N, after:N}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_board_patch(
  p_board_id     UUID,
  p_base_version BIGINT,
  p_patch        JSONB,
  p_actor_id     UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old          boards;
  v_new_data     JSONB;
  v_cards_before INT;
  v_cards_after  INT;
BEGIN
  -- ① 行锁：同一看板的并发写入在此串行化（防丢失更新的核心）
  SELECT * INTO v_old
    FROM boards
   WHERE id = p_board_id AND NOT is_deleted
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  -- ② 乐观锁：baseVersion 不匹配则拒绝并回传最新数据，由客户端合并后重试
  IF p_base_version IS DISTINCT FROM v_old.version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'VERSION_CONFLICT',
      'current_version', v_old.version,
      'current_data', v_old.data
    );
  END IF;

  -- ③ 纯函数应用 patch；NULL 表示非法 → 不改库
  v_new_data := public._apply_board_patch_ops(v_old.data, COALESCE(p_patch, '{}'::jsonb));
  IF v_new_data IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_PATCH');
  END IF;

  -- ④ 破坏性写入保护（把前端「骤降阻断」下沉到 DB，判断是原子的）
  --    规则：
  --      - 默认（未声明 intent）：只要卡片数下降就阻断 —— 防止旧客户端/异常状态批量覆盖
  --      - intent='user_edit'：用户主动操作（含拖拽、删卡），允许下降，但仍拦截「几乎清空」
  --        （删掉 >90% 且原数量 >= 5 时阻断，避免误操作把整列清空）
  v_cards_before := public._board_card_count(v_old.data);
  v_cards_after  := public._board_card_count(v_new_data);

  IF v_cards_after < v_cards_before THEN
    IF NOT (COALESCE(p_patch->>'intent', '') = 'user_edit') THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'DESTRUCTIVE_WRITE_BLOCKED',
        'before', v_cards_before, 'after', v_cards_after,
        'reason', 'card_count_decreased_without_intent'
      );
    END IF;
    IF v_cards_before > 0 AND v_cards_after = 0 THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'DESTRUCTIVE_WRITE_BLOCKED',
        'before', v_cards_before, 'after', v_cards_after,
        'reason', 'total_wipe'
      );
    END IF;
    IF v_cards_before >= 5 AND v_cards_after < (v_cards_before::numeric * 0.1) THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'DESTRUCTIVE_WRITE_BLOCKED',
        'before', v_cards_before, 'after', v_cards_after,
        'reason', 'near_total_wipe'
      );
    END IF;
  END IF;

  -- ⑤ 快照：与更新同一事务，写不进去就整体失败（修复审计 C4）
  INSERT INTO boards_history (board_id, title, payload, card_count, reason)
  VALUES (p_board_id, v_old.title, to_jsonb(v_old), v_cards_before, 'save');

  -- ⑥ 原子更新 + 版本自增
  UPDATE boards
     SET data       = v_new_data,
         title      = COALESCE(p_patch->>'title',      title),
         background = COALESCE(p_patch->>'background', background),
         labels     = COALESCE(p_patch->'labels',      labels),
         version    = v_old.version + 1,
         updated_by = COALESCE(p_actor_id, updated_by)
   WHERE id = p_board_id;

  RETURN jsonb_build_object('ok', true,
                            'version', v_old.version + 1,
                            'cards',   v_cards_after);
END $$;

-- ---------------------------------------------------------------------------
-- 5) 看板元数据更新（改名/背景/图标），同样带版本校验
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_board_meta(
  p_board_id     UUID,
  p_base_version BIGINT,
  p_fields       JSONB
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
  IF p_base_version IS DISTINCT FROM v_old.version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_CONFLICT',
                              'current_version', v_old.version);
  END IF;

  UPDATE boards
     SET title      = COALESCE(p_fields->>'title',      title),
         background = COALESCE(p_fields->>'background', background),
         labels     = COALESCE(p_fields->'labels',      labels),
         data       = data || COALESCE(p_fields->'data', '{}'::jsonb),
         version    = v_old.version + 1
   WHERE id = p_board_id;

  RETURN jsonb_build_object('ok', true, 'version', v_old.version + 1);
END $$;

-- ---------------------------------------------------------------------------
-- 6) 软删除（替代 DELETE_BOARD 的硬删除，修复审计 M7）
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_board(
  p_board_id     UUID,
  p_base_version BIGINT DEFAULT NULL
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
  IF p_base_version IS NOT NULL AND p_base_version IS DISTINCT FROM v_old.version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_CONFLICT',
                              'current_version', v_old.version);
  END IF;

  INSERT INTO boards_history (board_id, title, payload, card_count, reason)
  VALUES (p_board_id, v_old.title, to_jsonb(v_old),
          public._board_card_count(v_old.data), 'delete');

  UPDATE boards
     SET is_deleted = true, deleted_at = now(), version = v_old.version + 1
   WHERE id = p_board_id;

  RETURN jsonb_build_object('ok', true, 'version', v_old.version + 1);
END $$;

-- ---------------------------------------------------------------------------
-- 7) 权限：只给服务端。前端必须经 /api/board/patch（持 service_role）调用。
--    给 anon 执行 = 绕过全部校验，绝不能授权。
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._board_card_count(JSONB)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._apply_board_patch_ops(JSONB, JSONB)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_board_patch(UUID, BIGINT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_board_meta(UUID, BIGINT, JSONB)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.soft_delete_board(UUID, BIGINT)              FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_board_patch(UUID, BIGINT, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_board_meta(UUID, BIGINT, JSONB)        TO service_role;
GRANT EXECUTE ON FUNCTION public.soft_delete_board(UUID, BIGINT)              TO service_role;

NOTIFY pgrst, 'reload schema';

