/**
 * 服务端 Supabase 客户端（service_role）
 *
 * 关键约束（审计 C3/C5）：
 *   - 这个 key 绕过所有 RLS，**只能在服务端 API Route 中使用**
 *   - 绝不能加 NEXT_PUBLIC_ 前缀，否则会被打进客户端 bundle
 *   - 本模块只在 nodejs runtime 下被 import
 *
 * 若 key 未配置，返回 null，调用方应返回 503 而不是抛出 500，
 * 让前端可以优雅降级。
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;
let cachedKey = '';

export function getAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (cached && cachedKey === url + key) return cached;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) },
  });
  cachedKey = url + key;
  return cached;
}
