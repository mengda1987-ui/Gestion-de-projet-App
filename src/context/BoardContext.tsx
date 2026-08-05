'use client';
import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef } from 'react';
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

interface BoardContextType {
  state: BoardState;
  dispatch: React.Dispatch<Action>;
  broadcastChange: (action: Action) => void;
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

  // 从 Supabase 加载数据，失败则使用 Mock 数据
  useEffect(() => {
    async function loadData() {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!url) throw new Error('No Supabase URL configured');

        const [{ data: usersData }, { data: boardsData }] = await Promise.all([
          supabase.from('users').select('*'),
          supabase.from('boards').select('*'),
        ]);

        let settingsData: any = null;
        try {
          const { data } = await supabase.from('workspace_settings').select('*').limit(1).maybeSingle();
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
      } catch (err) {
        console.warn('Supabase load failed, using mock data:', err);
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

  // 数据持久化：当状态变化时自动保存到 Supabase
  useEffect(() => {
    if (!state._loaded) return;

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
          order: b.order,
          updated_at: new Date().toISOString()
        }));

        // 使用 upsert 批量更新/插入看板
        const { error: boardsError } = await supabase
          .from('boards')
          .upsert(boardsToSave);

        if (boardsError) throw boardsError;

        // 2. 保存工作区设置
        const { error: settingsError } = await supabase
          .from('workspace_settings')
          .upsert({
            id: 1, // 假设只有一个工作区设置
            workspace_background: state.workspaceBackground,
            login_background: state.loginBackground,
            logo: state.logo,
            updated_at: new Date().toISOString()
          });

        if (settingsError) throw settingsError;

        console.log('[Persistence] 数据已成功保存至 Supabase');
      } catch (err) {
        console.error('[Persistence] 数据保存失败:', err);
      }
    };

    // 使用防抖避免频繁请求
    const timer = setTimeout(saveData, 2000);
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

  return (
    <BoardContext.Provider value={{ state, dispatch, broadcastChange }}>
      {children}
    </BoardContext.Provider>
  );
}

export function useBoardContext() {
  const context = useContext(BoardContext);
  if (!context) throw new Error('useBoardContext must be used within BoardProvider');
  return context;
}

export function useBoard() {
  const { state, dispatch, broadcastChange } = useBoardContext();
  const findCard = (cardId: string): { card: any; columnId: string } | undefined => {
    for (const col of state.board.columns) {
      const card = col.cards.find(c => c.id === cardId);
      if (card) return { card, columnId: col.id };
    }
    return undefined;
  };
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
