import { NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth/session';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { getUserById } from '@/lib/auth/usersSchema';

/**
 * GET /api/auth/me
 *
 * 刷新页面后用会话 Cookie 恢复当前用户。
 * 旧实现的 currentUser 只存在内存，一刷新就退出登录 —— 这也是
 * 「未保存数据被丢弃」的诱因之一（用户以为还在登录态，实际已被踢出）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: 'SERVER_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  const row = await getUserById(admin, session.uid);

  if (!row || row.is_deleted === true) {
    // 用户已被删除：顺手清掉失效会话
    try { clearSession(); } catch {}
    return NextResponse.json({ user: null }, { status: 200 });
  }

  return NextResponse.json({
    user: {
      id: row.id,
      name: row.name,
      email: row.email || '',
      avatar: row.avatar || '',
      color: row.color || '#3B82F6',
      role: row.role === 'admin' ? 'admin' : 'member',
      lang: row.lang || 'zh',
    },
  });
}
