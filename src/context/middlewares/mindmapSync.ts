import { BoardState } from '../types';
import { Action } from '../actions';
import { Card, MindMapNode } from '@/types';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function syncMindMapCards(state: BoardState, action: Action): BoardState {
  const now = new Date().toISOString();
  const next: BoardState = {
    ...state,
    board: { ...state.board, columns: state.board.columns.map(c => ({ ...c, cards: [...c.cards] })), mindmap: [...state.board.mindmap] },
  };
  
  const nextChildrenOf = (parentId: string | null) => next.board.mindmap.filter(n => n.parentId === parentId).sort((a, b) => a.order - b.order);

  switch (action.type) {
    case 'IMPORT_AI_RESULT':
      return state;

    case 'ADD_COLUMN': {
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
      if (action.payload.card.mmNodeId) return state;
      const siblings = nextChildrenOf(col.mmRootId);
      const order = siblings.length > 0 ? Math.max(...siblings.map(s => s.order)) + 1 : 0;
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
      next.board.columns = next.board.columns.map(c => c.id !== col.id ? c : {
        ...c,
        cards: c.cards.map(card => card.id === action.payload.card.id ? { ...card, mmNodeId: newNode.id } : card),
      });
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
      const order = siblings.length > 0 ? Math.max(...siblings.map(s => s.order)) + 1 : 0;
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
      const findC = (): { card: Card; item: any } | null => {
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
      const removedItem = state.board.columns
        .flatMap(c => c.cards)
        .find(c => c.id === cardId)
        ?.checklists.find(cl => cl.id === checklistId)
        ?.items.find(it => it.id === itemId);
      if (removedItem?.mmNodeId) {
        const idsToRemove = new Set<string>();
        const walk = (nid: string) => {
          if (idsToRemove.has(nid)) return;
          idsToRemove.add(nid);
          next.board.mindmap.filter(n => n.parentId === nid).forEach(c => walk(c.id));
        };
        walk(removedItem.mmNodeId);
        next.board.mindmap = next.board.mindmap.filter(n => !idsToRemove.has(n.id));
      }
      next.board.updatedAt = now;
      return next;
    }

    case 'UPDATE_MINDMAP_NODE': {
      const nodeId = action.payload.nodeId;
      const updates = action.payload.updates;
      const node = next.board.mindmap.find(n => n.id === nodeId);
      if (!node) return state;
      let mutated = false;
      if (updates.text !== undefined && updates.text !== node.text) {
        next.board.columns = next.board.columns.map(col => ({
          ...col,
          cards: col.cards.map(card => {
            if (card.mmNodeId === nodeId) {
              mutated = true;
              return { ...card, title: updates.text!, updatedAt: now };
            }
            return {
              ...card,
              checklists: card.checklists.map(cl => ({
                ...cl,
                items: cl.items.map(it => {
                  if (it.mmNodeId === nodeId) {
                    mutated = true;
                    return { ...it, text: updates.text! };
                  }
                  return it;
                }),
              })),
            };
          }),
        }));
      }
      if (mutated) next.board.updatedAt = now;
      return mutated ? next : state;
    }

    case 'DELETE_MINDMAP_NODE': {
      const nodeId = action.payload.nodeId;
      const node = next.board.mindmap.find(n => n.id === nodeId);
      if (!node) return state;
      let linkedCard: Card | null = null;
      let linkedColId: string | null = null;
      let linkedItem: { cardId: string; checklistId: string; itemId: string } | null = null;
      for (const col of next.board.columns) {
        for (const card of col.cards) {
          if (card.mmNodeId === nodeId) {
            linkedCard = card;
            linkedColId = col.id;
            break;
          }
          for (const cl of card.checklists) {
            for (const it of cl.items) {
              if (it.mmNodeId === nodeId) {
                linkedItem = { cardId: card.id, checklistId: cl.id, itemId: it.id };
                break;
              }
            }
          }
        }
      }
      if (linkedCard && linkedColId) {
        next.board.columns = next.board.columns.map(col => ({
          ...col,
          cards: col.cards.filter(c => c.id !== linkedCard!.id),
        }));
      }
      if (linkedItem) {
        next.board.columns = next.board.columns.map(col => ({
          ...col,
          cards: col.cards.map(card => {
            if (card.id !== linkedItem!.cardId) return card;
            return {
              ...card,
              checklists: card.checklists.map(cl => {
                if (cl.id !== linkedItem!.checklistId) return cl;
                return { ...cl, items: cl.items.filter(it => it.id !== linkedItem!.itemId) };
              }),
            };
          }),
        }));
      }
      next.board.updatedAt = now;
      return next;
    }

    default:
      return state;
  }
}
