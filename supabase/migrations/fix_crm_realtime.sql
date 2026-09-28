-- ============================================================
-- 修复：crm_modules 未启用 Realtime 推送
-- 症状：跨设备同步要等 10 秒以上（靠 15 秒轮询兜底），而非秒级
-- 原因：建表时 ALTER PUBLICATION 那条语句未成功执行
-- 在 Supabase Dashboard → SQL Editor 里运行本文件即可
-- ============================================================

-- 1) 把 crm_modules 加入 realtime 发布（Realtime 推送的前提）
--    IF NOT EXISTS 语义：已在发布中就跳过，可安全重复执行
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'crm_modules'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_modules;
    RAISE NOTICE '✅ 已将 crm_modules 加入 supabase_realtime 发布';
  ELSE
    RAISE NOTICE 'ℹ️ crm_modules 已在 supabase_realtime 发布中，无需重复添加';
  END IF;
END $$;

-- 2) 关键：Realtime 的 postgres_changes 在开启 RLS 的表上，
--    需要 SELECT 权限才能把变更投递给订阅者。
--    旧的 RLS 策略若只授予了 anon 的 INSERT/UPDATE/DELETE 而无 SELECT，
--    订阅会显示 SUBSCRIBED 却收不到任何推送（正是当前症状）。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'crm_modules'
      AND policyname = 'crm_modules_realtime_select'
  ) THEN
    CREATE POLICY "crm_modules_realtime_select"
      ON public.crm_modules
      FOR SELECT
      TO anon, authenticated
      USING (true);
    RAISE NOTICE '✅ 已补充 crm_modules 的 SELECT RLS 策略（Realtime 投递所需）';
  ELSE
    RAISE NOTICE 'ℹ️ SELECT 策略已存在';
  END IF;
END $$;

-- 3) 让 PostgREST 立即重建 schema 缓存，避免策略生效延迟
NOTIFY pgrst, 'reload schema';

-- 4) 自检：确认修复结果（应返回一行，replication 列为 true）
SELECT
  schemaname,
  tablename,
  (SELECT COUNT(*) > 0 FROM pg_publication_tables t2
    WHERE t2.pubname = 'supabase_realtime'
      AND t2.schemaname = 'public'
      AND t2.tablename = 'crm_modules') AS realtime_enabled,
  (SELECT COUNT(*) FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'crm_modules'
      AND p.cmd = 'SELECT') AS select_policy_count
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'crm_modules';
