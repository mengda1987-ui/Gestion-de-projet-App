import { BoardState } from '../types';
import { Action } from '../actions';
import { Card, Column, MindMapNode, Checklist } from '@/types';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function mindmapOpsReducer(state: BoardState, action: Action): BoardState {
  switch (action.type) {
    case 'IMPORT_AI_RESULT': {
      const now = new Date().toISOString();
      const newColumns = [...state.board.columns];
      const newMindmap = [...state.board.mindmap];

      action.payload.columns.forEach((colData) => {
        const colId = generateId();
        const mmRootId = `mm-root-${colId}`;

        newMindmap.push({
          id: mmRootId,
          text: colData.title,
          parentId: null,
          color: '#6366F1',
          order: newMindmap.filter(n => n.parentId === null).length,
          createdAt: now,
          updatedAt: now,
        });

        const newCards: Card[] = colData.cards.map((cardData, cardIdx) => {
          const cardId = generateId();
          const mmCardId = `mm-auto-${cardId}`;

          newMindmap.push({
            id: mmCardId,
            text: cardData.title,
            parentId: mmRootId,
            color: '#6366F1',
            order: cardIdx,
            createdAt: now,
            updatedAt: now,
          });

          const checklists: Checklist[] = cardData.items.length > 0 ? [{
            id: generateId(),
            name: 'Tasks',
            items: cardData.items.map((itemText, itemIdx) => {
              const itemId = generateId();
              const mmItemId = `mm-auto-${itemId}`;

              newMindmap.push({
                id: mmItemId,
                text: itemText,
                parentId: mmCardId,
                color: '#10B981',
                order: itemIdx,
                createdAt: now,
                updatedAt: now,
              });

              return {
                id: itemId,
                text: itemText,
                completed: false,
                mmNodeId: mmItemId,
              };
            }),
          }] : [];

          return {
            id: cardId,
            title: cardData.title,
            description: '',
            status: 'todo',
            archived: false,
            checklists,
            comments: [],
            attachments: [],
            labels: [],
            assignees: [],
            createdAt: now,
            updatedAt: now,
            order: cardIdx,
            mmNodeId: mmCardId,
          } as Card;
        });

        newColumns.push({
          id: colId,
          title: colData.title,
          cards: newCards,
          order: newColumns.length,
          archived: false,
          mmRootId: mmRootId,
        });
      });

      return {
        ...state,
        board: {
          ...state.board,
          columns: newColumns,
          mindmap: newMindmap,
          updatedAt: now,
        },
      };
    }

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
        } as Card;
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
