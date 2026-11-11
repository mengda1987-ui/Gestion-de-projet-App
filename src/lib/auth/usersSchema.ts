/**
 * users 表列可用性探测（带进程内缓存）
 *
 * 背景：password_hash / name_key / is_deleted 由 lock_down_users_rls.sql 添加。
 * 迁移执行前后代码都必须能工作 —— 否则「先部署代码、后跑 SQL」这个
 * 安全上线顺序就无法成立（部署瞬间全员无法登录）。
 *
 * 探测方式：每个待测列做一次 select(col).limit(1)，
 * 只有第一次请求探测，之后进程内缓存，几乎没有额外开销。
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const BASE_COLUMNS = ['id', 'name', 'email', 'avatar', 'color', 'role', 'lang', 'password'];
const OPTIONAL_COLUMNS = ['password_hash', 'name_key', 'is_deleted', 'deleted_at'];

let cachedSelect: string | null = null;

async function hasColumn(admin: SupabaseClient, col: string): Promise<boolean> {
  const { error } = await admin.from('users').select(col).limit(1);
  return !error;
}

/** 返回当前实际可用的列（逗号分隔），用于 .select() */
export async function resolveUserColumns(admin: SupabaseClient): Promise<string> {
  if (cachedSelect) return cachedSelect;

  const available = [...BASE_COLUMNS];
  for (const col of OPTIONAL_COLUMNS) {
    if (await hasColumn(admin, col)) available.push(col);
  }
  cachedSelect = available.join(', ');
  console.info('[users] 可用列:', cachedSelect);
  return cachedSelect;
}

/** 某个可选列是否可用（用于分支逻辑，如是否展示软删除过滤） */
export async function hasUserColumn(admin: SupabaseClient, col: string): Promise<boolean> {
  const select = await resolveUserColumns(admin);
  return select.split(',').map(s => s.trim()).includes(col);
}

/** 测试/热更新用：清空缓存 */
export function resetUserColumnCache(): void {
  cachedSelect = null;
}

/**
 * 按 id 读取单个用户（动态列，返回 any 避免 Supabase 泛型推断失败）。
 */
export async function getUserById(admin: SupabaseClient, id: string): Promise<any | null> {
  const cols = await resolveUserColumns(admin);
  const { data, error } = await (admin.from('users').select(cols as any) as any)
    .eq('id', id)
    .limit(1);
  if (error) {
    console.error('[users] 按 id 查询失败:', error.message);
    return null;
  }
  return data?.[0] ?? null;
}

/**
 * 按 name_key 或规范化名字查找用户（供登录使用）。
 */
export async function findUserByName(
  admin: SupabaseClient,
  normalizedName: string,
  key: string,
): Promise<any | null> {
  const cols = await resolveUserColumns(admin);

  if (cols.includes('name_key')) {
    const { data } = await (admin.from('users').select(cols as any) as any)
      .eq('name_key', key)
      .limit(1);
    if (data && data.length > 0) return data[0];
  }

  // 回退：取候选后在应用层精确比较（避免 ilike 通配符串号）
  const escaped = normalizedName.replace(/[%_\\]/g, '\\$&');
  const { data, error } = await (admin.from('users').select(cols as any) as any)
    .ilike('name', escaped)
    .limit(50);
  if (error) {
    console.error('[users] 按名字查询失败:', error.message);
    throw new Error(error.message);
  }
  const normalize = (s: string) => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return (data || []).find((u: any) => normalize(u.name) === normalizedName) ?? null;
}
