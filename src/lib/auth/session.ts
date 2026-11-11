/**
 * 服务端会话（签名 HttpOnly Cookie，零外部依赖）
 *
 * 背景（审计 C3）：原实现登录只在前端 dispatch 一个 currentUser，
 * 刷新即丢失，且没有任何服务端可信身份 —— 导致 API 无法判断「谁在操作」，
 * 于是只能把 users 表对 anon 全开放，口令因此可被任意读取。
 *
 * 本模块提供：
 *   - createSession()  登录成功后签发 Cookie
 *   - getSession()     从 Cookie 还原可信身份（验签 + 过期校验）
 *   - clearSession()   登出
 *   - requireUser()/requireAdmin()  API 守卫
 *
 * Cookie 内容只有 { uid, role, iat, exp, sid }，通过 HMAC-SHA256 签名，
 * 不含任何口令或可被伪造的权限信息（role 也会被签名保护）。
 *
 * 仅服务端可用：依赖 node:crypto 与 next/headers 的 cookies()。
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'trello_session';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

export interface SessionPayload {
  /** 用户 id */
  uid: string;
  /** 角色（随会话固定，权限提升需重新登录） */
  role: 'admin' | 'member';
  /** 签发时间（秒） */
  iat: number;
  /** 过期时间（秒） */
  exp: number;
  /** 会话 id，便于日志追踪与后续「单点登出」扩展 */
  sid: string;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'SESSION_SECRET 未配置或过短（至少 16 字符）。请在 .env.local / Vercel 环境变量中配置。',
    );
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(data: string): string {
  return b64url(createHmac('sha256', secret()).update(data, 'utf8').digest());
}

/** 生成 token：base64url(payload).hmac */
export function encodeSession(p: SessionPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(p), 'utf8'));
  return `${body}.${sign(body)}`;
}

/** 解析并验签 token；失败返回 null（绝不抛异常给调用方） */
export function decodeSession(token: string | undefined | null): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;

  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);

  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null; // SESSION_SECRET 缺失
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as SessionPayload;
    if (!payload || typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 <= Date.now()) return null; // 已过期
    if (payload.role !== 'admin' && payload.role !== 'member') return null;
    return payload;
  } catch {
    return null;
  }
}

/** 构建会话 payload */
export function buildPayload(uid: string, role: 'admin' | 'member', ttlSeconds = DEFAULT_TTL_SECONDS): SessionPayload {
  const now = Math.floor(Date.now() / 1000);
  return { uid, role, iat: now, exp: now + ttlSeconds, sid: randomUUID() };
}

/** 登录：写入 HttpOnly Cookie */
export function createSession(payload: SessionPayload): void {
  cookies().set({
    name: SESSION_COOKIE,
    value: encodeSession(payload),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
  });
}

/** 登出：清除 Cookie */
export function clearSession(): void {
  cookies().set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** 读取当前会话（未登录返回 null） */
export function getSession(): SessionPayload | null {
  try {
    return decodeSession(cookies().get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

/** API 守卫：必须已登录 */
export function requireSession(): SessionPayload {
  const s = getSession();
  if (!s) {
    const err = new Error('UNAUTHORIZED') as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return s;
}

/** API 守卫：必须是管理员 */
export function requireAdmin(): SessionPayload {
  const s = requireSession();
  if (s.role !== 'admin') {
    const err = new Error('FORBIDDEN') as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  return s;
}
