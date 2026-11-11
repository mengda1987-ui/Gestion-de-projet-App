import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { requireSession } from '@/lib/auth/session';

/**
 * /api/crm/modules —— CRM 模块的写入入口
 *
 * 背景：原实现是前端直接 crm_modules.upsert / .delete（anon key 直写）。
 * 撤销 anon 写权限后会 403，因此收敛到服务端（审计 C1）。
 *
 *   POST   /api/crm/modules  { modules: [{ id, name, nameEn, emoji, color, data, order }] }
 *   DELETE /api/crm/modules  { ids: ['...'] }
 *
 * 删除与写入都会在 RPC 内生成变更前快照（crm_modules_history）。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MODULES = 100;
const MAX_BODY = 8 * 1024 * 1024; // CRM 含联系人，8MB 上限

function err(status: number, code: string, message?: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function guard() {
  try {
    return { session: requireSession(), response: null as null | NextResponse };
  } catch (e: any) {
    return { session: null, response: err(e?.status === 403 ? 403 : 401, e?.message || 'UNAUTHORIZED') };
  }
}

/** 只保留允许写入的字段，防止客户端注入任意列 */
function sanitizeModule(m: any, order: number) {
  if (!m || typeof m !== 'object') return null;
  const id = typeof m.id === 'string' ? m.id.trim() : '';
  if (!id || id.length > 100) return null;

  return {
    id,
    name: String(m.name ?? '').slice(0, 200),
    nameEn: String(m.nameEn ?? '').slice(0, 200),
    emoji: String(m.emoji ?? '📋').slice(0, 16),
    color: String(m.color ?? '#007AFF').slice(0, 64),
    order: Number.isFinite(Number(m.order)) ? Number(m.order) : order,
    data: m.data && typeof m.data === 'object' ? m.data : {},
  };
}

export async function POST(request: NextRequest) {
  const { response } = guard();
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  const raw = await request.text();
  if (raw.length > MAX_BODY) return err(413, 'BAD_REQUEST', '请求体过大');

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return err(400, 'BAD_REQUEST', '非法 JSON');
  }

  const modules = Array.isArray(body?.modules) ? body.modules : null;
  if (!modules) return err(400, 'BAD_REQUEST', 'modules 必须是数组');
  if (modules.length === 0) return NextResponse.json({ ok: true, count: 0 });
  if (modules.length > MAX_MODULES) return err(413, 'BAD_REQUEST', '模块数量过多');

  const clean = modules
    .map((m: any, i: number) => sanitizeModule(m, i))
    .filter(Boolean);

  if (clean.length !== modules.length) {
    return err(400, 'BAD_REQUEST', '存在非法的模块结构');
  }

  const { data, error } = await admin.rpc('upsert_crm_modules', { p_modules: clean } as any);
  if (error) {
    console.error('[crm/modules] 保存失败:', error.message);
    return err(500, 'ERROR', '保存失败');
  }
  const r = data as any;
  if (!r?.ok) return err(400, r?.code || 'ERROR');

  return NextResponse.json({ ok: true, count: r.count });
}

export async function DELETE(request: NextRequest) {
  const { response } = guard();
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return err(400, 'BAD_REQUEST');
  }

  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((x: any) => typeof x === 'string' && x.length > 0 && x.length <= 100)
    : null;

  if (!ids) return err(400, 'BAD_REQUEST', 'ids 必须是字符串数组');
  if (ids.length === 0) return NextResponse.json({ ok: true, count: 0 });
  if (ids.length > MAX_MODULES) return err(413, 'BAD_REQUEST', '数量过多');

  const { data, error } = await admin.rpc('delete_crm_modules', { p_ids: ids } as any);
  if (error) {
    console.error('[crm/modules] 删除失败:', error.message);
    return err(500, 'ERROR', '删除失败');
  }
  const r = data as any;
  if (!r?.ok) return err(400, r?.code || 'ERROR');

  return NextResponse.json({ ok: true, count: r.count });
}
