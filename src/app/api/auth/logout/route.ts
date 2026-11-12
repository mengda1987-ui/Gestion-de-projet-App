import { NextRequest, NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth/session';
import { getAdminClient } from '@/lib/supabaseAdmin';

/**
 * POST /api/auth/logout
 *
 * 清除 HttpOnly 会话 Cookie。前端必须调用这个接口，
 * 仅在前端 dispatch({ type: 'SET_CURRENT_USER', payload: null })
 * 并不会让服务端失效（旧实现的漏洞）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return NextResponse.json({ error: 'INVALID_ORIGIN' }, { status: 403 });
  const session = await getSession();
  try {
    if (session) {
      const db = getAdminClient();
      const { error } = await db!.from('revoked_sessions_v3').upsert({ sid: session.sid, user_id: session.uid, expires_at: new Date(session.exp * 1000).toISOString() });
      if (error) throw error;
    }
    clearSession();
    return NextResponse.json({ success: true, hadSession: Boolean(session) });
  } catch {
    try { clearSession(); } catch {}
    return NextResponse.json({ success: false, error: 'LOGOUT_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function GET() { return NextResponse.json({ error: 'METHOD_NOT_ALLOWED' }, { status: 405 }); }
