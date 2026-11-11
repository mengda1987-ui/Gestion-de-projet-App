'use client';

import React, { createContext, useContext, useReducer, useCallback } from 'react';
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
import { useBoardSync } from './sync/useBoardSync';

interface BoardContextType {
  state: BoardState;
  dispatch: React.Dispatch<Action>;
  broadcastChange: (action: Action) => void;
  saveError: string | null;
  /** 登出：清除服务端会话 Cookie 并重置本地登录态 */
  logout: () => Promise<void>;
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

export function boardReducer(state: BoardState, action: Action): BoardState {
  const skipSync = (action as any)._skipSync === true;
  let newState = baseReducer(state, action);
  if (!skipSync) newState = syncMindMapCards(newState, action);
  if (action.type !== 'SET_BOARDS_ORDER' && action.type !== 'REORDER_BOARDS') {
    newState = syncBoardInList(newState);
  }
  return newState;
}

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(boardReducer, null, createInitialState);

  const restoreSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return;
      const body = await res.json();
      const me = body?.user;
      if (!me) return;
      rawDispatch({ type: 'SET_CURRENT_USER', payload: me });
      if (me.lang === 'zh' || me.lang === 'en') {
        try {
          window.localStorage.setItem('trello-clone.lang', me.lang);
        } catch {}
      }
    } catch (e) {
      console.warn('[auth] 会话恢复失败:', e);
    }
  }, []);

  const {
    dispatchWithSync,
    drainOutbox,
    saveError,
    setSaveError,
    syncState,
  } = useBoardSync({
    state,
    rawDispatch,
    reducer: boardReducer,
    onRestoreSession: restoreSession,
  });

  const broadcastChange = useCallback(
    (action: Action) => {
      dispatchWithSync(action);
    },
    [dispatchWithSync],
  );

  const logout = useCallback(async () => {
    await drainOutbox();
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {
      console.warn('[logout] 服务端登出失败:', e);
    }
    dispatchWithSync({ type: 'SET_CURRENT_USER', payload: null });
  }, [drainOutbox, dispatchWithSync]);

  const contextValue = React.useMemo(
    () => ({
      state,
      dispatch: dispatchWithSync,
      broadcastChange,
      saveError,
      logout,
    }),
    [state, dispatchWithSync, broadcastChange, saveError, logout],
  );

  return (
    <BoardContext.Provider value={contextValue}>
      {children}
      {saveError &&
        createPortal(
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
          document.body,
        )}

      {state._loaded &&
        syncState.kind !== 'idle' &&
        createPortal(
          <div
            className="fixed bottom-3 left-4 z-[99998] select-none"
            title={syncState.detail}
          >
            <div
              className={
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium shadow-md backdrop-blur ' +
                (syncState.kind === 'error'
                  ? 'bg-red-600/95 text-white cursor-help'
                  : 'bg-amber-500/95 text-white')
              }
            >
              <span
                className={
                  'w-1.5 h-1.5 rounded-full bg-white ' +
                  (syncState.kind === 'pending' ? 'animate-pulse' : '')
                }
              />
              {syncState.label}
            </div>
          </div>,
          document.body,
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
  const { state, dispatch, broadcastChange, saveError, logout } = useBoardContext();

  const findCard = useCallback(
    (cardId: string): { card: any; columnId: string } | undefined => {
      for (const col of state.board.columns) {
        const card = col.cards.find(c => c.id === cardId);
        if (card) return { card, columnId: col.id };
      }
      return undefined;
    },
    [state.board.columns],
  );

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
    logout,
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
