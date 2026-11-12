import { NextRequest, NextResponse } from 'next/server';
import { route, jsonBody, uuid } from '@/lib/api/security';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { requireSession } from '@/lib/auth/session';

/**
 * PATCH /api/workspace-settings —— 保存工作区外观设置
 *
 * 背景：原实现是前端直接 workspace_settings.upsert（anon key 直写）。
 * 撤销 anon 写权限后会 403，因此收敛到服务端（审计 C1）。
 *
 * 只写传入的字段，未传的保持原值（COALESCE 在 RPC 内处理）。
 * 服务端做白名单校验，防止客户端写入任意列。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STRING_FIELDS = [
  'workspace_background',
  'login_background',
  'portal_background',
  'crm_background',
  'logo',
] as const;

const NUMBER_FIELDS = ['portal_image_opacity', 'crm_image_opacity'] as const;

const MAX_LEN = 1024 * 1024; // 背景图 dataURL 可能较大，限制 1MB

function err(status: number, code: string, message?: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

async function guard() {
  try {
    return { session: await requireSession(), response: null as null | NextResponse };
  } catch (e: any) {
    return { session: null, response: err(e?.status === 403 ? 403 : 401, e?.message || 'UNAUTHORIZED') };
  }
}

async function PATCHHandler(request: NextRequest) {
  const { session, response } = await guard();
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  const parsed = await jsonBody(request, MAX_LEN * 6);
  const raw = JSON.stringify(parsed);
  if (raw.length > MAX_LEN * 6) return err(413, 'BAD_REQUEST', '请求体过大');

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return err(400, 'BAD_REQUEST', '非法 JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return err(400, 'BAD_REQUEST');
  }

  // 白名单 + 规范化
  const fields: Record<string, unknown> = {};

  for (const key of STRING_FIELDS) {
    if (key in body) {
      const v = body[key];
      if (typeof v !== 'string') return err(400, 'BAD_REQUEST', `${key} 必须是字符串`);
      if (v.length > MAX_LEN) return err(413, 'BAD_REQUEST', `${key} 过大`);
      fields[key] = v;
    }
  }

  for (const key of NUMBER_FIELDS) {
    if (key in body) {
      const v = Number(body[key]);
      if (!isFinite(v) || v < 0 || v > 1) {
        return err(400, 'BAD_REQUEST', `${key} 必须是 0~1 之间的数字`);
      }
      fields[key] = v;
    }
  }

  if (Object.keys(fields).length === 0) {
    return err(400, 'BAD_REQUEST', '没有可更新的字段');
  }

  if (!uuid(body.entryId)) return err(400, 'INVALID_ENTRY_ID');
  if (body.accountId !== session!.uid) return err(401, 'ACCOUNT_CHANGED');
  const { data, error } = await admin.rpc('save_settings_v3', { p_fields: fields, p_actor_id: session!.uid, p_entry_id: body.entryId });
  if (error) {
    console.error('[workspace-settings] 保存失败:', error.message);
    return err(500, 'ERROR', '保存失败');
  }
  const r = data as any;
  if (!r?.ok) return err(400, r?.code || 'ERROR');

  return NextResponse.json({ ok: true, settings: r.settings });
}

async function GETHandler() {
  const { response } = await guard();
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  const { data, error } = await admin
    .from('workspace_settings')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[workspace-settings] 读取失败:', error.message);
    return err(500, 'ERROR');
  }
  return NextResponse.json({ ok: true, settings: data });
}

export const PATCH = route(async (request, user) => user.role === 'admin' ? PATCHHandler(request) : NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 }));
export const GET = route(async () => GETHandler());
