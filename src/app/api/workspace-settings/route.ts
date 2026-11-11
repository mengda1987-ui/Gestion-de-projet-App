import { NextRequest, NextResponse } from 'next/server';
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

function guard() {
  try {
    return { session: requireSession(), response: null as null | NextResponse };
  } catch (e: any) {
    return { session: null, response: err(e?.status === 403 ? 403 : 401, e?.message || 'UNAUTHORIZED') };
  }
}

export async function PATCH(request: NextRequest) {
  const { response } = guard();
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  const raw = await request.text();
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

  const { data, error } = await admin.rpc('save_workspace_settings', { p_fields: fields } as any);
  if (error) {
    console.error('[workspace-settings] 保存失败:', error.message);
    return err(500, 'ERROR', '保存失败');
  }
  const r = data as any;
  if (!r?.ok) return err(400, r?.code || 'ERROR');

  return NextResponse.json({ ok: true, settings: r.settings });
}

export async function GET() {
  const { response } = guard();
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
