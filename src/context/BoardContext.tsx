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

function readLocalBackup(): { boards: Board[]; workspaceBackground: string; loginBackground: string; logo: string; savedAt: string } | null {
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

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, null, createInitialState);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const loadedRef = useRef(false);
  const boardsSnapshotRef = useRef<string>('');
  const settingsSnapshotRef = useRef<string>('');
  const saveVersionRef = useRef(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 从 Supabase 加载数据，带超时保护，失败则使用 Mock 数据
  useEffect(() => {
    async function loadData() {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!url) throw new Error('No Supabase URL configured');

        // 设置 8 秒超时，避免在慢网络下卡太久
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
          password: '', // 不再从数据库加载密码
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
        dispatch({
          type: 'LOAD_ALL_DATA',
          payload: {
            users: users.length > 0 ? users : MOCK_USERS,
            boards: boards.length > 0 ? boards : MOCK_BOARDS,
            workspaceBackground: wsSettings.workspace_background || '#f5f5f7',
            loginBackground: wsSettings.login_background || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            logo: wsSettings.logo || '',
          },
        });
        loadedRef.current = true;
        boardsSnapshotRef.current = JSON.stringify(boards);
        settingsSnapshotRef.current = JSON.stringify({ bg: wsSettings.workspace_background, login: wsSettings.login_background, logo: wsSettings.logo });
      } catch (err) {
        console.warn('Supabase load failed:', err);
        const backup = readLocalBackup();
        if (backup && backup.boards.length > 0) {
          dispatch({
            type: 'LOAD_ALL_DATA',
            payload: {
              users: MOCK_USERS,
              boards: backup.boards,
              workspaceBackground: backup.workspaceBackground || '#f5f5f7',
              loginBackground: backup.loginBackground || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
              logo: backup.logo || '',
            },
          });
          loadedRef.current = true;
          boardsSnapshotRef.current = JSON.stringify(backup.boards);
          settingsSnapshotRef.current = JSON.stringify({ bg: backup.workspaceBackground || '#f5f5f7', login: backup.loginBackground || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)', logo: backup.logo || '' });
          setSaveError('服务器连接失败，已加载本地备份数据');
        } else {
          dispatch({
            type: 'LOAD_ALL_DATA',
            payload: {
              users: MOCK_USERS,
              boards: MOCK_BOARDS,
              workspaceBackground: '#f5f5f7',
              loginBackground: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
              logo: '',
            },
          });
          loadedRef.current = true;
          boardsSnapshotRef.current = JSON.stringify(MOCK_BOARDS);
          settingsSnapshotRef.current = JSON.stringify({ bg: '#f5f5f7', login: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)', logo: '' });
        }
      }
    }
    loadData();
  }, [dispatch]);

  // Supabase Realtime 多人实时协作
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const channel = supabase.channel('trello-realtime-sync', {
      config: {
        broadcast: { self: false },
      },
    });

    channel
      .on('broadcast', { event: 'action' }, ({ payload }: { payload: Action }) => {
        if (payload && typeof payload === 'object' && 'type' in payload) {
          dispatch({ ...(payload as any), _skipSync: true });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] 实时协作通道已连接');
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, []);

  // 数据持久化：快照对比，仅当看板/设置数据变化时才保存（初始加载不触发）
  useEffect(() => {
    if (!state._loaded) return;

    // 本地留底：每次数据变化立即写入 localStorage，防止保存失败导致内容丢失
    try {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify({
        boards: state.boards,
        workspaceBackground: state.workspaceBackground,
        loginBackground: state.loginBackground,
        logo: state.logo,
        savedAt: new Date().toISOString(),
      }));
    } catch {}

    const currentBoardsJSON = JSON.stringify(state.boards);
    const currentSettingsJSON = JSON.stringify({
      bg: state.workspaceBackground,
      login: state.loginBackground,
      logo: state.logo,
    });

    // 与上次保存时的快照一致 → 无需保存
    if (currentBoardsJSON === boardsSnapshotRef.current && currentSettingsJSON === settingsSnapshotRef.current) return;

    const version = ++saveVersionRef.current;

    const saveData = async () => {
      try {
        // 1. 保存看板数据
        const boardsToSave = state.boards.map(b => ({
          id: b.id,
          title: b.title,
          background: b.background,
          labels: b.labels,
          data: {
            columns: b.columns,
            mindmap: b.mindmap
          },
          emoji: b.emoji || null,
          iconBg: b.iconBg || null,
          iconImage: b.iconImage || null,
          visibleTo: b.visibleTo || [],
          order: b.order ?? 0,
          updated_at: new Date().toISOString()
        }));

        const { error: boardsError } = await supabase
          .from('boards')
          .upsert(boardsToSave);

        if (boardsError) throw boardsError;

        // 2. 保存工作区设置
        const { error: settingsError } = await supabase
          .from('workspace_settings')
          .upsert({
            id: '00000000-0000-0000-0000-000000000001',
            workspace_background: state.workspaceBackground,
            login_background: state.loginBackground,
            logo: state.logo,
            updated_at: new Date().toISOString()
          });

        if (settingsError) throw settingsError;

        // 保存成功且期间无新变更，更新快照
        if (saveVersionRef.current === version) {
          boardsSnapshotRef.current = currentBoardsJSON;
          settingsSnapshotRef.current = currentSettingsJSON;
        }

        setSaveError(null);
        console.log('[Persistence] 数据已成功保存至 Supabase');
      } catch (err) {
        console.error('[Persistence] 数据保存失败:', err);
        setSaveError('数据保存失败，已暂存在本地备份。请检查网络后重试。');
      }
    };

    // 500ms 防抖避免频繁请求
    const timer = setTimeout(saveData, 500);
    return () => clearTimeout(timer);
  }, [state.boards, state.workspaceBackground, state.loginBackground, state.logo, state._loaded]);

  const broadcastChange = useCallback((action: Action) => {
    dispatch(action);
    if (channelRef.current) {
      channelRef.current
        .send({ type: 'broadcast', event: 'action', payload: action })
        .then(() => {})
        .catch((err) => {
          console.warn('[Realtime] 广播失败:', err);
        });
    }
  }, []);

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
    logo: state.logo,
    boardLabels: state.boardLabels,
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
