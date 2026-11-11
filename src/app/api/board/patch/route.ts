import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { getSession } from '@/lib/auth/session';

/**
 * POST /api/board/patch
 *
 * 唯一允许写入 boards 的入口（apply_board_patch RPC 只授权给 service_role）。
 *
 * 为什么必须放服务端（审计 C1）：
 *   前端直连 Supabase 时，任何持有 anon key 的客户端都能整板覆盖。
 *   这里把写入收敛到「带版本校验的单条 RPC」，并在服务端强制：
 *     - 参数白名单校验（boardId 必须是 UUID，patch 必须是对象）
 *     - 看板归属校验（预留 actorId → 后续接会话后强制）
 *     - 数据库行锁 + 乐观锁（由 RPC 保证）
 *
 * 环境变量：
 *   NEXT_PUBLIC_SUPABASE_URL        （公开）
 *   SUPABASE_SERVICE_ROLE_KEY       （仅服务端，绝不能加 NEXT_PUBLIC_ 前缀）
 *
 * 未配置 service_role 时返回 503 + code=DISABLED，前端据此走旧通道，不会白屏。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PATCH_BYTES = 2 * 1024 * 1024; // 2MB：防止超大附件把请求撑爆
const MAX_OPS = 200;

/**
 * 进程内幂等缓存：sendBeacon 与正常 fetch 可能同时提交同一条 entry。
 * 命中缓存说明「这条已经成功写过」，直接返回相同结果，绝不重复执行 op。
 * serverless 实例重启会丢失，但 serverless 之间不会同时收到同一 entry
 * （同一客户端只会选一条路径），因此进程内缓存足够。
 */
const processedEntries = new Map<string, { at: number; result: any }>();
const ENTRY_TTL_MS = 10 * 60 * 1000;

function getProcessed(entryId: string): any | null {
  const hit = processedEntries.get(entryId);
  if (!hit) return null;
  if (Date.now() - hit.at > ENTRY_TTL_MS) {
    processedEntries.delete(entryId);
    return null;
  }
  return hit.result;
}

function markProcessed(entryId: string, result: any) {
  if (processedEntries.size > 2000) {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    for (const [k, v] of processedEntries) {
      if (v.at < cutoff) processedEntries.delete(k);
    }
  }
  processedEntries.set(entryId, { at: Date.now(), result });
}

function bad(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  // ---- 0. 鉴权（审计 C3：写接口必须校验会话）----
  // 注意：这里用「软校验 + 开关」策略 —— 若 SESSION_ENFORCE_WRITE=true 才强制。
  // 默认强制。若前端 Cookie 未就绪，会返回 401，客户端据此保留本地改动
  // 并重试（而不是丢弃）。
  const session = getSession();
  if (!session) {
    return NextResponse.json(
      { ok: false, code: 'UNAUTHORIZED', message: '会话已失效，请重新登录' },
      { status: 401 },
    );
  }

  // ---- 1. 请求体积与格式校验（先做，快速失败）----
  const raw = await request.text();
  if (raw.length > MAX_PATCH_BYTES) {
    return bad(413, 'BAD_PATCH', '请求体过大');
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad(400, 'BAD_PATCH', '请求体不是合法 JSON');
  }

  const { boardId, baseVersion, patch, entryId } = body || {};

  if (typeof boardId !== 'string' || !UUID_RE.test(boardId)) {
    return bad(400, 'BAD_PATCH', 'boardId 必须是合法 UUID');
  }
  if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
    return bad(400, 'BAD_PATCH', 'baseVersion 必须是非负整数');
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return bad(400, 'BAD_PATCH', 'patch 必须是对象');
  }
  const ops = (patch as any).ops;
  if (ops !== undefined && !Array.isArray(ops)) {
    return bad(400, 'BAD_PATCH', 'patch.ops 必须是数组');
  }
  if (Array.isArray(ops) && ops.length > MAX_OPS) {
    return bad(413, 'BAD_PATCH', `单次 patch 最多 ${MAX_OPS} 个 op`);
  }

  // 顶层元数据白名单（防止客户端塞入 version / is_deleted 等受保护字段）
  const cleanPatch: Record<string, unknown> = {};
  if (ops !== undefined) cleanPatch.ops = ops;
  if (typeof patch.title === 'string') cleanPatch.title = patch.title.slice(0, 500);
  if (typeof patch.background === 'string') cleanPatch.background = patch.background.slice(0, 4096);
  if (Array.isArray(patch.labels)) cleanPatch.labels = patch.labels;
  // intent=user_edit：声明这是用户主动操作，允许卡片数下降（仍受「近全清空」保护）
  if (patch.intent === 'user_edit') cleanPatch.intent = 'user_edit';
  if (patch.data && typeof patch.data === 'object' && !Array.isArray(patch.data)) {
    const allowed = ['emoji', 'iconBg', 'iconImage', 'visibleTo', 'order'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in patch.data) data[k] = patch.data[k];
    }
    if (Object.keys(data).length > 0) cleanPatch.data = data;
  }

  // ---- 1.5 幂等：同一条 entry 只执行一次（beacon 与 fetch 可能重复到达）----
  const idemKey = typeof entryId === 'string' && entryId.length > 0 ? entryId : '';
  if (idemKey) {
    const prev = getProcessed(idemKey);
    if (prev) {
      return NextResponse.json(prev, { status: prev.ok ? 200 : 409 });
    }
  }

  // ---- 2. 调用 RPC（行锁 + 版本校验 + 事务内快照） ----
  const admin = getAdminClient();
  if (!admin) {
    // 未配置 service_role：显式声明禁用，前端会回落到旧通道（不会白屏/丢数据）
    return bad(503, 'DISABLED', 'SUPABASE_SERVICE_ROLE_KEY 未配置，patch 通道不可用');
  }

  try {
    const { data, error } = await admin.rpc('apply_board_patch', {
      p_board_id: boardId,
      p_base_version: baseVersion,
      p_patch: cleanPatch,
      p_actor_id: null,
    });

    if (error) {
      console.error('[board/patch] RPC 失败:', error.message);
      return bad(500, 'ERROR', '写入失败');
    }

    const r = data as any;
    if (r?.ok === true) {
      const okBody = { ok: true, version: r.version, cards: r.cards, entryId };
      if (idemKey) markProcessed(idemKey, okBody);
      return NextResponse.json(okBody);
    }

    switch (r?.code) {
      case 'VERSION_CONFLICT': {
        // 注意：返回 409，但带着云端最新数据供客户端合并
        const body = {
          ok: false,
          code: 'VERSION_CONFLICT',
          currentVersion: r.current_version,
          currentData: r.current_data,
          entryId,
        };
        if (idemKey) markProcessed(idemKey, body);
        return NextResponse.json(body, { status: 409 });
      }
      case 'NOT_FOUND': {
        const body = { ok: false, code: 'NOT_FOUND', entryId };
        if (idemKey) markProcessed(idemKey, body);
        return NextResponse.json(body, { status: 404 });
      }
      case 'BAD_PATCH': {
        const body = { ok: false, code: 'BAD_PATCH', entryId };
        if (idemKey) markProcessed(idemKey, body);
        return NextResponse.json(body, { status: 422 });
      }
      case 'DESTRUCTIVE_WRITE_BLOCKED': {
        const body = {
          ok: false,
          code: 'DESTRUCTIVE_WRITE_BLOCKED',
          before: r.before,
          after: r.after,
          entryId,
        };
        if (idemKey) markProcessed(idemKey, body);
        return NextResponse.json(body, { status: 409 });
      }
      default:
        return bad(500, 'ERROR', '未知的 RPC 返回');
    }
  } catch (err: any) {
    console.error('[board/patch] 异常:', err?.message);
    return bad(500, 'ERROR', '服务端异常');
  }
}
