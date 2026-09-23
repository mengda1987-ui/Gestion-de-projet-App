-- ============================================================
-- 修复实时同步：为 Realtime 表设置 REPLICA IDENTITY FULL
-- ============================================================
-- 问题：Supabase Realtime 默认只发送主键，UPDATE/DELETE 事件
--       在客户端订阅时经常收不到或信息不全，导致多用户不同步。
-- 解决：设置 REPLICA IDENTITY FULL，让变更事件携带完整行数据。
-- ============================================================

ALTER TABLE users REPLICA IDENTITY FULL;
ALTER TABLE boards REPLICA IDENTITY FULL;
ALTER TABLE workspace_settings REPLICA IDENTITY FULL;

-- 确保三张表都在 realtime publication 中（幂等，重复执行不报错）
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE users;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE boards;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE workspace_settings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 为 updated_at 建立索引，便于按时间戳合并时快速比较
CREATE INDEX IF NOT EXISTS idx_boards_updated_at ON boards (updated_at);
