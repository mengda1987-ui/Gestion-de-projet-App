 'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeSync } from '@/lib/syncEvents';
import { shareBoards, shareUsers } from './identity';
import type { Action } from '../actions';
import { createInitialState, type BoardState } from '../types';
import { normalizeAction } from '../normalizeAction';
import { actionToPatch, isLocalOnlyAction } from '../patch/ops';
import { applyEntityOps } from '../patch/delta';
import { enqueue, dequeue, discardEntries, listAll, markRejected, newEntryId, type OutboxEntry } from '../patch/outbox';
import { submitEntry } from '../patch/client';
import { buildSnapshot, readLocalBackup, writeLocalBackup, fetchRemoteSnapshot, type WorkspaceSnapshot, type SyncIndicatorState } from './boardApi';

interface Params { state: BoardState; rawDispatch: React.Dispatch<Action>; reducer: (state: BoardState, action: Action) => BoardState }
export function useBoardSync({ state, rawDispatch, reducer }: Params) {
  const optimisticStateRef = useRef(state);
  const account = useRef('');
  const ready = useRef(false);
  const pending = useRef(new Map<string, OutboxEntry>());
  const durable = useRef(new Map<string, Promise<boolean>>());
  const versions = useRef(new Map<string, number>());
  const retryCounts = useRef(new Map<string, number>());
  const retryAfter = useRef(new Map<string, number>());
  const retryDetails = useRef(new Map<string, string>());
  const retryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const running = useRef<Promise<void> | null>(null);
  const fetching = useRef<Promise<void> | null>(null);
  const refetchAgain = useRef(false);
  const mutationRevision = useRef(0);
  const generation = useRef(0);
  const createdAt = useRef(0);
  const backupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistBackup = useCallback(() => {
    if (backupTimer.current) clearTimeout(backupTimer.current);
    backupTimer.current = setTimeout(() => {
      backupTimer.current = null;
      if (account.current) writeLocalBackup(buildSnapshot(optimisticStateRef.current), undefined, account.current);
    }, 800);
  }, []);
  const bc = useRef<BroadcastChannel | null>(null);
  const source = useRef('');
  const seen = useRef(new Set<string>());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncIndicatorState>({ kind: 'idle', label: '已同步' });
  const apply = useCallback((input: Action) => {
    const action = normalizeAction(input);
    optimisticStateRef.current = reducer(optimisticStateRef.current, action);
    rawDispatch(action);
    return optimisticStateRef.current;
  }, [rawDispatch, reducer]);
  const overlay = useCallback((snapshot: WorkspaceSnapshot) => {
    const next = { ...snapshot, boards: [...snapshot.boards] };
    for (const e of pending.current.values()) {
      if (e.accountId !== account.current) continue;
      if (e.kind === 'create' && !next.boards.some(b => b.id === e.boardId)) next.boards.push(e.input!.board);
      else if (e.kind === 'delete') next.boards = next.boards.filter(b => b.id !== e.boardId);
      else if (!e.kind || e.kind === 'patch') next.boards = next.boards.map(b => b.id === e.boardId ? applyEntityOps(b, e.payload.ops) : b);
      else if (e.kind === 'reorder') {
        const ids: string[] = e.input!.orderedIds;
        next.boards.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      } else if (e.kind === 'appearance') Object.assign(next, e.input!.appearance);
      else if (e.kind === 'profile') next.users = next.users.map(u => u.id === e.input!.id ? { ...u, ...e.input!.updates } : u);
    }
    return next;
  }, []);
  const refetch = useCallback(async () => {
    if (!account.current || !ready.current) return;
    if (fetching.current) { refetchAgain.current = true; return fetching.current; }
    const epoch = generation.current;
    const task = (async () => {
      do {
      refetchAgain.current = false;
      const revision = mutationRevision.current;
      try {
        const cur = optimisticStateRef.current;
        const { snapshot } = await fetchRemoteSnapshot(cur.users, cur, account.current);
        if (epoch !== generation.current) return;
        if (revision !== mutationRevision.current) { refetchAgain.current = true; continue; }
        const fresh = optimisticStateRef.current;
        snapshot.boards = snapshot.boards.map(b => (versions.current.get(b.id) ?? 0) > (b.version ?? 0) ? fresh.boards.find(local => local.id === b.id) || b : b);
        for (const b of snapshot.boards) versions.current.set(b.id, b.version ?? 0);
        const merged = overlay(snapshot); // read pending AFTER the request completes
        const content = optimisticStateRef.current;
        const dirtyBoards = new Set([...pending.current.values()].map(e => e.boardId));
        const confirmed = shareBoards(content.boards.filter(b => !dirtyBoards.has(b.id)), merged.boards.filter(b => !dirtyBoards.has(b.id)));
        const confirmedMap = new Map(confirmed.map(b => [b.id,b]));
        merged.boards = merged.boards.map(b => confirmedMap.get(b.id) || b);
        merged.users = shareUsers(content.users, merged.users);
        const sameBoards = merged.boards.length === content.boards.length && merged.boards.every((b,i) => b === content.boards[i]);
        if (sameBoards && merged.users === content.users && Object.entries(merged).every(([key,v]) => key === 'boards' || key === 'users' || v === (content as any)[key])) continue;
        apply({ type: 'APPLY_EXTERNAL_STATE', payload: merged });
        persistBackup();
      } catch (err) { if ((err as any)?.status === 401) apply({ type: 'SET_CURRENT_USER', payload: null }); setSaveError('云端读取失败，本地待提交改动保留。' + (err instanceof Error ? err.message : '')); }
      } while (refetchAgain.current && epoch === generation.current);
    })();
    fetching.current = task;
    try { await task; } finally { if (fetching.current === task) fetching.current = null; }
  }, [apply, overlay, persistBackup]);
  const announce = useCallback(() => {
    const id = newEntryId();
    bc.current?.postMessage({ kind: 'invalidate', source: source.current, id, account: account.current });
  }, []);
  const drainOutbox = useCallback(async () => {
    if (running.current) return running.current;
    if (!account.current || !ready.current) return;
    const epoch = generation.current;
    const task = (async () => {
      const restored = await listAll(account.current);
      if (epoch !== generation.current) return;
      for (const e of restored) if (e.kind !== 'crm' && !pending.current.has(e.id)) pending.current.set(e.id, e);
      pending.current = new Map([...pending.current].sort(([,a],[,b]) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
      const blocked = new Set<string>();
      for (const entry of pending.current.values()) {
        if (epoch !== generation.current) return;
        if (entry.accountId !== account.current || entry.kind === 'crm' || !pending.current.has(entry.id)) continue;
        if (blocked.has(entry.boardId)) continue;
        if (entry.rejection) {
          blocked.add(entry.boardId);
          setSaveError('同步未完成，改动仍保留在本机；此请求已暂停自动重试。');
          setSyncState({ kind: 'error', label: '存在未同步改动', detail: `${entry.rejection.message}；该看板队列已暂停，请检查或丢弃并从云端恢复。`, code: entry.rejection.code, permanent: true });
          continue;
        }
        const retryAt = retryAfter.current.get(entry.boardId) ?? 0;
        if (retryAt > Date.now()) { blocked.add(entry.boardId); continue; }
        retryAfter.current.delete(entry.boardId);
        const saved = durable.current.get(entry.id);
        if (saved && !(await saved)) setSaveError('浏览器存储不可用：改动仅暂存内存，请勿关闭页面。');
        setSyncState({ kind: 'pending', label: '保存中…' });
        let accepted = false;
        let failureDetail = '';
        let permanentFailure: NonNullable<OutboxEntry['rejection']> | undefined;
        for (let retry = 0; retry < 3; retry++) {
          const baseVersion = versions.current.get(entry.boardId) ?? entry.baseVersion;
          const current = { ...entry, baseVersion, attempts: entry.attempts + 1 };
          let result: any;
          if (!entry.kind || entry.kind === 'patch') {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try { result = await submitEntry(current, controller.signal); } finally { clearTimeout(timer); }
          } else {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
              const endpoint = entry.kind === 'appearance' ? '/api/workspace-settings' : entry.kind === 'profile' ? '/api/members' : '/api/boards';
              const method = entry.kind === 'create' ? 'POST' : entry.kind === 'delete' ? 'DELETE' : 'PATCH';
              const body = entry.kind === 'create' ? { action: 'create', ...entry.input, entryId: entry.id, accountId: entry.accountId } : entry.kind === 'delete' ? { id: entry.boardId, entryId: entry.id, accountId: entry.accountId } : { ...entry.input, entryId: entry.id, accountId: entry.accountId };
              const url = entry.kind === 'delete' ? endpoint + '?id=' + encodeURIComponent(entry.boardId) : endpoint;
              const response = await fetch(url, { method, credentials: 'same-origin', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
              result = await response.json();
              result = { ...result, ok: response.ok && result.ok !== false && !result.error, status: response.status, permanent: [400, 413, 422].includes(response.status) };
            } catch (err) { result = { ok: false, message: String(err) }; } finally { clearTimeout(timer); }
          }
          if (epoch !== generation.current) return;
          if (result.ok || (entry.kind === 'delete' && (result.code === 'NOT_FOUND' || result.error === 'NOT_FOUND'))) {
            await dequeue(entry.id);
            if (epoch !== generation.current) return;
            pending.current.delete(entry.id); durable.current.delete(entry.id);
            if (typeof result.version === 'number') versions.current.set(entry.boardId, result.version);
            retryCounts.current.delete(entry.boardId);
            retryAfter.current.delete(entry.boardId);
            retryDetails.current.delete(entry.boardId);
            const retryTimer = retryTimers.current.get(entry.boardId);
            if (retryTimer) clearTimeout(retryTimer);
            retryTimers.current.delete(entry.boardId);
            mutationRevision.current++;
            accepted = true;
            announce();
            await refetch(); // refresh the confirmed baseline, then replay still-pending deltas
            break;
          }
          if (result.code === 'VERSION_CONFLICT') {
            const serverVersion = typeof result.currentVersion === 'number' ? result.currentVersion : undefined;
            failureDetail = serverVersion === undefined
              ? '版本冲突：云端版本暂不可用，本地改动已保留'
              : `版本冲突：云端当前版本 ${serverVersion}，本地改动已保留`;
            await refetch();
            // The conflict response is authoritative; a snapshot can lag behind it.
            if (serverVersion !== undefined) versions.current.set(entry.boardId, serverVersion);
            continue;
          }
          failureDetail = result.message || result.code || result.error || '云端未确认写入';
          if (result.permanent) {
            permanentFailure = { status: result.status || 400, code: result.code || 'BAD_REQUEST', message: failureDetail };
            break;
          }
          setSaveError('同步未完成，改动保留在本机，恢复连接或重新登录后重试。');
          blocked.add(entry.boardId);
          break; // block this board only; independent boards can continue syncing
        }
        if (!accepted) {
          blocked.add(entry.boardId);
          if (permanentFailure) {
            entry.rejection = permanentFailure;
            await markRejected(entry.id, permanentFailure);
            if (epoch !== generation.current) return;
            setSaveError('同步未完成，改动仍保留在本机；此请求已暂停自动重试。');
            setSyncState({ kind: 'error', label: '存在未同步改动', detail: `${permanentFailure.message}（HTTP ${permanentFailure.status}）；该看板队列已暂停，请检查或丢弃并从云端恢复。`, code: permanentFailure.code, permanent: true });
            continue;
          }
          const failures = (retryCounts.current.get(entry.boardId) ?? 0) + 1;
          retryCounts.current.set(entry.boardId, failures);
          const delay = Math.min(5000 * 2 ** (failures - 1), 5 * 60 * 1000);
          const detail = failureDetail || retryDetails.current.get(entry.boardId) || '云端未确认写入；本地改动已保留';
          retryAfter.current.set(entry.boardId, Date.now() + delay);
          retryDetails.current.set(entry.boardId, detail);
          const previousTimer = retryTimers.current.get(entry.boardId);
          if (previousTimer) clearTimeout(previousTimer);
          const timer = setTimeout(() => {
            retryTimers.current.delete(entry.boardId);
            retryAfter.current.delete(entry.boardId);
            if (epoch === generation.current) void drainOutbox();
          }, delay);
          retryTimers.current.set(entry.boardId, timer);
          setSyncState({ kind: 'error', label: '存在未同步改动', detail: `${detail}；本地改动已保留，${Math.ceil(delay / 1000)} 秒后自动重试` });
        }
      }
      if (!pending.current.size) { setSaveError(null); setSyncState({ kind: 'idle', label: '已同步' }); }
      else {
        const rejected = [...pending.current.values()].find(e => e.accountId === account.current && e.kind !== 'crm' && e.rejection);
        const deferred = [...pending.current.values()].find(e => retryAfter.current.has(e.boardId));
        if (rejected?.rejection) {
          setSaveError('同步未完成，改动仍保留在本机；此请求已暂停自动重试。');
          setSyncState({ kind: 'error', label: '存在未同步改动', detail: `${rejected.rejection.message}（HTTP ${rejected.rejection.status}）；该看板队列已暂停，请检查或丢弃并从云端恢复。`, code: rejected.rejection.code, permanent: true });
        } else if (deferred) {
          const boardId = deferred.boardId;
          const remaining = Math.max(0, (retryAfter.current.get(boardId) ?? Date.now()) - Date.now());
          setSyncState({ kind: 'error', label: '存在未同步改动', detail: `${retryDetails.current.get(boardId) || '云端未确认写入'}；本地改动已保留，${Math.ceil(remaining / 1000)} 秒后自动重试` });
        }
      }
    })();
    running.current = task;
    try { await task; } catch (err) { setSaveError('同步队列已保留：' + String(err)); } finally { if (running.current === task) running.current = null; }
  }, [announce, refetch]);
  const discardRejectedQueueAndRestore = useCallback(async () => {
    const rejected = [...pending.current.values()].find(entry => entry.accountId === account.current && entry.kind !== 'crm' && entry.rejection);
    if (!rejected || !account.current || !ready.current) return;
    const epoch = generation.current;
    const revision = mutationRevision.current;
    setSyncState({ kind: 'pending', label: '正在从云端恢复…' });
    try {
      // Keep the local queue intact unless a fresh, account-verified cloud snapshot succeeds.
      const { snapshot } = await fetchRemoteSnapshot(optimisticStateRef.current.users, null, account.current);
      if (epoch !== generation.current) return;
      if (revision !== mutationRevision.current) {
        setSaveError('恢复期间有新的本地编辑；队列未清理，请再次确认从云端恢复。');
        setSyncState({ kind: 'error', label: '有新的本地改动', detail: '本地队列仍完整保留；再次点击恢复前请确认这些改动可以丢弃。', code: rejected.rejection?.code, permanent: true });
        return;
      }
      const boardId = rejected.boardId;
      const discard = [...pending.current.values()].filter(entry => {
        if (entry.accountId !== account.current || entry.kind === 'crm') return false;
        if (rejected.kind === 'reorder') return entry.kind === 'reorder';
        if (rejected.kind === 'appearance') return entry.kind === 'appearance';
        if (rejected.kind === 'profile') return entry.kind === 'profile' && entry.input?.id === rejected.input?.id;
        if (!boardId) return entry.id === rejected.id;
        return entry.boardId === boardId || (entry.kind === 'reorder' && entry.input?.orderedIds?.includes(boardId));
      });
      await discardEntries(account.current, discard.map(entry => entry.id));
      if (epoch !== generation.current) return;
      for (const entry of discard) { pending.current.delete(entry.id); durable.current.delete(entry.id); }
      const timer = retryTimers.current.get(boardId);
      if (timer) clearTimeout(timer);
      retryTimers.current.delete(boardId); retryAfter.current.delete(boardId); retryDetails.current.delete(boardId); retryCounts.current.delete(boardId);
      for (const board of snapshot.boards) versions.current.set(board.id, board.version ?? 0);
      mutationRevision.current++;
      const restored = overlay(snapshot);
      apply({ type: 'LOAD_ALL_DATA', payload: restored });
      writeLocalBackup(restored, undefined, account.current);
      setSaveError(null);
      setSyncState({ kind: pending.current.size ? 'pending' : 'idle', label: pending.current.size ? '正在同步其他改动…' : '已从云端恢复' });
      if (pending.current.size) void drainOutbox();
    } catch (error) {
      setSaveError(`云端恢复失败，队列未清理：${error instanceof Error ? error.message : String(error)}`);
      setSyncState({ kind: 'error', label: '云端恢复失败', detail: '本地队列仍完整保留；检查网络后重试。', code: rejected.rejection?.code, permanent: true });
    }
  }, [apply, drainOutbox, overlay]);
  const queue = useCallback((entry: OutboxEntry) => {
    pending.current.set(entry.id, entry);
    durable.current.set(entry.id, enqueue(entry)); // called synchronously for EVERY operation
    setSyncState({ kind: 'pending', label: '待同步…' });
    queueMicrotask(() => { void drainOutbox(); });
  }, [drainOutbox]);
  const dispatchWithSync = useCallback((input: Action) => {
    const action = normalizeAction(input);
    const before = optimisticStateRef.current;
    if (!ready.current && !isLocalOnlyAction(action)) { setSaveError('正在恢复云端，请稍后再编辑。'); return; }
    if (before.currentUser?.role !== 'admin' && ['DELETE_BOARD', 'REORDER_BOARDS', 'SET_BOARDS_ORDER', 'SET_BOARD_EMOJI', 'SET_BOARD_ICON', 'UPDATE_WORKSPACE_BG', 'UPDATE_LOGIN_BG', 'UPDATE_PORTAL_BG', 'UPDATE_CRM_BG', 'UPDATE_PORTAL_IMAGE_OPACITY', 'UPDATE_CRM_IMAGE_OPACITY', 'UPDATE_LOGO'].includes(action.type)) { setSaveError('此操作需要管理员权限。'); return; }
    const after = apply(action);
    if (action.type === 'SET_CURRENT_USER') {
      const uid = after.currentUser?.id || '';
      if (uid !== account.current) {
        generation.current++; account.current = uid; pending.current.clear(); durable.current.clear(); versions.current.clear();
        ready.current = false;
        running.current = null; fetching.current = null;
        apply({ type: 'APPLY_REMOTE_UPDATE', payload: { ...createInitialState(), currentUser: after.currentUser, _loaded: !uid } });
      }
    }
    if (isLocalOnlyAction(action) && action.type !== 'UPDATE_USER') return;
    if (!before.currentUser || !account.current) return;
    const make = (kind: OutboxEntry['kind'], boardId: string, input?: Record<string, any>, payload = { ops: [] } as OutboxEntry['payload']): OutboxEntry => ({ id: newEntryId(), accountId: account.current, kind, boardId, input, payload, baseVersion: versions.current.get(boardId) ?? 0, createdAt: createdAt.current = Math.max(Date.now(), createdAt.current + 1), attempts: 0 });
    if (action.type === 'CREATE_BOARD') queue(make('create', after.board.id, { id: after.board.id, title: after.board.title, background: after.board.background, board: after.board }));
    else if (action.type === 'DELETE_BOARD') queue(make('delete', action.payload));
    else if (action.type === 'REORDER_BOARDS' || action.type === 'SET_BOARDS_ORDER') queue(make('reorder', '', { action: 'reorder', orderedIds: after.boards.map(b => b.id) }));
    else if (action.type === 'UPDATE_USER') queue(make('profile', '', { id: action.payload.userId, ...action.payload.updates, updates: action.payload.updates }));
    else {
      const appearance: Record<string, string> = { UPDATE_WORKSPACE_BG: 'workspaceBackground', UPDATE_LOGIN_BG: 'loginBackground', UPDATE_PORTAL_BG: 'portalBackground', UPDATE_CRM_BG: 'crmBackground', UPDATE_PORTAL_IMAGE_OPACITY: 'portalImageOpacity', UPDATE_CRM_IMAGE_OPACITY: 'crmImageOpacity', UPDATE_LOGO: 'logo' };
      const names: Record<string, string> = { workspaceBackground: 'workspace_background', loginBackground: 'login_background', portalBackground: 'portal_background', crmBackground: 'crm_background', portalImageOpacity: 'portal_image_opacity', crmImageOpacity: 'crm_image_opacity', logo: 'logo' };
      const field = appearance[action.type];
      if (field) queue(make('appearance', '', { [names[field]]: (after as any)[field], appearance: { [field]: (after as any)[field] } }));
      else for (const board of after.boards) {
        const old = before.boards.find(b => b.id === board.id);
        if (old === board || !old) continue;
        const payload = actionToPatch(action, board, old);
        if (payload) queue(make('patch', board.id, undefined, payload));
      }
    }
    persistBackup();
  }, [apply, queue, persistBackup]);
  useEffect(() => {
    let cancelled = false;
    source.current = newEntryId();
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
        const body = await response.json();
        if (!cancelled) apply({ type: 'SET_CURRENT_USER', payload: body.user || null });
      } catch { if (!cancelled) setSaveError('会话恢复失败，请重新登录；离线队列未删除。'); }
      finally { if (!cancelled && !optimisticStateRef.current.currentUser) apply({ type: 'LOAD_ALL_DATA', payload: buildSnapshot(createInitialState()) }); }
    })();
    return () => { cancelled = true; };
  }, [apply]);
  useEffect(() => {
    const uid = state.currentUser?.id || '';
    const timers = retryTimers.current;
    const retryTimes = retryAfter.current;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear(); retryTimes.clear(); retryDetails.current.clear(); retryCounts.current.clear();
    generation.current++;
    ready.current = false;
    account.current = uid; pending.current.clear(); durable.current.clear(); versions.current.clear();
    running.current = null; fetching.current = null;
    if (!uid) { apply({ type: 'LOAD_ALL_DATA', payload: buildSnapshot(createInitialState()) }); return; }
    const epoch = generation.current;
    void (async () => {
      const entries = await listAll(uid);
      if (epoch !== generation.current) return;
      for (const e of entries) if (e.kind !== 'crm') pending.current.set(e.id, e);
      try { const { snapshot } = await fetchRemoteSnapshot([], null, uid); if (epoch !== generation.current) return; for (const b of snapshot.boards) versions.current.set(b.id, b.version ?? 0); apply({ type: 'LOAD_ALL_DATA', payload: overlay(snapshot) }); }
      catch (error) { if (epoch !== generation.current) return; if ((error as any)?.status === 401) { apply({ type: 'SET_CURRENT_USER', payload: null }); return; } const backup = readLocalBackup(uid); apply({ type: 'LOAD_ALL_DATA', payload: overlay(backup || buildSnapshot(createInitialState())) }); setSaveError('离线模式：云端恢复后自动重试。'); }
      ready.current = true;
      void drainOutbox();
    })();
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear(); retryTimes.clear();
    };
  }, [state.currentUser?.id, apply, overlay, drainOutbox]);
  useEffect(() => {
    const resume = () => { if (document.visibilityState === 'visible') void drainOutbox().then(refetch); };
    const timer = setInterval(resume, 15000);
    window.addEventListener('online', resume); window.addEventListener('pageshow', resume); document.addEventListener('visibilitychange', resume);
    const unsubscribe = state.currentUser?.id ? subscribeSync(resume) : () => {};
    const hide = () => { if (backupTimer.current) { clearTimeout(backupTimer.current); backupTimer.current = null; if (account.current) writeLocalBackup(buildSnapshot(optimisticStateRef.current), undefined, account.current); } };
    window.addEventListener('pagehide', hide);
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('trello-sync-v3'); bc.current = channel;
      channel.onmessage = e => {
        const m = e.data;
        if (m?.kind !== 'invalidate' || m.source === source.current || m.account !== account.current || seen.current.has(m.id)) return;
        if (seen.current.size > 1000) seen.current.clear(); seen.current.add(m.id); resume();
      };
    }
    return () => { clearInterval(timer); window.removeEventListener('online', resume); window.removeEventListener('pageshow', resume); window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', resume); unsubscribe(); bc.current?.close(); };
  }, [drainOutbox, refetch, state.currentUser?.id]);
  return { dispatchWithSync, drainOutbox, discardRejectedQueueAndRestore, saveError, setSaveError, syncState };
}
