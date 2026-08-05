import { Board, Label, ViewMode, FilterState, User } from '@/types';

export interface BoardState {
  boards: Board[];
  currentBoardId: string;
  board: Board;
  users: User[];
  currentUser: User | null;
  viewMode: ViewMode;
  filters: FilterState;
  darkMode: boolean;
  onlineUsers: string[];
  workspaceBackground: string;
  loginBackground: string;
  logo: string;
  boardLabels: Label[];
  _loaded?: boolean;
}

export function createInitialState(): BoardState {
  return {
    boards: [],
    currentBoardId: '',
    board: {
      id: '',
      title: '',
      background: '#f5f5f7',
      columns: [],
      labels: [],
      mindmap: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    users: [],
    currentUser: null,
    viewMode: 'board',
    filters: {
      search: '',
      labels: [],
      assignees: [],
      showArchived: false,
    },
    darkMode: false,
    onlineUsers: [],
    workspaceBackground: '#f5f5f7',
    loginBackground: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
    logo: '',
    boardLabels: [],
  };
}
