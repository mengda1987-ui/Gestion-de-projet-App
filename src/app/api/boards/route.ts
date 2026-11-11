import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { requireSession, getSession } from '@/lib/auth/session';

/**
 * /api/boards —— 看板的结构性变更（创建 / 重命名 / 软删除 / 排序）
 *
 * 背景（2026-11-11 线上探测实证）：
 *   anon key 直接 POST/PATCH/DELETE /rest/v1/boards → 201/204，
 *   任何人可整板覆盖或删除数据（审计 C1，11-05 事故根因）。
 *
 * 本接口把这些操作收敛到服务端，之后 lock_down_write_rls.sql
 * 撤销 anon 的写权限，数据库层就再无匿名写入口。
 *
 * 看板「内容」的修改（卡片/列/心智图）不走这里，走 /api/board/patch
 * （带版本校验的增量写入）。
 *
 *   POST   /api/boards   { action: 'create', title, background }
 *   PATCH  /api/boards   { action: 'rename', id, title }
 *                        { action: 'reorder', orderedIds: [...] }
 *   DELETE /api/boards?id=<uuid>   软删除
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function POST(request: NextRequest) {
  const { session, response } = guard();
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return err(400, 'BAD_REQUEST');
  }

  if (body?.action !== 'create') return err(400, 'BAD_REQUEST', '未知 action');

  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title) return err(400, 'BAD_REQUEST', '标题不能为空');
  if (title.length > 200) return err(400, 'BAD_REQUEST', '标题过长');

  const background =
    typeof body?.background === 'string' ? body.background.slice(0, 4096) : '#f5f5f7';

  const { data, error } = await admin.rpc('create_board', {
    p_title: title,
    p_background: background,
    p_owner: session!.uid,
  } as any);

  if (error) {
    console.error('[boards] 创建失败:', error.message);
    return err(500, 'ERROR', '创建看板失败');
  }
  const r = data as any;
  if (!r?.ok) return err(400, r?.code || 'ERROR');

  return NextResponse.json({ ok: true, board: r.board }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
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

  // --- 重命名（只改 title，不动 data/version 语义由 RPC 保证）---
  if (body?.action === 'rename') {
    const id = typeof body?.id === 'string' ? body.id : '';
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!UUID_RE.test(id)) return err(400, 'BAD_REQUEST', 'id 非法');
    if (!title) return err(400, 'BAD_REQUEST', '标题不能为空');

    const { error } = await admin
      .from('boards')
      .update({ title: title.slice(0, 200) })
      .eq('id', id);

    if (error) {
      console.error('[boards] 重命名失败:', error.message);
      return err(500, 'ERROR');
    }
    return NextResponse.json({ ok: true });
  }

  // --- 排序 ---
  if (body?.action === 'reorder') {
    const ids = Array.isArray(body?.orderedIds) ? body.orderedIds : null;
    if (!ids || ids.some((x: any) => typeof x !== 'string' || !UUID_RE.test(x))) {
      return err(400, 'BAD_REQUEST', 'orderedIds 非法');
    }
    if (ids.length > 500) return err(413, 'BAD_REQUEST', '看板数量过多');

    const { data, error } = await admin.rpc('reorder_boards', { p_ordered_ids: ids } as any);
    if (error) {
      console.error('[boards] 排序失败:', error.message);
      return err(500, 'ERROR');
    }
    return NextResponse.json({ ok: true, result: data });
  }

  return err(400, 'BAD_REQUEST', '未知 action');
}

export async function DELETE(request: NextRequest) {
  const { response } = guard();
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  const id = request.nextUrl.searchParams.get('id') || '';
  if (!UUID_RE.test(id)) return err(400, 'BAD_REQUEST', 'id 非法');

  // 软删除：保留行与历史快照，可恢复（审计 M7）
  const { data, error } = await admin.rpc('soft_delete_board_by_id', { p_board_id: id } as any);
  if (error) {
    console.error('[boards] 软删除失败:', error.message);
    return err(500, 'ERROR');
  }
  const r = data as any;
  if (!r?.ok) return err(404, 'NOT_FOUND');

  return NextResponse.json({ ok: true, id });
}

export async function GET() {
  return NextResponse.json({ ok: Boolean(getSession()) }, { status: getSession() ? 200 : 401 });
}
