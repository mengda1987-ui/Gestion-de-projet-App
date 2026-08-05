'use client';

import React, { createContext, useContext, useReducer, useEffect, useState, useCallback, useRef } from 'react';
import { Board, Card, Column, Label, ViewMode, FilterState, User, Comment, Attachment, MindMapNode, Checklist } from '@/types';
import { generateId } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { MOCK_BOARD, MOCK_BOARDS, MOCK_USERS } from '@/data/mockData';

interface BoardState {
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
  boardLabels: Label[]; // Global labels shared across all boards
  _loaded?: boolean;
}

type Action =
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
  | { type: 'SET_BOARD_EMOJI'; payload: { boardId: string; emoji: string } }
  | { type: 'SET_BOARD_ICON'; payload: { boardId: string; emoji?: string; iconBg?: string; iconImage?: string } }
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

function initialState(): BoardState {
  return {
    boards: MOCK_BOARDS,
    currentBoardId: '',
    board: MOCK_BOARD,
    users: MOCK_USERS,
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

function boardReducer(state: BoardState, action: Action): BoardState {
  const skipSync = (action as { _skipSync?: boolean })._skipSync === true;
  let newState = baseReducer(state, action);
  if (!skipSync) newState = syncMindMapCards(newState, action);
  newState = syncBoardInList(newState);
  return newState;
}

function syncBoardInList(state: BoardState): BoardState {
  if (state.boards.some(b => b.id === state.board.id)) {
    return {
      ...state,
      boards: state.boards.map(b => b.id === state.board.id ? state.board : b),
    };
  }
  return state;
}

function baseReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'SET_CURRENT_USER':
      return { ...state, currentUser: action.payload };

    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };

    case 'SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.payload } };

    case 'TOGGLE_DARK_MODE':
      return { ...state, darkMode: !state.darkMode };

    case 'SET_DARK_MODE':
      return { ...state, darkMode: action.payload };

    case 'UPDATE_WORKSPACE_BG':
      return { ...state, workspaceBackground: action.payload };

    case 'UPDATE_LOGIN_BG':
      return { ...state, loginBackground: action.payload };

    case 'UPDATE_LOGO':
      return { ...state, logo: action.payload };

    case 'LOAD_ALL_DATA': {
      const { users, boards, workspaceBackground, loginBackground, logo } = action.payload;
      // Migrate old cards: completed boolean → status
      const migratedBoards = boards.map(b => ({
        ...b,
        columns: b.columns.map(col => ({
          ...col,
          cards: col.cards.map(c => ({
            ...c,
            status: (c as any).status || ((c as any).completed ? 'complete' : 'todo'),
          })),
        })),
      }));
      const firstBoard = migratedBoards.length > 0 ? migratedBoards[0] : { ...initialState().board, id: '', title: '' };
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

    case 'UPDATE_BOARD':
      return { ...state, board: { ...state.board, ...action.payload, updatedAt: new Date().toISOString() } };

    case 'CREATE_BOARD': {
      const newBoard: Board = {
        id: generateId(),
        title: action.payload.title,
        background: action.payload.background,
        columns: [],
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mindmap: [],
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
        // Empty string = go back to workspace (deselect current board)
        return { ...state, currentBoardId: '' };
      }
      const board = state.boards.find(b => b.id === action.payload);
      if (!board) return state;
      return { ...state, board, currentBoardId: board.id, viewMode: 'board' };
    }

    case 'DELETE_BOARD': {
      const remaining = state.boards.filter(b => b.id !== action.payload);
      if (remaining.length === 0) return state;
      const nextBoard = remaining[0];
      return {
        ...state,
        boards: remaining,
        board: nextBoard,
        currentBoardId: nextBoard.id,
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

    case 'REORDER_CARDS': {
      const columns = state.board.columns.map(col => {
        if (col.id !== action.payload.columnId) return col;
        const cards = [...col.cards];
        const from = Math.max(0, Math.min(action.payload.fromIndex, cards.length - 1));
        const to = Math.max(0, Math.min(action.payload.toIndex, cards.length));
        if (from === to) return col;
        const [removed] = cards.splice(from, 1);
        cards.splice(to, 0, removed);
        return { ...col, cards: cards.map((c, i) => ({ ...c, order: i })) };
      });
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'MOVE_CARD': {
      const columns = state.board.columns.map(col => ({ ...col, cards: [...col.cards] }));
      const fromCol = columns.find(c => c.id === action.payload.fromColumnId);
      const toCol = columns.find(c => c.id === action.payload.toColumnId);
      if (!fromCol || !toCol) return state;
      const from = Math.max(0, Math.min(action.payload.fromIndex, fromCol.cards.length - 1));
      const to = Math.max(0, Math.min(action.payload.toIndex, toCol.cards.length));
      if (from < 0) return state;
      const [movedCard] = fromCol.cards.splice(from, 1);
      if (!movedCard) return state;
      toCol.cards.splice(to, 0, { ...movedCard, updatedAt: new Date().toISOString() });
      columns.forEach(col => {
        col.cards = col.cards.map((c, i) => ({ ...c, order: i }));
      });
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ADD_CARD': {
      const now = new Date().toISOString();
      const newCard: Card = {
        id: generateId(),
        title: action.payload.card.title || '新卡片',
        description: action.payload.card.description || '',
        coverImage: action.payload.card.coverImage,
        labels: action.payload.card.labels || [],
        assignees: action.payload.card.assignees || [],
        dueDate: action.payload.card.dueDate,
        startDate: action.payload.card.startDate,
        status: 'todo',
        archived: false,
        checklists: action.payload.card.checklists || [],
        comments: [],
        attachments: action.payload.card.attachments || [],
        createdAt: now,
        updatedAt: now,
        order: 0,
      };
      const columns = state.board.columns.map(col => {
        if (col.id !== action.payload.columnId) return col;
        return { ...col, cards: [...col.cards, { ...newCard, order: col.cards.length }] };
      });
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
    }

    case 'UPDATE_CARD': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c =>
          c.id === action.payload.cardId ? { ...c, ...action.payload.updates, updatedAt: new Date().toISOString() } : c
        ),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'DELETE_CARD': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.filter(c => c.id !== action.payload.cardId),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ARCHIVE_CARD': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c =>
          c.id === action.payload.cardId ? { ...c, archived: !c.archived, updatedAt: new Date().toISOString() } : c
        ),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'DUPLICATE_CARD': {
      let cardToDuplicate: Card | null = null;
      let sourceColumnId: string | null = null;
      state.board.columns.forEach(col => {
        col.cards.forEach(c => {
          if (c.id === action.payload.cardId) {
            cardToDuplicate = c;
            sourceColumnId = col.id;
          }
        });
      });
      if (!cardToDuplicate || !sourceColumnId) return state;
      const now = new Date().toISOString();
      const dup = cardToDuplicate as Card;
      const duplicated: Card = {
        ...dup,
        id: generateId(),
        title: `${dup.title} (副本)`,
        createdAt: now,
        updatedAt: now,
        comments: [],
        checklists: dup.checklists.map(cl => ({
          ...cl,
          id: generateId(),
          items: cl.items.map(item => ({ ...item, id: generateId() })),
        })),
        attachments: [],
      };
      const columns = state.board.columns.map(col => {
        if (col.id !== sourceColumnId) return col;
        return { ...col, cards: [...col.cards, { ...duplicated, order: col.cards.length }] };
      });
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
    }

    case 'CYCLE_CARD_STATUS': {
      const statusOrder: Card['status'][] = ['todo', 'in_progress', 'complete'];
      let currentStatus: Card['status'] = 'todo';
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id === action.payload.cardId) {
            currentStatus = c.status || 'todo';
            const nextIdx = (statusOrder.indexOf(currentStatus) + 1) % statusOrder.length;
            return { ...c, status: statusOrder[nextIdx], updatedAt: new Date().toISOString() };
          }
          return c;
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ADD_LABEL': {
      const newLabel: Label = { id: generateId(), ...action.payload.label };
      const boardLabels = [...state.boardLabels, newLabel];
      const boards = state.boards.map(b => ({ ...b, labels: boardLabels }));
      return {
        ...state,
        boardLabels,
        boards,
        board: { ...state.board, labels: boardLabels },
      };
    }

    case 'UPDATE_LABEL': {
      const boardLabels = state.boardLabels.map(l =>
        l.id === action.payload.labelId ? { ...l, ...action.payload.updates } : l
      );
      const boards = state.boards.map(b => ({ ...b, labels: boardLabels }));
      return {
        ...state,
        boardLabels,
        boards,
        board: { ...state.board, labels: boardLabels },
      };
    }

    case 'DELETE_LABEL': {
      const boardLabels = state.boardLabels.filter(l => l.id !== action.payload.labelId);
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => ({
          ...c,
          labels: c.labels.filter(lid => lid !== action.payload.labelId),
          updatedAt: new Date().toISOString(),
        })),
      }));
      const boards = state.boards.map(b => ({
        ...b,
        labels: boardLabels,
        columns: b.columns.map(col => ({
          ...col,
          cards: col.cards.map(c => ({
            ...c,
            labels: c.labels.filter(lid => lid !== action.payload.labelId),
            updatedAt: new Date().toISOString(),
          })),
        })),
      }));
      return {
        ...state,
        boardLabels,
        boards,
        board: { ...state.board, labels: boardLabels, columns, updatedAt: new Date().toISOString() },
      };
    }

    case 'TOGGLE_CARD_LABEL': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          const has = c.labels.includes(action.payload.labelId);
          return {
            ...c,
            labels: has ? c.labels.filter(l => l !== action.payload.labelId) : [...c.labels, action.payload.labelId],
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'TOGGLE_CARD_ASSIGNEE': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          const has = c.assignees.includes(action.payload.userId);
          return {
            ...c,
            assignees: has ? c.assignees.filter(u => u !== action.payload.userId) : [...c.assignees, action.payload.userId],
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'TOGGLE_CHECKLIST_ITEM': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            checklists: c.checklists.map(cl => {
              if (cl.id !== action.payload.checklistId) return cl;
              return {
                ...cl,
                items: cl.items.map(item =>
                  item.id === action.payload.itemId ? { ...item, completed: !item.completed } : item
                ),
              };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'UPDATE_CHECKLIST_ITEM': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            checklists: c.checklists.map(cl => {
              if (cl.id !== action.payload.checklistId) return cl;
              return {
                ...cl,
                items: cl.items.map(item =>
                  item.id === action.payload.itemId ? { ...item, ...action.payload.updates } : item
                ),
              };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ADD_CHECKLIST_ITEM': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            checklists: c.checklists.map(cl => {
              if (cl.id !== action.payload.checklistId) return cl;
              return {
                ...cl,
                items: [
                  ...cl.items,
                  { id: action.payload.itemId || generateId(), text: action.payload.text, completed: false },
                ],
              };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ADD_CHECKLIST': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            checklists: [
              ...c.checklists,
              { id: action.payload.id || generateId(), name: action.payload.name, items: [] },
            ],
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'DELETE_CHECKLIST': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            checklists: c.checklists.filter(cl => cl.id !== action.payload.checklistId),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ADD_ATTACHMENT': {
      const newAttachment: Attachment = {
        id: generateId(),
        ...action.payload.attachment,
        uploadedAt: new Date().toISOString(),
      };
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            attachments: [...c.attachments, newAttachment],
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'DELETE_ATTACHMENT': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            attachments: c.attachments.filter(a => a.id !== action.payload.attachmentId),
            coverImage: c.coverImage === c.attachments.find(a => a.id === action.payload.attachmentId)?.url ? undefined : c.coverImage,
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'SET_COVER_IMAGE': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            coverImage: action.payload.url || undefined,
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'ADD_COMMENT': {
      const newComment: Comment = {
        id: generateId(),
        userId: action.payload.userId,
        text: action.payload.text,
        createdAt: new Date().toISOString(),
      };
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            comments: [...c.comments, newComment],
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: new Date().toISOString() } };
    }

    case 'UPDATE_USER': {
      const users = state.users.map(u =>
        u.id === action.payload.userId ? { ...u, ...action.payload.updates } : u
      );
      const currentUser =
        state.currentUser && state.currentUser.id === action.payload.userId
          ? { ...state.currentUser, ...action.payload.updates }
          : state.currentUser;
      return { ...state, users, currentUser };
    }

    case 'ADD_USER':
      return { ...state, users: [...state.users, action.payload.user] };

    case 'DELETE_USER':
      return { ...state, users: state.users.filter(u => u.id !== action.payload.userId) };

    case 'SET_ONLINE_USERS':
      return { ...state, onlineUsers: action.payload };

    case 'ADD_MINDMAP_NODE': {
      const parentId = action.payload.node.parentId;
      const siblings = state.board.mindmap.filter(n => n.parentId === parentId);
      const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.order)) : -1;
      const now = new Date().toISOString();
      const node: MindMapNode = {
        id: generateId(),
        text: action.payload.node.text,
        description: action.payload.node.description,
        parentId,
        color: action.payload.node.color,
        collapsed: action.payload.node.collapsed,
        order: action.payload.node.order ?? (maxOrder + 1),
        createdAt: now,
        updatedAt: now,
      };
      return { ...state, board: { ...state.board, mindmap: [...state.board.mindmap, node], updatedAt: now } };
    }

    case 'UPDATE_MINDMAP_NODE': {
      const now = new Date().toISOString();
      const mindmap = state.board.mindmap.map(n =>
        n.id === action.payload.nodeId ? { ...n, ...action.payload.updates, updatedAt: now } : n
      );
      return { ...state, board: { ...state.board, mindmap, updatedAt: now } };
    }

    case 'DELETE_MINDMAP_NODE': {
      const idsToRemove = new Set<string>();
      const walk = (id: string) => {
        if (idsToRemove.has(id)) return;
        idsToRemove.add(id);
        state.board.mindmap.filter(n => n.parentId === id).forEach(c => walk(c.id));
      };
      walk(action.payload.nodeId);
      const mindmap = state.board.mindmap.filter(n => !idsToRemove.has(n.id));
      const now = new Date().toISOString();
      return { ...state, board: { ...state.board, mindmap, updatedAt: now } };
    }

    case 'CONVERT_MINDMAP_TO_CARDS': {
      const nodes = state.board.mindmap;
      const root = nodes.find(n => n.id === action.payload.rootNodeId);
      if (!root) return state;
      const now = new Date().toISOString();
      const childrenOf = (id: string) => nodes.filter(n => n.parentId === id).sort((a, b) => a.order - b.order);
      const newColumns: Column[] = [];
      const newCards: { card: Card; columnId: string }[] = [];

      const buildCardFromNode = (node: MindMapNode, depth: number, parentTitle?: string): Card => {
        const kids = childrenOf(node.id);
        const checklists = kids.length > 0 ? [
          {
            id: generateId(),
            name: '子任务（来自脑图）',
            items: kids.map(k => ({
              id: generateId(),
              text: k.text,
              completed: false,
              mmNodeId: k.id,
            })),
          },
        ] : [];
        const descendants = (() => {
          const all: string[] = [];
          const stack = [...kids];
          while (stack.length) {
            const cur = stack.pop()!;
            all.push(cur.text);
            stack.push(...childrenOf(cur.id));
          }
          return all;
        })();
        const desc = [
          `# ${node.text}`,
          '',
          node.description ? node.description + '\n' : '',
          depth > 0 && parentTitle ? `> 来自脑图父节点：${parentTitle}\n` : '',
          descendants.length > 0 ? `\n## 层级子节点总数：${descendants.length}\n` : '',
        ].filter(Boolean).join('\n');
        return {
          id: generateId(),
          title: node.text,
          description: desc,
          labels: [],
          assignees: [],
          status: 'todo',
          archived: false,
          checklists,
          comments: [],
          attachments: [],
          createdAt: now,
          updatedAt: now,
          order: 0,
          mmNodeId: node.id,
        };
      };

      const rootKids = childrenOf(root.id);

      if (action.payload.mode === 'rootAsColumn') {
        const columnId = generateId();
        const cardsFromFirstLevel = rootKids.map((k, i) => {
          const c = buildCardFromNode(k, 1, root.text);
          c.order = i;
          newCards.push({ card: c, columnId });
          return c;
        });
        if (cardsFromFirstLevel.length === 0) {
          const onlyCard = buildCardFromNode(root, 0);
          onlyCard.order = 0;
          newCards.push({ card: onlyCard, columnId });
        }
        newColumns.push({
          id: columnId,
          title: root.text,
          cards: newCards.filter(x => x.columnId === columnId).map(x => x.card),
          order: state.board.columns.length,
          archived: false,
          mmRootId: root.id,
        });
      } else {
        // rootAsCard
        const columnId = generateId();
        const rootCard = buildCardFromNode(root, 0);
        rootCard.order = 0;
        const subCards = rootKids.map((k, i) => {
          const c = buildCardFromNode(k, 1, root.text);
          c.order = i + 1;
          return c;
        });
        const allCardsForCol = [rootCard, ...subCards];
        newCards.push(...allCardsForCol.map(c => ({ card: c, columnId })));
        newColumns.push({
          id: columnId,
          title: `🧠 ${root.text}`,
          cards: allCardsForCol,
          order: state.board.columns.length,
          archived: false,
          mmRootId: root.id,
        });
      }

      const columns = [...state.board.columns, ...newColumns];
      return {
        ...state,
        board: { ...state.board, columns, updatedAt: now },
        viewMode: 'board',
      };
    }

    case 'CLEAR_ALL_MM_POSITIONS': {
      const now = new Date().toISOString();
      return {
        ...state,
        board: {
          ...state.board,
          columns: state.board.columns.map(col => {
            const { mmPosition: _c1, ...colRest } = col as any;
            return {
              ...colRest,
              cards: col.cards.map(card => {
                const { mmPosition: _c2, ...cardRest } = card as any;
                return {
                  ...cardRest,
                  checklists: card.checklists.map(cl => ({
                    ...cl,
                    items: cl.items.map(it => {
                      const { mmPosition: _i, ...itRest } = it as any;
                      return itRest;
                    }),
                  })),
                };
              }),
            };
          }),
          updatedAt: now,
        },
      };
    }

    case 'APPLY_REMOTE_UPDATE':
      return { ...state, ...action.payload };

    default:
      return state;
  }
}

function syncMindMapCards(state: BoardState, action: Action): BoardState {
  const now = new Date().toISOString();
  const next: BoardState = {
    ...state,
    board: { ...state.board, columns: state.board.columns.map(c => ({ ...c, cards: [...c.cards] })), mindmap: [...state.board.mindmap] },
  };
  const wrap = <T,>(arr: T[]) => [...arr];
  const childrenOf = (parentId: string | null) => state.board.mindmap.filter(n => n.parentId === parentId).sort((a,b)=>a.order-b.order);
  const nextChildrenOf = (parentId: string | null) => next.board.mindmap.filter(n => n.parentId === parentId).sort((a,b)=>a.order-b.order);

  const withSkip: <A>(act: A) => A & { _skipSync: true } = (act) => ({ ...(act as any), _skipSync: true } as any);

  switch (action.type) {
    case 'ADD_COLUMN': {
      // Auto-create mmRootId for new columns so downstream mindmap sync works
      const newColId = (action.payload as any).id;
      const col = next.board.columns.find(c => c.id === newColId);
      if (!col || col.mmRootId) return state;
      const rootNode: MindMapNode = {
        id: `mm-root-${col.id}`,
        text: col.title,
        parentId: null,
        color: '#6366F1',
        collapsed: false,
        order: next.board.mindmap.filter(n => n.parentId === null).length,
        createdAt: now,
        updatedAt: now,
      };
      next.board.mindmap = [...next.board.mindmap, rootNode];
      next.board.columns = next.board.columns.map(c => c.id !== col.id ? c : { ...c, mmRootId: rootNode.id } as any);
      next.board.updatedAt = now;
      return next;
    }

    case 'UPDATE_COLUMN': {
      const col = next.board.columns.find(c => c.id === action.payload.columnId);
      if (!col?.mmRootId) return state;
      if (action.payload.updates?.title !== undefined && col.title !== action.payload.updates.title) {
        next.board = {
          ...next.board,
          mindmap: next.board.mindmap.map(n => n.id === col.mmRootId ? { ...n, text: action.payload.updates.title!, updatedAt: now } : n),
          updatedAt: now,
        };
      }
      return next;
    }

    case 'ADD_CARD': {
      const col = next.board.columns.find(c => c.id === action.payload.columnId);
      if (!col?.mmRootId) return state;
      // 新卡片若没有 mmNodeId → 创建对应一级子节点（挂在根节点下）
      if (action.payload.card.mmNodeId) return state;
      const siblings = nextChildrenOf(col.mmRootId);
      const order = siblings.length > 0 ? Math.max(...siblings.map(s=>s.order)) + 1 : 0;
      const newNode: MindMapNode = {
        id: `mm-auto-${action.payload.card.id}`,
        text: action.payload.card.title || '',
        description: action.payload.card.description ? action.payload.card.description.slice(0, 200) : undefined,
        parentId: col.mmRootId,
        color: '#6366F1',
        collapsed: false,
        order,
        createdAt: now,
        updatedAt: now,
      };
      next.board.mindmap = [...next.board.mindmap, newNode];
      // 反向写回卡片的 mmNodeId
      next.board.columns = next.board.columns.map(c => c.id !== col.id ? c : {
        ...c,
        cards: c.cards.map(card => card.id === action.payload.card.id ? { ...card, mmNodeId: newNode.id } : card),
      });
      // 自动生成 checklist items 对应卡片已有子节点
      next.board.updatedAt = now;
      return next;
    }

    case 'UPDATE_CARD': {
      const cardInfo = (() => {
        for (const col of next.board.columns) for (const card of col.cards) if (card.id === action.payload.cardId) return { card, col };
        return null;
      })();
      if (!cardInfo) return state;
      const { card } = cardInfo;
      if (!card.mmNodeId) return state;
      const updates = action.payload.updates;
      let mutated = false;
      next.board.mindmap = next.board.mindmap.map(n => {
        if (n.id !== card.mmNodeId) return n;
        let merged = { ...n };
        if (updates.title !== undefined && updates.title !== n.text) { merged.text = updates.title; mutated = true; }
        if (updates.description !== undefined && updates.description !== n.description) { merged.description = updates.description?.slice(0, 200); mutated = true; }
        if (mutated) merged.updatedAt = now;
        return merged;
      });
      if (mutated) next.board.updatedAt = now;
      return mutated ? next : state;
    }

    case 'ARCHIVE_CARD':
    case 'DELETE_CARD': {
      const id = action.payload.cardId;
      const findCard = () => {
        for (const col of next.board.columns) for (const card of col.cards) if (card.id === id) return card;
        return null;
      };
      const card = findCard();
      if (!card?.mmNodeId) return state;
      // 删除该脑图节点及其所有子孙
      const idsToRemove = new Set<string>();
      const walk = (nid: string) => { if (idsToRemove.has(nid)) return; idsToRemove.add(nid); next.board.mindmap.filter(n => n.parentId === nid).forEach(c => walk(c.id)); };
      walk(card.mmNodeId);
      next.board.mindmap = next.board.mindmap.filter(n => !idsToRemove.has(n.id));
      next.board.updatedAt = now;
      return next;
    }

    case 'ADD_CHECKLIST_ITEM': {
      const findC = (): { card: Card; colId: string } | null => {
        for (const col of next.board.columns) for (const card of col.cards) if (card.id === action.payload.cardId) return { card, colId: col.id };
        return null;
      };
      const info = findC();
      if (!info?.card.mmNodeId) return state;
      const mmNodeId = info.card.mmNodeId;
      const siblings = nextChildrenOf(mmNodeId);
      const order = siblings.length > 0 ? Math.max(...siblings.map(s=>s.order)) + 1 : 0;
      const newItemId = (action.payload as any).itemId || generateId();
      const newNode: MindMapNode = {
        id: `mm-auto-${newItemId}`,
        text: action.payload.text,
        parentId: mmNodeId,
        color: '#10B981',
        collapsed: false,
        order,
        createdAt: now,
        updatedAt: now,
      };
      next.board.mindmap = [...next.board.mindmap, newNode];
      // 反向写 mmNodeId 回 checklist item
      next.board.columns = next.board.columns.map(c => c.id !== info.colId ? c : {
        ...c,
        cards: c.cards.map(card => {
          if (card.id !== info.card.id) return card;
          return {
            ...card,
            checklists: card.checklists.map(cl => cl.id !== action.payload.checklistId ? cl : {
              ...cl,
              items: cl.items.map(it => it.id === newItemId ? { ...it, mmNodeId: newNode.id } : it),
            }),
          };
        }),
      });
      next.board.updatedAt = now;
      return next;
    }

    case 'UPDATE_CHECKLIST_ITEM': {
      const findC = (): { card: Card; item: Checklist['items'][number] } | null => {
        for (const col of next.board.columns) for (const card of col.cards) if (card.id === action.payload.cardId) {
          for (const cl of card.checklists) {
            const it = cl.items.find(x => x.id === action.payload.itemId);
            if (it) return { card, item: it };
          }
        }
        return null;
      };
      const info = findC();
      if (!info?.item.mmNodeId) return state;
      let mutated = false;
      next.board.mindmap = next.board.mindmap.map(n => {
        if (n.id !== info.item.mmNodeId) return n;
        const merged = { ...n };
        if (action.payload.updates.text !== undefined && action.payload.updates.text !== n.text) { merged.text = action.payload.updates.text; mutated = true; }
        if (mutated) merged.updatedAt = now;
        return merged;
      });
      if (mutated) next.board.updatedAt = now;
      return mutated ? next : state;
    }

    case 'DELETE_CHECKLIST_ITEM': {
      let mutated = false;
      const { cardId, checklistId, itemId } = action.payload;

      // 1. 从看板数据结构中删除
      next.board.columns = next.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(card => {
          if (card.id !== cardId) return card;
          return {
            ...card,
            checklists: card.checklists.map(cl => {
              if (cl.id !== checklistId) return cl;
              const newItems = cl.items.filter(it => it.id !== itemId);
              if (newItems.length !== cl.items.length) mutated = true;
              return { ...cl, items: newItems };
            }),
          };
        }),
      }));

      if (!mutated) return state;

      // 2. 如果有关联的脑图节点，递归删除
      const findItemInOldState = (): Checklist['items'][number] | null => {
        for (const col of state.board.columns) 
          for (const card of col.cards) 
            if (card.id === cardId) 
              for (const cl of card.checklists) 
                if (cl.id === checklistId) 
                  return cl.items.find(it => it.id === itemId) || null;
        return null;
      };

      const oldItem = findItemInOldState();
      if (oldItem?.mmNodeId) {
        const idsToRemove = new Set<string>();
        const walk = (nid: string) => { 
          if (idsToRemove.has(nid)) return; 
          idsToRemove.add(nid); 
          next.board.mindmap.filter(n => n.parentId === nid).forEach(c => walk(c.id)); 
        };
        walk(oldItem.mmNodeId);
        next.board.mindmap = next.board.mindmap.filter(n => !idsToRemove.has(n.id));
      }

      next.board.updatedAt = now;
      return next;
    }

    case 'ADD_MINDMAP_NODE': {
      const parentId = action.payload.node.parentId;
      // 父节点是什么？
      // Case 1: parentId === null 或 parentId 是某个节点且对应 mmRootId 的列存在？
      // 简单同步策略：
      // - parentId === null → 暂不自动生成列（避免每次新建根节点就生成列；需用户显式转）
      // - parentId 对应某张卡片的 mmNodeId → 在该卡片清单里新增 checklist item
      // - parentId 对应某列的 mmRootId → 在该列新增一张卡片
      if (parentId !== null) {
        // 看看 parent 有没有对应卡片
        let parentCard: Card | null = null;
        let parentColId: string | null = null;
        for (const col of next.board.columns) for (const card of col.cards) if (card.mmNodeId === parentId) { parentCard = card; parentColId = col.id; break; }
        if (parentCard && parentColId) {
          // 对应：卡片 checklist 新增 item
          const col = next.board.columns.find(c => c.id === parentColId!)!;
          const nextCard = parentCard;
          let cl = nextCard.checklists.find(x => x.name === '子任务（来自脑图）');
          if (!cl) {
            cl = { id: generateId(), name: '子任务（来自脑图）', items: [] };
            nextCard.checklists = [...nextCard.checklists, cl];
          }
          const itemId = generateId();
          const newItem: Checklist['items'][number] = {
            id: itemId,
            text: action.payload.node.text,
            completed: false,
            mmNodeId: '', // 稍后写回（ADD_MINDMAP_NODE返回state没有node.id）
          };
          // 注意：ADD_MINDMAP_NODE 的 mindmap node id 是 reducer 内部生成的；但 sync 返回后不知道 mm 新id
          // 替代策略：用 mmNodeId = node.id → 我们把 sync 后的 mindmap node 取出来匹配
          const createdNode = next.board.mindmap.slice().sort((a,b)=> a.createdAt.localeCompare(b.createdAt)).pop(); // 不保险
          // 更稳妥：这里暂时先不加反向链接，下次 UPDATE 时再补
          cl.items = [...cl.items, newItem];
          // 更新 col.cards
          next.board.columns = next.board.columns.map(c => c.id !== col.id ? c : {
            ...c,
            cards: c.cards.map(card => card.id === nextCard.id ? { ...nextCard } : card),
          });
          next.board.updatedAt = now;
          return next;
        }
        // 有没有对应列？
        const col = next.board.columns.find(c => c.mmRootId === parentId);
        if (col) {
          // 新增卡片
          const cardId = generateId();
          const maxOrder = col.cards.length > 0 ? Math.max(...col.cards.map(c => c.order)) : -1;
          const newCard: Card = {
            id: cardId,
            title: action.payload.node.text,
            description: action.payload.node.description ? action.payload.node.description : '',
            labels: [],
            assignees: [],
            status: 'todo',
            archived: false,
            checklists: [],
            comments: [],
            attachments: [],
            createdAt: now,
            updatedAt: now,
            order: maxOrder + 1,
          };
          // mmNodeId 等 sync 返回后写回（临时先不写）
          next.board.columns = next.board.columns.map(c => c.id !== col.id ? c : { ...c, cards: [...c.cards, newCard] });
          next.board.updatedAt = now;
          return next;
        }
      }
      return state;
    }

    case 'UPDATE_MINDMAP_NODE': {
      const nid = action.payload.nodeId;
      const updates = action.payload.updates;
      // 找对应列
      const col = next.board.columns.find(c => c.mmRootId === nid);
      if (col && updates.text !== undefined) {
        next.board.columns = next.board.columns.map(c => c.id === col.id ? { ...c, title: updates.text! } : c);
        next.board.updatedAt = now;
      }
      // 找对应卡片
      for (const col of next.board.columns) {
        let cardsChanged = false;
        const cards = col.cards.map(card => {
          if (card.mmNodeId !== nid) return card;
          const out = { ...card };
          if (updates.text !== undefined && updates.text !== card.title) { out.title = updates.text; cardsChanged = true; }
          if (updates.description !== undefined && updates.description !== card.description) { out.description = updates.description ?? ''; cardsChanged = true; }
          return out;
        });
        if (cardsChanged) {
          next.board.columns = next.board.columns.map(c => c.id === col.id ? { ...c, cards } : c);
          next.board.updatedAt = now;
        }
        // 找对应 checklist item
        let clChanged = false;
        const cards2 = col.cards.map(card => ({
          ...card,
          checklists: card.checklists.map(cl => ({
            ...cl,
            items: cl.items.map(it => {
              if (it.mmNodeId !== nid) return it;
              const out = { ...it };
              if (updates.text !== undefined && updates.text !== it.text) { out.text = updates.text; clChanged = true; }
              return out;
            }),
          })),
        }));
        if (clChanged) {
          next.board.columns = next.board.columns.map(c => c.id === col.id ? { ...c, cards: cards2 } : c);
          next.board.updatedAt = now;
        }
      }
      return next;
    }

    case 'DELETE_MINDMAP_NODE': {
      // state.board.mindmap 已被 baseReducer 删除了节点+子孙，现在同步删除对应的卡片 / 列 / checklist item
      const removed = action.payload.nodeId;
      const removedSet = new Set<string>([removed]);
      // 原始 state 的旧 mindmap 才知道哪些被删（因为 next 已经没了）
      const oldChildren = (id: string) => state.board.mindmap.filter(n => n.parentId === id).sort((a,b)=>a.order-b.order);
      const stack = [removed];
      while (stack.length) {
        const cur = stack.pop()!;
        oldChildren(cur).forEach(ch => { removedSet.add(ch.id); stack.push(ch.id); });
      }
      let changed = false;
      // 删除列：mmRootId ∈ removedSet
      let cols = next.board.columns.filter(c => {
        if (c.mmRootId && removedSet.has(c.mmRootId)) { changed = true; return false; }
        return true;
      });
      // 删除卡片 & 清单 item
      cols = cols.map(c => {
        let cardsChanged = false;
        let cards = c.cards.filter(card => {
          if (card.mmNodeId && removedSet.has(card.mmNodeId)) { cardsChanged = true; changed = true; return false; }
          return true;
        });
        cards = cards.map(card => {
          let clChanged = false;
          const checklists = card.checklists.map(cl => {
            let itemsChanged = false;
            const items = cl.items.filter(it => {
              if (it.mmNodeId && removedSet.has(it.mmNodeId)) { itemsChanged = true; changed = true; clChanged = true; return false; }
              return true;
            });
            return itemsChanged ? { ...cl, items } : cl;
          });
          return clChanged ? { ...card, checklists } : card;
        });
        return cardsChanged ? { ...c, cards } : c;
      });
      if (changed) {
        next.board.columns = cols;
        next.board.updatedAt = now;
        return next;
      }
      return state;
    }
  }
  return state;
}

interface BoardContextType extends BoardState {
  dispatch: React.Dispatch<Action>;
  findCard: (cardId: string) => { card: Card; columnId: string } | null;
  broadcastChange: (action: Action) => void;
  loading: boolean;
}

const BoardContext = createContext<BoardContextType | null>(null);

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, undefined, initialState);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const currentUserRef = useRef(state.currentUser);
  currentUserRef.current = state.currentUser;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('trello-clone-sync');
      channelRef.current = bc;
      bc.onmessage = (event) => {
        try {
          const data = event.data || {};
          const curUser = currentUserRef.current;
          if (data.type === 'STATE_UPDATE' && data.sender !== curUser?.id) {
            if (data.boardState) {
              dispatch({ type: 'APPLY_REMOTE_UPDATE', payload: data.boardState });
            }
          }
          if (data.type === 'USER_ONLINE') {
            const cur = stateRef.current;
            dispatch({
              type: 'SET_ONLINE_USERS',
              payload: Array.from(new Set([...cur.onlineUsers, data.userId])),
            });
          }
        } catch (e) {
          // ignore message errors
        }
      };
    } catch (e) {
      channelRef.current = null;
    }
    return () => {
      try {
        if (bc) bc.close();
      } catch {
        // Channel already closed, ignore
      }
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!state.currentUser) return;
    const userId = state.currentUser.id;
    const safeSend = () => {
      try {
        channelRef.current?.postMessage({ type: 'USER_ONLINE', userId });
      } catch (e) {}
    };
    safeSend();
    const interval = setInterval(safeSend, 5000);
    return () => clearInterval(interval);
  }, [state.currentUser]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const allIds = stateRef.current.users.map(u => u.id);
      dispatch({ type: 'SET_ONLINE_USERS', payload: allIds });
    }, 2000);
    return () => clearTimeout(timeout);
  }, [state.users]);

  useEffect(() => {
    if (state.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [state.darkMode]);

  // --- Supabase: Load initial data ---
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const prevUserIdsRef = useRef<Set<string>>(new Set());
  const prevBoardIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (loadedRef.current) return;
    async function loadData() {
      try {
        // Fetch users
        const { data: users } = await supabase.from('users').select('*').order('created_at');
        // Fetch workspace settings
        const { data: settingsData } = await supabase.from('workspace_settings').select('*').limit(1).single();
        // Fetch boards
        const { data: boardsData } = await supabase.from('boards').select('*').order('created_at');

        const mappedUsers: User[] = (users || []).map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email || '',
          avatar: u.avatar || '',
          color: u.color || '#3B82F6',
          role: u.role || 'member',
          password: u.password,
          lang: u.lang || 'zh',
        }));

        const mappedBoards: Board[] = (boardsData || []).map((b: any) => ({
          id: b.id,
          title: b.title,
          background: b.background || '#f5f5f7',
          labels: b.labels || [],
          columns: b.data?.columns || [],
          mindmap: b.data?.mindmap || [],
          createdAt: b.created_at,
          updatedAt: b.updated_at,
        })).filter(b => {
          // Filter out boards that were locally deleted (safety net)
          const deleted = localStorage.getItem('trello_deleted_boards');
          if (deleted) {
            try {
              const deletedIds: string[] = JSON.parse(deleted);
              return !deletedIds.includes(b.id);
            } catch {
              return true;
            }
          }
          return true;
        });

        dispatch({
          type: 'LOAD_ALL_DATA',
          payload: {
            users: mappedUsers.length > 0 ? mappedUsers : initialState().users,
            boards: mappedBoards,
            workspaceBackground: settingsData?.workspace_background || '#f5f5f7',
            loginBackground: settingsData?.login_background || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            logo: settingsData?.logo || '',
          },
        });
      } catch (e) {
        console.error('Supabase load error:', e);
      } finally {
        loadedRef.current = true;
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // --- Persist login session to localStorage ---
  useEffect(() => {
    if (!loadedRef.current) return; // skip initial render to avoid clearing saved session
    if (state.currentUser) {
      localStorage.setItem('trello_user_id', state.currentUser.id);
    } else {
      localStorage.removeItem('trello_user_id');
      localStorage.removeItem('trello_board_id');
    }
  }, [state.currentUser]);

  // --- Persist current board to localStorage ---
  useEffect(() => {
    if (!loadedRef.current) return;
    localStorage.setItem('trello_board_id', state.currentBoardId);
  }, [state.currentBoardId]);

  // --- Restore login session after data load ---
  useEffect(() => {
    if (!state._loaded) return;
    if (state.currentUser) return; // already logged in
    const savedUserId = localStorage.getItem('trello_user_id');
    if (!savedUserId) return;
    const user = state.users.find(u => u.id === savedUserId);
    if (user) {
      const savedBoardId = localStorage.getItem('trello_board_id');
      dispatch({ type: 'SET_CURRENT_USER', payload: user });
      if (savedBoardId && state.boards.some(b => b.id === savedBoardId)) {
        dispatch({ type: 'SET_CURRENT_BOARD', payload: savedBoardId });
      }
    } else {
      localStorage.removeItem('trello_user_id');
      localStorage.removeItem('trello_board_id');
    }
  }, [state._loaded, state.users]);

  // --- Supabase: Save board data (debounced) ---
  const prevBoardRef = useRef(state.board);
  useEffect(() => {
    if (!loadedRef.current) return;
    const board = state.board;
    if (!board.id) return;

    // Only save if board data actually changed
    const prev = prevBoardRef.current;
    if (prev.columns === board.columns && prev.labels === board.labels &&
        prev.title === board.title && prev.background === board.background &&
        prev.mindmap === board.mindmap) return;

    prevBoardRef.current = board;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    isSavingRef.current = true;
    saveTimerRef.current = setTimeout(async () => {
      try {
        await supabase.from('boards').upsert({
          id: board.id,
          title: board.title,
          background: board.background,
          labels: board.labels,
          data: { columns: board.columns, mindmap: board.mindmap },
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Supabase save error:', e);
      } finally {
        isSavingRef.current = false;
      }
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state.board.columns, state.board.labels, state.board.title, state.board.background, state.board.mindmap]);

  // --- Supabase: Save boards list when boards array changes ---
  useEffect(() => {
    if (!loadedRef.current) return;
    const currentIds = new Set(state.boards.map(b => b.id));
    const prevIds = prevBoardIdsRef.current;

    const syncBoards = async () => {
      // Delete boards that were removed FIRST (before upsert, to avoid re-creation race)
      const toDelete = [...prevIds].filter(id => !currentIds.has(id));
      if (toDelete.length > 0) {
        await Promise.all(toDelete.map(async (id) => {
          try {
            const { error } = await supabase.from('boards').delete().eq('id', id);
            if (error) console.error('Supabase delete board error:', id, error);
          } catch (e) {
            console.error('Supabase delete board exception:', id, e);
          }
        }));

        // Save deleted IDs to localStorage as safety net
        try {
          const existing = JSON.parse(localStorage.getItem('trello_deleted_boards') || '[]');
          const updated = [...new Set([...existing, ...toDelete])];
          localStorage.setItem('trello_deleted_boards', JSON.stringify(updated));
        } catch {
          localStorage.setItem('trello_deleted_boards', JSON.stringify(toDelete));
        }
      }

      // Upsert current boards after deletes complete
      await Promise.all(state.boards.map(async (b) => {
        try {
          await supabase.from('boards').upsert({
            id: b.id,
            title: b.title,
            background: b.background,
            labels: b.labels || [],
            data: { columns: b.columns || [], mindmap: b.mindmap || [] },
            updated_at: new Date().toISOString(),
          });
        } catch (e) {
          console.error('Supabase upsert board error:', b.id, e);
        }
      }));
    };
    syncBoards();

    prevBoardIdsRef.current = currentIds;
  }, [state.boards]);

  // --- Supabase: Save users ---
  useEffect(() => {
    if (!loadedRef.current) return;
    const currentIds = new Set(state.users.map(u => u.id));
    const prevIds = prevUserIdsRef.current;

    const syncUsers = async () => {
      // Upsert current users
      await Promise.all(state.users.map(async (u) => {
        try {
          await supabase.from('users').upsert({
            id: u.id,
            name: u.name,
            email: u.email,
            avatar: u.avatar,
            color: u.color,
            role: u.role,
            password: u.password,
            lang: u.lang,
          });
        } catch (e) {
          console.error('Supabase upsert user error:', u.id, e);
        }
      }));

      // Delete users that were removed
      const usersToDelete = [...prevIds].filter(id => !currentIds.has(id));
      if (usersToDelete.length > 0) {
        await Promise.all(usersToDelete.map(async (id) => {
          try {
            await supabase.from('users').delete().eq('id', id);
          } catch (e) {
            console.error('Supabase delete user error:', id, e);
          }
        }));
      }
    };
    syncUsers();

    prevUserIdsRef.current = currentIds;
  }, [state.users]);

  // --- Supabase: Save workspace settings ---
  useEffect(() => {
    if (!loadedRef.current) return;
    const save = async () => {
      try {
        await supabase.from('workspace_settings').upsert({
          id: '00000000-0000-0000-0000-000000000001',
          workspace_background: state.workspaceBackground,
          login_background: state.loginBackground,
          logo: state.logo,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error('Supabase save workspace settings error:', e);
      }
    };
    save();
  }, [state.workspaceBackground, state.loginBackground, state.logo]);

  // --- Supabase Realtime: Subscribe to board changes ---
  useEffect(() => {
    if (!loadedRef.current) return;
    const channel = supabase
      .channel('boards-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'boards' },
        async (payload: any) => {
          const changedBoard = payload.new;
          if (!changedBoard?.id) return;
          // Skip if we're the ones who made the change (debounced save in progress)
          if (isSavingRef.current) return;

          try {
            const { data: fresh } = await supabase
              .from('boards')
              .select('*')
              .eq('id', changedBoard.id)
              .single();
            if (!fresh) return;

            const updatedBoard: Board = {
              id: fresh.id,
              title: fresh.title,
              background: fresh.background || '#f5f5f7',
              labels: fresh.labels || [],
              columns: fresh.data?.columns || [],
              mindmap: fresh.data?.mindmap || [],
              createdAt: fresh.created_at,
              updatedAt: fresh.updated_at,
            };

            // Update the board if it's the currently viewed one
            const current = stateRef.current;
            if (current.currentBoardId === updatedBoard.id) {
              dispatch({ type: 'SET_CURRENT_BOARD', payload: updatedBoard.id });
            }
            // Also update the boards list
            const newBoards = current.boards.map(b =>
              b.id === updatedBoard.id ? updatedBoard : b
            );
            // Use a quick update
            // We need to update both board and boards list
            setTimeout(() => {
              const latest = stateRef.current;
              if (latest.currentBoardId === updatedBoard.id) {
                dispatch({ type: 'UPDATE_BOARD', payload: updatedBoard });
              }
            }, 100);
          } catch (e) {
            console.error('Supabase realtime sync error:', e);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const findCard = useCallback((cardId: string) => {
    for (const col of stateRef.current.board.columns) {
      for (const card of col.cards) {
        if (card.id === cardId) {
          return { card, columnId: col.id };
        }
      }
    }
    return null;
  }, []);

  const broadcastChange = useCallback((action: Action) => {
    dispatch(action);
    const curUser = currentUserRef.current;
    if (!curUser) return;
    try {
      queueMicrotask(() => {
        const latest = stateRef.current;
        try {
          channelRef.current?.postMessage({
            type: 'STATE_UPDATE',
            sender: curUser.id,
            boardState: { board: latest.board, boards: latest.boards, onlineUsers: latest.onlineUsers },
          });
        } catch (e) {
          // BroadcastChannel may fail if state is not cloneable
          console.debug('BroadcastChannel postMessage failed:', e);
        }
      });
    } catch (e) {
      // queueMicrotask may fail in rare edge cases
      console.debug('BroadcastChannel send error:', e);
    }
  }, []);

  return (
    <BoardContext.Provider value={{ ...state, dispatch, findCard, broadcastChange, loading }}>
      {children}
    </BoardContext.Provider>
  );
}

export function useBoard() {
  const context = useContext(BoardContext);
  if (!context) {
    throw new Error('useBoard must be used within a BoardProvider');
  }
  return context;
}
