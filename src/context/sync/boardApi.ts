import { supabase } from '@/lib/supabase';
import type { Board, User } from '@/types';
import type { BoardState } from '../types';

export const BACKUP_KEY = 'trello_local_backup_v1';
export const MAX_BACKUP_AGE_MS = 6 * 60 * 60 * 1000; // 6 小时
export const SYNC_CHANNEL = 'trello-sync-channel';
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

export function readLocalBackup(): LocalBackup | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.boards)) return null;
    return parsed as LocalBackup;
  } catch {
    return null;
  }
}

export function writeLocalBackup(data: WorkspaceSnapshot, savedAt = new Date().toISOString()): string {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...data, savedAt }));
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
      order: typeof c.order === 'number' ? c.order : cardIdx,
      status: c.status || (c.completed ? 'complete' : 'todo'),
    }));
    return {
      ...col,
      order: typeof col.order === 'number' ? col.order : colIdx,
      cards,
    };
  });

  return {
    id: b.id,
    title: b.title || '',
    background: b.background || DEFAULT_BG,
    labels: Array.isArray(b.labels) ? b.labels : [],
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
 * 从 /api/members 加载成员列表（返回 null 表示会话未就绪或接口异常，调用方应保留当前用户缓存）
 */
export async function fetchMembersList(): Promise<User[] | null> {
  try {
    const res = await fetch('/api/members', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json();
    const members = Array.isArray(body?.members) ? body.members : [];
    return members.map((m: any) => ({
      id: m.id,
      name: m.name,
      email: m.email || '',
      avatar: m.avatar || '',
      color: m.color || '#3B82F6',
      role: m.role === 'admin' ? 'admin' : 'member',
      lang: m.lang === 'en' ? 'en' : 'zh',
      password: '',
    }));
  } catch {
    return null;
  }
}

/**
 * 统一从云端拉取完整工作区快照（合并原 loadData 与 refetchFromServer 的重复查询）
 */
export async function fetchRemoteSnapshot(
  fallbackUsers: User[],
  fallbackAppearance?: Partial<WorkspaceSnapshot> | null,
): Promise<{ snapshot: WorkspaceSnapshot; settingsLoaded: boolean }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('No Supabase URL configured');

  const withTimeout = <T,>(promise: PromiseLike<T>, ms = 8000, label = 'request'): Promise<T> =>
    Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out`)), ms),
      ),
    ]);

  const [{ data: boardsData, error: boardsErr }, membersRows] = await withTimeout(
    Promise.all([
      supabase
        .from('boards')
        .select('*')
        .or('is_deleted.is.null,is_deleted.eq.false')
        .order('order', { ascending: true }),
      fetchMembersList(),
    ]),
    8000,
    'boards+members',
  );

  if (boardsErr) throw boardsErr;

  let settingsData: any = null;
  try {
    const { data, error } = await withTimeout(
      supabase.from('workspace_settings').select('*').limit(1).maybeSingle(),
      8000,
      'workspace_settings',
    );
    if (!error && data) {
      settingsData = data;
    } else if (error) {
      const { data: rows } = await withTimeout(
        supabase.from('workspace_settings').select('*').limit(1),
        5000,
        'workspace_settings_fallback',
      );
      if (Array.isArray(rows) && rows.length > 0) settingsData = rows[0];
    }
  } catch (e) {
    console.warn('[sync] workspace_settings 读取异常，沿用现有外观设置:', e);
  }

  const boards = (boardsData || []).map((b: any, i: number) => mapBoardRow(b, i));
  const users = membersRows ?? fallbackUsers;
  const ws = settingsData || {};
  const fb = fallbackAppearance || {};

  const snapshot: WorkspaceSnapshot = {
    boards,
    users,
    workspaceBackground: ws.workspace_background || fb.workspaceBackground || DEFAULT_BG,
    loginBackground: ws.login_background || fb.loginBackground || DEFAULT_LOGIN_BG,
    portalBackground: ws.portal_background || fb.portalBackground || DEFAULT_BG,
    crmBackground: ws.crm_background || fb.crmBackground || DEFAULT_BG,
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
    logo: ws.logo || fb.logo || '',
  };

  return { snapshot, settingsLoaded: Boolean(settingsData) };
}

/** 创建云端看板 */
export async function createBoardApi(params: {
  id: string;
  title: string;
  background: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'create', ...params }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null);
    return { ok: false, error: `HTTP ${res.status} ${body?.error || ''}`.trim() };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network error' };
  }
}

/** 软删除云端看板 */
export async function deleteBoardApi(boardId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/boards?id=${encodeURIComponent(boardId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok || res.status === 404) return { ok: true };
    const body = await res.json().catch(() => null);
    return { ok: false, error: `HTTP ${res.status} ${body?.error || ''}`.trim() };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network error' };
  }
}

/** 排序云端看板 */
export async function reorderBoardsApi(orderedIds: string[]): Promise<boolean> {
  try {
    const res = await fetch('/api/boards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'reorder', orderedIds }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 保存工作区外观字段（仅发送变更字段） */
export async function saveAppearanceFieldApi(fields: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch('/api/workspace-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(fields),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 更新当前用户非敏感资料 */
export async function updateMyProfileApi(
  userId: string,
  updates: Partial<User>,
): Promise<boolean> {
  try {
    const res = await fetch('/api/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        id: userId,
        name: updates.name,
        email: updates.email,
        avatar: updates.avatar,
        color: updates.color,
        lang: updates.lang,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

