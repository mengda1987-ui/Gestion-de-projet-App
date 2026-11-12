'use client';

import React, { createContext, useContext, useReducer, useCallback, useEffect, useState } from 'react';
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
import { normalizeAction } from './normalizeAction';

interface BoardContextType {
  state: BoardState;
  dispatch: React.Dispatch<Action>;
  broadcastChange: (action: Action) => void;
  saveError: string | null;
  /** 登出：清除服务端会话 Cookie 并重置本地登录态 */
  logout: () => Promise<void>;
}

type Commands = Omit<BoardContextType, 'state'>;
const BoardStateContext = createContext<BoardState | undefined>(undefined);
const BoardCommandsContext = createContext<Commands | undefined>(undefined);
type Content = Pick<BoardState, 'board' | 'users' | 'currentUser'>;
const BoardContentContext = createContext<Content | undefined>(undefined);

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
  if (!skipSync && state.currentUser?.role === 'admin') newState = syncMindMapCards(state, newState, action);
  if (newState.board !== state.board && action.type !== 'SET_BOARDS_ORDER' && action.type !== 'REORDER_BOARDS') {
    newState = syncBoardInList(newState);
  }
  return newState;
}

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(boardReducer, null, createInitialState);
  const [syncNoticeDismissed, setSyncNoticeDismissed] = useState(false);

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
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
      if (!response.ok && response.status !== 401) throw new Error('Logout failed');
    } catch (e) {
      console.warn('[logout] 服务端登出失败:', e);
      setSaveError('退出失败，请检查网络后重试。');
      return;
    }
    dispatchWithSync(normalizeAction({ type: 'SET_CURRENT_USER', payload: null }));
  }, [drainOutbox, dispatchWithSync, setSaveError]);

  const contextValue = React.useMemo(
    () => ({
      dispatch: dispatchWithSync,
      broadcastChange,
      saveError,
      logout,
    }),
    [dispatchWithSync, broadcastChange, saveError, logout],
  );
  const contentValue = React.useMemo(() => ({ board: state.board, users: state.users, currentUser: state.currentUser }), [state.board, state.users, state.currentUser]);

  useEffect(() => {
    setSyncNoticeDismissed(false);
  }, [saveError, syncState.kind, syncState.label, syncState.detail]);

  return (
    <BoardCommandsContext.Provider value={contextValue}><BoardStateContext.Provider value={state}><BoardContentContext.Provider value={contentValue}>
      {children}
      {(saveError || (state._loaded && syncState.kind !== 'idle')) && !syncNoticeDismissed &&
        createPortal(
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[2147483647] w-max max-w-[min(92vw,42rem)] pointer-events-none">
            <div
              role={saveError || syncState.kind === 'error' ? 'alert' : 'status'}
              className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-900/95 px-4 py-3 text-sm font-medium text-white shadow-xl animate-slide-up pointer-events-auto"
            >
              <span className="min-w-0 flex-1 break-words">
                <span className="block">{saveError || syncState.label}</span>
                {saveError && syncState.kind !== 'idle' && (
                  <span className="mt-1 block text-xs font-normal text-slate-300">{syncState.label}</span>
                )}
                {syncState.detail && (
                  <span className="mt-1 block text-xs font-normal text-slate-300">{syncState.detail}</span>
                )}
              </span>
              <button
                type="button"
                aria-label="关闭同步提示"
                onClick={() => setSyncNoticeDismissed(true)}
                className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                ✕
              </button>
            </div>
          </div>,
          document.body,
        )}
    </BoardContentContext.Provider></BoardStateContext.Provider></BoardCommandsContext.Provider>
  );
}

export function useBoardState() {
  const state = useContext(BoardStateContext);
  if (!state) throw new Error('BoardProvider missing');
  return state;
}
function useCommands() {
  const commands = useContext(BoardCommandsContext);
  if (!commands) throw new Error('BoardProvider missing');
  return commands;
}
function useBoardContext() { return { state: useBoardState(), ...useCommands() }; }
export function useBoardContent() {
  const content = useContext(BoardContentContext);
  if (!content) throw new Error('BoardProvider missing');
  return { ...content, ...useCommands() };
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
