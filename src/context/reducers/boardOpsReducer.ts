import { BoardState, createInitialState } from '../types';
import { Action } from '../actions';
import { Board, Label } from '@/types';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function boardOpsReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'LOAD_ALL_DATA': {
      const { users, boards, workspaceBackground, loginBackground, logo } = action.payload;
      // Migrate old cards: completed boolean → status
      const migratedBoards = boards.map((b, idx) => ({
        ...b,
        order: b.order ?? idx,
        columns: b.columns.map(col => ({
          ...col,
          cards: col.cards.map(c => ({
            ...c,
            status: (c as any).status || ((c as any).completed ? 'complete' : 'todo'),
          })),
        })),
      }));
      const firstBoard = migratedBoards.length > 0 ? migratedBoards[0] : { ...createInitialState().board, id: '', title: '' };
      // Merge labels from all boards into global label set
      const labelMap = new Map<string, Label>();
      migratedBoards.forEach(b => b.labels?.forEach(l => labelMap.set(l.id, l)));
      const boardLabels = Array.from(labelMap.values());
      return {
        ...state,
        users,
        boards: migratedBoards,
        board: firstBoard,
        currentBoardId: '',
        workspaceBackground,
        loginBackground,
        logo,
        boardLabels,
        _loaded: true,
      };
    }

    case 'REORDER_BOARDS': {
      const { fromIndex, toIndex } = action.payload;
      const boards = [...state.boards];
      const [moved] = boards.splice(fromIndex, 1);
      boards.splice(toIndex, 0, moved);
      return { ...state, boards };
    }

    case 'SET_BOARDS_ORDER': {
      return { ...state, boards: action.payload };
    }

    case 'UPDATE_BOARD':
      return { ...state, board: { ...state.board, ...action.payload, updatedAt: new Date().toISOString() } };

    case 'CREATE_BOARD': {
      const maxOrder = state.boards.reduce((max, b) => Math.max(max, b.order ?? 0), -1);
      const newBoard: Board = {
        id: generateId(),
        title: action.payload.title,
        background: action.payload.background,
        columns: [],
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mindmap: [],
        order: maxOrder + 1,
      };
      return {
        ...state,
        boards: [...state.boards, newBoard],
        board: newBoard,
        currentBoardId: newBoard.id,
        viewMode: 'board',
      };
    }

    case 'SET_CURRENT_BOARD': {
      if (!action.payload) {
        return { ...state, currentBoardId: '' };
      }
      const board = state.boards.find(b => b.id === action.payload);
      if (!board) return state;
      return { ...state, board, currentBoardId: board.id, viewMode: 'board' };
    }

    case 'DELETE_BOARD': {
      const remaining = state.boards.filter(b => b.id !== action.payload);
      if (remaining.length === 0) return { ...state, currentBoardId: '' };
      return {
        ...state,
        boards: remaining,
        currentBoardId: state.currentBoardId === action.payload ? '' : state.currentBoardId,
        board: state.currentBoardId === action.payload ? remaining[0] : state.board,
        viewMode: 'board',
      };
    }

    case 'RENAME_BOARD': {
      const renamed = state.boards.map(b =>
        b.id === action.payload.boardId ? { ...b, title: action.payload.title, updatedAt: new Date().toISOString() } : b
      );
      return {
        ...state,
        boards: renamed,
        board: state.board.id === action.payload.boardId
          ? { ...state.board, title: action.payload.title, updatedAt: new Date().toISOString() }
          : state.board,
      };
    }

    case 'UPDATE_BOARD_DATA': {
      const updated = state.boards.map(b =>
        b.id === action.payload.boardId ? { ...b, ...action.payload.updates, updatedAt: new Date().toISOString() } : b
      );
      return {
        ...state,
        boards: updated,
        board: state.board.id === action.payload.boardId
          ? { ...state.board, ...action.payload.updates, updatedAt: new Date().toISOString() }
          : state.board,
      };
    }

    case 'SET_BOARD_EMOJI': {
      const updatedBoards = state.boards.map(b =>
        b.id === action.payload.boardId
          ? { ...b, emoji: action.payload.emoji, updatedAt: new Date().toISOString() }
          : b
      );
      return {
        ...state,
        boards: updatedBoards,
        board: state.board.id === action.payload.boardId
          ? { ...state.board, emoji: action.payload.emoji, updatedAt: new Date().toISOString() }
          : state.board,
      };
    }

    case 'SET_BOARD_ICON': {
      const { boardId, ...iconFields } = action.payload;
      const updatedBoards = state.boards.map(b =>
        b.id === boardId ? { ...b, ...iconFields, updatedAt: new Date().toISOString() } : b
      );
      return {
        ...state,
        boards: updatedBoards,
        board: state.board.id === boardId
          ? { ...state.board, ...iconFields, updatedAt: new Date().toISOString() }
          : state.board,
      };
    }

    default:
      return state;
  }
}
