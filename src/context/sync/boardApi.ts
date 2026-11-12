import type { Board, User } from '@/types';
import type { BoardState } from '../types';

export const BACKUP_KEY = 'trello_local_backup_v1';
export const MAX_BACKUP_AGE_MS = 6 * 60 * 60 * 1000; // 6 小时
export const DEFAULT_BG = '#f5f5f7';
export const DEFAULT_LOGIN_BG = 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)';

export interface WorkspaceSnapshot {
  boards: Board[];
  users: User[];
  workspaceBackground: string;
  loginBackground: string;
  portalBackground: string;
  crmBackground: string;
  portalImageOpacity: number;
  crmImageOpacity: number;
  logo: string;
}

export interface LocalBackup extends WorkspaceSnapshot {
  savedAt: string;
}

export interface SyncIndicatorState {
  kind: 'idle' | 'pending' | 'error';
  label: string;
  detail?: string;
  code?: string;
  permanent?: boolean;
}

export function buildSnapshot(state: BoardState): WorkspaceSnapshot {
  return {
    boards: state.boards,
    users: state.users,
    workspaceBackground: state.workspaceBackground,
    loginBackground: state.loginBackground,
    portalBackground: state.portalBackground,
    crmBackground: state.crmBackground,
    portalImageOpacity: state.portalImageOpacity,
    crmImageOpacity: state.crmImageOpacity,
    logo: state.logo,
  };
}

export function readLocalBackup(accountId: string): LocalBackup | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(BACKUP_KEY + '.' + accountId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.boards) || !Number.isFinite(Date.parse(parsed.savedAt)) || Date.now() - Date.parse(parsed.savedAt) > MAX_BACKUP_AGE_MS) return null;
    return parsed as LocalBackup;
  } catch {
    return null;
  }
}

export function writeLocalBackup(data: WorkspaceSnapshot, savedAt = new Date().toISOString(), accountId = ''): string {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BACKUP_KEY + '.' + accountId, JSON.stringify({ ...data, savedAt }));
    }
  } catch {}
  return savedAt;
}

/**
 * 将数据库单行看板映射为前端 Board 结构（唯一映射入口，杜绝漏字段）
 */
export function mapBoardRow(b: any, idx = 0): Board {
  const rawColumns = Array.isArray(b.data?.columns) ? b.data.columns : [];
  const columns = rawColumns.map((col: any, colIdx: number) => {
    const rawCards = Array.isArray(col.cards) ? col.cards : [];
    const cards = rawCards.map((c: any, cardIdx: number) => ({
      ...c,
      title: typeof c.title === 'string' ? c.title : '',
      description: typeof c.description === 'string' ? c.description : '',
      labels: Array.isArray(c.labels) ? c.labels : [],
      assignees: Array.isArray(c.assignees) ? c.assignees : [],
      checklists: Array.isArray(c.checklists) ? c.checklists.map((cl: any) => ({ ...cl, name: cl.name || '', items: Array.isArray(cl.items) ? cl.items.map((it: any) => ({ ...it, text: it.text || '', completed: Boolean(it.completed) })) : [] })) : [],
      comments: Array.isArray(c.comments) ? c.comments : [],
      attachments: Array.isArray(c.attachments) ? c.attachments : [],
      order: cardIdx,
      status: c.status || (c.completed ? 'complete' : 'todo'),
    }));
    return {
      ...col,
      title: typeof col.title === 'string' ? col.title : '',
      archived: Boolean(col.archived),
      order: colIdx,
      cards,
    };
  });

  return {
    id: b.id,
    title: b.title || '',
    background: b.background || DEFAULT_BG,
    labels: Array.isArray(b.labels) ? b.labels.filter((l: any) => l && typeof l.id === 'string').map((l: any) => ({ ...l, name: l.name || '', color: l.color || '#3B82F6' })) : [],
    columns,
    mindmap: Array.isArray(b.data?.mindmap) ? b.data.mindmap : [],
    emoji: b.emoji || undefined,
    iconBg: b.iconBg || undefined,
    iconImage: b.iconImage || undefined,
    visibleTo: Array.isArray(b.visibleTo) ? b.visibleTo : [],
    order: typeof b.order === 'number' ? b.order : idx,
    createdAt: b.created_at || new Date().toISOString(),
    updatedAt: b.updated_at || new Date().toISOString(),
    version: typeof b.version === 'number' ? b.version : 0,
    isDeleted: b.is_deleted === true,
  };
}
/**
 * 统一从云端拉取完整工作区快照（合并原 loadData 与 refetchFromServer 的重复查询）
 */
export async function fetchRemoteSnapshot(
  fallbackUsers: User[],
  fallbackAppearance?: Partial<WorkspaceSnapshot> | null,
  accountId?: string,
): Promise<{ snapshot: WorkspaceSnapshot; settingsLoaded: boolean }> {
  const response = await fetch('/api/snapshot', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error('Snapshot HTTP ' + response.status), { status: response.status });
  const { boards: boardsData, users: membersRows, settings: settingsData, accountId: owner } = await response.json();
  if (accountId && accountId !== owner) throw Object.assign(new Error('Account changed'), { status: 401 });
  const boards = (boardsData || []).map((b: any, i: number) => mapBoardRow(b, i));
  const users = membersRows ?? fallbackUsers;
  const ws = settingsData || {};
  const fb = fallbackAppearance || {};

  const snapshot: WorkspaceSnapshot = {
    boards,
    users,
    workspaceBackground: ws.workspace_background ?? fb.workspaceBackground ?? DEFAULT_BG,
    loginBackground: ws.login_background ?? fb.loginBackground ?? DEFAULT_LOGIN_BG,
    portalBackground: ws.portal_background ?? fb.portalBackground ?? DEFAULT_BG,
    crmBackground: ws.crm_background ?? fb.crmBackground ?? DEFAULT_BG,
    portalImageOpacity:
      typeof ws.portal_image_opacity === 'number'
        ? ws.portal_image_opacity
        : typeof fb.portalImageOpacity === 'number'
          ? fb.portalImageOpacity
          : 1,
    crmImageOpacity:
      typeof ws.crm_image_opacity === 'number'
        ? ws.crm_image_opacity
        : typeof fb.crmImageOpacity === 'number'
          ? fb.crmImageOpacity
          : 1,
    logo: ws.logo ?? fb.logo ?? '',
  };

  return { snapshot, settingsLoaded: Boolean(settingsData) };
}
