import { NextResponse } from 'next/server';
import { clearSession, getSession } from '@/lib/auth/session';

/**
 * POST /api/auth/logout
 *
 * 清除 HttpOnly 会话 Cookie。前端必须调用这个接口，
 * 仅在前端 dispatch({ type: 'SET_CURRENT_USER', payload: null })
 * 并不会让服务端失效（旧实现的漏洞）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = getSession();
  try {
    clearSession();
  } catch (e: any) {
    console.warn('[logout] 清除会话失败:', e?.message);
  }
  return NextResponse.json({ success: true, hadSession: Boolean(session) });
}

export async function GET() {
  return POST();
}
