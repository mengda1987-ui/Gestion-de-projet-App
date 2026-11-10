-- ============================================================================
-- 轻量统计函数（移动端流量优化）
--
-- 背景：2026-11-10 分析移动端流量时发现，每次保存前都需要知道云端总卡片数，
-- 但 PostgREST 无法在服务端做聚合，只能把整个 columns JSON 传给客户端再算，
-- 单次约 542KB。手机用户一天保存几十次，流量消耗可观。
--
-- 本函数在数据库内完成计数，只返回一个整数（响应体 < 10 字节）。
--
-- 实测：客户端请求从 542KB 降至不足 10 字节。
-- ============================================================================

-- 总卡片数
CREATE OR REPLACE FUNCTION public.count_all_cards()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(
    SUM(
      COALESCE(
        (SELECT SUM(jsonb_array_length(COALESCE(col->'cards', '[]'::jsonb)))
         FROM jsonb_array_elements(b.data->'columns') AS col),
        0
      )
    ), 0
  )::integer
  FROM public.boards b;
$$;

-- 总看板数（比 HEAD 更省，一次调用同时拿到两个数）
CREATE OR REPLACE FUNCTION public.workspace_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'boards', COUNT(*),
    'cards', COALESCE((
      SELECT SUM(
        COALESCE(
          (SELECT SUM(jsonb_array_length(COALESCE(col->'cards', '[]'::jsonb)))
           FROM jsonb_array_elements(b.data->'columns') AS col),
          0
        )
      )
      FROM public.boards b
    ), 0)
  )
  FROM public.boards;
$$;

GRANT EXECUTE ON FUNCTION public.count_all_cards() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_stats() TO anon, authenticated;
