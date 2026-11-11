'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Board } from '@/types';
import type { Action } from '../actions';
import type { BoardState } from '../types';
import {
  actionToPatch,
  isLocalOnlyAction,
  type BoardPatchPayload,
} from '../patch/ops';
import {
  enqueue as outboxEnqueue,
  dequeue as outboxDequeue,
  listAll as outboxListAll,
  newEntryId,
  type OutboxEntry,
} from '../patch/outbox';
import {
  submitEntry,
  beaconSubmit,
  backoffDelay,
  type PatchResult,
} from '../patch/client';
import {
  MAX_BACKUP_AGE_MS,
  SYNC_CHANNEL,
  DEFAULT_BG,
  DEFAULT_LOGIN_BG,
  buildSnapshot,
  readLocalBackup,
  writeLocalBackup,
  fetchRemoteSnapshot,
  createBoardApi,
  deleteBoardApi,
  reorderBoardsApi,
  saveAppearanceFieldApi,
  updateMyProfileApi,
  type WorkspaceSnapshot,
  type SyncIndicatorState,
} from './boardApi';

interface UseBoardSyncParams {
  state: BoardState;
  rawDispatch: React.Dispatch<Action>;
  reducer: (state: BoardState, action: Action) => BoardState;
  onRestoreSession: () => Promise<void>;
}

export function useBoardSync({
  state,
  rawDispatch,
  reducer,
  onRestoreSession,
}: UseBoardSyncParams) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncIndicatorState>({
    kind: 'idle',
    label: '已同步',
  });

  // ===== 仅保留 5 个核心同步 Ref（彻底砍掉 16 个历史冗余 Ref）=====
  /** 始终指向最新 state，供异步回调读取而不触发 Effect 重建 */
  const stateRef = useRef<BoardState>(state);
  stateRef.current = state;

  /** 每个看板已确认的云端版本号（Single Source of Truth） */
  const versionsRef = useRef<Map<string, number>>(new Map());
  /** 每个看板正在排队或请求中的在途操作数（>0 时严禁远端旧数据覆盖该看板） */
  const inflightCountRef = useRef<Map<string, number>>(new Map());
  /** 每个看板的串行提交 Promise 链（确保同一看板按序提交、baseVersion 单调递增） */
  const boardQueuesRef = useRef<Map<string, Promise<void>>>(new Map());
  /** 防止并发 refetch 竞态的互斥锁 */
  const refetchingRef = useRef<boolean>(false);

  const bcRef = useRef<BroadcastChannel | null>(null);

  const adjustInflight = useCallback((boardId: string, delta: number) => {
    const cur = inflightCountRef.current.get(boardId) ?? 0;
    const next = Math.max(0, cur + delta);
    if (next === 0) {
      inflightCountRef.current.delete(boardId);
    } else {
      inflightCountRef.current.set(boardId, next);
    }
  }, []);

  const hasBoardInflight = useCallback((boardId: string): boolean => {
    return (inflightCountRef.current.get(boardId) ?? 0) > 0;
  }, []);

  const hasAnyInflight = useCallback((): boolean => {
    for (const count of inflightCountRef.current.values()) {
      if (count > 0) return true;
    }
    return false;
  }, []);

  /** 带 20s 超时的单次 Patch 请求 */
  const sendWithTimeout = useCallback(async (entry: OutboxEntry): Promise<PatchResult> => {
    try {
      return await Promise.race([
        submitEntry(entry),
        new Promise<PatchResult>(resolve =>
          setTimeout(() => resolve({ ok: false, code: 'ERROR', message: 'timeout' }), 20000),
        ),
      ]);
    } catch (e: any) {
      return { ok: false, code: 'ERROR', message: e?.message || 'network error' };
    }
  }, []);

  /**
   * 从云端拉取最新快照，并按「唯一可信版本法则」合并到本地状态
   */
  const refetchFromServer = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!stateRef.current._loaded) return;
      const force = opts?.force === true;

      if (refetchingRef.current) {
        if (!force) return;
        for (let i = 0; i < 30 && refetchingRef.current; i++) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (refetchingRef.current) return;
      }

      refetchingRef.current = true;
      try {
        const curState = stateRef.current;
        const { snapshot: remote } = await fetchRemoteSnapshot(curState.users, curState);

        const localBoards = curState.boards || [];
        const localBoardMap = new Map<string, Board>(localBoards.map(b => [b.id, b]));
        const remoteBoardIds = new Set<string>();
        const mergedBoards: Board[] = [];
        let changed = false;

        for (const rb of remote.boards) {
          remoteBoardIds.add(rb.id);
          const lb = localBoardMap.get(rb.id);

          // 法则 1：该看板存在尚未确认落库的在途修改 → 无条件保留本地看板，绝不回滚
          if (lb && hasBoardInflight(rb.id)) {
            mergedBoards.push(lb);
            continue;
          }

          const localV = versionsRef.current.get(rb.id);
          const remoteV = typeof rb.version === 'number' ? rb.version : 0;

          // 法则 2：无在途修改时，以云端版本号为唯一真相源
          if (!lb || localV === undefined || remoteV !== localV || force) {
            versionsRef.current.set(rb.id, remoteV);
            mergedBoards.push(rb);
            if (!lb || localV !== remoteV) changed = true;
          } else {
            mergedBoards.push(lb);
          }
        }

        // 本地有但云端没有的看板：仅当该看板正在创建中（inflight > 0）时保留，否则说明已在云端删除
        for (const lb of localBoards) {
          if (!remoteBoardIds.has(lb.id)) {
            if (hasBoardInflight(lb.id)) {
              mergedBoards.push(lb);
            } else {
              changed = true;
            }
          }
        }

        if (
          !changed &&
          !force &&
          remote.users.length === curState.users.length &&
          remote.workspaceBackground === curState.workspaceBackground &&
          remote.loginBackground === curState.loginBackground &&
          remote.portalBackground === curState.portalBackground &&
          remote.crmBackground === curState.crmBackground &&
          remote.portalImageOpacity === curState.portalImageOpacity &&
          remote.crmImageOpacity === curState.crmImageOpacity &&
          remote.logo === curState.logo
        ) {
          return;
        }

        const mergedSnapshot: WorkspaceSnapshot = {
          ...remote,
          boards: mergedBoards,
        };

        writeLocalBackup(mergedSnapshot);
        rawDispatch({ type: 'APPLY_EXTERNAL_STATE', payload: mergedSnapshot });
      } catch (err) {
        console.warn('[sync] 远端同步拉取失败:', err);
      } finally {
        refetchingRef.current = false;
      }
    },
    [rawDispatch, hasBoardInflight],
  );

  /**
   * 串行消费单条 Patch Entry：
   * - 发送前总是读取 versionsRef 中该看板的最新版本号
   * - 遇到 VERSION_CONFLICT 原地更新版本号并立即重试（不释放 inflight 锁、不产生重复队列项）
   */
  const executePatchEntry = useCallback(
    async (initialEntry: OutboxEntry): Promise<void> => {
      const { boardId } = initialEntry;
      let currentEntry: OutboxEntry = {
        ...initialEntry,
        baseVersion: versionsRef.current.get(boardId) ?? initialEntry.baseVersion,
      };
      await outboxEnqueue(currentEntry);

      let conflictRetries = 0;
      let networkRetries = 0;

      while (true) {
        const result = await sendWithTimeout(currentEntry);

        if (result.ok) {
          versionsRef.current.set(boardId, result.version);
          await outboxDequeue(currentEntry.id);
          return;
        }

        if (result.code === 'VERSION_CONFLICT') {
          versionsRef.current.set(boardId, result.currentVersion);
          if (conflictRetries < 2) {
            conflictRetries += 1;
            currentEntry = {
              ...currentEntry,
              baseVersion: result.currentVersion,
              attempts: currentEntry.attempts + 1,
            };
            await outboxEnqueue(currentEntry);
            continue;
          }
          await outboxDequeue(currentEntry.id);
          void refetchFromServer({ force: true });
          return;
        }

        if (
          result.code === 'NOT_FOUND' ||
          result.code === 'BAD_PATCH' ||
          result.code === 'DESTRUCTIVE_WRITE_BLOCKED' ||
          result.code === 'DISABLED'
        ) {
          await outboxDequeue(currentEntry.id);
          if (result.code === 'DESTRUCTIVE_WRITE_BLOCKED') {
            setSaveError(
              `已阻止一次疑似批量清空：卡片数将从 ${result.before} 降为 ${result.after}。`,
            );
          }
          return;
        }

        if (result.code === 'UNAUTHORIZED') {
          setSyncState({ kind: 'error', label: '未保存：登录失效', detail: '请重新登录' });
          setSaveError('登录状态已失效，改动已暂存在本地，请重新登录后同步。');
          return;
        }

        if (result.code === 'ENDPOINT_MISSING') {
          setSyncState({ kind: 'error', label: '未保存：接口不可用', detail: result.message });
          setSaveError('保存接口不可用，请检查服务端部署状态。');
          return;
        }

        if (networkRetries < 2) {
          networkRetries += 1;
          currentEntry = { ...currentEntry, attempts: currentEntry.attempts + 1 };
          await outboxEnqueue(currentEntry);
          await new Promise(r => setTimeout(r, backoffDelay(networkRetries)));
          continue;
        }

        setSyncState({ kind: 'error', label: '未保存：网络异常', detail: '恢复连接后自动同步' });
        setSaveError('网络异常，改动已暂存本地，恢复连接后会自动重试。');
        return;
      }
    },
    [sendWithTimeout, refetchFromServer],
  );

  /**
   * 将看板增量修改入队：
   * 【关键】在同一同步调用栈内立即递增 inflightCountRef，消除任何异步空窗期！
   */
  const enqueueBoardPatch = useCallback(
    (boardId: string, payload: BoardPatchPayload) => {
      if (!boardId) return;
      const hasOps = Array.isArray(payload.ops) && payload.ops.length > 0;
      const hasMeta =
        payload.title !== undefined ||
        payload.background !== undefined ||
        payload.labels !== undefined ||
        payload.data !== undefined;
      if (!hasOps && !hasMeta) return;

      const baseVersion = versionsRef.current.get(boardId) ?? 0;
      const entry: OutboxEntry = {
        id: newEntryId(),
        boardId,
        baseVersion,
        payload: { ...payload, intent: 'user_edit' },
        createdAt: Date.now(),
        attempts: 0,
      };

      // 同步加锁：此刻起任何并发 refetch 都不得覆盖该看板
      adjustInflight(boardId, +1);
      setSyncState({ kind: 'pending', label: '保存中…', detail: '正在同步到云端' });

      const prevQueue = boardQueuesRef.current.get(boardId) ?? Promise.resolve();
      const nextQueue = prevQueue
        .then(
          () => executePatchEntry(entry),
          () => executePatchEntry(entry),
        )
        .finally(() => {
          adjustInflight(boardId, -1);
          if (!hasAnyInflight()) {
            const v = versionsRef.current.get(boardId);
            setSyncState(prev =>
              prev.kind === 'error'
                ? prev
                : { kind: 'idle', label: v !== undefined ? `已同步 v${v}` : '已同步' },
            );
          }
        });

      boardQueuesRef.current.set(boardId, nextQueue);
    },
    [adjustInflight, executePatchEntry, hasAnyInflight],
  );

  /** 重放 IndexedDB Outbox 中遗留的未提交项（启动 / 唤醒 / 登出前调用） */
  const drainOutbox = useCallback(async () => {
    try {
      const pending = await outboxListAll();
      if (pending.length === 0) return;
      for (const entry of pending) {
        if (hasBoardInflight(entry.boardId)) continue;
        adjustInflight(entry.boardId, +1);
        try {
          await executePatchEntry(entry);
        } finally {
          adjustInflight(entry.boardId, -1);
        }
      }
    } catch (e) {
      console.warn('[sync] 重放本地 Outbox 队列失败:', e);
    }
  }, [hasBoardInflight, adjustInflight, executePatchEntry]);

  // ===== 1. 初始化加载：拉取云端数据 -> 初始化版本基准 -> 重放未完成 Outbox =====
  useEffect(() => {
    let cancelled = false;
    async function loadInitialData() {
      const backup = readLocalBackup();
      try {
        const { snapshot: remote } = await fetchRemoteSnapshot(
          backup?.users || [],
          backup,
        );
        if (cancelled) return;

        const serverHasData = remote.boards.length > 0 || remote.users.length > 0;
        const backupAge = backup?.savedAt
          ? Date.now() - new Date(backup.savedAt).getTime()
          : Infinity;
        const useBackupFallback =
          !serverHasData &&
          Boolean(backup && backup.boards.length > 0 && backupAge < MAX_BACKUP_AGE_MS);

        const dataToUse: WorkspaceSnapshot = useBackupFallback && backup ? backup : remote;
        for (const b of dataToUse.boards) {
          if (typeof b.version === 'number') {
            versionsRef.current.set(b.id, b.version);
          }
        }

        rawDispatch({ type: 'LOAD_ALL_DATA', payload: dataToUse });
        writeLocalBackup(dataToUse);
        void onRestoreSession();
        void drainOutbox();
      } catch (err) {
        if (cancelled) return;
        console.warn('[sync] 初始加载失败，使用本地备份兜底:', err);
        const fallback: WorkspaceSnapshot =
          backup && backup.boards.length > 0
            ? {
                boards: backup.boards,
                users: backup.users || [],
                workspaceBackground: backup.workspaceBackground || DEFAULT_BG,
                loginBackground: backup.loginBackground || DEFAULT_LOGIN_BG,
                portalBackground: backup.portalBackground || DEFAULT_BG,
                crmBackground: backup.crmBackground || DEFAULT_BG,
                portalImageOpacity:
                  typeof backup.portalImageOpacity === 'number' ? backup.portalImageOpacity : 1,
                crmImageOpacity:
                  typeof backup.crmImageOpacity === 'number' ? backup.crmImageOpacity : 1,
                logo: backup.logo || '',
              }
            : {
                boards: [],
                users: [],
                workspaceBackground: DEFAULT_BG,
                loginBackground: DEFAULT_LOGIN_BG,
                portalBackground: DEFAULT_BG,
                crmBackground: DEFAULT_BG,
                portalImageOpacity: 1,
                crmImageOpacity: 1,
                logo: '',
              };

        for (const b of fallback.boards) {
          if (typeof b.version === 'number') {
            versionsRef.current.set(b.id, b.version);
          }
        }
        setSaveError(
          backup && backup.boards.length > 0
            ? '服务器连接失败，已加载本地离线备份'
            : '服务器连接失败，请检查网络后刷新页面',
        );
        rawDispatch({ type: 'LOAD_ALL_DATA', payload: fallback });
        void onRestoreSession();
      }
    }
    void loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [rawDispatch, onRestoreSession, drainOutbox]);

  // ===== 2. Realtime 订阅 + 移动端前后台唤醒重连 + 轮询兜底 =====
  useEffect(() => {
    if (typeof window === 'undefined' || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let channelStatus = '';

    const scheduleRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (hasAnyInflight()) {
          // 仍有在途提交时顺延，等本地 Patch 落库确认后再拉取
          scheduleRefetch();
          return;
        }
        void refetchFromServer();
      }, 600);
    };

    const createChannel = () =>
      supabase
        .channel('board-realtime-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, scheduleRefetch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, scheduleRefetch)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_settings' }, scheduleRefetch)
        .subscribe(status => {
          channelStatus = status;
        });

    let channel = createChannel();
    let lastResumeAt = 0;

    /**
     * 前后台唤醒 / 网络恢复：
     * 严格遵循「1. 按需重建频道 -> 2. 先排空本地未提交 Outbox -> 3. 再强制拉取云端最新」
     * 注意：不再监听 window.focus，彻底消除电脑端关闭弹窗/点窗口误触发强制覆盖！
     */
    const onResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastResumeAt < 800) return;
      lastResumeAt = now;

      if (channelStatus !== 'SUBSCRIBED') {
        try {
          supabase.removeChannel(channel);
        } catch {}
        channel = createChannel();
      }

      void (async () => {
        await drainOutbox();
        if (!hasAnyInflight()) {
          await refetchFromServer({ force: true });
        }
      })();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') onResume();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) onResume();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onResume);
    window.addEventListener('pageshow', onPageShow as any);

    const poll = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (hasAnyInflight()) return;
      void refetchFromServer();
    }, 15000);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onResume);
      window.removeEventListener('pageshow', onPageShow as any);
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [hasAnyInflight, refetchFromServer, drainOutbox]);

  // ===== 3. 跨标签页 BroadcastChannel 实时同步 =====
  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(SYNC_CHANNEL);
    bcRef.current = bc;
    bc.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || msg.kind !== 'full-snapshot' || !msg.data) return;
      if (hasAnyInflight()) return;
      writeLocalBackup(msg.data, msg.savedAt);
      rawDispatch({ type: 'APPLY_EXTERNAL_STATE', payload: msg.data });
    };
    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, [rawDispatch, hasAnyInflight]);

  // ===== 4. 状态变更时写入本地镜像 & 跨标签页广播 =====
  useEffect(() => {
    if (!state._loaded) return;
    const snap = buildSnapshot(stateRef.current);
    const savedAt = writeLocalBackup(snap);
    try {
      bcRef.current?.postMessage({ kind: 'full-snapshot', savedAt, data: snap });
    } catch {}
  }, [
    state.boards,
    state.users,
    state.workspaceBackground,
    state.loginBackground,
    state.portalBackground,
    state.crmBackground,
    state.portalImageOpacity,
    state.crmImageOpacity,
    state.logo,
    state._loaded,
  ]);

  // ===== 5. 页面关闭时 sendBeacon 兜底提交未完成 Outbox =====
  useEffect(() => {
    const onPageHide = () => {
      void (async () => {
        const pending = await outboxListAll();
        for (const entry of pending) {
          beaconSubmit(entry);
        }
      })();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // 错误横幅 8 秒自动消失
  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(null), 8000);
    return () => clearTimeout(timer);
  }, [saveError]);


  /**
   * 统一 Action 分发入口：
   * 本地乐观更新 -> 同步入队 / 调用对应服务端接口 -> 云端确认后推进 version
   */
  const dispatchWithSync = useCallback(
    (action: Action) => {
      const currentState = stateRef.current;

      // A. 新建看板
      if (action.type === 'CREATE_BOARD') {
        const nextState = reducer(currentState, action);
        const newBoardId = nextState.board?.id || nextState.currentBoardId || '';
        rawDispatch(action);
        if (newBoardId) {
          versionsRef.current.set(newBoardId, 0);
          adjustInflight(newBoardId, +1);
          setSyncState({ kind: 'pending', label: '正在创建看板…' });
          void (async () => {
            try {
              const res = await createBoardApi({
                id: newBoardId,
                title: action.payload.title,
                background: action.payload.background,
              });
              if (res.ok) {
                setSyncState({ kind: 'idle', label: '看板已创建', detail: newBoardId });
              } else {
                setSyncState({ kind: 'error', label: '看板未同步', detail: res.error });
              }
            } finally {
              adjustInflight(newBoardId, -1);
            }
          })();
        }
        return;
      }

      // B. 删除看板
      if (action.type === 'DELETE_BOARD') {
        const boardId = action.payload;
        rawDispatch(action);
        versionsRef.current.delete(boardId);
        setSyncState({ kind: 'pending', label: '正在删除…' });
        void (async () => {
          const res = await deleteBoardApi(boardId);
          if (res.ok) {
            setSyncState({ kind: 'idle', label: '已删除', detail: boardId });
          } else {
            setSyncState({ kind: 'error', label: '删除未同步', detail: res.error });
          }
        })();
        return;
      }

      // C. 看板排序
      if (action.type === 'REORDER_BOARDS' || action.type === 'SET_BOARDS_ORDER') {
        const nextState = reducer(currentState, action);
        rawDispatch(action);
        const orderedIds = nextState.boards.map(b => b.id).filter(Boolean);
        if (orderedIds.length > 0) {
          void reorderBoardsApi(orderedIds);
        }
        return;
      }

      // D. 工作区外观设置
      if (
        action.type === 'UPDATE_WORKSPACE_BG' ||
        action.type === 'UPDATE_LOGIN_BG' ||
        action.type === 'UPDATE_PORTAL_BG' ||
        action.type === 'UPDATE_CRM_BG' ||
        action.type === 'UPDATE_PORTAL_IMAGE_OPACITY' ||
        action.type === 'UPDATE_CRM_IMAGE_OPACITY' ||
        action.type === 'UPDATE_LOGO'
      ) {
        rawDispatch(action);
        const fieldMap: Record<string, string> = {
          UPDATE_WORKSPACE_BG: 'workspace_background',
          UPDATE_LOGIN_BG: 'login_background',
          UPDATE_PORTAL_BG: 'portal_background',
          UPDATE_CRM_BG: 'crm_background',
          UPDATE_PORTAL_IMAGE_OPACITY: 'portal_image_opacity',
          UPDATE_CRM_IMAGE_OPACITY: 'crm_image_opacity',
          UPDATE_LOGO: 'logo',
        };
        const colName = fieldMap[action.type];
        if (colName) {
          void saveAppearanceFieldApi({ [colName]: action.payload });
        }
        return;
      }

      // E. 个人资料更新
      if (action.type === 'UPDATE_USER') {
        rawDispatch(action);
        void updateMyProfileApi(action.payload.userId, action.payload.updates);
        return;
      }

      // F. 纯本地 UI 动作
      if (isLocalOnlyAction(action)) {
        rawDispatch(action);
        return;
      }

      // G. 看板内容与元数据增量动作（Single Source of Truth 闭环）
      try {
        const nextState = reducer(currentState, action);
        const targetBoardId =
          (action.type === 'RENAME_BOARD' ||
          action.type === 'UPDATE_BOARD_DATA' ||
          action.type === 'SET_BOARD_EMOJI' ||
          action.type === 'SET_BOARD_ICON'
            ? action.payload.boardId
            : '') ||
          nextState.board?.id ||
          currentState.board?.id;

        const boardBefore =
          currentState.boards.find(b => b.id === targetBoardId) || currentState.board;
        const boardAfter =
          nextState.boards.find(b => b.id === targetBoardId) || nextState.board;

        if (boardAfter && boardAfter.id) {
          const payload = actionToPatch(action, boardAfter, boardBefore);
          if (payload) {
            // 同步入队并锁定 inflightCount，随后立即派发本地乐观更新
            enqueueBoardPatch(boardAfter.id, payload);
          }
        }
      } catch (err) {
        console.warn('[sync] 生成增量 Patch 异常:', err);
      }

      rawDispatch(action);
    },
    [rawDispatch, reducer, adjustInflight, enqueueBoardPatch],
  );

  return {
    dispatchWithSync,
    drainOutbox,
    saveError,
    setSaveError,
    syncState,
  };
}
