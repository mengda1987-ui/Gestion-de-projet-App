'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { Card, Column, ChecklistItem } from '@/types';
import { cn, generateId } from '@/lib/utils';
import {
  Network,
  Plus,
  Minus,
  ChevronRight,
  ChevronDown,
  PlusCircle,
  X,
  Trash2,
  Pencil,
  Palette,
  Check,
  GitBranchPlus,
  Sparkles,
  Layers,
  Archive,
  ArchiveRestore,
  Maximize2,
} from 'lucide-react';

type NodeKind = 'column' | 'card' | 'item';

interface VirtualNode {
  id: string;
  kind: NodeKind;
  refId: string;         // columnId / cardId / itemId
  parentRef: string | null; // parent refId (null for columns)
  text: string;
  color: string;
  order: number;
  archived: boolean;
  completed: boolean;
  description?: string;
  dueDate?: string;
  posOverride?: { x: number; y: number };
}

interface LayoutedNode {
  node: VirtualNode;
  depth: number;
  subtreeHeight: number;
  y: number;
  x: number;
  width: number;
  height: number;
  children: LayoutedNode[];
}

const NODE_H_GAP = 96;
const NODE_V_GAP = 12;
const NODE_MIN_WIDTH = 130;
const NODE_PADDING_X = 10;
const NODE_HEIGHT = 36;
const ROOT_HEIGHT = 48;
const ROOT_MIN_WIDTH = 180;

const COLUMN_COLORS = [
  '#6366F1', '#3B82F6', '#8B5CF6', '#10B981',
  '#F59E0B', '#EF4444', '#EC4899', '#06B6D4',
];

const DEFAULT_COLORS = [
  '#6366F1', '#8B5CF6', '#A855F7', '#D946EF',
  '#EC4899', '#F43F5E', '#EF4444', '#F97316',
  '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9',
  '#3B82F6', '#64748B',
];

function estimateTextWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += /[\u4e00-\u9fa5]/.test(ch) ? 13 : 7;
  }
  return w;
}

function nodeWidthFor(text: string, depth: number): number {
  const base = depth === 0 ? ROOT_MIN_WIDTH : NODE_MIN_WIDTH;
  return Math.max(base, estimateTextWidth(text) + NODE_PADDING_X * 2 + 16);
}

export default function MindMapView() {
  const { t, lang } = useLang();
  const { board, dispatch, currentUser, broadcastChange } = useBoard();
  const boardRef = useRef(board);
  boardRef.current = board;

  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number } | null>(null);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [colorRect, setColorRect] = useState<{ left: number; top: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [settleDrag, setSettleDrag] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTargetRefIdRef = useRef<string | null>(null);
  const [pendingPositions, setPendingPositions] = useState<Record<string, { x: number; y: number }>>({});
  const pendingPositionsRef = useRef(pendingPositions);
  pendingPositionsRef.current = pendingPositions;
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  interface NodeDragState {
    nodeId: string;
    kind: NodeKind;
    refId: string;
    startClientX: number;
    startClientY: number;
    didMove: boolean;
    startTime: number;
    descendants: Array<{ id: string; origX: number; origY: number }>;
  }
  const dragRef = useRef<NodeDragState | null>(null);

  // 清理 settle 定时器
  useEffect(() => {
    return () => { if (settleTimerRef.current) clearTimeout(settleTimerRef.current); };
  }, []);

  // ============ 核心：从看板数据实时派生出脑图节点 ============
  const nodes: VirtualNode[] = useMemo(() => {
    const list: VirtualNode[] = [];
    board.columns
      .filter(col => !col.archived)
      .forEach((col, idx) => {
        const colColor = COLUMN_COLORS[idx % COLUMN_COLORS.length];
        list.push({
          id: `col-${col.id}`,
          kind: 'column',
          refId: col.id,
          parentRef: null,
          text: col.title,
          color: colColor,
          order: col.order,
          archived: false,
          completed: false,
          posOverride: (col as any).mmPosition,
        });
        const cardsSorted = [...col.cards]
          .filter(card => !card.archived)
          .sort((a, b) => a.order - b.order);
        cardsSorted.forEach((card) => {
          let color = colColor;
          if (card.labels.length > 0) {
            const lbl = board.labels.find(l => l.id === card.labels[0]);
            if (lbl?.color) color = lbl.color;
          } else if (card.completed) {
            color = '#10B981';
          }
          list.push({
            id: `card-${card.id}`,
            kind: 'card',
            refId: card.id,
            parentRef: col.id,
            text: card.title,
            color,
            order: card.order,
            archived: !!card.archived,
            completed: !!card.completed,
            description: card.description,
            dueDate: card.dueDate,
            posOverride: (card as any).mmPosition,
          });
          card.checklists.forEach(cl => {
            [...cl.items]
              .sort((a, b) => (a as any).order - (b as any).order || 0)
              .forEach((it, i) => {
                list.push({
                  id: `item-${it.id}`,
                  kind: 'item',
                  refId: it.id,
                  parentRef: card.id,
                  text: it.text,
                  color: it.completed ? '#22C55E' : '#14B8A6',
                  order: i,
                  archived: false,
                  completed: !!it.completed,
                  dueDate: (it as any).dueDate,
                  posOverride: (it as any).mmPosition,
                });
              });
          });
        });
      });
    return list;
  }, [board.columns, board.labels]);

  const childrenMap = useMemo(() => {
    const m = new Map<string | null, VirtualNode[]>();
    nodes.forEach(n => {
      const key = n.parentRef;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(n);
    });
    m.forEach(arr => arr.sort((a, b) => a.order - b.order));
    return m;
  }, [nodes]);

  const byId = useMemo(() => {
    const m = new Map<string, VirtualNode>();
    nodes.forEach(n => m.set(n.id, n));
    return m;
  }, [nodes]);

  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  const layouted = useMemo<LayoutedNode[]>(() => {
    function lay(root: VirtualNode, depth: number, yCursor: number, forceX?: number): LayoutedNode {
      const rawKids = (childrenMap.get(root.refId) ?? []);
      const kids = collapsed[`k-${root.id}`] ? [] : rawKids;
      const width = nodeWidthFor(root.text, depth);
      const height = depth === 0 ? ROOT_HEIGHT : NODE_HEIGHT;
      const rootOverridden = !!root.posOverride;
      let x = forceX ?? (40 + depth * (NODE_H_GAP + NODE_MIN_WIDTH + 30));
      let y = yCursor;
      if (rootOverridden) {
        x = root.posOverride!.x;
        y = root.posOverride!.y;
      }
      const layKids: LayoutedNode[] = [];
      let subtree = 0;
      if (kids.length > 0) {
        const childDepth = depth + 1;
        const childrenXForce = x + width + NODE_H_GAP;
        // 父被拖走时：子节点紧贴父节点下方堆叠，不做居中重排（避免落盘跳动）
        let childrenYStart = yCursor;
        if (rootOverridden) {
          childrenYStart = y + height + NODE_V_GAP;
        }
        let cur = childrenYStart;
        for (const k of kids) {
          if (k.posOverride) {
            const sub = lay(k, childDepth, 0);
            layKids.push({ ...sub, x: k.posOverride!.x, y: k.posOverride!.y });
            if (!rootOverridden) {
              cur = Math.max(cur, k.posOverride!.y + sub.subtreeHeight + NODE_V_GAP);
            }
          } else {
            const sub = rootOverridden
              ? lay(k, childDepth, cur, childrenXForce)
              : lay(k, childDepth, cur);
            layKids.push(sub);
            cur = sub.y + sub.subtreeHeight + NODE_V_GAP;
          }
        }
        subtree = layKids.reduce((s, k) => s + k.subtreeHeight + NODE_V_GAP, -NODE_V_GAP);
        if (!rootOverridden && layKids.length > 0) {
          const ys = layKids.map(k => k.y).sort((a, b) => a - b);
          const first = layKids.find(k => k.y === ys[0])!;
          const last = layKids.reduce((a, c) => (c.y > a.y ? c : a), layKids[0]);
          const c1 = first.y + first.subtreeHeight / 2;
          const c2 = last.y + last.subtreeHeight / 2;
          y = (c1 + c2) / 2 - height / 2;
        }
      } else {
        subtree = height;
      }
      return { node: root, depth, subtreeHeight: Math.max(height, subtree), x, y, width, height, children: layKids };
    }
    const roots = (childrenMap.get(null) ?? []).slice().sort((a, b) => a.order - b.order);
    let y = 48;
    const result: LayoutedNode[] = [];
    for (const r of roots) {
      if (r.posOverride) {
        const lr = lay(r, 0, 0);
        result.push(lr);
        y = Math.max(y, lr.y + lr.subtreeHeight + 32);
      } else {
        const lr = lay(r, 0, y);
        result.push(lr);
        y = lr.y + lr.subtreeHeight + 32;
      }
    }
    return result;
  }, [nodes, childrenMap, collapsed]);

  const { nodesFlat, bbox } = useMemo(() => {
    const flat: LayoutedNode[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (n: LayoutedNode) => {
      flat.push(n);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
      n.children.forEach(walk);
    };
    layouted.forEach(walk);
    if (flat.length === 0) return { nodesFlat: flat, bbox: { x: 0, y: 0, w: 1600, h: 900 } };
    return {
      nodesFlat: flat,
      bbox: {
        x: minX - 80,
        y: minY - 60,
        w: maxX - minX + 160,
        h: maxY - minY + 120,
      },
    };
  }, [layouted]);

  const layoutedById = useMemo(() => {
    const m = new Map<string, LayoutedNode>();
    nodesFlat.forEach(n => m.set(n.node.id, n));
    return m;
  }, [nodesFlat]);

  // ============ 新增节点后自动滚动到目标 ============
  useEffect(() => {
    const targetRefId = scrollTargetRefIdRef.current;
    if (!targetRefId) return;
    const container = containerRef.current;
    if (!container) return;
    // 找 layouted 节点（可能是 col-xxx 或 card-xxx）
    let targetLayout = layoutedById.get(`col-${targetRefId}`);
    if (!targetLayout) targetLayout = layoutedById.get(`card-${targetRefId}`);
    if (!targetLayout) return;
    const { x, y, width, height } = targetLayout;
    const rect = container.getBoundingClientRect();
    const containerW = rect.width;
    const containerH = rect.height;
    const newPanX = containerW / 2 - (x + width / 2) * zoom;
    const newPanY = containerH / 2 - (y + height / 2) * zoom;
    setPan({ x: newPanX, y: newPanY });
    scrollTargetRefIdRef.current = null;
  }, [layoutedById, zoom]);

  // ============ 工具栏的新增根节点 = 新增列表 ============
  const addColumn = () => {
    const newId = generateId();
    scrollTargetRefIdRef.current = newId;
    broadcastChange({
      type: 'ADD_COLUMN',
      payload: { title: t('mindmap.defaultColumn'), id: newId },
    } as any);
  };

  // ============ 节点 CRUD：全都映射到看板 Action ============
  const startEdit = (n: VirtualNode) => {
    setEditId(n.id);
    setEditText(n.text);
  };

  const submitEdit = () => {
    if (!editId) return;
    const n = byId.get(editId);
    if (!n) { setEditId(null); return; }
    const txt = editText.trim() || n.text;
    if (txt !== n.text) {
      if (n.kind === 'column') {
        broadcastChange({ type: 'UPDATE_COLUMN', payload: { columnId: n.refId, updates: { title: txt } } });
      } else if (n.kind === 'card') {
        broadcastChange({ type: 'UPDATE_CARD', payload: { cardId: n.refId, updates: { title: txt } } });
      } else if (n.kind === 'item') {
        // 查找所属 cardId + checklistId
        const pair = findItem(n.refId);
        if (pair) {
          broadcastChange({ type: 'UPDATE_CHECKLIST_ITEM', payload: { cardId: pair.cardId, checklistId: pair.checklistId, itemId: n.refId, updates: { text: txt } } });
        }
      }
    }
    setEditId(null);
    setEditText('');
  };

  const findItem = (itemId: string): { cardId: string; checklistId: string } | null => {
    for (const col of boardRef.current.columns) for (const card of col.cards) for (const cl of card.checklists) {
      if (cl.items.some(it => it.id === itemId)) return { cardId: card.id, checklistId: cl.id };
    }
    return null;
  };

  const addChild = (parent: VirtualNode) => {
    if (parent.kind === 'column') {
      // 列加孩子 = 新增卡片
      const cardId = generateId();
      scrollTargetRefIdRef.current = cardId;
      broadcastChange({
        type: 'ADD_CARD',
        payload: {
          columnId: parent.refId,
          card: {
            id: cardId,
            title: t('mindmap.defaultCard'),
            description: '',
            labels: [],
            assignees: [],
            completed: false,
            archived: false,
            checklists: [],
            comments: [],
            attachments: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            order: (childrenMap.get(parent.refId)?.length ?? 0),
          },
        },
      });
    } else if (parent.kind === 'card') {
      // 卡片加孩子 = 新增清单 item（没有清单就先建清单）
      const card = findCard(parent.refId);
      if (!card) return;
      let checklistId: string;
      if (card.checklists.length === 0) {
        checklistId = generateId();
        // ADD_CHECKLIST Action 的 reducer 内部会生成新 id，但 payload 必须传 name
        (broadcastChange as any)({
          type: 'ADD_CHECKLIST',
          payload: { cardId: parent.refId, name: t('mindmap.defaultChecklist') },
        });
      } else {
        checklistId = card.checklists[0].id;
      }
      (broadcastChange as any)({
        type: 'ADD_CHECKLIST_ITEM',
        payload: {
          cardId: parent.refId,
          checklistId,
          text: t('mindmap.defaultItem'),
        } as any,
      });
    } else if (parent.kind === 'item') {
      // 清单 item 加孩子 = 在兄弟后面加同级 item（保持3级简洁）
      const pair = findItem(parent.refId);
      if (!pair) return;
      (broadcastChange as any)({
        type: 'ADD_CHECKLIST_ITEM',
        payload: { cardId: pair.cardId, checklistId: pair.checklistId, text: t('mindmap.defaultItem') } as any,
      });
    }
  };

  const addSibling = (sib: VirtualNode) => {
    if (!sib.parentRef) {
      // 根节点同级 = 新增列
      addColumn();
      return;
    }
    const parent = nodes.find(n => n.refId === sib.parentRef);
    if (!parent) return;
    // 在后面插入同级
    if (parent.kind === 'column') {
      // 不会发生，因为列 parentRef 是 null
    } else if (parent.kind === 'card') {
      const card = findCard(parent.refId);
      if (card?.checklists.length === 0) return addChild(parent);
    }
    // 复用 addChild(parent) 的逻辑但 order = sib.order + 0.5
    const order = sib.order + 0.5;
    if (parent.kind === 'column') {
      broadcastChange({
        type: 'ADD_CARD',
        payload: {
          columnId: parent.refId,
          card: {
            id: generateId(),
            title: t('mindmap.defaultCard'),
            description: '',
            labels: [], assignees: [],
            completed: false, archived: false,
            checklists: [], comments: [], attachments: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            order,
          },
        },
      });
    } else if (parent.kind === 'card') {
      const pair = (() => {
        for (const col of boardRef.current.columns) for (const card of col.cards) if (card.id === parent.refId) {
          if (card.checklists.length > 0) return { checklistId: card.checklists[0].id };
        }
        return null;
      })();
      if (!pair) return addChild(parent);
      (broadcastChange as any)({
        type: 'ADD_CHECKLIST_ITEM',
        payload: {
          cardId: parent.refId, checklistId: pair.checklistId,
          text: t('mindmap.defaultItem'),
        } as any,
      });
    }
  };

  const findCard = (cardId: string): Card | null => {
    for (const col of boardRef.current.columns) for (const card of col.cards) if (card.id === cardId) return card;
    return null;
  };

  const deleteNode = (n: VirtualNode) => {
    if (!confirm(t('mindmap.deleteConfirm', { name: n.text }))) return;
    if (n.kind === 'column') {
      broadcastChange({ type: 'DELETE_COLUMN', payload: { columnId: n.refId } });
    } else if (n.kind === 'card') {
      broadcastChange({ type: 'DELETE_CARD', payload: { cardId: n.refId } });
    } else if (n.kind === 'item') {
      const pair = findItem(n.refId);
      if (pair) broadcastChange({ type: 'DELETE_CHECKLIST_ITEM', payload: { ...pair, itemId: n.refId } });
    }
  };

  const archiveNode = (n: VirtualNode) => {
    if (n.kind === 'column') {
      broadcastChange({ type: 'ARCHIVE_COLUMN', payload: { columnId: n.refId } });
    } else if (n.kind === 'card') {
      broadcastChange({ type: 'ARCHIVE_CARD', payload: { cardId: n.refId } });
    }
  };

  const toggleComplete = (n: VirtualNode) => {
    if (n.kind === 'card') {
      const card = findCard(n.refId);
      if (card) broadcastChange({ type: 'UPDATE_CARD', payload: { cardId: n.refId, updates: { completed: !card.completed } } });
    } else if (n.kind === 'item') {
      const pair = findItem(n.refId);
      if (pair) {
        const card = findCard(pair.cardId);
        const it = card?.checklists.find(c => c.id === pair.checklistId)?.items.find(i => i.id === n.refId);
        if (it) {
          broadcastChange({ type: 'TOGGLE_CHECKLIST_ITEM', payload: { ...pair, itemId: n.refId } });
        }
      }
    }
  };

  const setNodeColor = (n: VirtualNode, color: string) => {
    // 节点颜色同步：写回卡片第一个标签（如果没有就创建一个默认颜色标签）
    if (n.kind === 'card') {
      const card = findCard(n.refId);
      if (!card) return;
      // 查找同颜色已有 label
      let lbl = board.labels.find(l => l.color.toLowerCase() === color.toLowerCase());
      if (!lbl) {
        // 新建临时 label（不走用户 UI 了）
        const newLabelId = `lbl-${generateId()}`;
        dispatch({
          type: 'ADD_LABEL',
          payload: { label: { id: newLabelId, name: t('mindmap.defaultLabel'), color } },
        } as any);
        lbl = { id: newLabelId, name: t('mindmap.defaultLabel'), color };
      }
      const newLabels = card.labels.length > 0 ? [lbl.id, ...card.labels.slice(1)] : [lbl.id];
      broadcastChange({ type: 'UPDATE_CARD', payload: { cardId: n.refId, updates: { labels: newLabels } } });
    } else if (n.kind === 'column') {
      broadcastChange({ type: 'UPDATE_COLUMN', payload: { columnId: n.refId, updates: { // columns 无 color 字段，不改
      } as any } });
    }
  };

  // ======== 收集整个子树（递归后代，包含自身） ========
  const collectSubtree = (rootL: LayoutedNode): LayoutedNode[] => {
    const out: LayoutedNode[] = [rootL];
    const walk = (n: LayoutedNode) => {
      for (const c of n.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(rootL);
    return out;
  };

  // ======== 节点位置（含 pendingPositions 覆盖 + 拖拽 commit） ========
  const getNodePos = (n: LayoutedNode): { x: number; y: number } => {
    const p = pendingPositionsRef.current[n.node.id];
    if (p) return p;
    return { x: n.x, y: n.y };
  };

  const onNodeMouseDown = (e: React.MouseEvent, n: LayoutedNode) => {
    e.stopPropagation();
    e.preventDefault();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const subtree = collectSubtree(n);
    const descendants = subtree.map(m => {
      const pos = getNodePos(m);
      return { id: m.node.id, origX: pos.x, origY: pos.y };
    });
    dragRef.current = {
      nodeId: n.node.id,
      kind: n.node.kind,
      refId: n.node.refId,
      startClientX,
      startClientY,
      didMove: false,
      startTime: Date.now(),
      descendants,
    };
  };

  const commitNodeDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    if (d.didMove) {
      // 落盘后短暂禁用 transition，避免 pending → laid-out 坐标差异产生视觉抖动
      setSettleDrag(true);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => setSettleDrag(false), 250);

      // 把整个子树（根+所有后代）的最终位置都写入 mmPosition，
      // 确保每个节点都被"钉"在拖到的位置，落盘后完全不跳
      for (const desc of d.descendants) {
        const lastPos = pendingPositionsRef.current[desc.id];
        if (!lastPos) continue;
        const savedPos = { x: Math.round(lastPos.x), y: Math.round(lastPos.y) };

        // 通过 byIdRef 反查该节点的 kind 和 refId（用 ref 避免闭包过期）
         const vn = byIdRef.current.get(desc.id);
        if (!vn) continue;

        if (vn.kind === 'column') {
          broadcastChange({
            type: 'UPDATE_COLUMN',
            payload: { columnId: vn.refId, updates: { mmPosition: savedPos } as any },
          });
        } else if (vn.kind === 'card') {
          broadcastChange({
            type: 'UPDATE_CARD',
            payload: { cardId: vn.refId, updates: { mmPosition: savedPos } as any },
          });
        } else if (vn.kind === 'item') {
          const pair = findItem(vn.refId);
          if (pair) {
            broadcastChange({
              type: 'UPDATE_CHECKLIST_ITEM',
              payload: { ...pair, itemId: vn.refId, updates: { mmPosition: savedPos } as any },
            });
          }
        }
      }
    }
    // 延迟一帧清空 pending，确保 mmPosition 先落盘且 layouted 重算完毕
    const descendantsIds = d.descendants.map(desc => desc.id);
    requestAnimationFrame(() => {
      setPendingPositions(pp => {
        const next = { ...pp };
        for (const id of descendantsIds) delete next[id];
        return next;
      });
    });
    const topNodeId = d.nodeId;
    const didMoveFlag = d.didMove;
    queueMicrotask(() => {
      (window as any).__mmDragDidMove = (window as any).__mmDragDidMove || {};
      (window as any).__mmDragDidMove[topNodeId] = didMoveFlag;
      setTimeout(() => {
        if ((window as any).__mmDragDidMove) delete (window as any).__mmDragDidMove[topNodeId];
      }, 150);
      dragRef.current = null;
    });
  };

  const clearAllLayoutOverrides = () => {
    broadcastChange({ type: 'CLEAR_ALL_MM_POSITIONS' } as any);
    setPendingPositions({});
  };

  const fitAll = () => {
    const container = containerRef.current;
    if (!container || nodesFlat.length === 0) return;
    const rect = container.getBoundingClientRect();
    const cw = rect.width - 40;  // 留 20px 内边距
    const ch = rect.height - 40;
    if (cw <= 0 || ch <= 0) return;
    const scaleX = cw / bbox.w;
    const scaleY = ch / bbox.h;
    const newZoom = Math.max(0.25, Math.min(2.5, Math.min(scaleX, scaleY)));
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const newPanX = rect.width / 2 - cx * newZoom;
    const newPanY = rect.height / 2 - cy * newZoom;
    setZoom(+newZoom.toFixed(2));
    setPan({ x: newPanX, y: newPanY });
  };

  // ======== Pan/Zoom: 拖动平移 + 滚轮/触控板缩放（锚点在指针） ========
  const panRef = useRef({ x: 0, y: 0 });
  panRef.current = pan;
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement | SVGElement;
    const isCanvasBg =
      target.classList.contains('mindmap-bg') ||
      target.classList.contains('mindmap-canvas') ||
      target.classList.contains('mindmap-viewport');
    if (e.button === 1 || isCanvasBg || e.shiftKey) {
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      setIsPanning(true);
      e.preventDefault();
    }
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (d) {
        const dxPx = e.clientX - d.startClientX;
        const dyPx = e.clientY - d.startClientY;
        const z = zoomRef.current || 1;
        const dx = dxPx / z;
        const dy = dyPx / z;
        const justCrossed = !d.didMove && Math.hypot(dxPx, dyPx) > 3;
        if (justCrossed || d.didMove) {
          const patch: Record<string, { x: number; y: number }> = {};
          for (const desc of d.descendants) {
            patch[desc.id] = { x: desc.origX + dx, y: desc.origY + dy };
          }
          setPendingPositions(pp => ({ ...pp, ...patch }));
          dragRef.current = { ...d, didMove: true };
        }
        return;
      }
      if (!panStart.current) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPan({ x: panStart.current.panX + dx, y: panStart.current.panY + dy });
    };
    const onUp = () => {
      if (dragRef.current) commitNodeDrag();
      panStart.current = null;
      setIsPanning(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // 滚轮 / 触控板缩放（以鼠标指针为锚点）+ 触控板双指平移
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pinchAccum = 0;

    const onWheel = (e: WheelEvent) => {
      // —— 判断是否是「缩放意图」 ——
      // 1. 用户按住 Ctrl / ⌘ ：肯定是缩放
      // 2. e.ctrlKey=true 且 deltaY 非常小： macOS 触控板捏合手势（浏览器会自动注入 ctrlKey）
      const wantZoom =
        e.ctrlKey ||
        e.metaKey ||
        (Math.abs(e.deltaY) < 6 && Math.abs(e.deltaX) < 6 && (e as any).wheelDeltaY !== undefined && Math.abs((e as any).wheelDeltaY) > 120 * 2 && Math.abs((e as any).wheelDeltaY) !== Math.abs(e.deltaY));

      if (wantZoom) {
        e.preventDefault();
        const viewport = el.getBoundingClientRect();
        const viewportTop = 57; // 顶栏高度 pt-[57px]
        const pointerX = e.clientX - viewport.left;
        const pointerY = e.clientX > 0 ? e.clientY - viewport.top - viewportTop : e.clientY - viewport.top;
        const cx = pointerX - panRef.current.x;
        const cy = pointerY - panRef.current.y;

        // 缩放因子：正向滚(up) = 放大；触控板捏合 = 放大
        let factor = 1;
        const delta = -e.deltaY; // 上滚为正
        if (e.ctrlKey && Math.abs(e.deltaY) < 2) {
          pinchAccum += delta;
          if (Math.abs(pinchAccum) < 0.15) return; // 防抖
          factor = Math.exp(pinchAccum * 0.02);
          pinchAccum = 0;
        } else {
          pinchAccum = 0;
          factor = Math.exp(delta * 0.0015);
        }

        const nextZoom = Math.max(0.25, Math.min(2.5, +(zoomRef.current * factor).toFixed(3)));
        if (nextZoom === zoomRef.current) return;
        const scale = nextZoom / zoomRef.current;
        // 保持(cx, cy)在屏幕不变：新 pan = pointer - scale * cx
        const newPanX = pointerX - cx * scale;
        const newPanY = pointerY - cy * scale;
        setZoom(nextZoom);
        setPan({ x: newPanX, y: newPanY });
      } else {
        // 普通滚轮：上下/左右平移画布（触控板双指滑动）
        if (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) > 0) {
          e.preventDefault();
          setPan(p => ({
            x: p.x - (e.deltaX || 0),
            y: p.y - (e.deltaY || 0),
          }));
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => { el.removeEventListener('wheel', onWheel, { capture: true }); };
  }, []);

  // ===== 关闭 menu =====
  useEffect(() => {
    const onClick = () => { setMenuFor(null); setMenuRect(null); setColorFor(null); setColorRect(null); };
    const t = setTimeout(() => window.addEventListener('click', onClick), 0);
    return () => { clearTimeout(t); window.removeEventListener('click', onClick); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditId(null); setMenuFor(null); setColorFor(null); setMenuRect(null); setColorRect(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const totalCanvasW = Math.max(bbox.w, 1600);
  const totalCanvasH = Math.max(bbox.h, 900);

  const stats = useMemo(() => {
    const cols = board.columns.filter(c => !c.archived).length;
    const cards = board.columns.reduce((s, c) => s + c.cards.filter(x => !x.archived).length, 0);
    const items = board.columns.reduce((s, c) => s + c.cards.reduce((s2, card) => s2 + card.checklists.reduce((s3, cl) => s3 + cl.items.length, 0), 0), 0);
    return { cols, cards, items };
  }, [board.columns]);

  return (
    <div
      className="relative h-full w-full bg-slate-50 dark:bg-slate-900 overflow-hidden mindmap-viewport"
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(100,116,139,0.12) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Top Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex flex-wrap items-center gap-2 p-3 glass backdrop-blur border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2 mr-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-sm">
            <Network size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-tight">
              {t('mindmap.title')}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight flex items-center gap-2">
              <span className="inline-flex items-center gap-1"><Layers size={10}/>{t('mindmap.viewLists', { n: stats.cols })}</span>
              <span className="inline-flex items-center gap-1"><Check size={10}/>{t('mindmap.viewCards', { n: stats.cards })}</span>
              <span className="inline-flex items-center gap-1"><Sparkles size={10}/>{t('mindmap.viewItems', { n: stats.items })}</span>
            </div>
          </div>
        </div>

        <div className="h-6 w-px bg-slate-300 dark:bg-slate-600 mx-1" />

        <button
          onClick={addColumn}
          className="btn-secondary text-xs h-8 px-2.5 inline-flex items-center gap-1"
        >
          <GitBranchPlus size={14}/> {t('mindmap.addRoot')}
        </button>
        <button
          onClick={() => setZoom(z => Math.min(2.5, +(z + 0.1).toFixed(2)))}
          className="btn-ghost h-8 w-8 p-0 inline-flex items-center justify-center"
          title={t('mindmap.zoomIn')}
        >
          <Plus size={16} />
        </button>
        <div className="text-xs text-slate-600 dark:text-slate-300 font-medium tabular-nums w-10 text-center">
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))}
          className="btn-ghost h-8 w-8 p-0 inline-flex items-center justify-center"
          title={t('mindmap.zoomOut')}
        >
          <Minus size={16} />
        </button>
        <button
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          className="btn-ghost text-xs h-8 px-2 inline-flex items-center gap-1"
        >
          {t('mindmap.resetView')}
        </button>
        <button
          onClick={fitAll}
          className="btn-ghost text-xs h-8 px-2 inline-flex items-center gap-1"
          title={t('mindmap.fitAll')}
        >
          <Maximize2 size={14} /> {t('mindmap.fitAll')}
        </button>
        <button
          onClick={clearAllLayoutOverrides}
          className="btn-secondary text-xs h-8 px-2.5 inline-flex items-center gap-1"
          title={t('mindmap.clearLayoutHint')}
        >
          <Layers size={14}/> {t('mindmap.resetLayout')}
        </button>

        <div className="flex-1" />
        <div className="text-[10px] text-indigo-500 font-medium px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-100 dark:border-indigo-500/30">
          {t('mindmap.hintSync')}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="absolute inset-0 pt-[57px] overflow-hidden mindmap-canvas"
        onMouseDown={onCanvasMouseDown}
        style={{ cursor: isPanning ? 'grabbing' : 'default' }}
      >
        <div
          className="mindmap-bg absolute top-[57px] left-0"
          style={{
            width: totalCanvasW,
            height: totalCanvasH,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {/* SVG Lines (超大 buffer + overflow visible 保证线永远不被截断) */}
          <svg
            width={totalCanvasW + 4000}
            height={totalCanvasH + 4000}
            viewBox={`-2000 -2000 ${totalCanvasW + 4000} ${totalCanvasH + 4000}`}
            className="absolute pointer-events-none"
            style={{ left: -2000, top: -2000, overflow: 'visible', zIndex: 5, isolation: 'isolate', pointerEvents: 'none' }}
          >
            <defs>
              {DEFAULT_COLORS.map(c => (
                <linearGradient key={`lg-${c}`} id={`mm-edge-${c.replace('#', '')}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor={c} stopOpacity="0.75"/>
                  <stop offset="100%" stopColor={c} stopOpacity="0.95"/>
                </linearGradient>
              ))}
            </defs>
            {nodesFlat.map(n =>
              n.children.map(ch => {
                const np = getNodePos(n);
                const cp = getNodePos(ch);
                // 端点 +6/-6 偏移，避开节点 ring / 阴影 / 圆角覆盖
                const x1 = np.x + n.width + 6;
                const y1 = np.y + n.height / 2;
                const x2 = cp.x - 6;
                const y2 = cp.y + ch.height / 2;
                const span = Math.max(60, x2 - x1);
                const cx = span * 0.55;
                const d = `M ${x1} ${y1} C ${x1 + cx} ${y1}, ${x2 - cx} ${y2}, ${x2} ${y2}`;
                const col = ch.node.color.replace('#', '');
                return (
                  <path
                    key={`${n.node.id}->${ch.node.id}`}
                    d={d}
                    stroke={`url(#mm-edge-${col})`}
                    strokeWidth={ch.depth === 0 ? 5.5 : ch.depth === 1 ? 4.5 : 3.2}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.95}
                  />
                );
              })
            )}
          </svg>

          {/* Nodes */}
          {nodesFlat.map(n => {
            const isEdit = editId === n.node.id;
            const hasKids = (childrenMap.get(n.node.refId)?.length ?? 0) > 0;
            const pos = getNodePos(n);
            const activeDragNodeId = dragRef.current?.didMove ? dragRef.current.nodeId : null;
            const inDragSubtree = !!activeDragNodeId && (() => {
              const descendants = dragRef.current?.descendants || [];
              return descendants.some(d => d.id === n.node.id);
            })();
            const isTopDrag = activeDragNodeId === n.node.id;
            const isHover = hoverNodeId === n.node.id;
            let zIdx = 100 + n.depth * 10;
            if (isHover) zIdx = 5000 + n.depth * 10;
            if (inDragSubtree) zIdx = 9000;
            if (isTopDrag) zIdx = 9999;
            return (
              <div
                key={n.node.id}
                className={cn(
                  'absolute group rounded-2xl shadow-md select-none',
                  n.depth === 0 && 'shadow-xl ring-2 ring-white/70 dark:ring-slate-700',
                  n.node.completed && 'opacity-80',
                  isTopDrag ? 'cursor-grabbing scale-105' : inDragSubtree ? 'cursor-grabbing' : 'cursor-grab transition-all'
                )}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: n.width,
                  height: n.height,
                  zIndex: zIdx,
                  transition: (isTopDrag || inDragSubtree || settleDrag) ? 'none' : 'all 150ms ease-out',
                  boxShadow: isTopDrag
                    ? '0 30px 60px -15px rgba(99,102,241,0.5), 0 18px 36px -18px rgba(0,0,0,0.35)'
                    : inDragSubtree
                      ? '0 18px 40px -12px rgba(99,102,241,0.28), 0 10px 20px -12px rgba(0,0,0,0.25)'
                      : undefined,
                }}
                onMouseEnter={() => setHoverNodeId(n.node.id)}
                onMouseLeave={() => setHoverNodeId(h => (h === n.node.id ? null : h))}
                onMouseDown={(e) => onNodeMouseDown(e, n)}
                onClick={stop}
              >
                {hasKids && n.depth > 0 && (
                  <button
                    onClick={(e) => { stop(e); setCollapsed(s => ({ ...s, [`k-${n.node.id}`]: !s[`k-${n.node.id}`] })); }}
                    className={cn(
                      'absolute -left-4 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 shadow flex items-center justify-center text-slate-500 hover:text-indigo-500 hover:scale-110 transition-all',
                      collapsed[`k-${n.node.id}`] && 'text-indigo-500 bg-indigo-50 dark:bg-indigo-500/20 border-indigo-200 dark:border-indigo-500/40'
                    )}
                  >
                    {collapsed[`k-${n.node.id}`] ? <ChevronRight size={13} strokeWidth={3} /> : <ChevronDown size={13} strokeWidth={3} />}
                  </button>
                )}

                <div
                  className={cn(
                    'w-full h-full rounded-2xl flex items-center justify-center border border-white/60 dark:border-slate-600/50 backdrop-blur group',
                    n.node.completed && 'line-through decoration-white/80 decoration-2'
                  )}
                  style={{
                    background: `linear-gradient(135deg, ${n.node.color} 0%, ${n.node.color}ee 100%)`,
                    paddingLeft: NODE_PADDING_X,
                    paddingRight: NODE_PADDING_X,
                  }}
                  onDoubleClick={() => startEdit(n.node)}
                >
                  {!isEdit ? (
                    <div
                      className={cn(
                        'font-bold text-white whitespace-normal text-center leading-snug drop-shadow-sm select-none w-full break-words',
                        n.depth === 0 ? 'text-[16px]' : n.depth === 1 ? 'text-[14px]' : 'text-[13px]'
                      )}
                      title={n.node.text + (n.node.description ? `\n---\n${n.node.description.slice(0, 200)}` : '')}
                    >
                      {n.node.text}
                    </div>
                  ) : (
                    <input
                      autoFocus
                      className="w-full bg-white/95 dark:bg-slate-800/95 rounded-lg px-3 py-1.5 text-slate-900 dark:text-white outline-none ring-2 ring-white text-[14px] text-center font-medium"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={submitEdit}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitEdit();
                        if (e.key === 'Escape') { setEditId(null); setEditText(''); }
                      }}
                      onClick={stop}
                    />
                  )}
                </div>

                {/* Floating action bar — 悬停和编辑时统一贴在右上角外侧 */}
                 <div className="absolute -top-9 -right-9 z-30 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-1 group-hover:translate-y-0 pointer-events-none group-hover:pointer-events-auto">
                  <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-1 flex items-center gap-0.5">
                    <button
                      onClick={(e) => {
                        stop(e);
                        if (colorFor === n.node.id) { setColorFor(null); setColorRect(null); return; }
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setColorRect({ left: r.right - 220, top: r.bottom + 6 });
                        setColorFor(n.node.id);
                        setMenuFor(null); setMenuRect(null);
                      }}
                      className="w-7 h-7 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-500/20 dark:hover:text-indigo-300 flex items-center justify-center"
                      title={t('mindmap.tooltip.color')}
                    >
                      <Palette size={14}/>
                    </button>
                    <button
                      onClick={(e) => { stop(e); addChild(n.node); }}
                      className="w-7 h-7 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-300 flex items-center justify-center"
                      title={n.node.kind === 'column' ? t('mindmap.tooltip.addCard') : n.node.kind === 'card' ? t('mindmap.tooltip.addSubtask') : t('mindmap.tooltip.addSibling')}
                    >
                      <PlusCircle size={15}/>
                    </button>
                    <button
                      onClick={(e) => {
                        stop(e);
                        if (menuFor === n.node.id) { setMenuFor(null); setMenuRect(null); return; }
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuRect({ left: r.right - 176, top: r.bottom + 6 });
                        setMenuFor(n.node.id);
                        setColorFor(null); setColorRect(null);
                      }}
                      className="w-7 h-7 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-500/20 dark:hover:text-sky-300 flex items-center justify-center"
                      title={t('mindmap.tooltip.more')}
                    >
                      <Pencil size={14}/>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {nodesFlat.length === 0 && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-lg mb-4">
                <Sparkles size={28} />
              </div>
              <div className="text-slate-800 dark:text-slate-100 font-semibold text-lg mb-1">
                {t('mindmap.emptyTitle')}
              </div>
              <div className="text-slate-500 dark:text-slate-400 text-xs mb-4">
                {t('mindmap.emptySub')}
              </div>
              <button onClick={addColumn} className="btn-primary px-4 h-9 text-xs inline-flex items-center gap-1">
                <Plus size={14}/> {t('mindmap.firstList')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom tip */}
      <div className="absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
        <div className="glass backdrop-blur rounded-xl px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 pointer-events-auto shadow-sm inline-flex items-center flex-wrap gap-x-3 gap-y-1">
          <span className="font-semibold text-violet-600 dark:text-violet-400"><Network size={11} className="inline mr-1"/>{t('mindmap.tip.dragNode')}</span>
          <span><Pencil size={11} className="inline mr-1 text-indigo-500"/>{t('mindmap.tip.dblclick')}</span>
          <span><PlusCircle size={11} className="inline mr-1 text-emerald-500"/>{t('mindmap.tip.addChild')}</span>
          <span><Check size={11} className="inline mr-1 text-sky-500"/>{t('mindmap.tip.menu')}</span>
          <span><Layers size={11} className="inline mr-1 text-rose-500"/>{t('mindmap.tip.resetLayout')}</span>
          <span><Sparkles size={11} className="inline mr-1 text-pink-500"/>{t('mindmap.tip.sync')}</span>
        </div>
      </div>

      {/* Color Picker Portal */}
      {colorFor && colorRect && byId.get(colorFor) && typeof document !== 'undefined' && createPortal((() => {
        const n = byId.get(colorFor)!;
        return (
          <div
            style={{ position: 'fixed', left: Math.max(8, colorRect.left), top: colorRect.top, zIndex: 99999 }}
            className="w-[220px] bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-2 animate-slide-up"
            onClick={stop}
          >
            <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 px-1 pb-1.5 uppercase tracking-wider">
              🎨 {n.kind === 'card' ? t('mindmap.color.card') : t('mindmap.color.label')}
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {DEFAULT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setNodeColor(n, c)}
                  className={cn(
                    'w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 shrink-0',
                    n.color.toLowerCase() === c.toLowerCase() ? 'border-slate-700 dark:border-white scale-110 shadow' : 'border-transparent'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            {n.kind === 'card' && (
              <label className="mt-2 flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-indigo-500 cursor-pointer px-1">
                <Palette size={10}/> {t('mindmap.color.custom')}
                <input
                  type="color"
                  value={n.color}
                  onChange={(e) => setNodeColor(n, e.target.value)}
                  className="w-5 h-5 p-0 border-0 bg-transparent cursor-pointer"
                />
              </label>
            )}
          </div>
        );
      })(), document.body)}

      {/* Menu Portal */}
      {menuFor && menuRect && byId.get(menuFor) && typeof document !== 'undefined' && createPortal((() => {
        const n = byId.get(menuFor)!;
        const hasChildren = (childrenMap.get(n.refId)?.length ?? 0) > 0;
        return (
          <div
            style={{ position: 'fixed', left: Math.max(8, menuRect.left), top: menuRect.top, zIndex: 99999 }}
            className="w-48 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 py-1.5 animate-slide-up overflow-hidden"
            onClick={stop}
          >
            <button onClick={() => startEdit(n)} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-300 inline-flex items-center gap-2">
              <Pencil size={13}/> {t('mindmap.menu.rename')}
            </button>
            <button onClick={() => addChild(n)} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-300 inline-flex items-center gap-2">
              <Plus size={13}/> {t('mindmap.menu.add', { kind: n.kind === 'column' ? t('mindmap.menu.add.column') : n.kind === 'card' ? t('mindmap.menu.add.card') : t('mindmap.menu.add.item') })}
            </button>
            {n.kind !== 'item' && (
              <button onClick={() => addSibling(n)} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-300 inline-flex items-center gap-2">
                <GitBranchPlus size={13}/> {t('mindmap.menu.addAfter', { kind: n.kind === 'column' ? t('mindmap.menu.add.column') : n.kind === 'card' ? t('mindmap.menu.add.siblingCard') : t('mindmap.menu.add.siblingItem') })}
              </button>
            )}
            {hasChildren && (
              <button
                onClick={() => setCollapsed(s => ({ ...s, [`k-${n.id}`]: !s[`k-${n.id}`] }))}
                className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/20 hover:text-indigo-600 dark:hover:text-indigo-300 inline-flex items-center gap-2"
              >
                {collapsed[`k-${n.id}`] ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
                {collapsed[`k-${n.id}`] ? t('mindmap.menu.expand') : t('mindmap.menu.collapse')}
              </button>
            )}
            {(n.kind === 'card' || n.kind === 'item') && (
              <button onClick={() => toggleComplete(n)} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 hover:text-emerald-600 dark:hover:text-emerald-300 inline-flex items-center gap-2">
                <Check size={13}/> {n.completed ? t('mindmap.menu.markUndone') : t('mindmap.menu.markDone')}
              </button>
            )}
            {(n.kind === 'column' || n.kind === 'card') && (
              <button onClick={() => archiveNode(n)} className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-500/20 hover:text-amber-600 dark:hover:text-amber-300 inline-flex items-center gap-2">
                {n.archived ? <ArchiveRestore size={13}/> : <Archive size={13}/>}
                {n.archived ? t('mindmap.menu.unarchive') : t('mindmap.menu.archive')}
              </button>
            )}
            <div className="border-t border-slate-100 dark:border-slate-700 my-1"/>
            <button onClick={() => deleteNode(n)} className="w-full px-3 py-1.5 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/20 inline-flex items-center gap-2">
              <Trash2 size={13}/> {t('mindmap.menu.delete')}
            </button>
          </div>
        );
      })(), document.body)}
    </div>
  );
}
