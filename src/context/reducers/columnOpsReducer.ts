import { BoardState } from '../types';
import { Action } from '../actions';
import { Column } from '@/types';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function columnOpsReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'REORDER_COLUMNS': {
      const columns = [...state.board.columns];
      const from = Math.max(0, Math.min(action.payload.fromIndex, columns.length - 1));
      const to = Math.max(0, Math.min(action.payload.toIndex, columns.length - 1));
      if (from === to) return state;
      const [removed] = columns.splice(from, 1);
      columns.splice(to, 0, removed);
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ADD_COLUMN': {
      const newColumn: Column = {
        id: action.payload.id || generateId(),
        title: action.payload.title,
        cards: [],
        order: state.board.columns.length,
        archived: false,
      };
      return {
        ...state,
        board: { ...state.board, columns: [...state.board.columns, newColumn], updatedAt: new Date().toISOString() },
      };
    }

    case 'UPDATE_COLUMN': {
      const columns = state.board.columns.map(c =>
        c.id === action.payload.columnId ? { ...c, ...action.payload.updates } : c
      );
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'DELETE_COLUMN': {
      const columns = state.board.columns.filter(c => c.id !== action.payload.columnId);
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ARCHIVE_COLUMN': {
      const columns = state.board.columns.map(c =>
        c.id === action.payload.columnId ? { ...c, archived: !c.archived } : c
      );
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    default:
      return state;
  }
}
