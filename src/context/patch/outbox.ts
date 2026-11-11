/**
 * Patch Outbox：持久化的待提交队列（IndexedDB）
 *
 * 为什么需要它（审计 C7/C8）：
 *   原实现把「待保存改动」只放在内存里，关页/切后台/断网就直接丢。
 *   这里把每次 patch 先落 IndexedDB，发送成功才删除；重启后可重放。
 *
 * 设计要点：
 *   - 每条记录带 id（幂等键）与 baseVersion（乐观锁基准）
 *   - 同一看板的 patch 串行发送，保证 baseVersion 单调递增
 *   - 队列只保留最近 N 天 / 最多 M 条，避免无限增长
 *   - IndexedDB 不可用（隐私模式等）时自动降级为纯内存队列，功能不中断
 */
import type { BoardPatchPayload } from './ops';

const DB_NAME = 'trello_patch_outbox';
const DB_VERSION = 1;
const STORE = 'patches';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 天
const MAX_ENTRIES = 500;

export interface OutboxEntry {
  /** 幂等键，同时作为主键 */
  id: string;
  boardId: string;
  /** 提交时使用的看板版本（乐观锁基准） */
  baseVersion: number;
  payload: BoardPatchPayload;
  createdAt: number;
  /** 已尝试发送次数（用于退避与告警） */
  attempts: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise(resolve => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_board', 'boardId');
        store.createIndex('by_created', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** 生成幂等键（crypto.randomUUID 不可用时降级） */
export function newEntryId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** 入队（先落盘再发送，保证断电不丢） */
export async function enqueue(entry: OutboxEntry): Promise<void> {
  const db = await openDb();
  if (!db) return; // 降级：调用方仍需在内存中保留
  await new Promise<void>(resolve => {
    try {
      const req = tx(db, 'readwrite').put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  await prune();
}

/** 出队（发送成功后调用） */
export async function dequeue(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const req = tx(db, 'readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 更新尝试次数 */
export async function bumpAttempts(entry: OutboxEntry): Promise<void> {
  await enqueue({ ...entry, attempts: entry.attempts + 1 });
}

/** 读取全部待提交项（按创建时间升序，保证顺序） */
export async function listAll(): Promise<OutboxEntry[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise<OutboxEntry[]>(resolve => {
    try {
      const req = tx(db, 'readonly').getAll();
      req.onsuccess = () => {
        const rows = (req.result || []) as OutboxEntry[];
        rows.sort((a, b) => a.createdAt - b.createdAt);
        resolve(rows);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** 读取某个看板的待提交项 */
export async function listByBoard(boardId: string): Promise<OutboxEntry[]> {
  const all = await listAll();
  return all.filter(e => e.boardId === boardId);
}

/** 清理过期与超量条目 */
export async function prune(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const all = await listAll();
  if (all.length === 0) return;

  const cutoff = Date.now() - MAX_AGE_MS;
  const stale = all.filter(e => e.createdAt < cutoff);
  const overflow = all.length > MAX_ENTRIES ? all.slice(0, all.length - MAX_ENTRIES) : [];
  const toDrop = [...stale, ...overflow];
  for (const e of toDrop) {
    await dequeue(e.id);
  }
}

/** 清空（仅用于调试/退出登录） */
export async function clearAll(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const req = tx(db, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
