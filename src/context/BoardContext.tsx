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
  newState = syncBoardInList(newState);
  return newState;
}

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, null, createInitialState);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const channel = new BroadcastChannel('trello-board-sync');
    channelRef.current = channel;
    
    channel.onmessage = (e: MessageEvent<Action>) => {
      if (e.data && typeof e.data === 'object' && 'type' in e.data) {
        dispatch({ ...(e.data as any), _skipSync: true });
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  const broadcastChange = useCallback((action: Action) => {
    dispatch(action);
    if (channelRef.current && typeof window !== 'undefined') {
      try {
        channelRef.current.postMessage(action);
      } catch (err) {
        console.warn('BroadcastChannel postMessage failed:', err);
      }
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
