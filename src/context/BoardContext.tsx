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
  const [syncNoticeExpanded, setSyncNoticeExpanded] = useState(false);

  const {
    dispatchWithSync,
    drainOutbox,
    discardRejectedQueueAndRestore,
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
      {typeof document !== 'undefined' && state.appSection !== 'crm' && (saveError || (state._loaded && syncState.kind !== 'idle')) && (!syncNoticeDismissed || syncState.permanent) &&
        createPortal(
          <div data-sync-notice className="pointer-events-none fixed bottom-4 left-4 z-[9999] max-w-[calc(100vw-2rem)]">
            <div className="pointer-events-auto max-w-xs" onMouseEnter={() => setSyncNoticeExpanded(true)} onMouseLeave={() => setSyncNoticeExpanded(false)}>
              <button
                type="button"
                aria-expanded={syncNoticeExpanded}
                onClick={() => setSyncNoticeExpanded(true)}
                className="max-w-xs truncate rounded-lg border border-slate-700/60 bg-slate-900/80 px-3 py-1.5 text-left text-xs text-slate-200 shadow-md backdrop-blur-md"
              >
                {syncState.permanent
                  ? `未同步 (${syncState.code || 'BAD_REQUEST'}) · 点击查看或清理`
                  : syncState.kind === 'pending' ? '正在同步… · 点击查看' : '同步未完成 · 点击查看'}
              </button>
              {syncNoticeExpanded && (
                <div className="pt-2">
                <div role={syncState.kind === 'error' ? 'alert' : 'status'} aria-atomic="true" className="max-h-64 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 p-3 text-xs leading-5 text-slate-200 shadow-xl backdrop-blur-md">
                  {saveError && <p className="font-medium text-white">{saveError}</p>}
                  <p className={saveError ? 'mt-1' : ''}>{syncState.label}</p>
                  {syncState.detail && <p className="mt-1 break-words text-slate-300">{syncState.detail}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {syncState.permanent && (
                      <button type="button" onClick={() => void discardRejectedQueueAndRestore()} className="rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-1 font-medium text-amber-200 hover:bg-amber-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
                        丢弃损坏队列并从云端恢复
                      </button>
                    )}
                    <button type="button" aria-label="关闭同步提示" onClick={() => { setSyncNoticeExpanded(false); setSyncNoticeDismissed(true); }} className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">关闭</button>
                  </div>
                </div>
                </div>
              )}
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
