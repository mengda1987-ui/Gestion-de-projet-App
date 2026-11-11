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
  code:
    | 'BAD_PATCH'
    | 'NOT_FOUND'
    | 'DESTRUCTIVE_WRITE_BLOCKED'
    | 'UNAUTHORIZED'
    | 'DISABLED'
    | 'ENDPOINT_MISSING'
    | 'ERROR';
  message?: string;
  before?: number;
  after?: number;
}

export type PatchResult = PatchSuccess | PatchConflict | PatchRejected;

const ENDPOINT = '/api/board/patch';

/**
 * 诊断：记录「接口根本不存在」这类致命部署问题。
 * 一旦 404，说明后端没部署 —— 继续重试毫无意义，必须明确告知用户。
 */
let endpointMissingLogged = false;

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

    // ---- 业务错误：NOT_FOUND 也走 404，但语义完全不同 ----
    // 【严重 bug 修复】原实现把「看板不存在」的 404 和「接口不存在」的 404
    // 混为一谈，导致前端误判为「后端未部署」并丢弃用户改动。
    // 这里必须通过响应体的 code 区分，而不是只看 HTTP 状态码。
    const bodyCode = (body as any)?.code;
    if (bodyCode === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: (body as any)?.message };
    }

    // 【关键】404 / 405 且响应体没有业务 code，才是「接口真的不存在」。
    // 旧实现把它当作网络错误无限重试，导致：
    //   1. 改动永远落不了库，却看起来"还在同步中"
    //   2. 用户刷新后改动彻底消失（outbox 重放仍然 404）
    if ((res.status === 404 || res.status === 405) && !bodyCode) {
      let absUrl = ENDPOINT;
      try { absUrl = new URL(ENDPOINT, window.location.origin).toString(); } catch {}
      // 把响应体也读出来（Vercel 的 404 会返回 HTML，能据此判断是路由缺失还是别的）
      let snippet = '';
      try {
        const t = await res.text();
        snippet = t.replace(/\s+/g, ' ').slice(0, 120);
      } catch {}
      if (!endpointMissingLogged) {
        endpointMissingLogged = true;
        console.error(
          `[patch] ❌ ${absUrl} 返回 ${res.status}\n` +
          `   页面: ${typeof window !== 'undefined' ? window.location.href : '?'}\n` +
          `   响应: ${snippet || '(空)'}\n` +
          '   → HTTP 404 通常表示该路径下没有对应的 API 路由。',
        );
      }
      return {
        ok: false,
        code: 'ENDPOINT_MISSING',
        message: `${absUrl} → ${res.status} ${snippet}`,
      };
    }

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
