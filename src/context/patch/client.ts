/**
 * Patch 客户端：与 /api/board/patch 通信
 *
 * 关键行为（对应审计 C1 / C7）：
 *   - 携带 baseVersion 做乐观锁；冲突时返回最新版本 + 最新数据，绝不盲写
 *   - 网络失败指数退避重试，队列留在 outbox 里不丢
 *   - 页面关闭时可用 sendBeacon 兜底提交（fetch 会被浏览器中止）
 */
import type { BoardPatchPayload } from './ops';
import type { OutboxEntry } from './outbox';

export interface PatchSuccess {
  ok: true;
  version: number;
  cards: number;
}

export interface PatchConflict {
  ok: false;
  code: 'VERSION_CONFLICT';
  currentVersion: number;
  /** 云端最新 data（仅 columns/mindmap），用于三方合并 */
  currentData?: { columns?: unknown[]; mindmap?: unknown[] };
}

export interface PatchRejected {
  ok: false;
  code: 'BAD_PATCH' | 'NOT_FOUND' | 'DESTRUCTIVE_WRITE_BLOCKED' | 'UNAUTHORIZED' | 'DISABLED' | 'ERROR';
  message?: string;
  before?: number;
  after?: number;
}

export type PatchResult = PatchSuccess | PatchConflict | PatchRejected;

const ENDPOINT = '/api/board/patch';

/** 是否启用了 patch 通道 */
export function isPatchRpcEnabled(): boolean {
  // 默认启用；只有显式设为 'false' 才关闭。
  // 原因：NEXT_PUBLIC_* 是构建期内联的，一旦漏配就会永久退回旧的全量路径，
  // 而那条路径正是「保存后自动回滚」的根源。宁可默认走新路径。
  return process.env.NEXT_PUBLIC_USE_PATCH_RPC !== 'false';
}

function toResult(body: any): PatchResult {
  if (body && body.ok === true && typeof body.version === 'number') {
    return { ok: true, version: body.version, cards: body.cards ?? 0 };
  }
  const code = (body?.code || 'ERROR') as any;
  if (code === 'VERSION_CONFLICT') {
    return {
      ok: false,
      code: 'VERSION_CONFLICT',
      currentVersion: typeof body.currentVersion === 'number' ? body.currentVersion : 0,
      currentData: body.currentData,
    };
  }
  return {
    ok: false,
    code,
    message: body?.message || body?.error,
    before: body?.before,
    after: body?.after,
  };
}

/**
 * 提交一条 patch。
 * @param signal 可选 AbortSignal（组件卸载时取消）
 */
export async function submitPatch(
  boardId: string,
  baseVersion: number,
  payload: BoardPatchPayload,
  entryId?: string,
  signal?: AbortSignal,
): Promise<PatchResult> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 显式携带会话 Cookie：缺少它会在启用鉴权后拿到 401，
      // 进而触发「丢弃本地改动」——线上保存回滚的潜在诱因之一。
      credentials: 'same-origin',
      body: JSON.stringify({ boardId, baseVersion, patch: payload, entryId }),
      signal,
    });

    const body = await res.json().catch(() => null);

    if (!res.ok && !body) {
      return { ok: false, code: 'ERROR', message: `HTTP ${res.status}` };
    }
    return toResult(body);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, code: 'ERROR', message: 'aborted' };
    }
    return { ok: false, code: 'ERROR', message: err?.message || 'network error' };
  }
}

/** 顺带提交一个 entry（带幂等键） */
export function submitEntry(entry: OutboxEntry, signal?: AbortSignal): Promise<PatchResult> {
  return submitPatch(entry.boardId, entry.baseVersion, entry.payload, entry.id, signal);
}

/**
 * 页面卸载时兜底提交（fetch 会被浏览器中止，sendBeacon 不会）。
 * 仅用于最后一搏：服务端按 entryId 幂等，重复提交无副作用。
 */
export function beaconSubmit(entry: OutboxEntry): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false;
    const blob = new Blob(
      [JSON.stringify({
        boardId: entry.boardId,
        baseVersion: entry.baseVersion,
        patch: entry.payload,
        entryId: entry.id,
      })],
      { type: 'application/json' },
    );
    // sendBeacon 会自动携带同源 Cookie（无需显式配置），
    // 但服务端按 entryId 幂等，重复提交无副作用。
    return navigator.sendBeacon(ENDPOINT, blob);
  } catch {
    return false;
  }
}

/** 指数退避（毫秒），上限 30s */
export function backoffDelay(attempts: number): number {
  return Math.min(30000, 500 * Math.pow(2, Math.max(0, attempts - 1)));
}
