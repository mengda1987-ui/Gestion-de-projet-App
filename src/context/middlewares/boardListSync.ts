import { BoardState } from '../types';
export function syncBoardInList(state: BoardState): BoardState {
  const i = state.boards.findIndex(b => b.id === state.board.id);
  if (i < 0 || state.boards[i] === state.board) return state;
  const boards = [...state.boards]; boards[i] = state.board;
  return { ...state, boards };
}
