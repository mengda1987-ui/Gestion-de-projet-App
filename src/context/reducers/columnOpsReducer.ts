import { BoardState } from '../types';
import { Action } from '../actions';
import { Column } from '@/types';
import { actionClock } from '../normalizeAction';

export function columnOpsReducer(state: BoardState, action: Action): BoardState {
  const { now, generateId } = actionClock(action, 4);
  switch (action.type) {
    case 'REORDER_COLUMNS': {
      const columns = [...state.board.columns];
      const from = Math.max(0, Math.min(action.payload.fromIndex, columns.length - 1));
      const to = Math.max(0, Math.min(action.payload.toIndex, columns.length - 1));
      if (from === to) return state;
      const [removed] = columns.splice(from, 1);
      if (!removed) return state;
      columns.splice(to, 0, removed);
      columns.forEach((col, i) => { columns[i] = { ...col, order: i }; });
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
    }

    case 'ADD_COLUMN': {
      const newColumn: Column = {
        id: action.payload.id || generateId(),
        title: action.payload.title,
        cards: [],
        order: 0,
        archived: false,
      };
      // 新列表插入到最前面，并重新编号 order
      const columns = [newColumn, ...state.board.columns].map((c, i) => ({ ...c, order: i }));
      return {
        ...state,
        board: { ...state.board, columns, updatedAt: now },
      };
    }


    case 'UPDATE_COLUMN': {
      const columns = state.board.columns.map(c =>
        c.id === action.payload.columnId ? { ...c, ...action.payload.updates } : c
      );
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
    }

    case 'DELETE_COLUMN': {
      const columns = state.board.columns.filter(c => c.id !== action.payload.columnId);
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
    }

    case 'ARCHIVE_COLUMN': {
      const columns = state.board.columns.map(c =>
        c.id === action.payload.columnId ? { ...c, archived: !c.archived } : c
      );
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
    }

    default:
      return state;
  }
}
