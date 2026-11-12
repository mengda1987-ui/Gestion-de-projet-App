import { BoardState } from '../types';
import { Action } from '../actions';
import { actionClock } from '../normalizeAction';

export function checklistOpsReducer(state: BoardState, action: Action): BoardState {
  const { now, generateId } = actionClock(action, 3);
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
            updatedAt: now,
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
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
            updatedAt: now,
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
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
            updatedAt: now,
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
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
            updatedAt: now,
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
    }

    case 'DELETE_CHECKLIST': {
      const columns = state.board.columns.map(col => ({
        ...col,
        cards: col.cards.map(c => {
          if (c.id !== action.payload.cardId) return c;
          return {
            ...c,
            checklists: c.checklists.filter(cl => cl.id !== action.payload.checklistId),
            updatedAt: now,
          };
        }),
      }));
      return { ...state, board: { ...state.board, columns, updatedAt: now } };
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
            updatedAt: now,
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
      return { ...state, board: { ...state.board, columns, mindmap, updatedAt: now } };
    }

    default:
      return state;
  }
}
