import { NextResponse } from 'next/server';
import { adminClient, publicBoard, route, readLiveRows } from '@/lib/api/security';
export const dynamic = 'force-dynamic';
export const GET = route(async (_request, user) => {
  const db = adminClient();
  const [boards, users, settings] = await Promise.all([
    readLiveRows('boards', '*', 'order'),
    readLiveRows('users', 'id,name,email,avatar,color,role,lang', 'created_at'),
    db.from('workspace_settings').select('*').eq('id', '00000000-0000-0000-0000-000000000001').maybeSingle(),
  ]);
  if (settings.error) throw new Error('Snapshot unavailable');
  return NextResponse.json({ accountId: user.uid, boards: boards.map(b => publicBoard(b, user)).filter(Boolean), users, settings: settings.data }, { headers: { 'Cache-Control': 'private, no-store' } });
});
