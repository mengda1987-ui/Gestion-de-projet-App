/**
 * Action → patch ops 映射（纯函数，无副作用）
 *
 * 设计目标（对应审计 C1/M2/M9）：
 *   - 只发送「必要的最小增量」，绝不发送整板 JSON
 *   - 拖拽只发一张卡的 position，不再把整列 order 重编号
 *   - 改卡片只发被改的字段，多人同时编辑不同字段不会互相覆盖
 *
 * 落库路径：/api/board/patch → apply_board_patch() RPC（带版本校验 + 行锁）
 */
import type { Action } from '@/context/actions';
import type { Board } from '@/types';

/** 与 supabase/migrations/add_board_patch_rpc.sql 中的 op 一一对应 */
export type BoardPatchOp =
  | { op: 'move_card'; cardId: string; toColumnId: string; position: number }
  | { op: 'add_card'; columnId: string; card: Record<string, unknown> }
  | { op: 'update_card'; cardId: string; fields: Record<string, unknown> }
  | { op: 'remove_card'; cardId: string }
  | { op: 'add_column'; column: Record<string, unknown> }
  | { op: 'update_column'; columnId: string; fields: Record<string, unknown> }
  | { op: 'move_column'; columnId: string; position: number }
  | { op: 'remove_column'; columnId: string }
  | { op: 'upsert_mm_node'; node: Record<string, unknown> }
  | { op: 'update_mm_node'; nodeId: string; fields: Record<string, unknown> }
  | { op: 'remove_mm_node'; nodeId: string };

/** 一个 patch 请求体：ops + 可选的看板级元数据 */
export interface BoardPatchPayload {
  ops: BoardPatchOp[];
  title?: string;
  background?: string;
  labels?: unknown[];
  /** 看板级非 columns/mindmap 字段（emoji / iconBg / iconImage / visibleTo / order） */
  data?: Record<string, unknown>;
  /**
   * 写入意图。用户主动操作（拖拽/删卡/编辑）标为 'user_edit'，
   * 服务端据此区分「用户动作」与「异常批量覆盖」，后者直接阻断。
   */
  intent?: 'user_edit';
}

/** position 步长：留出中点插入空间，避免频繁整体重排 */
export const POSITION_STEP = 1024;

/**
 * 计算「插入/移动到 index 位置」时应使用的 position。
 * 取前后相邻项的中点，只写 1 行，不再整列重编号（审计维度五）。
 */
export function positionForIndex(
  siblings: { position?: number; order?: number; [key: string]: any }[],
  index: number,
): number {
  const posOf = (i: number): number | null => {
    const s = siblings[i];
    if (!s) return null;
    const p = typeof s.position === 'number' ? s.position : s.order;
    return typeof p === 'number' && isFinite(p) ? p : null;
  };

  const prev = index > 0 ? posOf(index - 1) : null;
  const next = posOf(index);

  if (prev === null && next === null) return POSITION_STEP;
  if (prev === null) return (next as number) - POSITION_STEP;
  if (next === null) return prev + POSITION_STEP;
  if (next - prev <= 1e-6) return prev + POSITION_STEP / 2;
  return (prev + next) / 2;
}

type AnyCard = { id: string; [key: string]: any };
type AnyColumn = { id: string; cards: AnyCard[]; [key: string]: any };

/** 是否是「与持久化无关」的纯 UI action */
export function isLocalOnlyAction(action: Action): boolean {
  switch (action.type) {
    case 'SET_CURRENT_USER':
    case 'SET_APP_SECTION':
    case 'SET_VIEW_MODE':
    case 'SET_FILTERS':
    case 'TOGGLE_DARK_MODE':
    case 'SET_DARK_MODE':
    case 'SET_ONLINE_USERS':
    case 'SET_CURRENT_BOARD':
    case 'APPLY_REMOTE_UPDATE':
    case 'APPLY_EXTERNAL_STATE':
    case 'LOAD_ALL_DATA':
    case 'UPDATE_USER':
    case 'ADD_USER':
    case 'DELETE_USER':
    case 'CLEAR_ALL_MM_POSITIONS':
      return true;
    default:
      return false;
  }
}

/**
 * 把一次 UI Action 翻译成 patch。
 * 返回 null 表示「与持久化无关」，调用方应直接跳过、不产生网络请求。
 *
 * board 必须是 **reducer 处理之后** 的看板（见 BoardContext 的 queuePatchForAction）。
 */
export function actionToPatch(action: Action, board: Board): BoardPatchPayload | null {
  const columns = (board.columns || []) as unknown as AnyColumn[];
  const allCards = columns.flatMap(c => c.cards || []);

  switch (action.type) {
    // ===== 看板级元数据（不动 columns/mindmap）=====
    case 'RENAME_BOARD':
      return { ops: [], title: action.payload.title };

    case 'UPDATE_BOARD':
    case 'UPDATE_BOARD_DATA': {
      let updates: any;
      if (action.type === 'UPDATE_BOARD') {
        updates = action.payload;
      } else {
        if (action.payload.boardId !== board.id) return null;
        updates = action.payload.updates;
      }
      const out: BoardPatchPayload = { ops: [] };
      if (updates.title !== undefined) out.title = updates.title;
      if (updates.background !== undefined) out.background = updates.background;
      if (updates.labels !== undefined) out.labels = updates.labels;
      const data: Record<string, unknown> = {};
      for (const key of ['emoji', 'iconBg', 'iconImage', 'visibleTo', 'order'] as const) {
        if (updates[key] !== undefined) data[key] = updates[key];
      }
      if (Object.keys(data).length > 0) out.data = data;
      return out;
    }

    case 'SET_BOARD_EMOJI':
      return action.payload.boardId === board.id
        ? { ops: [], data: { emoji: action.payload.emoji } }
        : null;

    case 'SET_BOARD_ICON': {
      if (action.payload.boardId !== board.id) return null;
      const p = action.payload as any;
      const data: Record<string, unknown> = {};
      if ('emoji' in p) data.emoji = p.emoji ?? null;
      if ('iconBg' in p) data.iconBg = p.iconBg ?? null;
      if ('iconImage' in p) data.iconImage = p.iconImage ?? null;
      return { ops: [], data };
    }

    case 'ADD_LABEL': {
      const lbl = action.payload.label;
      const existing = (board.labels || []).filter(l => l.id !== lbl.id);
      return { ops: [], labels: [...existing, { id: lbl.id, name: lbl.name, color: lbl.color }] };
    }

    case 'UPDATE_LABEL':
      return {
        ops: [],
        labels: (board.labels || []).map(l =>
          l.id === action.payload.labelId ? { ...l, ...action.payload.updates } : l),
      };

    case 'DELETE_LABEL':
      return { ops: [], labels: (board.labels || []).filter(l => l.id !== action.payload.labelId) };

    // ===== 列 =====
    case 'ADD_COLUMN': {
      const col = columns.find(c => c.id === action.payload.id);
      if (!col) return null;
      return {
        ops: [{
          op: 'add_column',
          column: {
            id: col.id,
            title: col.title,
            archived: col.archived ?? false,
            position: typeof col.order === 'number' ? col.order : 0,
            cards: col.cards || [],
          },
        }],
      };
    }

    case 'UPDATE_COLUMN':
      return {
        ops: [{
          op: 'update_column',
          columnId: action.payload.columnId,
          fields: action.payload.updates as Record<string, unknown>,
        }],
      };

    case 'ARCHIVE_COLUMN': {
      const col = columns.find(c => c.id === action.payload.columnId);
      if (!col) return null;
      return { ops: [{ op: 'update_column', columnId: col.id, fields: { archived: !col.archived } }] };
    }

    case 'DELETE_COLUMN':
      return { ops: [{ op: 'remove_column', columnId: action.payload.columnId }] };

    case 'REORDER_COLUMNS': {
      // reducer 已重排数组：目标位置上的列即被移动的列（审计 M9：这里会写 position）
      const moved = columns[action.payload.toIndex];
      if (!moved) return null;
      const others = columns.filter(c => c.id !== moved.id);
      return {
        ops: [{
          op: 'move_column',
          columnId: moved.id,
          position: positionForIndex(others, action.payload.toIndex),
        }],
      };
    }


    // ===== 卡片 =====
    case 'MOVE_CARD': {
      const target = columns.find(c => c.id === action.payload.toColumnId);
      const moved = target?.cards?.[action.payload.toIndex];
      if (!target || !moved) return null;
      const siblings = target.cards.filter(c => c.id !== moved.id);
      return {
        ops: [{
          op: 'move_card',
          cardId: moved.id,
          toColumnId: target.id,
          position: positionForIndex(siblings, action.payload.toIndex),
        }],
      };
    }

    case 'REORDER_CARDS': {
      const col = columns.find(c => c.id === action.payload.columnId);
      const moved = col?.cards?.[action.payload.toIndex];
      if (!col || !moved) return null;
      const siblings = col.cards.filter(c => c.id !== moved.id);
      return {
        ops: [{
          op: 'move_card',
          cardId: moved.id,
          toColumnId: col.id,
          position: positionForIndex(siblings, action.payload.toIndex),
        }],
      };
    }

    case 'ADD_CARD': {
      const col = columns.find(c => c.id === action.payload.columnId);
      const card = col?.cards?.[0]; // reducer 插入到最前面
      if (!col || !card) return null;
      return { ops: [{ op: 'add_card', columnId: col.id, card: card as Record<string, unknown> }] };
    }

    case 'UPDATE_CARD':
      // 只发变化字段：A 改标题、B 改日期互不覆盖（审计 M2）
      return {
        ops: [{
          op: 'update_card',
          cardId: action.payload.cardId,
          fields: action.payload.updates as Record<string, unknown>,
        }],
      };

    case 'DELETE_CARD':
      // 【关键修复 2026-11-11】原实现发的是 update_card + {deleted:true}，
      // 但 RPC 的 update_card 只会「写一个字段」，并不会移除卡片。
      // 而前端 reducer 是真删除 → 云端仍留有卡片 → 下次拉取「删掉的卡片又回来」。
      // 正确做法：用 RPC 支持的 remove_card，真正从列里移除。
      return { ops: [{ op: 'remove_card', cardId: action.payload.cardId }] };

    case 'ARCHIVE_CARD': {
      const card = allCards.find(c => c.id === action.payload.cardId);
      if (!card) return null;
      return { ops: [{ op: 'update_card', cardId: card.id, fields: { archived: !card.archived } }] };
    }

    case 'CYCLE_CARD_STATUS': {
      const card = allCards.find(c => c.id === action.payload.cardId);
      if (!card) return null;
      return { ops: [{ op: 'update_card', cardId: card.id, fields: { status: card.status } }] };
    }

    // ===== 单卡片字段更新（标签/成员/附件/评论/清单）=====
    case 'TOGGLE_CARD_LABEL':
    case 'TOGGLE_CARD_ASSIGNEE':
    case 'TOGGLE_CARD_CONTACT':
    case 'SET_COVER_IMAGE':
    case 'ADD_ATTACHMENT':
    case 'DELETE_ATTACHMENT':
    case 'ADD_COMMENT':
    case 'TOGGLE_CHECKLIST_ITEM':
    case 'UPDATE_CHECKLIST_ITEM':
    case 'ADD_CHECKLIST_ITEM':
    case 'ADD_CHECKLIST':
    case 'DELETE_CHECKLIST':
    case 'DELETE_CHECKLIST_ITEM': {
      const cardId = (action.payload as any).cardId as string | undefined;
      if (!cardId) return null;
      const card = allCards.find(c => c.id === cardId);
      if (!card) return null;
      const fields = pickCardPatchFields(action, card);
      if (!fields) return null;
      return { ops: [{ op: 'update_card', cardId, fields }] };
    }

    // ===== 心智图 =====
    case 'ADD_MINDMAP_NODE': {
      const nodes = board.mindmap || [];
      const node = nodes[nodes.length - 1];
      if (!node) return null;
      return { ops: [{ op: 'upsert_mm_node', node: node as unknown as Record<string, unknown> }] };
    }

    case 'UPDATE_MINDMAP_NODE':
      return {
        ops: [{
          op: 'update_mm_node',
          nodeId: action.payload.nodeId,
          fields: action.payload.updates as Record<string, unknown>,
        }],
      };

    case 'DELETE_MINDMAP_NODE':
      return { ops: [{ op: 'remove_mm_node', nodeId: action.payload.nodeId }] };

    default:
      return null;
  }
}

/** 从 reducer 更新后的卡片中挑出应提交的字段子集 */
function pickCardPatchFields(action: Action, card: AnyCard): Record<string, unknown> | null {
  switch (action.type) {
    case 'TOGGLE_CARD_LABEL':
      return { labels: card.labels };
    case 'TOGGLE_CARD_ASSIGNEE':
      return { assignees: card.assignees };
    case 'TOGGLE_CARD_CONTACT':
      return { contacts: card.contacts };
    case 'SET_COVER_IMAGE':
      return { coverImage: card.coverImage ?? null };
    case 'ADD_ATTACHMENT':
    case 'DELETE_ATTACHMENT':
      return { attachments: card.attachments, coverImage: card.coverImage ?? null };
    case 'ADD_COMMENT':
      return { comments: card.comments };
    case 'TOGGLE_CHECKLIST_ITEM':
    case 'UPDATE_CHECKLIST_ITEM':
    case 'ADD_CHECKLIST_ITEM':
    case 'ADD_CHECKLIST':
    case 'DELETE_CHECKLIST':
    case 'DELETE_CHECKLIST_ITEM':
      return { checklists: card.checklists };
    default:
      return null;
  }
}

