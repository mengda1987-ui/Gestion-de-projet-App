-- ============================================================================
-- 【独立脚本】补齐 users 表的 password_hash / name_key / is_deleted
--
-- 背景：
--   原 lock_down_users_rls.sql 里包含 `REVOKE ... ON SEQUENCE users_id_seq`，
--   但线上 users 表主键是 UUID（无序列），该语句报错导致整段脚本中断，
--   所以 password_hash 等列从未创建成功。
--
-- 本脚本只做「加列 + 回填 + 撤权限」，不涉及序列，可独立安全执行。
--
-- ⚠️ 执行顺序：
--   1. 先在 Supabase SQL Editor 执行本脚本
--   2. 验证 password_hash 列已存在
--   3. 用户下次登录时会自动把明文口令升级为 scrypt（无感迁移）
--
-- 幂等：可重复执行。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 第 1 步：加列（不含任何序列/约束依赖）
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name_key      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ;

-- 迁移到 password_hash 后允许清空明文
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 第 2 步：回填 name_key（用于登录精确匹配，消除 ilike 通配符串号风险）
--
-- 规范化规则必须与 src/lib/auth/password.ts 的 normalizeName() + nameKey() 完全一致：
--   NFKC → trim → 折叠连续空白 → 转小写 → md5(hex)
-- md5 仅作查找键，不需要密码学强度，故不引入 pgcrypto。
-- ---------------------------------------------------------------------------
UPDATE users
   SET name_key = md5(lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))))
 WHERE name_key IS NULL;

-- ---------------------------------------------------------------------------
-- 第 3 步：唯一索引（先检查重复，避免建索引失败）
-- ---------------------------------------------------------------------------
DO $$
DECLARE dup_count INT;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT name_key FROM users
     WHERE name_key IS NOT NULL
     GROUP BY name_key HAVING COUNT(*) > 1
  ) t;

  IF dup_count > 0 THEN
    RAISE WARNING '存在 % 组重复 name_key，跳过唯一索引。请先人工处理后重跑。', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_name_key ON users (name_key);
    RAISE NOTICE '唯一索引 uniq_users_name_key 已创建';
  END IF;
END $$;
-- 软删除查询用的部分索引
CREATE INDEX IF NOT EXISTS idx_users_live ON users (id) WHERE NOT is_deleted;

-- ---------------------------------------------------------------------------
-- 第 4 步：收紧权限（这是关闭「匿名读口令」的关键）
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access"    ON users;
DROP POLICY IF EXISTS "users_public_all" ON users;
DROP POLICY IF EXISTS "allow_all_users"  ON users;

REVOKE ALL ON TABLE users FROM anon, authenticated;

-- 授予服务端角色（Supabase 的 service_role 通常自带 BYPASSRLS，
-- 但显式授权可保证自建/本地环境行为一致）
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users TO service_role;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 第 5 步：自检（执行后请核对输出）
--
-- 注意：所有子查询都必须限定到 public schema 且 LIMIT 1，
-- 否则 pg_class 里可能存在同名表/视图（不同 schema），
-- 导致 "more than one row returned by a subquery used as an expression"（SQLSTATE 21000）。
-- ---------------------------------------------------------------------------
SELECT '列检查' AS 检查项,
       (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users'
           AND column_name IN ('password_hash','name_key','is_deleted','deleted_at')) AS 已存在列数,
       (SELECT COUNT(*) FROM public.users WHERE name_key IS NOT NULL) AS name_key已回填,
       (SELECT COUNT(*) FROM public.users) AS 用户总数,
       has_table_privilege('anon', 'public.users', 'SELECT') AS anon可读,
       (SELECT relrowsecurity
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'users'
         LIMIT 1) AS rls已启用,
       (SELECT COUNT(*) FROM (
          SELECT name_key FROM public.users
           WHERE name_key IS NOT NULL
           GROUP BY name_key HAVING COUNT(*) > 1
        ) d) AS 重复name_key组数;
