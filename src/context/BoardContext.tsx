'use client';
import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoardState, createInitialState } from './types';
import { Action } from './actions';
import { settingsReducer } from './reducers/settingsReducer';
import { boardOpsReducer } from './reducers/boardOpsReducer';
import { columnOpsReducer } from './reducers/columnOpsReducer';
import { cardOpsReducer } from './reducers/cardOpsReducer';
import { checklistOpsReducer } from './reducers/checklistOpsReducer';
import { mindmapOpsReducer } from './reducers/mindmapOpsReducer';
import { syncMindMapCards } from './middlewares/mindmapSync';
import { syncBoardInList } from './middlewares/boardListSync';
import { supabase } from '@/lib/supabase';
import { MOCK_USERS, MOCK_BOARDS } from '@/data/mockData';
import type { User, Board } from '@/types';

const BACKUP_KEY = 'trello_local_backup_v1';
const SYNC_CHANNEL = 'trello-sync-channel';

interface BackupData {
  boards: Board[];
  users: User[];
  workspaceBackground: string;
  loginBackground: string;
  portalBackground: string;
  crmBackground: string;
  portalImageOpacity: number;
  crmImageOpacity: number;
  logo: string;
}

interface LocalBackup extends BackupData {
  savedAt: string;
  pending?: boolean; // 是否有尚未同步到服务器的本地改动
}

function readLocalBackup(): LocalBackup | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.boards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface BoardContextType {
  state: BoardState;
  dispatch: React.Dispatch<Action>;
  broadcastChange: (action: Action) => void;
  saveError: string | null;
}

const BoardContext = createContext<BoardContextType | undefined>(undefined);

function baseReducer(state: BoardState, action: Action): BoardState {
  let newState = state;
  
  newState = settingsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = boardOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = columnOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = cardOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = checklistOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = mindmapOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  return state;
}

function boardReducer(state: BoardState, action: Action): BoardState {
  const skipSync = (action as any)._skipSync === true;
  let newState = baseReducer(state, action);
  if (!skipSync) newState = syncMindMapCards(newState, action);
  // SET_BOARDS_ORDER 和 REORDER_BOARDS 不需要 boardListSync（会覆盖 order 值）
  if (action.type !== 'SET_BOARDS_ORDER' && action.type !== 'REORDER_BOARDS') {
    newState = syncBoardInList(newState);
  }
  return newState;
}

function buildBackup(state: BoardState): BackupData {
  return {
    boards: state.boards,
    users: state.users,
    workspaceBackground: state.workspaceBackground,
    loginBackground: state.loginBackground,
    portalBackground: state.portalBackground,
    crmBackground: state.crmBackground,
    portalImageOpacity: state.portalImageOpacity,
    crmImageOpacity: state.crmImageOpacity,
    logo: state.logo,
  };
}

// 将数据库行映射为 BackupData（与 loadData 中的映射保持一致）
function rowsToBackupData(usersData: any[], boardsData: any[], settingsData: any): BackupData {
  const users: User[] = (usersData || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email || '',
    avatar: u.avatar || '',
    color: u.color || '#3B82F6',
    role: u.role || 'member',
    password: u.password || '',
    lang: u.lang || 'zh',
  }));

  const boards: Board[] = (boardsData || []).map((b: any) => ({
    id: b.id,
    title: b.title,
    background: b.background || '#f5f5f7',
    labels: b.labels || [],
    columns: b.data?.columns || [],
    mindmap: b.data?.mindmap || [],
    emoji: b.emoji || undefined,
    iconBg: b.iconBg || undefined,
    iconImage: b.iconImage || undefined,
    visibleTo: b.visibleTo || [],
    order: b.order ?? 0,
    createdAt: b.created_at || new Date().toISOString(),
    updatedAt: b.updated_at || new Date().toISOString(),
  }));

  const wsSettings = settingsData || {};

  return {
    boards,
    users,
    workspaceBackground: wsSettings.workspace_background || '#f5f5f7',
    loginBackground: wsSettings.login_background || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
    portalBackground: wsSettings.portal_background || '#f5f5f7',
    crmBackground: wsSettings.crm_background || '#f5f5f7',
    portalImageOpacity: typeof wsSettings.portal_image_opacity === 'number' ? wsSettings.portal_image_opacity : 1,
    crmImageOpacity: typeof wsSettings.crm_image_opacity === 'number' ? wsSettings.crm_image_opacity : 1,
    logo: wsSettings.logo || '',
  };
}

// 用于实时同步比对的“稳定键”：剔除所有时间戳字段，避免保存时产生的微小时间差造成误判/回环
function stableKey(data: BackupData): string {
  return JSON.stringify(data, (key, value) =>
    (key === 'createdAt' || key === 'updatedAt') ? undefined : value
  );
}

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, null, createInitialState);
  const loadedRef = useRef(false);
  const boardsSnapshotRef = useRef<string>('');
  const usersSnapshotRef = useRef<string>('');
  const lastLocalContentRef = useRef<string>('');
  const stableContentRef = useRef<string>('');
  const latestSnapshotRef = useRef<BackupData | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveRef = useRef(false);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ===== 保存到 Supabase（串行队列，避免并发覆盖）=====
  const doSave = useCallback(async (data: BackupData) => {
    try {
      // 1. 删除已从本地移除的看板
      const prevBoards = boardsSnapshotRef.current ? JSON.parse(boardsSnapshotRef.current) : [];
      const currentBoardIds = new Set(data.boards.map(b => b.id));
      const deletedBoardIds = prevBoards
        .filter((b: any) => !currentBoardIds.has(b.id))
        .map((b: any) => b.id);

      if (deletedBoardIds.length > 0) {
        const { error } = await supabase.from('boards').delete().in('id', deletedBoardIds);
        if (error) throw error;
      }

      // 2. 删除已从本地移除的用户
      const prevUsers = usersSnapshotRef.current ? JSON.parse(usersSnapshotRef.current) : [];
      const currentUserIds = new Set(data.users.map(u => u.id));
      const deletedUserIds = prevUsers
        .filter((u: any) => !currentUserIds.has(u.id))
        .map((u: any) => u.id);

      if (deletedUserIds.length > 0) {
        const { error } = await supabase.from('users').delete().in('id', deletedUserIds);
        if (error) throw error;
      }

      // 3. 保存/更新看板
      const boardsToSave = data.boards.map(b => ({
        id: b.id,
        title: b.title,
        background: b.background,
        labels: b.labels,
        data: { columns: b.columns, mindmap: b.mindmap },
        emoji: b.emoji || null,
        iconBg: b.iconBg || null,
        iconImage: b.iconImage || null,
        visibleTo: b.visibleTo || [],
        order: b.order ?? 0,
        updated_at: new Date().toISOString(),
      }));

      const { error: boardsError } = await supabase.from('boards').upsert(boardsToSave);
      if (boardsError) throw boardsError;

      // 4. 保存/更新用户
      const usersToSave = data.users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        color: u.color,
        role: u.role,
        password: u.password,
        lang: u.lang,
      }));

      const { error: usersError } = await supabase.from('users').upsert(usersToSave);
      if (usersError) throw usersError;

      // 5. 保存工作区设置
      const { error: settingsError } = await supabase.from('workspace_settings').upsert({
        id: '00000000-0000-0000-0000-000000000001',
        workspace_background: data.workspaceBackground,
        login_background: data.loginBackground,
        portal_background: data.portalBackground,
        crm_background: data.crmBackground,
        portal_image_opacity: data.portalImageOpacity,
        crm_image_opacity: data.crmImageOpacity,
        logo: data.logo,
        updated_at: new Date().toISOString(),
      });

      if (settingsError) throw settingsError;

      // 保存成功后更新快照
      boardsSnapshotRef.current = JSON.stringify(data.boards);
      usersSnapshotRef.current = JSON.stringify(data.users);

      // 本次数据已成功同步到服务器，清除 pending 标记（仅当没有更新的改动排队时）
      if (JSON.stringify(data) === lastLocalContentRef.current) {
        pendingSaveRef.current = false;
        try {
          window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString(), pending: false }));
        } catch {}
      }

      setSaveError(null);
    } catch (err) {
      console.error('[Persistence] 数据保存失败:', err);
      setSaveError('数据保存失败，已暂存在本地备份。请检查网络后重试。');
    }
  }, []);

  const enqueueSave = useCallback((data: BackupData) => {
    saveQueueRef.current = saveQueueRef.current.then(() => doSave(data)).catch(() => {});
  }, [doSave]);

  // ===== 跨标签页广播 =====
  const broadcastSnapshot = useCallback((data: BackupData, savedAt: string) => {
    try {
      bcRef.current?.postMessage({ kind: 'full-snapshot', savedAt, data });
    } catch {}
  }, []);

  // ===== 从服务器重新拉取，并在内容变化时应用到 state（跨用户实时同步）=====
  const refetchFromServer = useCallback(async () => {
    if (!loadedRef.current) return;
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!url) return;

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
      );

      const [{ data: usersData }, { data: boardsData }] = await Promise.race([
        Promise.all([
          supabase.from('users').select('*'),
          supabase.from('boards').select('*'),
        ]),
        timeout.then(() => { throw new Error('timeout'); }),
      ]) as any;

      let settingsData: any = null;
      try {
        const { data } = await Promise.race([
          supabase.from('workspace_settings').select('*').limit(1).maybeSingle(),
          timeout.then(() => { throw new Error('timeout'); }),
        ]) as any;
        settingsData = data;
      } catch {}

      const data = rowsToBackupData(usersData, boardsData, settingsData);
      const stable = stableKey(data);
      if (stable === stableContentRef.current) return;
      // 本地还有尚未同步到服务器的改动时，暂不应用远端数据，避免覆盖本地刚改的内容
      if (pendingSaveRef.current) return;

      stableContentRef.current = stable;
      lastLocalContentRef.current = JSON.stringify(data);
      boardsSnapshotRef.current = JSON.stringify(data.boards);
      usersSnapshotRef.current = JSON.stringify(data.users);
      try {
        window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString(), pending: false }));
      } catch {}
      dispatch({ type: 'APPLY_EXTERNAL_STATE', payload: data });
    } catch (err) {
      console.warn('[Realtime] 重新拉取失败:', err);
    }
  }, [dispatch]);

  // ===== 初始化 BroadcastChannel（跨标签页实时同步）=====
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof BroadcastChannel === 'undefined') return;

    const bc = new BroadcastChannel(SYNC_CHANNEL);
    bcRef.current = bc;
    bc.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || msg.kind !== 'full-snapshot' || !msg.data) return;
      const content = JSON.stringify(msg.data);
      // 内容与本地一致则忽略，避免循环
      if (content === lastLocalContentRef.current) return;
      // 先落本地，再应用到 state（防止回环）
      lastLocalContentRef.current = content;
      stableContentRef.current = stableKey(msg.data);
      try {
        window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...msg.data, savedAt: msg.savedAt }));
      } catch {}
      dispatch({ type: 'APPLY_EXTERNAL_STATE', payload: msg.data });
    };

    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, []);

  // ===== 订阅 Supabase Realtime：他人保存后实时同步到本端 =====
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refetchFromServer(), 800);
    };

    const channel = supabase
      .channel('board-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_settings' }, scheduleRefetch)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [refetchFromServer]);

  // ===== 加载数据：本地备份与 Supabase 比较，取较新者，防止旧数据覆盖 =====
  useEffect(() => {
    async function loadData() {
      const backup = readLocalBackup();
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!url) throw new Error('No Supabase URL configured');

        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
        );

        const [{ data: usersData }, { data: boardsData }] = await Promise.race([
          Promise.all([
            supabase.from('users').select('*'),
            supabase.from('boards').select('*'),
          ]),
          timeout.then(() => { throw new Error('timeout'); }),
        ]) as any;

        let settingsData: any = null;
        try {
          const { data } = await Promise.race([
            supabase.from('workspace_settings').select('*').limit(1).maybeSingle(),
            timeout.then(() => { throw new Error('timeout'); }),
          ]) as any;
          settingsData = data;
        } catch {}

        const users: User[] = (usersData || []).map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email || '',
          avatar: u.avatar || '',
          color: u.color || '#3B82F6',
          role: u.role || 'member',
          password: u.password || '',
          lang: u.lang || 'zh',
        }));

        const boards: Board[] = (boardsData || []).map((b: any) => ({
          id: b.id,
          title: b.title,
          background: b.background || '#f5f5f7',
          labels: b.labels || [],
          columns: b.data?.columns || [],
          mindmap: b.data?.mindmap || [],
          emoji: b.emoji || undefined,
          iconBg: b.iconBg || undefined,
          iconImage: b.iconImage || undefined,
          visibleTo: b.visibleTo || [],
          order: b.order ?? 0,
          createdAt: b.created_at || new Date().toISOString(),
          updatedAt: b.updated_at || new Date().toISOString(),
        }));

        const wsSettings = settingsData || {};

        // 服务器是否已有数据（有看板或用户，说明不是首次运行/空库）
        const serverHasData = (boards?.length > 0) || (users?.length > 0);
        // 本地备份是否存在尚未同步到服务器的改动
        const hasPendingLocal = !!backup && backup.pending === true;
        // 采用本地备份的条件：有未同步改动；或服务器为空但本地有历史数据（恢复）
        const useLocal = hasPendingLocal || (!serverHasData && !!backup && (backup.boards?.length > 0));

        let dataToUse: BackupData;
        let savedAt: string;
        if (useLocal && backup) {
          dataToUse = {
            boards: backup.boards,
            users: backup.users || [],
            workspaceBackground: backup.workspaceBackground || '#f5f5f7',
            loginBackground: backup.loginBackground || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            portalBackground: backup.portalBackground || '#f5f5f7',
            crmBackground: backup.crmBackground || '#f5f5f7',
            portalImageOpacity: typeof backup.portalImageOpacity === 'number' ? backup.portalImageOpacity : 1,
            crmImageOpacity: typeof backup.crmImageOpacity === 'number' ? backup.crmImageOpacity : 1,
            logo: backup.logo || '',
          };
          savedAt = backup.savedAt;
        } else {
          dataToUse = {
            boards,
            users,
            workspaceBackground: wsSettings.workspace_background || '#f5f5f7',
            loginBackground: wsSettings.login_background || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            portalBackground: wsSettings.portal_background || '#f5f5f7',
            crmBackground: wsSettings.crm_background || '#f5f5f7',
            portalImageOpacity: typeof wsSettings.portal_image_opacity === 'number' ? wsSettings.portal_image_opacity : 1,
            crmImageOpacity: typeof wsSettings.crm_image_opacity === 'number' ? wsSettings.crm_image_opacity : 1,
            logo: wsSettings.logo || '',
          };
          savedAt = new Date().toISOString();
        }

        dispatch({ type: 'LOAD_ALL_DATA', payload: dataToUse });
        loadedRef.current = true;

        // 快照记录“服务器当前值”，用于删除判断
        boardsSnapshotRef.current = JSON.stringify(boards);
        usersSnapshotRef.current = JSON.stringify(users);

        // 避免首次持久化 effect 重复写回 / 广播
        lastLocalContentRef.current = JSON.stringify(dataToUse);
        stableContentRef.current = stableKey(dataToUse);
        latestSnapshotRef.current = dataToUse;

        // 始终将当前加载结果落本地，作为离线兜底镜像（pending 状态保持正确）
        try {
          window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...dataToUse, savedAt, pending: hasPendingLocal }));
        } catch {}

        if (useLocal && backup) {
          // 本地有未同步改动，或服务器为空需要恢复：补保存到服务器
          pendingSaveRef.current = true;
          enqueueSave(dataToUse);
        }
      } catch (err) {
        console.warn('Supabase load failed:', err);
        let dataToUse: BackupData;
        if (backup && backup.boards.length > 0) {
          dataToUse = {
            boards: backup.boards,
            users: backup.users || [],
            workspaceBackground: backup.workspaceBackground || '#f5f5f7',
            loginBackground: backup.loginBackground || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            portalBackground: backup.portalBackground || '#f5f5f7',
            crmBackground: backup.crmBackground || '#f5f5f7',
            portalImageOpacity: typeof backup.portalImageOpacity === 'number' ? backup.portalImageOpacity : 1,
            crmImageOpacity: typeof backup.crmImageOpacity === 'number' ? backup.crmImageOpacity : 1,
            logo: backup.logo || '',
          };
          setSaveError('服务器连接失败，已加载本地备份数据');
        } else {
          dataToUse = {
            boards: MOCK_BOARDS,
            users: MOCK_USERS,
            workspaceBackground: '#f5f5f7',
            loginBackground: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            portalBackground: '#f5f5f7',
            crmBackground: '#f5f5f7',
            portalImageOpacity: 1,
            crmImageOpacity: 1,
            logo: '',
          };
        }

        dispatch({ type: 'LOAD_ALL_DATA', payload: dataToUse });
        loadedRef.current = true;
        boardsSnapshotRef.current = JSON.stringify(dataToUse.boards);
        usersSnapshotRef.current = JSON.stringify(dataToUse.users);
        lastLocalContentRef.current = JSON.stringify(dataToUse);
        stableContentRef.current = stableKey(dataToUse);
        latestSnapshotRef.current = dataToUse;
      }
    }
    loadData();
  }, [dispatch, enqueueSave]);

  // ===== 持久化：内容变化时立即落本地 + 广播 + 串行保存 =====
  useEffect(() => {
    if (!state._loaded) return;

    const data = buildBackup(state);
    const content = JSON.stringify(data);
    if (content === lastLocalContentRef.current) return;

    lastLocalContentRef.current = content;
    stableContentRef.current = stableKey(data);
    latestSnapshotRef.current = data;
    const savedAt = new Date().toISOString();

    // 1. 本地兜底（标记为未同步，保存成功后再清除）
    pendingSaveRef.current = true;
    try {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...data, savedAt, pending: true }));
    } catch {}

    // 2. 广播给其他标签页
    broadcastSnapshot(data, savedAt);

    // 3. 串行保存到 Supabase
    enqueueSave(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    broadcastSnapshot,
    enqueueSave,
  ]);

  // ===== 关页面/切后台时强制 flush，防止数据滞留内存 =====
  useEffect(() => {
    const flush = () => {
      const data = latestSnapshotRef.current;
      if (data) enqueueSave(data);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [enqueueSave]);

  const broadcastChange = useCallback((action: Action) => {
    dispatch(action);
  }, [dispatch]);

  // 优化：useMemo 包裹 context value，避免不必要的重渲染
  const contextValue = React.useMemo(() => ({
    state,
    dispatch,
    broadcastChange,
    saveError
  }), [state, broadcastChange, saveError]);

  // 保存失败提示自动消失
  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(null), 8000);
    return () => clearTimeout(timer);
  }, [saveError]);

  return (
    <BoardContext.Provider value={contextValue}>
      {children}
      {saveError && createPortal(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100000] max-w-[90vw]">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-600 text-white text-sm font-medium shadow-xl animate-slide-up">
            <span>{saveError}</span>
            <button
              onClick={() => setSaveError(null)}
              className="shrink-0 px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-xs"
            >
              ✕
            </button>
          </div>
        </div>,
        document.body
      )}
    </BoardContext.Provider>
  );
}

export function useBoardContext() {
  const context = useContext(BoardContext);
  if (!context) throw new Error('useBoardContext must be used within BoardProvider');
  return context;
}

export function useBoard() {
  const { state, dispatch, broadcastChange, saveError } = useBoardContext();
  
  // 优化：缓存 findCard 函数，避免每次渲染重新创建
  const findCard = useCallback((cardId: string): { card: any; columnId: string } | undefined => {
    for (const col of state.board.columns) {
      const card = col.cards.find(c => c.id === cardId);
      if (card) return { card, columnId: col.id };
    }
    return undefined;
  }, [state.board.columns]);
  
  return {
    users: state.users,
    boards: state.boards,
    board: state.board,
    currentBoardId: state.currentBoardId,
    currentUser: state.currentUser,
    viewMode: state.viewMode,
    filters: state.filters,
    darkMode: state.darkMode,
    onlineUsers: state.onlineUsers,
    workspaceBackground: state.workspaceBackground,
    loginBackground: state.loginBackground,
    portalBackground: state.portalBackground,
    crmBackground: state.crmBackground,
    portalImageOpacity: state.portalImageOpacity,
    crmImageOpacity: state.crmImageOpacity,
    logo: state.logo,
    boardLabels: state.boardLabels,
    appSection: state.appSection,
    _loaded: state._loaded,
    dispatch,
    broadcastChange,
    saveError,
    findCard,
  };
}

export function useBoardState() {
  return useBoardContext().state;
}

export function useBoardDispatch() {
  return useBoardContext().dispatch;
}

export function useBroadcastChange() {
  return useBoardContext().broadcastChange;
}
