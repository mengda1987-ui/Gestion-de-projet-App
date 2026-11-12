import { NextResponse } from 'next/server';
import { adminClient, assert, authorizeBoard, jsonBody, route, uuid, validateOps, validateEntity, lookupReceipt, ApiFailure } from '@/lib/api/security';
import { applyEntityOps } from '@/context/patch/delta';
import { mapBoardRow } from '@/context/sync/boardApi';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = route(async (request, user) => {
  const body = await jsonBody(request);
  if (body.accountId !== user.uid) throw new ApiFailure(401, 'ACCOUNT_CHANGED');
  assert(uuid(body.boardId) && uuid(body.entryId) && Number.isSafeInteger(body.baseVersion) && body.baseVersion >= 0);
  const row = await authorizeBoard(body.boardId, user);
  const receipt = await lookupReceipt(body.entryId, user.uid, 'board:' + body.boardId, body.patch?.ops);
  if (receipt) return NextResponse.json(receipt, { status: receipt.ok ? 200 : 409 });
  if (body.baseVersion !== row.version) return NextResponse.json({ ok: false, code: 'VERSION_CONFLICT', currentVersion: row.version }, { status: 409 });
  const board = mapBoardRow(row);
  validateOps(body.patch?.ops, 'board', user, board);
  const candidate = applyEntityOps(board, body.patch.ops);
  // Validate the entire resulting graph as well as every requested path.
  validateEntity(candidate, 'board');
  const { data, error } = await adminClient().rpc('apply_workspace_patch_v3', { p_kind: 'board', p_id: body.boardId, p_base_version: body.baseVersion, p_ops: body.patch.ops, p_entry_id: body.entryId, p_actor_id: user.uid });
  if (error) { console.error('[patch]', error); throw new ApiFailure(503, 'WRITE_UNAVAILABLE'); }
  const status = data.ok ? 200 : data.code === 'VERSION_CONFLICT' ? 409 : data.code === 'NOT_FOUND' ? 404 : data.code === 'FORBIDDEN' ? 403 : 422;
  return NextResponse.json(data, { status });
});
