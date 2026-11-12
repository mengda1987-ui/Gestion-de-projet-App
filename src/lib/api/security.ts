import { NextRequest, NextResponse } from 'next/server';
import { getSession, type SessionPayload } from '@/lib/auth/session';
import { getAdminClient } from '@/lib/supabaseAdmin';
import type { EntityOp } from '@/context/patch/delta';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}
export function assert(value: unknown, message = 'BAD_REQUEST'): asserts value {
  if (!value) throw new ApiFailure(400, message);
}
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(v);
export function adminClient() { const db = getAdminClient(); if (!db) throw new ApiFailure(503, 'SERVER_NOT_CONFIGURED'); return db; }
export async function readLiveRows(table: 'boards' | 'users' | 'crm_modules', columns = '*', order = 'id'): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await adminClient().from(table).select(columns).eq('is_deleted', false).order(order).order('id').range(offset, offset + 499);
    if (error) throw new ApiFailure(503, 'READ_UNAVAILABLE');
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
export const visible = (v: any, user: SessionPayload) => user.role === 'admin' || !Array.isArray(v) || !v.length || v.includes(user.uid);
function entirelyVisible(value: any, user: SessionPayload): boolean {
  if (!value || typeof value !== 'object') return true;
  if (!visible(value.visibleTo, user)) return false;
  return Array.isArray(value) ? value.every(v => entirelyVisible(v, user)) : Object.values(value).every(v => Array.isArray(v) ? v.every(x => entirelyVisible(x, user)) : true);
}
export function publicBoard(row: any, user: SessionPayload) {
  if (row.is_deleted || !visible(row.visibleTo, user)) return null;
  return { ...row, data: { ...row.data, mindmap: user.role === 'admin' ? row.data?.mindmap || [] : [], columns: (row.data?.columns || []).filter((c: any) => visible(c.visibleTo, user)).map((c: any, order: number) => ({ ...c, order, cards: (c.cards || []).filter((card: any) => visible(card.visibleTo, user)).map((card: any, order: number) => ({ ...card, order })) })) } };
}
export async function authorizeBoard(id: string, user: SessionPayload, manage = false) {
  assert(uuid(id), 'INVALID_ID');
  const { data, error } = await adminClient().from('boards').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiFailure(503, 'DATABASE_UNAVAILABLE');
  if (!data || data.is_deleted || !visible(data.visibleTo, user)) throw new ApiFailure(404, 'NOT_FOUND');
  if (manage && user.role !== 'admin') throw new ApiFailure(403, 'FORBIDDEN');
  return data;
}
export async function lookupReceipt(entry: string, actor: string, target: string, input: unknown) {
  const { data, error } = await adminClient().rpc('lookup_sync_receipt_v3', { p_entry: entry, p_actor: actor, p_target: target, p_input: input });
  if (error) throw new ApiFailure(503, 'RECEIPT_UNAVAILABLE');
  return data;
}
export async function jsonBody(request: NextRequest, limit = 4 * 1024 * 1024): Promise<Record<string, any>> {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new ApiFailure(413, 'BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  assert(reader, 'EMPTY_BODY');
  const chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new ApiFailure(408, 'REQUEST_TIMEOUT')); }, 15000); });
  try {
    while (true) { const { done, value } = await Promise.race([reader.read(), timeout]); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new ApiFailure(413, 'BODY_TOO_LARGE'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    assert(body && typeof body === 'object' && !Array.isArray(body)); return body;
  } catch (e) { if (e instanceof ApiFailure) throw e; throw new ApiFailure(400, 'INVALID_JSON'); } finally { clearTimeout(timer); }
}
export function route(handler: (request: NextRequest, user: SessionPayload) => Promise<Response>) {
  return async (request: NextRequest) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('origin');
        if (origin && origin !== request.nextUrl.origin) throw new ApiFailure(403, 'INVALID_ORIGIN');
        if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiFailure(403, 'INVALID_ORIGIN');
      }
      const user = await getSession();
      if (!user) throw new ApiFailure(401, 'UNAUTHORIZED');
      return await handler(request, user);
    } catch (e) {
      const err = e instanceof ApiFailure ? e : new ApiFailure(500, 'INTERNAL_ERROR');
      if (!(e instanceof ApiFailure)) console.error('[api]', e);
      return NextResponse.json({ ok: false, error: err.code, code: err.code, message: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
const allowed: Record<string, string[]> = {
  board: ['title', 'background', 'emoji', 'iconBg', 'iconImage', 'visibleTo', 'order', 'columns', 'labels', 'mindmap'],
  column: ['title', 'order', 'position', 'archived', 'visibleTo', 'mmRootId', 'mmPosition', 'cards'],
  card: ['title', 'description', 'coverImage', 'labels', 'assignees', 'dueDate', 'startDate', 'status', 'completed', 'archived', 'order', 'position', 'mmNodeId', 'mmPosition', 'visibleTo', 'linkedContacts', 'checklists', 'comments', 'attachments'],
  checklist: ['name', 'items'], item: ['text', 'completed', 'dueDate', 'mmNodeId', 'mmPosition'],
  comment: ['userId', 'text'], attachment: ['name', 'url', 'type', 'size', 'uploadedAt'],
  label: ['name', 'color'], node: ['text', 'description', 'parentId', 'color', 'collapsed', 'order'],
  module: ['name', 'nameEn', 'emoji', 'color', 'stages', 'fields', 'contacts'],
  contact: ['name', 'email', 'phone', 'company', 'tags', 'ownerId', 'stageId', 'notes', 'customFields'],
  stage: ['name', 'order'], field: ['name', 'type', 'options'],
};
const child: Record<string, string> = { columns: 'column', cards: 'card', labels: 'label', mindmap: 'node', checklists: 'checklist', items: 'item', comments: 'comment', attachments: 'attachment', stages: 'stage', fields: 'field', contacts: 'contact' };
const arrays = new Set(['labels', 'assignees', 'linkedContacts', 'visibleTo', 'tags', 'options']);
const nullable = new Set(['emoji', 'iconBg', 'iconImage', 'coverImage', 'visibleTo', 'dueDate', 'startDate', 'mmNodeId', 'mmRootId', 'mmPosition', 'parentId']);
function fieldValue(key: string, v: any, entity: string): void {
  if (v === null) { assert(nullable.has(key) || (key === 'description' && entity === 'node')); return; }
  if (child[key] && !(key === 'labels' && entity === 'card')) {
    assert(Array.isArray(v)); const ids = new Set(); for (const x of v) { validateEntity(x, child[key]); assert(!ids.has(x.id)); ids.add(x.id); } return;
  }
  if (arrays.has(key)) { assert(Array.isArray(v) && v.every(x => typeof x === 'string' && x.length <= 200)); return; }
  if (['order', 'size', 'position'].includes(key)) { assert(typeof v === 'number' && Number.isFinite(v) && (key !== 'size' || v >= 0)); return; }
  if (['archived', 'completed', 'collapsed'].includes(key)) { assert(typeof v === 'boolean'); return; }
  if (key === 'mmPosition') { assert(v && typeof v.x === 'number' && Number.isFinite(v.x) && typeof v.y === 'number' && Number.isFinite(v.y)); return; }
  if (key === 'customFields') { assert(v && !Array.isArray(v) && typeof v === 'object' && Object.values(v).every(x => typeof x === 'string')); return; }
  assert(typeof v === 'string' && v.length <= (['url', 'coverImage', 'iconImage', 'background'].includes(key) ? 1024 * 1024 : 100000), 'INVALID_FIELD');
  if (key === 'status') assert(['todo', 'in_progress', 'complete'].includes(v));
  if (key === 'type' && entity === 'field') assert(['text','number','date','select'].includes(v));
  if (['url', 'coverImage', 'iconImage'].includes(key)) assert(!v || /^(https?:\/\/|data:image\/(png|jpeg|webp|gif);base64,|data:application\/pdf;base64,)/i.test(v), 'INVALID_URL');
  if (['dueDate', 'startDate'].includes(key)) assert(Number.isFinite(Date.parse(v)), 'INVALID_DATE');
}
export function validateEntity(v: any, type: string): void {
  assert(v && !Array.isArray(v) && typeof v === 'object' && typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 200);
  for (const [key, value] of Object.entries(v)) {
    if (['id', 'createdAt', 'updatedAt', 'version', 'isDeleted'].includes(key)) continue;
    assert(allowed[type]?.includes(key), 'INVALID_FIELD'); fieldValue(key, value, type);
  }
  const required: Record<string, string[]> = { column: ['title', 'cards', 'archived', 'order'], card: ['title', 'description', 'labels', 'assignees', 'checklists', 'comments', 'attachments', 'status', 'archived', 'order'], checklist: ['name', 'items'], item: ['text', 'completed'], module: ['name', 'nameEn', 'emoji', 'color', 'contacts', 'stages', 'fields'], contact: ['name', 'email', 'phone', 'company', 'tags', 'ownerId', 'stageId', 'notes', 'customFields'] };
  required.comment = ['userId', 'text']; required.attachment = ['name', 'url', 'type', 'size']; required.label = ['name', 'color']; required.node = ['text', 'parentId', 'color', 'order']; required.stage = ['name', 'order']; required.field = ['name', 'type'];
  for (const key of required[type] || []) assert(key in v, 'MISSING_FIELD');
  if (type === 'board') {
    const ids = new Set<string>();
    for (const column of v.columns || []) for (const card of column.cards || []) {
      assert(!ids.has(card.id), 'DUPLICATE_CARD_ID'); ids.add(card.id);
    }
  }
}
export function validateOps(ops: any, root: 'board' | 'module', user: SessionPayload, model: any): asserts ops is EntityOp[] {
  assert(Array.isArray(ops) && ops.length > 0 && ops.length <= 10000, 'BAD_PATCH');
  for (const op of ops) {
    assert(op && ['set', 'insert', 'remove', 'unset', 'order', 'move', 'add_value', 'remove_value'].includes(op.op) && Array.isArray(op.path) && op.path.length > 0 && op.path.length <= 16 && op.path.every((x: any) => typeof x === 'string' && x.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(x)), 'BAD_PATCH');
    if (op.op === 'move') {
      assert(Array.isArray(op.fromPath) && op.fromPath.length === 3 && op.path.length === 3 && op.fromPath[0] === 'columns' && op.path[0] === 'columns' && op.fromPath[2] === 'cards' && op.path[2] === 'cards' && typeof op.id === 'string');
      let source = model;
      for (const key of op.fromPath) source = Array.isArray(source) ? source.find(x => x.id === key) : source?.[key];
      const entity = source?.find((x: any) => x.id === op.id);
      if (!entity) throw new ApiFailure(409, 'TARGET_REMOVED');
      validateOps([{ op: 'remove', path: [...op.fromPath, op.id] }, { op: 'insert', path: op.path, value: entity, afterId: op.afterId }], root, user, model);
      continue;
    }
    let type: string = root, value = model, collection = '', key = '';
    for (let i = 0; i < op.path.length; i++) {
      key = op.path[i];
      if (collection) {
        value = Array.isArray(value) ? value.find((x: any) => x.id === key) : undefined;
        type = collection; collection = '';
        if (value && !visible(value.visibleTo, user)) throw new ApiFailure(403, 'FORBIDDEN');
        if (user.role !== 'admin' && type === 'comment' && value?.userId !== user.uid) throw new ApiFailure(403, 'FORBIDDEN');
      } else {
        if (key === 'customFields' && i === op.path.length - 2 && root === 'module') {
          assert((op.op === 'set' && typeof op.value === 'string') || op.op === 'unset');
          i++; key = 'customFieldEntry'; value = value?.customFields?.[op.path[i]]; break;
        }
        assert(allowed[type]?.includes(key), 'INVALID_PATH');
        if (user.role !== 'admin' && ['visibleTo', 'emoji', 'iconBg', 'iconImage'].includes(key)) throw new ApiFailure(403, 'FORBIDDEN');
        const nested = child[key] && !(key === 'labels' && type === 'card');
        if (nested) collection = child[key];
        else assert(i === op.path.length - 1, 'INVALID_PATH');
        value = value?.[key];
      }
    }
    if (op.op === 'insert') { assert(collection); validateEntity(op.value, collection); assert(op.afterId === null || typeof op.afterId === 'string'); }
    if (op.op === 'order') assert(collection && Array.isArray(op.ids) && op.ids.every((x: any) => typeof x === 'string') && new Set(op.ids).size === op.ids.length);
    if (op.op === 'add_value' || op.op === 'remove_value') assert(!collection && arrays.has(key) && typeof op.value === 'string');
    if (op.op === 'set') { assert(!collection && !['cards', 'columns', 'contacts', 'checklists', 'comments', 'attachments', 'items'].includes(key), 'INVALID_PATH'); if (key !== 'customFieldEntry') fieldValue(key, op.value, type); }
    if (op.op === 'unset') assert(key === 'customFieldEntry');
    if (user.role !== 'admin' && type === 'comment' && key === 'userId') throw new ApiFailure(403, 'FORBIDDEN');
    if (op.op === 'remove') assert(!collection && op.path.length >= 2, 'INVALID_PATH');
    if (op.op === 'remove') assert(child[op.path[op.path.length - 2]], 'INVALID_PATH');
    if (user.role !== 'admin' && ['remove', 'order'].includes(op.op) && !entirelyVisible(value, user)) throw new ApiFailure(403, 'HIDDEN_DESCENDANTS');
    if (user.role !== 'admin' && op.op === 'insert' && op.value.visibleTo?.length) throw new ApiFailure(403, 'FORBIDDEN');
    if (user.role !== 'admin' && op.op === 'insert' && op.path.includes('comments') && op.value.userId !== user.uid) throw new ApiFailure(403, 'FORBIDDEN');
  }
}
