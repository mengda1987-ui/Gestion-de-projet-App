import type { BoardState } from '../types';
import type { Action } from '../actions';
import type { MindMapNode } from '@/types';
const linkedActions = new Set(['ADD_COLUMN', 'UPDATE_COLUMN', 'DELETE_COLUMN', 'ARCHIVE_COLUMN', 'REORDER_COLUMNS', 'ADD_CARD', 'UPDATE_CARD', 'DELETE_CARD', 'ARCHIVE_CARD', 'MOVE_CARD', 'REORDER_CARDS', 'ADD_CHECKLIST_ITEM', 'UPDATE_CHECKLIST_ITEM', 'DELETE_CHECKLIST_ITEM', 'DELETE_CHECKLIST', 'UPDATE_MINDMAP_NODE', 'DELETE_MINDMAP_NODE']);
export function syncMindMapCards(before: BoardState, after: BoardState, action: Action): BoardState {
  if (!linkedActions.has(action.type) || before.board === after.board) return after;
  const at = action._meta?.at || after.board.updatedAt;
  let columns = after.board.columns;
  let mindmap = after.board.mindmap || [];
  const oldNodes = before.board.mindmap || [];
  const cards = columns.flatMap(c => c.cards);
  const deleted = new Set<string>();
  const removeTree = (id?: string) => {
    if (!id || deleted.has(id)) return;
    deleted.add(id);
    oldNodes.filter(n => n.parentId === id).forEach(n => removeTree(n.id));
  };
  if (action.type === 'DELETE_MINDMAP_NODE') removeTree(action.payload.nodeId);
  for (const col of before.board.columns) if (!columns.some(c => c.id === col.id)) removeTree(col.mmRootId);
  for (const card of before.board.columns.flatMap(c => c.cards)) {
    const next = cards.find(c => c.id === card.id);
    if (!next) removeTree(card.mmNodeId);
    const nextItems = next?.checklists.flatMap(c => c.items) || [];
    for (const item of card.checklists.flatMap(c => c.items)) if (!nextItems.some(i => i.id === item.id)) removeTree(item.mmNodeId);
  }
  mindmap = mindmap.filter(n => !deleted.has(n.id));
  const upsert = (id: string, text: string, parentId: string | null, order: number) => {
    const existing = mindmap.find(n => n.id === id);
    if (existing && existing.text === text && existing.parentId === parentId && existing.order === order) return;
    const node: MindMapNode = { color: '#6366F1', createdAt: at, ...existing, id, text, parentId, order, updatedAt: at };
    mindmap = existing ? mindmap.map(n => n.id === id ? node : n) : [...mindmap, node];
  };
  const updatedNode = action.type === 'UPDATE_MINDMAP_NODE' ? mindmap.find(n => n.id === action.payload.nodeId) : undefined;
  columns = columns.filter(col => !deleted.has(col.mmRootId || '')).map(col => {
    const mmRootId = col.mmRootId || 'mm-root-' + col.id;
    const title = updatedNode?.id === mmRootId ? updatedNode.text : col.title;
    upsert(mmRootId, title, null, col.order);
    const nextCards = col.cards.filter(card => !deleted.has(card.mmNodeId || '')).map(card => {
      const mmNodeId = card.mmNodeId || 'mm-auto-' + card.id;
      const cardTitle = updatedNode?.id === mmNodeId ? updatedNode.text : card.title;
      upsert(mmNodeId, cardTitle, mmRootId, card.order);
      const checklists = card.checklists.map(cl => {
        const items = cl.items.filter(it => !deleted.has(it.mmNodeId || '')).map((it, i) => {
        const itemNodeId = it.mmNodeId || 'mm-auto-' + it.id;
        const text = updatedNode?.id === itemNodeId ? updatedNode.text : it.text;
        upsert(itemNodeId, text, mmNodeId, i);
        return it.text === text && it.mmNodeId === itemNodeId ? it : { ...it, text, mmNodeId: itemNodeId };
      });
        return items.length === cl.items.length && items.every((it,i) => it === cl.items[i]) ? cl : { ...cl, items };
      });
      if (card.title === cardTitle && card.mmNodeId === mmNodeId && checklists.every((cl,i) => cl === card.checklists[i])) return card;
      return { ...card, title: cardTitle, mmNodeId, checklists };
    });
    return col.title === title && col.mmRootId === mmRootId && nextCards.length === col.cards.length && nextCards.every((card,i) => card === col.cards[i]) ? col : { ...col, title, mmRootId, cards: nextCards };
  });
  return { ...after, board: { ...after.board, columns, mindmap } };
}
