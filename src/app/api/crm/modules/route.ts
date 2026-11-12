import { NextResponse } from 'next/server';
import { route, adminClient, assert, jsonBody, uuid, validateEntity, validateOps, lookupReceipt, readLiveRows, ApiFailure } from '@/lib/api/security';
import { applyEntityOps } from '@/context/patch/delta';
export const dynamic = 'force-dynamic';
export const GET = route(async (_request, user) => {
  const data = await readLiveRows('crm_modules', '*', 'order');
  return NextResponse.json({ accountId: user.uid, modules: data }, { headers: { 'Cache-Control': 'private, no-store' } });
});
export const POST = route(async (request, user) => {
  const b = await jsonBody(request);
  if (b.accountId !== user.uid) throw new ApiFailure(401, 'ACCOUNT_CHANGED');
  assert(typeof b.id === 'string' && b.id.length > 0 && b.id.length <= 100 && uuid(b.entryId) && Number.isSafeInteger(b.baseVersion) && b.baseVersion >= 0 && ['create','delete','patch'].includes(b.action));
  if (b.action === 'create') { validateEntity(b.module, 'module'); assert(b.module.id === b.id); }
  if (b.action === 'delete' && user.role !== 'admin') throw new ApiFailure(403, 'FORBIDDEN');
  if (b.action === 'patch') {
    const receipt = await lookupReceipt(b.entryId, user.uid, 'module:' + b.id, b.ops);
    if (receipt) return NextResponse.json(receipt, { status: receipt.ok ? 200 : 409 });
    const { data, error } = await adminClient().from('crm_modules').select('*').eq('id', b.id).eq('is_deleted', false).maybeSingle();
    if (error) throw new ApiFailure(503, 'READ_UNAVAILABLE');
    if (!data) throw new ApiFailure(404, 'NOT_FOUND');
    if (b.baseVersion !== data.version) return NextResponse.json({ ok: false, code: 'VERSION_CONFLICT', currentVersion: data.version }, { status: 409 });
    const m = { id: data.id, name: data.name, nameEn: data.name_en, emoji: data.emoji, color: data.color, ...data.data };
    validateOps(b.ops, 'module', user, m); validateEntity(applyEntityOps(m, b.ops), 'module');
  }
  const { data, error } = b.action === 'patch' ? await adminClient().rpc('apply_workspace_patch_v3', { p_kind: 'module', p_id: b.id, p_base_version: b.baseVersion, p_ops: b.ops, p_entry_id: b.entryId, p_actor_id: user.uid }) : await adminClient().rpc('crm_structure_v3', { p_action: b.action, p_input: { id: b.id, module: b.module || null }, p_actor_id: user.uid, p_entry_id: b.entryId });
  if (error) throw new ApiFailure(503, 'WRITE_UNAVAILABLE');
  return NextResponse.json(data, { status: data.ok ? 200 : data.code === 'VERSION_CONFLICT' ? 409 : 422 });
});
