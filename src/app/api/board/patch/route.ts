import { NextResponse } from 'next/server';
import { adminClient, assert, authorizeBoard, jsonBody, route, uuid, validateOps, validateEntity, lookupReceipt, ApiFailure, patchValidationFailure } from '@/lib/api/security';
import { applyEntityOps } from '@/context/patch/delta';
import { mapBoardRow } from '@/context/sync/boardApi';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = route(async (request, user) => {
  const body = await jsonBody(request);
  if (body.accountId !== user.uid) throw new ApiFailure(401, 'ACCOUNT_CHANGED');
  if (!uuid(body.boardId)) throw new ApiFailure(400, 'BAD_REQUEST', 'boardId must be a UUID');
  if (!uuid(body.entryId)) throw new ApiFailure(400, 'BAD_REQUEST', 'entryId must be a UUID');
  if (!Number.isSafeInteger(body.baseVersion) || body.baseVersion < 0) throw new ApiFailure(400, 'BAD_REQUEST', 'baseVersion must be a non-negative integer');
  const row = await authorizeBoard(body.boardId, user);
  const receipt = await lookupReceipt(body.entryId, user.uid, 'board:' + body.boardId, body.patch?.ops);
  if (receipt) return NextResponse.json(receipt, { status: receipt.ok ? 200 : 409 });
  if (body.baseVersion !== row.version) return NextResponse.json({ ok: false, code: 'VERSION_CONFLICT', currentVersion: row.version }, { status: 409 });
  const board = mapBoardRow(row);
  try {
    validateOps(body.patch?.ops, 'board', user, board);
  } catch (error) {
    throw patchValidationFailure(error, 'ops') || error;
  }
  const candidate = applyEntityOps(board, body.patch.ops);
  // Validate the entire resulting graph as well as every requested path.
  try {
    validateEntity(candidate, 'board');
  } catch (error) {
    throw patchValidationFailure(error, 'board') || error;
  }
  const { data, error } = await adminClient().rpc('apply_workspace_patch_v3', { p_kind: 'board', p_id: body.boardId, p_base_version: body.baseVersion, p_ops: body.patch.ops, p_entry_id: body.entryId, p_actor_id: user.uid });
  if (error) {
    console.error('[patch]', error);
    throw new ApiFailure(503, 'WRITE_UNAVAILABLE', `apply_workspace_patch_v3 database error: ${error.message || JSON.stringify(error)}`);
  }
  const response = data?.code === 'BAD_PATCH' && !data.message
    ? {
        ...data,
        message: (() => {
          const mismatches = candidate.columns.flatMap(column =>
            column.cards.flatMap(card =>
              ['deleted', 'urgent', 'linkedContacts']
                .filter(field => Object.hasOwn(card, field))
                .map(field => `board.columns[${column.id}].cards[${card.id}].${field}: migration 202611120001_sync_security_v3.sql expects this field to be absent; actual ${JSON.stringify((card as any)[field])}`),
            ),
          );
          if (mismatches.length) {
            return `Database returned BAD_PATCH without a message. Potential schema mismatch: if the database only has migration 202611120001_sync_security_v3.sql, it rejects these card fields: ${mismatches.slice(0, 10).join('; ')}. Migration 202611120002_icon_image_size.sql explicitly allows them. If migration 002 is already installed, the database validator rejected another board field not identified by the API validator.`;
          }
          return `apply_workspace_patch_v3 returned BAD_PATCH for board ${body.boardId} after API validation; public._valid_entity_v3 rejected the resulting board. The database returned no field-level detail or PostgreSQL exception, so this response does not identify a specific field.`;
        })(),
      }
    : data;
  const status = response.ok ? 200 : response.code === 'VERSION_CONFLICT' ? 409 : response.code === 'NOT_FOUND' ? 404 : response.code === 'FORBIDDEN' ? 403 : 422;
  return NextResponse.json(response, { status });
});
