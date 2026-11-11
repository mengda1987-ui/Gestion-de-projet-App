/**
 * 前端访问服务端 API 的统一封装
 *
 * 背景（审计 C3）：users 表对 anon 关闭后，前端不能再直连 Supabase 读写成员。
 * 这里把所有成员相关操作收敛到 /api/members，并统一处理错误码，
 * 避免各处重复写 fetch + 错误分支。
 */
import type { User } from '@/types';

export interface ApiError {
  code: string;
  message: string;
  status: number;
}

function toError(status: number, body: any): ApiError {
  return {
    code: body?.error || 'ERROR',
    message: body?.message || body?.error || `HTTP ${status}`,
    status,
  };
}

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T | null; error: ApiError | null }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      credentials: 'same-origin', // 携带 HttpOnly 会话 Cookie
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { data: null, error: toError(res.status, body) };
    return { data: body as T, error: null };
  } catch (e: any) {
    return {
      data: null,
      error: { code: 'NETWORK', message: e?.message || '网络错误', status: 0 },
    };
  }
}

/** 成员列表（服务端已剥离口令） */
export async function fetchMembers(): Promise<{ members: User[] } | null> {
  const { data, error } = await request<{ members: User[] }>('/api/members');
  if (error) {
    if (error.status !== 401) console.warn('[members] 读取失败:', error);
    return null;
  }
  return data;
}

/** 新建成员（需 admin） */
export async function createMember(input: {
  name: string;
  password: string;
  email?: string;
  avatar?: string;
  color?: string;
  role?: 'admin' | 'member';
  lang?: 'zh' | 'en';
}) {
  return request<{ member: User }>('/api/members', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 更新成员（本人或 admin） */
export async function updateMember(input: {
  id?: string;
  name?: string;
  email?: string;
  avatar?: string;
  color?: string;
  lang?: 'zh' | 'en';
  role?: 'admin' | 'member';
  password?: string;
  currentPassword?: string;
}) {
  return request<{ member: User }>('/api/members', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** 软删除成员（需 admin） */
export async function deleteMember(id: string) {
  return request<{ success: boolean }>(`/api/members?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** 当前会话用户（刷新页面后恢复登录态） */
export async function fetchMe(): Promise<User | null> {
  const { data } = await request<{ user: User | null }>('/api/auth/me');
  return data?.user ?? null;
}

/** 登出：必须调用服务端清除 HttpOnly Cookie */
export async function logoutApi(): Promise<void> {
  await request<{ success: boolean }>('/api/auth/logout', { method: 'POST' });
}
