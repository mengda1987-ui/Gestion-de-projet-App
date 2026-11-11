import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { requireSession } from '@/lib/auth/session';

/**
 * PATCH /api/boards/metadata —— 批量同步看板「元数据」
 *
 * 只写 title / background / labels / emoji / iconBg / iconImage / visibleTo / order
 * **绝不写 data 字段**（卡片、列、心智图内容只能经 /api/board/patch 的版本校验通道）。
 *
 * 这是对 audit C1 的核心防线：
 *   原实现 boards.upsert 会把整个 data JSON 一起写回，
 *   任何持有旧状态的客户端都能整块覆盖云端内容。
 *   把「元数据」与「内容」拆成两条写入通道后，
 *   元数据同步永远不会影响卡片数据。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BOARDS = 200;

const ALLOWED = [
  'title', 'background', 'labels',
  'emoji', 'iconBg', 'iconImage', 'visibleTo', 'order',
] as const;

function err(status: number, code: string, message?: string) {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

export async function PATCH(request: NextRequest) {
  try {
    requireSession();
  } catch (e: any) {
    return err(e?.status === 403 ? 403 : 401, e?.message || 'UNAUTHORIZED');
  }

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return err(400, 'BAD_REQUEST');
  }

  const boards = Array.isArray(body?.boards) ? body.boards : null;
  if (!boards) return err(400, 'BAD_REQUEST', 'boards 必须是数组');
  if (boards.length === 0) return NextResponse.json({ ok: true, count: 0 });
  if (boards.length > MAX_BOARDS) return err(413, 'BAD_REQUEST', '看板数量过多');

  let updated = 0;

  for (const b of boards) {
    if (!b || typeof b.id !== 'string' || !UUID_RE.test(b.id)) {
      return err(400, 'BAD_REQUEST', '存在非法 boardId');
    }

    // 白名单：只取允许的字段，**跳过 data / version / is_deleted 等受保护字段**
    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in b) {
        const v = (b as any)[key];
        if (key === 'labels') {
          if (!Array.isArray(v)) return err(400, 'BAD_REQUEST', 'labels 必须是数组');
          patch.labels = v;
        } else if (key === 'visibleTo') {
          if (!Array.isArray(v)) return err(400, 'BAD_REQUEST', 'visibleTo 必须是数组');
          patch.visibleTo = v;
        } else if (key === 'order') {
          const n = Number(v);
          if (!Number.isFinite(n)) return err(400, 'BAD_REQUEST', 'order 非法');
          patch.order = Math.trunc(n);
        } else {
          if (v !== null && typeof v !== 'string') {
            return err(400, 'BAD_REQUEST', `${key} 必须是字符串或 null`);
          }
          // 背景图 dataURL 可能很大，给 4MB 上限
          if (typeof v === 'string' && v.length > 4 * 1024 * 1024) {
            return err(413, 'BAD_REQUEST', `${key} 过大`);
          }
          patch[key] = v;
        }
      }
    }

    if (Object.keys(patch).length === 0) continue;

    const { error } = await admin.from('boards').update(patch).eq('id', b.id);
    if (error) {
      console.warn('[boards/metadata] 更新失败:', b.id, error.message);
    } else {
      updated += 1;
    }
  }

  return NextResponse.json({ ok: true, count: updated });
}
