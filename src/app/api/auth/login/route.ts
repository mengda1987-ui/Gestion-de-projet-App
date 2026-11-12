import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { buildPayload, createSession } from '@/lib/auth/session';
import { hashPassword, verifyPassword, normalizeName, nameKey } from '@/lib/auth/password';
import { findUserByName } from '@/lib/auth/usersSchema';
import { jsonBody } from '@/lib/api/security';
import { createHash } from 'node:crypto';

/**
 * POST /api/auth/login
 *
 * 相比旧实现（审计 C3）的修复：
 *   1. 不再 select 返回 password；只对外暴露安全字段
 *   2. 不用 ilike(name, input) 直接匹配：输入 % / _ 会被当通配符，
 *      可能匹配到别人的账号 → 改为「规范化后精确匹配」
 *   3. 口令改 scrypt 校验，老明文数据校验通过后自动无感升级（双轨渐进式）
 *   4. 登录成功签发 HttpOnly 签名 Cookie，服务端从此有可信身份
 *   5. 「用户不存在」与「密码错误」返回同一结果，避免账号枚举
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 极简内存限流：同一 IP 每分钟最多 10 次登录尝试
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (attempts.size > 2000) for (const [key, value] of attempts) if (value.resetAt < now) attempts.delete(key);
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

/** 只对外暴露安全字段 */
function publicUser(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    avatar: row.avatar || '',
    color: row.color || '#3B82F6',
    role: row.role === 'admin' ? 'admin' : 'member',
    lang: row.lang || 'zh',
  };
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', message: '尝试过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  let body: any;
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 });
    body = await jsonBody(request, 8192);
  } catch {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }

  const name = typeof body?.name === 'string' ? body.name : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!name.trim() || name.length > 200 || !password || password.length > 200) {
    return NextResponse.json({ error: 'Name and password are required' }, { status: 400 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: 'SERVER_NOT_CONFIGURED', message: '服务端未配置 SUPABASE_SERVICE_ROLE_KEY' },
      { status: 503 },
    );
  }

  const normalized = normalizeName(name);
  const bucket = createHash('sha256').update(ip + ':' + normalized).digest('hex');
  const quota = await admin.rpc('consume_api_quota_v3', { p_actor: '00000000-0000-0000-0000-000000000000', p_bucket: 'login:' + bucket, p_limit: 10, p_seconds: 60 });
  if (quota.error) return NextResponse.json({ error: 'SERVER_NOT_CONFIGURED' }, { status: 503 });
  if (!quota.data) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  let row: any = null;

  try {
    row = await findUserByName(admin, normalized, nameKey(normalized));
  } catch (e: any) {
    console.error('[login] 异常:', e?.message);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  // 统一失败响应，避免账号枚举
  const fail = () => NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });

  if (!row || row.is_deleted === true) return fail();

  const { ok, needsUpgrade } = await verifyPassword(password, row.password_hash, row.password);
  if (!ok) return fail();

  // ---- 无感迁移：明文 → scrypt ----
  if (needsUpgrade) {
    try {
      const { error: upErr } = await admin
        .from('users')
        .update({ password_hash: await hashPassword(password), password: null })
        .eq('id', row.id);
      if (upErr) {
        console.warn('[login] 口令升级失败（不影响本次登录）:', upErr.message);
      } else {
        console.info('[login] 已将该用户口令升级为 scrypt:', row.id);
      }
    } catch (e: any) {
      console.warn('[login] 口令升级异常:', e?.message);
    }
  }

  // ---- 签发会话 ----
  const role: 'admin' | 'member' = row.role === 'admin' ? 'admin' : 'member';
  try {
    createSession({ ...buildPayload(row.id, role), sessionVersion: Number(row.session_version || 0) });
  } catch (e: any) {
    console.error('[login] 会话签发失败（检查 SESSION_SECRET）:', e?.message);
    return NextResponse.json(
      { error: 'SESSION_NOT_CONFIGURED', message: 'SESSION_SECRET 未配置或过短' },
      { status: 503 },
    );
  }

  return NextResponse.json({ success: true, user: publicUser(row) });
}
