import { BoardState } from '../types';
import { Action } from '../actions';
import { Card, Label, Comment, Attachment } from '@/types';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function cardOpsReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
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
        id: action.payload.card.id || generateId(),
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

    default:
      return state;
  }
}
