import { BoardState } from '../types';
import { Action } from '../actions';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function checklistOpsReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
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

    case 'DELETE_CHECKLIST_ITEM': {
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
                items: cl.items.filter(item => item.id !== action.payload.itemId),
              };
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));
      const mindmap = state.board.mindmap.filter(node => {
        const found = state.board.columns.some(col =>
          col.cards.some(card =>
            card.checklists.some(cl =>
              cl.items.some(item => item.id === action.payload.itemId && item.mmNodeId === node.id)
            )
          )
        );
        return !found;
      });
      return { ...state, board: { ...state.board, columns, mindmap, updatedAt: new Date().toISOString() } };
    }

    default:
      return state;
  }
}
