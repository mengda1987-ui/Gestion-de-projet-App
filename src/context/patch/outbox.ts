import type { BoardPatchPayload } from './ops';
export interface OutboxEntry {
  id: string; accountId: string; boardId: string; baseVersion: number;
  payload: BoardPatchPayload; createdAt: number; attempts: number;
  kind?: 'patch' | 'create' | 'delete' | 'reorder' | 'appearance' | 'profile' | 'crm';
  input?: Record<string, any>;
  rejection?: { status: number; code: string; message: string };
}
const memory = new Map<string, OutboxEntry>();
let opening: Promise<IDBDatabase | null> | undefined;
const key = (account: string) => 'trello.outbox.v3.' + account;
const ackKey = (account: string) => 'trello.outbox.ack.v3.' + account;
const acknowledged = new Set<string>();
const recordKey = (entry: OutboxEntry) => 'trello.outbox.entry.v3.' + entry.accountId + '.' + entry.id;
const receiptKey = (account: string, id: string) => 'trello.outbox.done.v3.' + account + '.' + id;
function hydrate(account: string) {
  try {
    const prefix = 'trello.outbox.entry.v3.' + account + '.';
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name?.startsWith(prefix)) continue;
      const e = JSON.parse(localStorage.getItem(name) || 'null');
      if (e?.accountId !== account) continue;
      if (localStorage.getItem(receiptKey(account, e.id))) acknowledged.add(e.id);
      else if (!memory.has(e.id)) memory.set(e.id, e);
    }
    for (const id of JSON.parse(localStorage.getItem(ackKey(account)) || '[]')) acknowledged.add(id);
    for (const e of JSON.parse(localStorage.getItem(key(account)) || '[]')) if (e.accountId === account && !acknowledged.has(e.id) && !memory.has(e.id)) memory.set(e.id, e);
  } catch {}
}
const mirror = (entry: OutboxEntry) => { try { localStorage.setItem(recordKey(entry), JSON.stringify(entry)); return true; } catch { return false; } };
function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return opening ||= new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 3000);
    try {
      const request = indexedDB.open('trello_patch_outbox', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('patches')) request.result.createObjectStore('patches', { keyPath: 'id' }); };
      request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
      request.onerror = request.onblocked = () => { clearTimeout(timer); resolve(null); };
    } catch { clearTimeout(timer); resolve(null); }
  });
}
async function transaction(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<any> {
  const db = await database();
  if (!db) return undefined;
  return new Promise(resolve => {
    let result: any;
    const timer = setTimeout(() => resolve(undefined), 3000);
    try {
      const tx = db.transaction('patches', mode);
      const request = run(tx.objectStore('patches'));
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => { clearTimeout(timer); resolve(result ?? true); };
      tx.onerror = tx.onabort = () => { clearTimeout(timer); resolve(undefined); };
    } catch { clearTimeout(timer); resolve(undefined); }
  });
}
export const newEntryId = () => crypto.randomUUID();
export async function enqueue(entry: OutboxEntry): Promise<boolean> {
  hydrate(entry.accountId);
  memory.set(entry.id, entry);
  const mirrored = mirror(entry);
  const saved = await transaction('readwrite', store => store.put(entry));
  return mirrored || saved === true || typeof saved === 'string';
}
export async function dequeue(id: string): Promise<void> {
  const entry = memory.get(id);
  if (!entry) return;
  acknowledged.add(id);
  try { localStorage.setItem(receiptKey(entry.accountId, id), '1'); localStorage.removeItem(recordKey(entry)); } catch {}
  await transaction('readwrite', store => store.delete(id));
  memory.delete(id);
}
export async function markRejected(id: string, rejection: NonNullable<OutboxEntry['rejection']>): Promise<void> {
  const entry = memory.get(id);
  if (!entry) return;
  const rejected = { ...entry, rejection };
  memory.set(id, rejected);
  mirror(rejected);
  await transaction('readwrite', store => store.put(rejected));
}
/** Discard only explicitly selected entries owned by this account. */
export async function discardEntries(accountId: string, ids: string[]): Promise<void> {
  if (!accountId || !ids.length) return;
  const wanted = new Set(ids);
  const entries = (await listAll(accountId)).filter(entry => entry.accountId === accountId && wanted.has(entry.id));
  for (const entry of entries) await dequeue(entry.id);
  const removed = new Set(entries.map(entry => entry.id));
  try {
    const name = key(accountId);
    const legacy = JSON.parse(localStorage.getItem(name) || '[]');
    if (Array.isArray(legacy)) localStorage.setItem(name, JSON.stringify(legacy.filter((entry: OutboxEntry) => !removed.has(entry.id) || entry.accountId !== accountId)));
    const done = new Set<string>(JSON.parse(localStorage.getItem(ackKey(accountId)) || '[]'));
    for (const id of removed) done.add(id);
    localStorage.setItem(ackKey(accountId), JSON.stringify([...done]));
  } catch {}
}
export async function listAll(accountId?: string): Promise<OutboxEntry[]> {
  if (!accountId) return [];
  hydrate(accountId);
  try {
    const rows = JSON.parse(localStorage.getItem(key(accountId)) || '[]');
    for (const e of rows) if (e.accountId === accountId && !acknowledged.has(e.id) && !memory.has(e.id)) memory.set(e.id, e);
  } catch {}
  const persisted = await transaction('readonly', store => store.getAll());
  if (Array.isArray(persisted)) for (const e of persisted) {
    try { if (localStorage.getItem(receiptKey(accountId, e.id))) acknowledged.add(e.id); } catch {}
    if (e.accountId === accountId && !acknowledged.has(e.id) && !memory.has(e.id)) memory.set(e.id, e);
  }
  return [...memory.values()].filter(e => e.accountId === accountId && !acknowledged.has(e.id)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
