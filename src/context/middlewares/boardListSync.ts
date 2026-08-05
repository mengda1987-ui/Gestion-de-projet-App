import { BoardState } from '../types';

export function syncBoardInList(state: BoardState): BoardState {
  const boards = state.boards.map(b => b.id === state.board.id ? state.board : b);
  return { ...state, boards };
}
