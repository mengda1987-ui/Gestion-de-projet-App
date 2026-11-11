-- ============================================================================
-- P1.5：彻底关闭 users 表的匿名访问
--
-- 背景（审计 C3 实证）：
--   2026-11-11 用 anon key 实测
--     GET /rest/v1/users?select=id,password  → HTTP 200
--   即任何人只要拿到前端公开的 anon key（它必然在浏览器里），
--   就能把全站用户口令读走。这是本系统最严重的漏洞。
--
-- ⚠️ 执行前提（务必确认后再跑）：
--   1. /api/members、/api/auth/{login,logout,me} 已部署并验证通过
--   2. 前端已不再直连 supabase.from('users')（BoardContext 已改走 API）
--   3. 所有用户已刷新页面（旧标签页会读不到成员列表）
--
-- 本迁移做的事：
--   1. users 增加 password_hash / name_key / is_deleted 三列
--   2. 回填 name_key（用于登录精确匹配，消除 ilike 通配符串号风险）
--   3. 撤销 anon / authenticated 对 users 的一切权限
--   4. 只保留 service_role 访问（服务端 API 使用）
--   5. 自检输出
--
-- 幂等：可重复执行。
-- 执行位置：Supabase Dashboard → SQL Editor
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 新增列
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_key      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ;

-- 老数据允许 password 为空（迁移到 password_hash 后清空明文）
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

-- name_key 唯一（同一规范化名字只能有一个用户）
-- 说明：name_key 只是「规范化名字的查找键」，不需要密码学强度，
-- 因此直接使用内置 md5()，不引入 pgcrypto 扩展依赖。
-- 规范化规则必须与 src/lib/auth/password.ts 的 normalizeName() + nameKey() 保持一致：
--   NFKC → trim → 折叠连续空白 → 转小写 → md5(hex)
UPDATE users
   SET name_key = md5(lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))))
 WHERE name_key IS NULL;

-- 去重保护：若已有重复 name_key，先告警（不自动删除，交人工处理）
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT name_key FROM users WHERE name_key IS NOT NULL
     GROUP BY name_key HAVING COUNT(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE WARNING '存在 % 组重复的 name_key，唯一索引未创建。请先人工清理后重跑本脚本。', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_name_key ON users (name_key);
    RAISE NOTICE '已创建 uniq_users_name_key';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_live ON users (id) WHERE NOT is_deleted;

-- ---------------------------------------------------------------------------
-- 2) 收紧权限：彻底撤销匿名访问
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;   -- 表 owner 也受 RLS 约束

-- 删掉历史遗留的「全开放」策略
DROP POLICY IF EXISTS "Public access"            ON users;
DROP POLICY IF EXISTS "users_public_all"         ON users;
DROP POLICY IF EXISTS "allow_all_users"          ON users;

-- 撤销所有客户端角色的权限（service_role 不受 RLS 约束，无需显式授权）
REVOKE ALL ON TABLE users FROM anon, authenticated;
REVOKE ALL ON SEQUENCE users_id_seq FROM anon, authenticated;

-- 显式授予服务端角色完整权限。
-- 说明：Supabase 的 service_role 通常自带 BYPASSRLS，但显式授权更稳妥，
-- 也保证在自建 Postgres / 本地测试环境下行为一致（曾因缺这行导致 service_role 无权限）。
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users TO service_role;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq TO service_role;

-- 连登录接口都不允许 anon 直查：登录必须经 /api/auth/login（服务端 service_role）
-- 因此这里不创建任何 anon 可用的 SELECT 策略。

-- ---------------------------------------------------------------------------
-- 3) 让 PostgREST 重建 schema 缓存
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 4) 自检（anon_privs 必须为 0；rls 必须为 true）
-- ---------------------------------------------------------------------------
SELECT c.relname                       AS table_name,
       c.relrowsecurity                AS rls_enabled,
       c.relforcerowsecurity           AS force_rls,
       COUNT(p.polname)                AS policy_count,
       (SELECT COUNT(*) FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public'
           AND g.table_name = c.relname
           AND g.grantee IN ('anon', 'authenticated')) AS client_privs
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relname = 'users'
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity;
