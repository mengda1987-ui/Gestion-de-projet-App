import { NextResponse } from 'next/server';
import { adminClient, assert, authorizeBoard, jsonBody, route, uuid, ApiFailure } from '@/lib/api/security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = route(async (request, user) => {
  const b = await jsonBody(request);
  if (b.accountId !== user.uid) throw new ApiFailure(401, 'ACCOUNT_CHANGED');
  assert(b.action === 'create' && uuid(b.id) && uuid(b.entryId) && typeof b.title === 'string' && b.title.trim().length > 0 && b.title.length <= 200 && typeof b.background === 'string' && b.background.length <= 1024 * 1024);
  const { data, error } = await adminClient().rpc('board_structure_v3', { p_action: 'create', p_input: { id: b.id, title: b.title.trim(), background: b.background }, p_actor_id: user.uid, p_entry_id: b.entryId });
  if (error) throw new ApiFailure(503, 'WRITE_UNAVAILABLE');
  return NextResponse.json(data, { status: data.ok ? 200 : 409 });
});
export const PATCH = route(async (request, user) => {
  const b = await jsonBody(request);
  if (b.accountId !== user.uid) throw new ApiFailure(401, 'ACCOUNT_CHANGED');
  assert(b.action === 'reorder' && Array.isArray(b.orderedIds) && b.orderedIds.length <= 500 && b.orderedIds.every(uuid) && new Set(b.orderedIds).size === b.orderedIds.length && uuid(b.entryId));
  for (const id of b.orderedIds) await authorizeBoard(id, user, true);
  const { data, error } = await adminClient().rpc('board_structure_v3', { p_action: 'reorder', p_input: { orderedIds: b.orderedIds }, p_actor_id: user.uid, p_entry_id: b.entryId });
  if (error) throw new ApiFailure(503, 'WRITE_UNAVAILABLE');
  return NextResponse.json(data, { status: data.ok ? 200 : 409 });
});
export const DELETE = route(async (request, user) => {
  const b = await jsonBody(request);
  if (b.accountId !== user.uid) throw new ApiFailure(401, 'ACCOUNT_CHANGED');
  assert(uuid(b.id) && uuid(b.entryId));
  if (user.role !== 'admin') throw new ApiFailure(403, 'FORBIDDEN');
  const { data, error } = await adminClient().rpc('board_structure_v3', { p_action: 'delete', p_input: { id: b.id }, p_actor_id: user.uid, p_entry_id: b.entryId });
  if (error) throw new ApiFailure(503, 'WRITE_UNAVAILABLE');
  return NextResponse.json(data, { status: data.ok ? 200 : data.code === 'NOT_FOUND' ? 404 : 409 });
});
export const GET = route(async () => NextResponse.json({ ok: true }));
