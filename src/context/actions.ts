import { Board, Card, Column, Label, ViewMode, FilterState, User, Comment, Attachment, MindMapNode } from '@/types';
import { BoardState } from './types';

export type Action =
  | { type: 'SET_CURRENT_USER'; payload: User | null }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_FILTERS'; payload: Partial<FilterState> }
  | { type: 'TOGGLE_DARK_MODE' }
  | { type: 'SET_DARK_MODE'; payload: boolean }
  | { type: 'UPDATE_BOARD'; payload: Partial<Board> }
  | { type: 'CREATE_BOARD'; payload: { title: string; background: string } }
  | { type: 'SET_CURRENT_BOARD'; payload: string }
  | { type: 'DELETE_BOARD'; payload: string }
  | { type: 'RENAME_BOARD'; payload: { boardId: string; title: string } }
  | { type: 'UPDATE_BOARD_DATA'; payload: { boardId: string; updates: Partial<Board> } }
  | { type: 'SET_BOARD_EMOJI'; payload: { boardId: string; emoji: string } }
  | { type: 'SET_BOARD_ICON'; payload: { boardId: string; emoji?: string; iconBg?: string; iconImage?: string } }
  | { type: 'REORDER_BOARDS'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'SET_BOARDS_ORDER'; payload: Board[] }
  | { type: 'REORDER_COLUMNS'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'ADD_COLUMN'; payload: { title: string; id?: string } }
  | { type: 'UPDATE_COLUMN'; payload: { columnId: string; updates: Partial<Column> } }
  | { type: 'DELETE_COLUMN'; payload: { columnId: string } }
  | { type: 'ARCHIVE_COLUMN'; payload: { columnId: string } }
  | { type: 'REORDER_CARDS'; payload: { columnId: string; fromIndex: number; toIndex: number } }
  | { type: 'MOVE_CARD'; payload: { fromColumnId: string; toColumnId: string; fromIndex: number; toIndex: number } }
  | { type: 'ADD_CARD'; payload: { columnId: string; card: Partial<Card> } }
  | { type: 'UPDATE_CARD'; payload: { cardId: string; updates: Partial<Card> } }
  | { type: 'DELETE_CARD'; payload: { cardId: string } }
  | { type: 'ARCHIVE_CARD'; payload: { cardId: string } }
  | { type: 'DUPLICATE_CARD'; payload: { cardId: string } }
  | { type: 'CYCLE_CARD_STATUS'; payload: { cardId: string } }
  | { type: 'ADD_LABEL'; payload: { label: Omit<Label, 'id'> } }
  | { type: 'UPDATE_LABEL'; payload: { labelId: string; updates: Partial<Label> } }
  | { type: 'DELETE_LABEL'; payload: { labelId: string } }
  | { type: 'TOGGLE_CARD_LABEL'; payload: { cardId: string; labelId: string } }
  | { type: 'TOGGLE_CARD_ASSIGNEE'; payload: { cardId: string; userId: string } }
  | { type: 'TOGGLE_CHECKLIST_ITEM'; payload: { cardId: string; checklistId: string; itemId: string } }
  | { type: 'UPDATE_CHECKLIST_ITEM'; payload: { cardId: string; checklistId: string; itemId: string; updates: Partial<import('@/types').ChecklistItem> } }
  | { type: 'ADD_CHECKLIST_ITEM'; payload: { cardId: string; checklistId: string; text: string; itemId?: string } }
  | { type: 'ADD_CHECKLIST'; payload: { cardId: string; name: string; id?: string } }
  | { type: 'DELETE_CHECKLIST'; payload: { cardId: string; checklistId: string } }
  | { type: 'DELETE_CHECKLIST_ITEM'; payload: { cardId: string; checklistId: string; itemId: string } }
  | { type: 'ADD_COMMENT'; payload: { cardId: string; text: string; userId: string } }
  | { type: 'ADD_ATTACHMENT'; payload: { cardId: string; attachment: Omit<Attachment, 'id' | 'uploadedAt'> } }
  | { type: 'DELETE_ATTACHMENT'; payload: { cardId: string; attachmentId: string } }
  | { type: 'SET_COVER_IMAGE'; payload: { cardId: string; url: string | null } }
  | { type: 'UPDATE_USER'; payload: { userId: string; updates: Partial<User> } }
  | { type: 'ADD_USER'; payload: { user: User } }
  | { type: 'DELETE_USER'; payload: { userId: string } }
  | { type: 'SET_ONLINE_USERS'; payload: string[] }
  | { type: 'IMPORT_AI_RESULT'; payload: { columns: { title: string; cards: { title: string; items: string[] }[] }[] } }
  | { type: 'ADD_MINDMAP_NODE'; payload: { node: Omit<MindMapNode, 'id' | 'createdAt' | 'updatedAt' | 'order'> & { order?: number } } }
  | { type: 'UPDATE_MINDMAP_NODE'; payload: { nodeId: string; updates: Partial<MindMapNode> } }
  | { type: 'DELETE_MINDMAP_NODE'; payload: { nodeId: string } }
  | { type: 'CONVERT_MINDMAP_TO_CARDS'; payload: { rootNodeId: string; mode: 'rootAsColumn' | 'rootAsCard' } }
  | { type: 'CLEAR_ALL_MM_POSITIONS' }
  | { type: 'APPLY_REMOTE_UPDATE'; payload: Partial<BoardState> }
  | { type: 'UPDATE_WORKSPACE_BG'; payload: string }
  | { type: 'UPDATE_LOGIN_BG'; payload: string }
  | { type: 'UPDATE_LOGO'; payload: string }
  | { type: 'LOAD_ALL_DATA'; payload: { users: User[]; boards: Board[]; workspaceBackground: string; loginBackground: string; logo: string } };
