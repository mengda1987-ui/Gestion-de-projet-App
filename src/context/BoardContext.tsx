'use client';
import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoardState, createInitialState } from './types';
import { Action } from './actions';
import { settingsReducer } from './reducers/settingsReducer';
import { boardOpsReducer } from './reducers/boardOpsReducer';
import { columnOpsReducer } from './reducers/columnOpsReducer';
import { cardOpsReducer } from './reducers/cardOpsReducer';
import { checklistOpsReducer } from './reducers/checklistOpsReducer';
import { mindmapOpsReducer } from './reducers/mindmapOpsReducer';
import { syncMindMapCards } from './middlewares/mindmapSync';
import { syncBoardInList } from './middlewares/boardListSync';
import { supabase } from '@/lib/supabase';
import {
  actionToPatch,
  isLocalOnlyAction,
  type BoardPatchPayload,
} from './patch/ops';
import {
  enqueue as outboxEnqueue,
  dequeue as outboxDequeue,
  listAll as outboxListAll,
  newEntryId,
  type OutboxEntry,
} from './patch/outbox';
import {
  isPatchRpcEnabled,
  submitEntry,
  beaconSubmit,
  backoffDelay,
  type PatchResult,
} from './patch/client';
// 注意：不再导入 MOCK_BOARDS/MOCK_USERS。
// 历史遗留的 mock 兜底会把示例数据写回生产数据库（曾导致「产品开发项目」污染），
// 现已改为「服务器不可用 → 空数据 + 禁止写回」。
import type { User, Board } from '@/types';

const BACKUP_KEY = 'trello_local_backup_v1';
const SYNC_CHANNEL = 'trello-sync-channel';

interface BackupData {
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

interface LocalBackup extends BackupData {
  savedAt: string;
  pending?: boolean; // 是否有尚未同步到服务器的本地改动
}

function readLocalBackup(): LocalBackup | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.boards)) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface BoardContextType {
  state: BoardState;
  dispatch: React.Dispatch<Action>;
  broadcastChange: (action: Action) => void;
  saveError: string | null;
  /** 登出：清除服务端会话 Cookie 并重置本地登录态 */
  logout: () => Promise<void>;
}

const BoardContext = createContext<BoardContextType | undefined>(undefined);

function baseReducer(state: BoardState, action: Action): BoardState {
  let newState = state;
  
  newState = settingsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = boardOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = columnOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = cardOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = checklistOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  newState = mindmapOpsReducer(newState, action);
  if (newState !== state) return newState;
  
  return state;
}

function boardReducer(state: BoardState, action: Action): BoardState {
  const skipSync = (action as any)._skipSync === true;
  let newState = baseReducer(state, action);
  if (!skipSync) newState = syncMindMapCards(newState, action);
  // SET_BOARDS_ORDER 和 REORDER_BOARDS 不需要 boardListSync（会覆盖 order 值）
  if (action.type !== 'SET_BOARDS_ORDER' && action.type !== 'REORDER_BOARDS') {
    newState = syncBoardInList(newState);
  }
  return newState;
}

function buildBackup(state: BoardState): BackupData {
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

/**
 * 加载成员列表。
 *
 * users 表对 anon 关闭后不能再直连 Supabase（审计 C3），改走 /api/members。
 * 返回 null 表示「会话已失效或服务端不可用」——调用方应保留本地缓存，
 * 绝不能当成「没有成员」处理（否则会把空列表写回，造成数据丢失）。
 */
async function fetchMembersForLoad(): Promise<any[] | null> {
  try {
    const res = await fetch('/api/members', { credentials: 'same-origin' });
    if (!res.ok) {
      console.warn('[load] 成员列表读取失败:', res.status);
      return null;
    }
    const body = await res.json();
    const members = Array.isArray(body?.members) ? body.members : [];
    // 统一成 rowsToBackupData 期望的形状（服务端已不含口令）
    return members.map((m: any) => ({
      id: m.id,
      name: m.name,
      email: m.email || '',
      avatar: m.avatar || '',
      color: m.color || '#3B82F6',
      role: m.role || 'member',
      lang: m.lang || 'zh',
      password: '', // 服务端不再下发；保留空串以兼容旧结构
    }));
  } catch (e) {
    console.warn('[load] 成员列表请求异常:', e);
    return null;
  }
}

// 将数据库行映射为 BackupData（与 loadData 中的映射保持一致）
function rowsToBackupData(usersData: any[], boardsData: any[], settingsData: any): BackupData {
  const users: User[] = (usersData || []).map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email || '',
    avatar: u.avatar || '',
    color: u.color || '#3B82F6',
    role: u.role || 'member',
    password: u.password || '',
    lang: u.lang || 'zh',
  }));

  const boards: Board[] = (boardsData || []).map((b: any) => ({
    id: b.id,
    title: b.title,
    background: b.background || '#f5f5f7',
    labels: b.labels || [],
    columns: b.data?.columns || [],
    mindmap: b.data?.mindmap || [],
    emoji: b.emoji || undefined,
    iconBg: b.iconBg || undefined,
    iconImage: b.iconImage || undefined,
    visibleTo: b.visibleTo || [],
    order: b.order ?? 0,
    createdAt: b.created_at || new Date().toISOString(),
    updatedAt: b.updated_at || new Date().toISOString(),
    // 乐观锁版本号：仅用于前端合并判断，不参与持久化内容比较
    version: typeof b.version === 'number' ? b.version : 0,
  } as Board));

  const wsSettings = settingsData || {};

  return {
    boards,
    users,
    workspaceBackground: wsSettings.workspace_background || '#f5f5f7',
    loginBackground: wsSettings.login_background || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
    portalBackground: wsSettings.portal_background || '#f5f5f7',
    crmBackground: wsSettings.crm_background || '#f5f5f7',
    portalImageOpacity: typeof wsSettings.portal_image_opacity === 'number' ? wsSettings.portal_image_opacity : 1,
    crmImageOpacity: typeof wsSettings.crm_image_opacity === 'number' ? wsSettings.crm_image_opacity : 1,
    logo: wsSettings.logo || '',
  };
}

// 用于实时同步比对的“稳定键”：剔除所有时间戳字段，避免保存时产生的微小时间差造成误判/回环
function stableKey(data: BackupData): string {
  return JSON.stringify(data, (key, value) =>
    (key === 'createdAt' || key === 'updatedAt' || key === 'version') ? undefined : value
  );
}

// 单个看板的内容键（剔除时间戳与版本号），用于判断某个看板是否真的发生了变化
function boardContentKey(board: any): string {
  return JSON.stringify(board, (key, value) =>
    (key === 'createdAt' || key === 'updatedAt' || key === 'version') ? undefined : value
  );
}

/**
 * 取云端总卡片数（轻量）。
 *
 * 2026-11-10 移动端流量优化：
 * 原实现用 select('id,title,data') 拉全量看板 JSON（实测约 548KB）只为算卡片数，
 * 是移动端流量的主要浪费之一。
 *
 * 三级降级策略：
 *   1. RPC workspace_stats()  → 响应体 < 50 字节（需先执行 add_stats_functions.sql）
 *   2. RPC count_all_cards()  → 响应体 < 10 字节
 *   3. 都没建 → 返回 null，跳过校验（不发大请求，宁可少一层保护也不耗流量）
 *
 * 注意：不要用 select=data->columns 试图"只取部分字段"——
 * 实测 PostgREST 仍会返回完整 columns JSON（542KB），几乎等于全量。
 */
let statsRpcAvailable: boolean | null = null;

async function fetchRemoteCardTotal(): Promise<number | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  // 已知 RPC 不可用时直接跳过，避免每次保存都产生一个 404 请求
  if (statsRpcAvailable === false) return null;

  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  try {
    const res = await fetch(`${url}/rest/v1/rpc/workspace_stats`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    if (res.ok) {
      const data = await res.json();
      statsRpcAvailable = true;
      const cards = typeof data?.cards === 'number' ? data.cards : parseInt(data?.cards, 10);
      return Number.isFinite(cards) ? cards : null;
    }
    // 404 = 函数不存在，说明迁移未执行
    if (res.status === 404) {
      statsRpcAvailable = false;
      console.info(
        '[统计] workspace_stats() 不存在，已跳过写入前校验以节省流量。' +
        '执行 supabase/migrations/add_stats_functions.sql 可启用。'
      );
      return null;
    }
  } catch {
    return null;
  }
  return null;
}


export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(boardReducer, null, createInitialState);
  const loadedRef = useRef(false);
  const boardsSnapshotRef = useRef<string>('');
  const usersSnapshotRef = useRef<string>('');
  const lastLocalContentRef = useRef<string>('');
  const stableContentRef = useRef<string>('');
  const latestSnapshotRef = useRef<BackupData | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveRef = useRef(false);
  // 当本轮数据来自「服务器不可用」的降级路径（空数据）时置位，
  // 用于阻止持久化 effect 把这批降级数据写回云端，避免污染服务器真实数据。
  const blockSaveRef = useRef(false);
  const bcRef = useRef<BroadcastChannel | null>(null);
  // 显式删除追踪：只有用户主动删除的看板/用户才会从服务器删除，
  // 避免“快照对比自动删除”误删他人数据。
  const deletedBoardIdsRef = useRef<Set<string>>(new Set());
  const deletedUserIdsRef = useRef<Set<string>>(new Set());
  // 用户是否主动修改过背景（用于防止把用户设置的背景冲成默认白底）
  const appearanceDirtyRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * 同步状态（v2.4.2）：直接把「改动有没有落库」显示在界面上。
   * 用户不必打开 Console 才能判断保存是否成功。
   */
  const [syncState, setSyncState] = useState<{
    kind: 'idle' | 'pending' | 'error';
    label: string;
    detail?: string;
  }>({ kind: 'idle', label: '已同步' });

  // 当前用户的最新值（供 doSave 等稳定回调读取，避免 hook 依赖抖动）
  const currentUserRef = useRef<User | null>(null);
  useEffect(() => {
    currentUserRef.current = state.currentUser;
  }, [state.currentUser]);

  // ===== P1 patch 通道（灰度，NEXT_PUBLIC_USE_PATCH_RPC=true 时启用）=====
  // 设计：dispatch 后按 action → ops 生成最小增量，先落 IndexedDB outbox，
  // 再串行提交 /api/board/patch（服务端调用 apply_board_patch，行锁 + 版本校验）。
  // 开关关闭时以下所有逻辑都不会运行，旧 doSave 路径行为完全不变。
  const patchEnabledRef = useRef(false);
  // 每个看板当前已知的云端版本（乐观锁基准）
  const boardVersionsRef = useRef<Map<string, number>>(new Map());
  // 同一看板的 patch 串行队列（保证 baseVersion 单调递增）
  const patchQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  // 运行时熔断：服务端返回 DISABLED / 连续失败时自动退回旧通道
  const patchBrokenRef = useRef(false);
  // 冲突/阻断提示（避免每条 patch 都弹一次）
  const lastPatchNoticeRef = useRef<string>('');
  /**
   * 尚未确认落库的 patch 数量（按看板）。
   *
   * 【保存回滚 Bug 修复 2026-11-11】
   * 现象：拖拽/编辑后约 3 秒内容自动跳回原样。
   * 根因：patch 还在路上（或刚发出），Realtime 触发的 refetchFromServer
   *       拉回的是「本次修改之前」的云端数据，并按时间戳比较后
   *       覆盖了本地 state → UI 回滚。随后 patch 成功，但本地已无可应用的目标。
   * 修复：只要有未确认的 patch，就禁止 refetch 覆盖本地该看板的数据。
   */
  const pendingPatchCountRef = useRef<Map<string, number>>(new Map());
  /** 每个看板「第一次出现未确认 patch」的时间戳，用于超时降级 */
  const pendingPatchFirstSeenRef = useRef<Map<string, number>>(new Map());
  // 正在进行中的 refetch（避免并发拉取互相覆盖）
  const refetchingRef = useRef(false);

  const bumpPending = useCallback((boardId: string, delta: number) => {
    const cur = pendingPatchCountRef.current.get(boardId) ?? 0;
    const next = Math.max(0, cur + delta);
    if (next === 0) {
      pendingPatchCountRef.current.delete(boardId);
      pendingPatchFirstSeenRef.current.delete(boardId);
    } else {
      pendingPatchCountRef.current.set(boardId, next);
      // 只在「从 0 变为有」时记录起始时间
      if (cur === 0) pendingPatchFirstSeenRef.current.set(boardId, Date.now());
    }
  }, []);

  /**
   * 是否有「新鲜」的未确认 patch。
   *
   * 与 hasPendingPatch 的区别：超过 PENDING_STALE_MS 仍未确认的条目视为
   * 「卡死的旧条目」（例如服务端 4xx 但客户端没处理），不再阻断同步，
   * 避免网络异常后同步被永久冻结。
   */
  const PENDING_STALE_MS = 30_000;
  const hasFreshPendingPatch = useCallback((boardId: string) => {
    const rec = pendingPatchFirstSeenRef.current.get(boardId);
    if (!rec) return false;
    if (Date.now() - rec > PENDING_STALE_MS) return false;
    return (pendingPatchCountRef.current.get(boardId) ?? 0) > 0;
  }, []);

  const hasAnyFreshPending = useCallback(() => {
    const now = Date.now();
    for (const [boardId, count] of pendingPatchCountRef.current) {
      if (count <= 0) continue;
      const firstSeen = pendingPatchFirstSeenRef.current.get(boardId) ?? now;
      if (now - firstSeen < PENDING_STALE_MS) return true;
    }
    return false;
  }, []);

  /**
   * patch 通道是否可用（未熔断即视为可用）。
   *
   * 【修复 2026-11-11】原实现要求 NEXT_PUBLIC_USE_PATCH_RPC === 'true'，
   * 但该变量是**构建期内联**的：只要 Vercel 构建时没读到（环境变量没配、
   * 或配在错误的作用域），线上就永远走旧的全量路径 ——
   * 而旧路径正是「整板覆盖 + 时间戳合并」导致回滚的根源。
   *
   * 现在改为：默认启用，仅当显式设为 'false' 才关闭。
   * 这样即使变量缺失，也不会退回到有缺陷的旧路径。
   */
  const patchActive = useCallback(() => !patchBrokenRef.current, []);

  /**
   * 诊断：把 patch 通道的真实状态暴露到 window，
   * 便于在浏览器 Console 中一键确认「为什么改动没走增量通道」。
   *
   * 用法：控制台执行 __trelloPatchDiagnose()
   */
  const exposeDiagnostics = useCallback(() => {
    if (typeof window === 'undefined') return;
    (window as any).__trelloPatchDiagnose = () => {
      const info = {
        开关值: process.env.NEXT_PUBLIC_USE_PATCH_RPC ?? '(未定义)',
        patchEnabled: patchEnabledRef.current,
        已熔断: patchBrokenRef.current,
        最终生效: patchActive(),
        已知版本: Object.fromEntries(boardVersionsRef.current),
        待提交数量: Object.fromEntries(pendingPatchCountRef.current),
      };
      console.table(info);
      if (!patchEnabledRef.current) {
        console.error(
          '❌ patch 通道未启用：NEXT_PUBLIC_USE_PATCH_RPC 未在【构建时】为 "true"。\n' +
          '   该变量是构建期内联的，改完必须重新部署（Redeploy），仅改环境变量不会生效。',
        );
      }
      return info;
    };
  }, [patchActive]);

  /** 记录云端版本（初始化 / refetch 时更新） */
  const setBoardVersion = useCallback((boardId: string, version: number) => {
    if (typeof version !== 'number' || !isFinite(version)) return;
    boardVersionsRef.current.set(boardId, version);
  }, []);

  /** 把一条 entry 提交到服务端，处理冲突与失败 */
  const flushPatchEntry = useCallback(async (entry: OutboxEntry): Promise<void> => {
    if (!patchActive()) {
      // 熔断后退回旧通道：从 outbox 移除，交由 doSave 全量兜底
      await outboxDequeue(entry.id);
      return;
    }

    let result: PatchResult;
    try {
      result = await submitEntry(entry);
    } catch (e: any) {
      result = { ok: false, code: 'ERROR', message: e?.message };
    } finally {
      // 注意：pending 计数在下面各分支统一处理（成功/失败都要减）
    }

    if (result.ok) {
      setBoardVersion(entry.boardId, result.version);
      await outboxDequeue(entry.id);
      bumpPending(entry.boardId, -1);
      lastPatchNoticeRef.current = '';
      // 状态指示：确认落库（v2.4.2）
      setSyncState({
        kind: 'idle',
        label: '已保存 v' + result.version,
        detail: `数据库已确认：version=${result.version}, 卡片数=${result.cards}`,
      });
      // 最近一次 patch 已确认落库：允许后续 refetch 覆盖本地
      return;
    }

    switch (result.code) {
      case 'VERSION_CONFLICT': {
        // 乐观锁生效：绝不覆盖云端。记录新版本，并让本地按新版本重试，
        // 而不是直接丢弃改动（修复：原实现直接 outboxDequeue = 丢掉用户修改）。
        setBoardVersion(entry.boardId, result.currentVersion);
        await outboxDequeue(entry.id);
        bumpPending(entry.boardId, -1);

        // 用服务端返回的最新数据更新本地，避免基于旧状态继续操作
        if (result.currentData) {
          try {
            window.dispatchEvent(new CustomEvent('trello:patch-conflict', {
              detail: { boardId: entry.boardId, version: result.currentVersion },
            }));
          } catch {}
        }
        const msg = '检测到他人同时修改了该看板，已同步最新数据。';
        if (lastPatchNoticeRef.current !== msg) {
          lastPatchNoticeRef.current = msg;
          setSaveError(msg);
        }
        return;
      }
      case 'DESTRUCTIVE_WRITE_BLOCKED':
        await outboxDequeue(entry.id);
        bumpPending(entry.boardId, -1);
        setSaveError(
          `已阻止一次疑似覆盖：卡片数将从 ${result.before} 降为 ${result.after}。请刷新后再操作。`,
        );
        return;
      case 'BAD_PATCH':
      case 'NOT_FOUND':
        // 结构性错误：重试无意义，丢弃并提示（数据仍在本地备份里）
        await outboxDequeue(entry.id);
        bumpPending(entry.boardId, -1);
        console.warn('[patch] 被服务端拒绝:', entry.id, result.code, result.message);
        return;
      case 'DISABLED': {
        // service_role 未配置或通道未开启：整体退回旧通道，避免改动丢失
        patchBrokenRef.current = true;
        await outboxDequeue(entry.id);
        bumpPending(entry.boardId, -1);
        console.info('[patch] 服务端未启用 patch 通道，已回退到旧保存路径');
        return;
      }
      case 'UNAUTHORIZED': {
        // 会话失效（Cookie 过期/未携带）。
        // 【重要】绝不能丢弃改动：保留在 outbox 中，登录后自动重放。
        // 只是提示用户重新登录，不改 pending 计数（改动仍未落库）。
        setSyncState({ kind: 'error', label: '未保存：登录失效', detail: '请重新登录后再试' });
        if (lastPatchNoticeRef.current !== 'AUTH') {
          lastPatchNoticeRef.current = 'AUTH';
          setSaveError('登录状态已失效，改动已保存在本地。请重新登录后自动同步。');
        }
        return;
      }
      case 'ENDPOINT_MISSING': {
        // 后端接口不存在（通常是 Vercel 未部署 API 路由）。
        // 重试无意义；但改动保留在 outbox，部署修复后可重放。
        // 递减 pending，避免同步被永久冻结（否则所有后续同步都停止）。
        bumpPending(entry.boardId, -1);
        setSyncState({ kind: 'error', label: '未保存：接口不存在', detail: '后端未部署' });
        if (lastPatchNoticeRef.current !== 'ENDPOINT_MISSING') {
          lastPatchNoticeRef.current = 'ENDPOINT_MISSING';
          setSaveError(
            '⚠️ 保存接口不可用（后端未部署），改动只存在本机，刷新会丢失！' +
            '请联系管理员部署后端后重试。',
          );
          console.error(
            '[patch] 致命：/api/board/patch 不存在。' +
            '当前所有编辑都不会写入数据库，刷新即丢失。',
          );
        }
        return;
      }
      default: {
        // 网络错误等可重试：保留在 outbox，退避后再来。
        // 重要：这里【不减】pending 计数 —— 改动还没落库，
        // 必须继续阻止 refetch 覆盖本地，否则会重现「3 秒回滚」。
        await outboxEnqueue({ ...entry, attempts: entry.attempts + 1 });
        if (entry.attempts + 1 >= 5) {
          setSaveError('网络异常，改动已暂存本地，恢复连接后会自动重试。');
          setSyncState({ kind: 'error', label: '未保存：网络异常', detail: '正在重试…' });
        }
        const delay = backoffDelay(entry.attempts + 1);
        setTimeout(() => {
          void flushPatchEntry({ ...entry, attempts: entry.attempts + 1 });
        }, delay);
      }
    }
  }, [patchActive, setBoardVersion, bumpPending]);

  /** 入队并触发提交（同一看板串行） */
  const enqueuePatch = useCallback(
    async (boardId: string, payload: BoardPatchPayload) => {
      if (!patchActive()) return;
      if (!payload.ops || payload.ops.length === 0) {
        // 只有元数据（标题/背景/标签），仍然要走 patch，否则会丢
        if (!payload.title && !payload.background && !payload.labels && !payload.data) return;
      }

      const entry: OutboxEntry = {
        id: newEntryId(),
        boardId,
        baseVersion: boardVersionsRef.current.get(boardId) ?? 0,
        // 所有入队的 patch 都源自用户 Action，显式声明 intent，
        // 否则服务端会按「异常覆盖」把正常的删卡/拖拽也拦下来。
        payload: { ...payload, intent: 'user_edit' },
        createdAt: Date.now(),
        attempts: 0,
      };

      // 先落盘（断电/关页不丢），再提交
      await outboxEnqueue(entry);

      // 标记该看板有未确认改动：在此之前禁止 refetch 用云端数据覆盖本地
      // （否则会重现「拖拽后 3 秒自动跳回」的保存回滚 bug）
      bumpPending(boardId, +1);
      setSyncState({ kind: 'pending', label: '保存中…', detail: '正在写入数据库' });

      const prev = patchQueueRef.current.get(boardId) ?? Promise.resolve();
      const next = prev
        .then(() => flushPatchEntry(entry))
        .catch(err => console.warn('[patch] 提交异常:', err));
      patchQueueRef.current.set(boardId, next);
    },
    [patchActive, flushPatchEntry, bumpPending],
  );


  // ===== 保存到 Supabase（增量保存：只写真正变化的看板，避免整表覆盖）=====
  // 关键修复：不再整表 upsert，也不再靠快照对比自动删除。
  // 只保存 updatedAt 比服务器快照更新的看板，从根本上避免“用旧数据覆盖别人新数据”。
  const doSave = useCallback(async (data: BackupData) => {
    try {
      // 0. 显式删除：只删除用户主动删除的看板/用户（不再靠快照对比自动删）
      if (deletedBoardIdsRef.current.size > 0) {
        const ids = Array.from(deletedBoardIdsRef.current);
        // boards 表写权限已收敛到服务端（审计 C1），改走 /api/boards 软删除。
        // 失败不阻断主流程，下一次保存会重试。
        for (const id of ids) {
          try {
            const res = await fetch(`/api/boards?id=${encodeURIComponent(id)}`, {
              method: 'DELETE',
              credentials: 'same-origin',
            });
            if (!res.ok && res.status !== 401) {
              console.warn('[Persistence] 看板删除失败:', id, res.status);
            }
          } catch (e) {
            console.warn('[Persistence] 看板删除请求异常:', e);
          }
        }
        deletedBoardIdsRef.current.clear();
      }
      if (deletedUserIdsRef.current.size > 0) {
        const ids = Array.from(deletedUserIdsRef.current);
        // users 表已对 anon 关闭，改走服务端（审计 C3）。
        // 失败不阻断主流程：成员删除有独立接口，这里是兜底清理。
        for (const id of ids) {
          try {
            const res = await fetch(`/api/members?id=${encodeURIComponent(id)}`, {
              method: 'DELETE',
              credentials: 'same-origin',
            });
            if (!res.ok) {
              console.warn('[Persistence] 成员删除失败:', id, res.status);
            }
          } catch (e) {
            console.warn('[Persistence] 成员删除请求异常:', e);
          }
        }
        deletedUserIdsRef.current.clear();
      }

      // 1. 计算需要保存的看板：与上次成功保存的快照逐板比较
      const prevBoards: any[] = boardsSnapshotRef.current ? JSON.parse(boardsSnapshotRef.current) : [];

      const prevBoardMap = new Map<string, any>(prevBoards.map((b: any) => [b.id, b]));

      const boardsToSave = data.boards.filter(b => {
        const prev = prevBoardMap.get(b.id);
        if (!prev) return true; // 新看板
        // 内容（剔除时间戳）有变化才保存
        return boardContentKey(b) !== boardContentKey(prev);
      });

      // ================================================================
      // 破坏性写入防护（2026-11-05 数据覆盖事故后新增）
      //
      // 事故经过：某个客户端持有旧的本地状态，在 15:21 触发了批量 upsert，
      // 把云端 6 个看板整体覆盖成一个月前的版本。因为 doSave 是无条件写入，
      // 云端没有任何抵抗能力，事故后也无法回溯。
      //
      // 防护策略：写入前先读云端当前卡片总数，若本次写入会让某看板的
      // 卡片数「大幅减少」，判定为可疑覆盖，直接阻断并报警。
      // 用户主动删除卡片仍可正常进行（只删少量时不会触发阈值）。
      // ================================================================
      if (boardsToSave.length > 0) {
        const countCards = (cols: any[]): number =>
          (cols || []).reduce((s, c) => s + ((c?.cards || []).length), 0);

        try {
          // 流量优化（2026-11-10）：原来 select('id,title,data') 会再拉一遍
          // 全量看板 JSON（约 550KB），是移动端流量的主要浪费之一。
          // 改用 HEAD 精确计数：响应体 0 字节，只读 content-range 头部。
          // 精度足够——防护只需要知道"云端总卡片数"，不需要逐板明细。
          const remoteTotal = await fetchRemoteCardTotal();

          if (remoteTotal !== null) {
            // 注意：boardsToSave 只包含本次变更的看板，因此只能做"总量下限"判断。
            // 若本次要写的看板数少于云端全部看板数，说明还有其他看板未参与，
            // 此时不做误阻断。
            const allLocalTotal = data.boards.reduce(
              (s, b) => s + countCards(b.columns), 0
            );
            if (remoteTotal >= 5 && allLocalTotal < remoteTotal * 0.5) {
              const msg = `已阻止一次疑似覆盖事故：云端共 ${remoteTotal} 张卡片，本次提交仅 ${allLocalTotal} 张。请刷新页面获取最新数据后再操作。`;
              console.error('[保护] 检测到破坏性写入，已阻断:', { remoteTotal, allLocalTotal });
              setSaveError(msg);
              // 不写入云端，也不更新快照，下一次仍会重新评估
              return;
            }
          }
        } catch (e) {
          // 读取云端失败时不阻断（避免网络问题导致无法保存），但要记录
          console.warn('[保护] 写入前校验失败，本次跳过校验:', e);
        }
      }

      // 说明：原实现在这里「下载被覆盖的全量 + 前端 insert boards_history」。
      // 两个问题：
      //   1. boards_history 已撤 anon 权限（审计 C3），前端写必然失败
      //   2. 每次保存都要下载一遍全量看板（约 550KB），纯浪费流量
      // 现在历史快照由服务端在 apply_board_patch / soft_delete_board_by_id
      // 的同一事务内写入，既原子又不占客户端流量。


      if (boardsToSave.length > 0) {
        // ================================================================
        // 关键安全改造（审计 C1）
        //
        // 原实现：supabase.from('boards').upsert(整板 JSON)
        //   → 任何持有旧内存状态的客户端都会整块覆盖云端（11-05 事故根因）
        //   → boards 表对 anon 开放写权限时，攻击者可绕过前端直接覆盖
        //
        // 现在：整板 upsert 一律禁止。
        //   - patch 通道启用时：增量已由 enqueuePatch → /api/board/patch 提交
        //   - 看板元数据（标题/背景/图标/可见性/排序/新建）走 /api/boards
        //   - 卡片/列/心智图内容只允许经 apply_board_patch（带版本校验）
        // 这里仅兜底同步「看板级元数据」，绝不写 data 字段。
        // ================================================================
        const metaRes = await fetch('/api/boards/metadata', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            boards: boardsToSave.map(b => ({
              id: b.id,
              title: b.title,
              background: b.background,
              labels: b.labels,
              emoji: b.emoji ?? null,
              iconBg: b.iconBg ?? null,
              iconImage: b.iconImage ?? null,
              visibleTo: b.visibleTo ?? [],
              order: b.order ?? 0,
            })),
          }),
        });
        if (!metaRes.ok && metaRes.status !== 401) {
          console.warn('[Persistence] 看板元数据同步失败:', metaRes.status);
        }
      }

      // 2. 用户：不再整表 upsert（审计 C2 —— 任何持有旧内存状态的客户端
      //    都会把已删除成员 upsert 复活，并把口令重新写回）。
      //    成员的新增/改名/改密/删除统一由 /api/members 负责，那里有服务端权限校验。
      //    这里仅同步「当前用户自己的非敏感资料」变更（头像/颜色/语言）。
      const me = currentUserRef.current;
      if (me) {
        const prevMe = latestSnapshotRef.current?.users?.find(u => u.id === me.id);
        const profileChanged =
          !prevMe ||
          prevMe.name !== me.name ||
          prevMe.avatar !== me.avatar ||
          prevMe.color !== me.color ||
          prevMe.lang !== me.lang;
        if (profileChanged) {
          try {
            const res = await fetch('/api/members', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                id: me.id,
                name: me.name,
                avatar: me.avatar,
                color: me.color,
                lang: me.lang,
              }),
            });
            if (!res.ok && res.status !== 401) {
              console.warn('[Persistence] 个人资料同步失败:', res.status);
            }
          } catch (e) {
            console.warn('[Persistence] 个人资料同步异常:', e);
          }
        }
      }

      // 3. 工作区设置（单行，直接 upsert）
      //
      // 防护（2026-11-05 背景被刷白事故后新增）：
      // 只有「本次提交确实包含用户主动修改的背景」时才写背景字段。
      // 具体做法：与云端当前值比对，若云端已有非默认背景、而本次是默认兜底值，
      // 且用户并未主动改背景，则保留云端值，避免把用户设置的背景冲成 #f5f5f7。
      let settingsPayload: any = {
        id: '00000000-0000-0000-0000-000000000001',
        workspace_background: data.workspaceBackground,
        login_background: data.loginBackground,
        portal_background: data.portalBackground,
        crm_background: data.crmBackground,
        portal_image_opacity: data.portalImageOpacity,
        crm_image_opacity: data.crmImageOpacity,
        logo: data.logo,
        updated_at: new Date().toISOString(),
      };

      try {
        const { data: remoteSettings } = await supabase
          .from('workspace_settings')
          .select('*')
          .limit(1)
          .maybeSingle();

        if (remoteSettings) {
          // 判断某个字段是否为「兜底白底」
          const isFallbackBg = (v: unknown) => {
            if (typeof v !== 'string') return false;
            const t = v.trim().toLowerCase();
            return !t || t === '#f5f5f7' || t === '#fff' || t === '#ffffff' || t === 'white';
          };

          const keepOrOverwrite = (serverVal: unknown, localVal: unknown) => {
            // 用户没主动改背景：一律用云端
            if (!appearanceDirtyRef.current) return serverVal ?? localVal;
            // 用户主动改过：允许覆盖，但如果本次是白底而云端不是白底，
            // 说明这是兜底值意外泄漏，仍然保留云端
            if (isFallbackBg(localVal) && !isFallbackBg(serverVal)) return serverVal;
            return localVal;
          };

          settingsPayload = {
            ...settingsPayload,
            workspace_background: keepOrOverwrite(remoteSettings.workspace_background, settingsPayload.workspace_background),
            login_background: keepOrOverwrite(remoteSettings.login_background, settingsPayload.login_background),
            portal_background: keepOrOverwrite(remoteSettings.portal_background, settingsPayload.portal_background),
            crm_background: keepOrOverwrite(remoteSettings.crm_background, settingsPayload.crm_background),
            portal_image_opacity: appearanceDirtyRef.current
              ? settingsPayload.portal_image_opacity
              : (remoteSettings.portal_image_opacity ?? settingsPayload.portal_image_opacity),
            crm_image_opacity: appearanceDirtyRef.current
              ? settingsPayload.crm_image_opacity
              : (remoteSettings.crm_image_opacity ?? settingsPayload.crm_image_opacity),
            logo: appearanceDirtyRef.current
              ? settingsPayload.logo
              : (remoteSettings.logo ?? settingsPayload.logo),
          };
        }

        // 存档旧设置：历史表已撤 anon 权限（审计 C3），改由服务端 RPC 在同一事务内完成，
        // 这里不再单独 insert。
      } catch (e) {
        console.warn('[保护] 读取云端背景设置失败，本次按本地值写入:', e);
      }

      // 工作区设置：改走服务端（审计 C1 —— anon 写权限将被撤销）
      // 服务端 RPC 会做字段白名单 + 同事务历史快照，且只更新传入的字段。
      try {
        const settingsRes = await fetch('/api/workspace-settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            workspace_background: settingsPayload.workspace_background,
            login_background: settingsPayload.login_background,
            portal_background: settingsPayload.portal_background,
            crm_background: settingsPayload.crm_background,
            portal_image_opacity: settingsPayload.portal_image_opacity,
            crm_image_opacity: settingsPayload.crm_image_opacity,
            logo: settingsPayload.logo,
          }),
        });
        if (!settingsRes.ok && settingsRes.status !== 401) {
          console.warn('[Persistence] 工作区设置保存失败:', settingsRes.status);
        }
      } catch (e) {
        console.warn('[Persistence] 工作区设置保存异常:', e);
      }
      // 背景已与云端对齐，清除"用户主动修改"标记
      appearanceDirtyRef.current = false;


      // 保存成功后更新快照（记录服务器当前值）
      boardsSnapshotRef.current = JSON.stringify(data.boards);
      usersSnapshotRef.current = JSON.stringify(data.users);

      // 本次数据已成功同步到服务器，清除 pending 标记（仅当没有更新的改动排队时）
      if (JSON.stringify(data) === lastLocalContentRef.current) {
        pendingSaveRef.current = false;
        try {
          window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString(), pending: false }));
        } catch {}
      }

      setSaveError(null);
    } catch (err) {
      console.error('[Persistence] 数据保存失败:', err);
      setSaveError('数据保存失败，已暂存在本地备份。请检查网络后重试。');
    }
    // 依赖保持为空数组：doSave 会被 enqueueSave 串行调用，
    // 若因 state 变化重建会导致保存队列被替换。currentUser 通过 ref 读取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const enqueueSave = useCallback((data: BackupData) => {
    saveQueueRef.current = saveQueueRef.current.then(() => doSave(data)).catch(() => {});
  }, [doSave]);

  /**
   * 刷新页面后用会话 Cookie 恢复登录态（/api/auth/me）。
   *
   * 旧实现 currentUser 只存在内存里，一刷新就掉线，用户会以为
   * 「还在登录但数据没同步」——这是数据丢失体验的诱因之一。
   * 现在服务端持有 HttpOnly 签名 Cookie，刷新后可直接恢复。
   */
  const restoreSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!res.ok) return;
      const body = await res.json();
      const me = body?.user;
      if (!me) return;
      dispatch({ type: 'SET_CURRENT_USER', payload: me });
      if (me.lang === 'zh' || me.lang === 'en') {
        try { window.localStorage.setItem('trello-clone.lang', me.lang); } catch {}
      }
    } catch (e) {
      // 会话恢复失败不阻断使用：用户仍可用本地备份浏览
      console.warn('[auth] 会话恢复失败:', e);
    }
  }, [dispatch]);

  // ===== 跨标签页广播 =====
  const broadcastSnapshot = useCallback((data: BackupData, savedAt: string) => {
    try {
      bcRef.current?.postMessage({ kind: 'full-snapshot', savedAt, data });
    } catch {}
  }, []);

  // ===== 从服务器重新拉取，并在内容变化时应用到 state（跨用户实时同步）=====
  const refetchFromServer = useCallback(async () => {
    if (!loadedRef.current) return;
    // 防止并发 refetch 互相覆盖（后到的请求可能基于更早的读，写回时覆盖新数据）
    if (refetchingRef.current) return;
    refetchingRef.current = true;
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!url) return;

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
      );

      const [{ data: boardsData }, membersRows] = await Promise.race([
        Promise.all([
          supabase.from('boards').select('*'),
          fetchMembersForLoad(),
        ]),
        timeout,
      ]) as any;
      // membersRows 为 null 表示会话失效/服务端不可用：沿用内存中的成员列表，
      // 绝不用空数组覆盖（否则会把用户列表清空并写回）。
      const usersData = membersRows ?? (latestSnapshotRef.current?.users || []);

      // 背景设置单独请求，并使用「独立」的超时 Promise。
      // 注意：不能复用上面的 timeout —— 它一旦 settle 就无法再次参与 race，
      // 会导致这里瞬时抛错并被 catch 吞掉，settingsData 退化为 null，
      // 背景数据整体丢失（表现为所有页面背景变成默认浅灰/空白）。
      let settingsData: any = null;
      try {
        const settingsTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('settings request timed out')), 8000)
        );
        const { data, error } = await Promise.race([
          supabase.from('workspace_settings').select('*').limit(1).maybeSingle(),
          settingsTimeout,
        ]) as any;
        if (!error && data) {
          settingsData = data;
        } else if (error) {
          // 退化方案：maybeSingle 在多行或特定情况下会报错，改用数组查询兜底，
          // 确保背景设置尽可能取到，而不是静默丢失。
          try {
            const { data: rows } = await supabase
              .from('workspace_settings')
              .select('*')
              .limit(1) as any;
            if (Array.isArray(rows) && rows.length > 0) settingsData = rows[0];
          } catch {}
        }
      } catch (e) {
        console.warn('[bg] workspace_settings 加载失败，将退回本地/默认背景:', e);
      }

      // 服务器已成功响应。但只有当背景设置真正读到（settingsData 非空）时才解除降级保护，
      // 否则本次 remote 的背景全是兜底浅灰，一旦允许写回就会把云端正确的背景覆盖掉。
      const wasBlocked = blockSaveRef.current;
      if (settingsData) {
        blockSaveRef.current = false;
      }

      const remote = rowsToBackupData(usersData, boardsData, settingsData);

      // 注意：这里【不能】无脑把本地版本号覆盖成云端值。
      // 合并逻辑需要「本地已知版本 vs 云端版本」的对比来判断谁更新，
      // 提前覆盖会让比较恒成立（远端永远"不更新"）或恒不成立。
      // 版本号的更新放在合并循环里，仅在「采纳远端」时才推进。

      // 关键：背景设置没读到（settingsData 为空）时，rowsToBackupData 会把四个背景字段
      // 全部填成兜底值（#f5f5f7 浅灰）。若直接应用，会把屏幕上本来正确的背景刷成"一片白"，
      // 而且下一次持久化还会写回云端，造成背景永久丢失。
      // 这里改为沿用内存中当前的背景设置，只更新看板/用户。
      if (!settingsData) {
        const current = latestSnapshotRef.current;
        if (current) {
          remote.workspaceBackground = current.workspaceBackground;
          remote.loginBackground = current.loginBackground;
          remote.portalBackground = current.portalBackground;
          remote.crmBackground = current.crmBackground;
          remote.portalImageOpacity = current.portalImageOpacity;
          remote.crmImageOpacity = current.crmImageOpacity;
          remote.logo = current.logo;
        }
        console.warn('[bg] refetch 未取到 workspace_settings，本次沿用当前背景设置');
      }

      // ===== 逐看板合并：以 updatedAt 为准，谁新用谁 =====
      // 这样即使本地有未同步改动，也只会保留本地更新的看板，
      // 而远端更新的看板会被应用进来，彻底解决“B 看不到 A 的改动”。
      const localBoards: Board[] = latestSnapshotRef.current?.boards || [];
      const localBoardMap = new Map<string, Board>(localBoards.map(b => [b.id, b]));

      const mergedBoards: Board[] = [];
      const remoteBoardIds = new Set<string>();

      for (const rb of remote.boards) {
        remoteBoardIds.add(rb.id);
        const lb = localBoardMap.get(rb.id);
        if (!lb) {
          mergedBoards.push(rb); // 远端新增的看板
          continue;
        }

        // ================================================================
        // 【保存回滚 Bug 修复】—— 最关键的一处
        //
        // 该看板还有未确认落库的 patch 时，绝不能用云端数据覆盖本地：
        //   - 云端此刻可能是「patch 之前」的旧快照
        //   - 覆盖后 UI 会立刻回滚（线上表现为「拖拽后 3 秒跳回原样」）
        //   - patch 随后成功，但本地已无对应改动可应用，数据看起来"被删除"
        //
        // 注意：这里【不判断 patchEnabledRef】。
        // 即使灰度开关没生效（构建时未注入），只要本地有未确认改动，
        // 也必须保护 —— 否则开关一旦失效就退回"必回滚"状态。
        // ================================================================
        if (hasFreshPendingPatch(rb.id)) {
          mergedBoards.push(lb);
          continue;
        }

        // 以「版本号」为唯一真相，不再依赖客户端时钟
        // （本地/云端时间戳来自不同时钟，比较结果不可靠 —— 审计 M1）
        //
        // 【修复 2026-11-11】这里不再受灰度开关控制：
        // 时间戳比较本身就是回滚的成因之一，任何情况下都不应回退到它。
        {
          const localV = boardVersionsRef.current.get(rb.id);
          const remoteV = typeof (rb as any).version === 'number' ? (rb as any).version : undefined;

          // 1) 远端版本明确更大 → 采用远端
          if (typeof remoteV === 'number' && typeof localV === 'number' && remoteV > localV) {
            boardVersionsRef.current.set(rb.id, remoteV);
            mergedBoards.push(rb);
            continue;
          }

          // 2) 本地还没有版本基准（如首次同步前）：用远端校准，但只在
          //    本地内容为空时采用，避免覆盖尚未提交的本地改动
          if (typeof localV !== 'number') {
            if (typeof remoteV === 'number') boardVersionsRef.current.set(rb.id, remoteV);
            const localEmpty = !lb.columns?.length && !lb.mindmap?.length;
            mergedBoards.push(localEmpty ? rb : lb);
            continue;
          }

          // 3) 版本相同或本地更新 → 保留本地（内容差异由后续 patch 提交）
          mergedBoards.push(lb);
          continue;
        }
      }

      // 本地有、远端没有的看板：保留（可能是本地刚创建还没保存成功）
      for (const lb of localBoards) {
        if (!remoteBoardIds.has(lb.id)) mergedBoards.push(lb);
      }

      // 用户：远端为准（用户信息冲突概率低），但保留本地新增的
      const remoteUserIds = new Set(remote.users.map(u => u.id));
      const mergedUsers: User[] = [
        ...remote.users,
        ...(latestSnapshotRef.current?.users || []).filter(u => !remoteUserIds.has(u.id)),
      ];

      const merged: BackupData = {
        ...remote,
        boards: mergedBoards,
        users: mergedUsers,
      };

      const stable = stableKey(merged);
      // 若刚从「服务器不可用」的降级状态恢复，强制应用远端数据，
      // 保证屏幕上立刻从空看板切回真实数据。
      if (!wasBlocked && stable === stableContentRef.current) return;

      stableContentRef.current = stable;
      lastLocalContentRef.current = JSON.stringify(merged);
      latestSnapshotRef.current = merged;
      // 快照记录服务器当前值（用于增量保存判断）
      boardsSnapshotRef.current = JSON.stringify(remote.boards);
      usersSnapshotRef.current = JSON.stringify(remote.users);
      try {
        window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...merged, savedAt: new Date().toISOString(), pending: pendingSaveRef.current }));
      } catch {}
      dispatch({ type: 'APPLY_EXTERNAL_STATE', payload: merged });
    } catch (err) {
      console.warn('[Realtime] 重新拉取失败:', err);
    } finally {
      refetchingRef.current = false;
    }
  }, [dispatch, hasFreshPendingPatch]);
  // 说明：setBoardVersion 通过 ref 间接使用（boardVersionsRef），
  // 不放进依赖可避免每次渲染重建 refetchFromServer（会导致 Realtime 反复重订阅）。


  // ===== 初始化 BroadcastChannel（跨标签页实时同步）=====
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof BroadcastChannel === 'undefined') return;

    const bc = new BroadcastChannel(SYNC_CHANNEL);
    bcRef.current = bc;
    bc.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || msg.kind !== 'full-snapshot' || !msg.data) return;
      const content = JSON.stringify(msg.data);
      // 内容与本地一致则忽略，避免循环
      if (content === lastLocalContentRef.current) return;
      // 先落本地，再应用到 state（防止回环）
      lastLocalContentRef.current = content;
      stableContentRef.current = stableKey(msg.data);
      try {
        window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...msg.data, savedAt: msg.savedAt }));
      } catch {}
      dispatch({ type: 'APPLY_EXTERNAL_STATE', payload: msg.data });
    };

    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, []);

  // ===== 订阅 Supabase Realtime：他人保存后实时同步到本端 =====
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    /**
     * 【保存回滚 Bug 根治 2026-11-11】
     *
     * Realtime 会把「本端自己刚写的那次」变更也推回来：
     * 本端 patch 成功 → DB 触发器更新 updated_at → 推送 → 本端 refetch。
     * 若 patch 还没落库（网络慢），refetch 拉到的仍是旧数据，
     * 合并就会把 UI 覆盖回修改前 —— 这就是「拖拽后跳回原样」。
     *
     * 根治：本端存在未确认 patch 时，直接跳过这次 refetch。
     * patch 成功后会自行推进版本号，不需要靠 refetch 同步自己。
     */
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (hasAnyFreshPending()) {
          // 有未确认改动：推迟同步，等 patch 落库后再拉（超时后自动放行）
          scheduleRefetch();
          return;
        }
        void refetchFromServer();
      }, 800);
    };

    const channel = supabase
      .channel('board-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_settings' }, scheduleRefetch)
      .subscribe();

    // 兜底轮询：即使 Realtime 未在 Supabase 后台开启，也能保证多用户最终一致
    // 注意：有未确认 patch 时跳过本轮，避免用云端旧数据覆盖本地改动
    const poll = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (hasAnyFreshPending()) return;
      void refetchFromServer();
    }, 15000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
    // hasAnyFreshPending 依赖 ref，本身稳定；不放入依赖避免 Realtime 反复重订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchFromServer]);


  // ===== 加载数据：本地备份与 Supabase 比较，取较新者，防止旧数据覆盖 =====
  useEffect(() => {
    async function loadData() {
      const backup = readLocalBackup();
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!url) throw new Error('No Supabase URL configured');

        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
        );

        const [{ data: boardsData }, membersRows] = await Promise.race([
          Promise.all([
            supabase.from('boards').select('*'),
            fetchMembersForLoad(),
          ]),
          timeout,
        ]) as any;
        // 同上：读取失败时沿用内存缓存，避免把成员列表清空后写回
        const usersData = membersRows ?? (latestSnapshotRef.current?.users || []);

        // 背景设置使用「独立」超时 Promise（不能复用上面的 timeout，原因见 refetchFromServer）
        let settingsData: any = null;
        try {
          const settingsTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('settings request timed out')), 8000)
          );
          const { data, error } = await Promise.race([
            supabase.from('workspace_settings').select('*').limit(1).maybeSingle(),
            settingsTimeout,
          ]) as any;
          if (!error && data) {
            settingsData = data;
          } else if (error) {
            try {
              const { data: rows } = await supabase
                .from('workspace_settings')
                .select('*')
                .limit(1) as any;
              if (Array.isArray(rows) && rows.length > 0) settingsData = rows[0];
            } catch {}
          }
        } catch (e) {
          console.warn('[bg] workspace_settings 加载失败，将退回本地/默认背景:', e);
        }

        const users: User[] = (usersData || []).map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email || '',
          avatar: u.avatar || '',
          color: u.color || '#3B82F6',
          role: u.role || 'member',
          password: u.password || '',
          lang: u.lang || 'zh',
        }));

        const boards: Board[] = (boardsData || []).map((b: any) => ({
          id: b.id,
          title: b.title,
          background: b.background || '#f5f5f7',
          labels: b.labels || [],
          columns: b.data?.columns || [],
          mindmap: b.data?.mindmap || [],
          emoji: b.emoji || undefined,
          iconBg: b.iconBg || undefined,
          iconImage: b.iconImage || undefined,
          visibleTo: b.visibleTo || [],
          order: b.order ?? 0,
          createdAt: b.created_at || new Date().toISOString(),
          updatedAt: b.updated_at || new Date().toISOString(),
        }));

        const wsSettings = settingsData || {};

        // 服务器是否已有数据（有看板或用户，说明不是首次运行/空库）
        const serverHasData = (boards?.length > 0) || (users?.length > 0);
        // 本地备份是否存在尚未同步到服务器的改动
        const hasPendingLocal = !!backup && backup.pending === true;
        // 是否为「默认兜底色」——它不是用户设置的背景，而是代码里的兜底值。
        // 2026-11-05 事故：本地备份里的背景被写成 #f5f5f7 后，上一版逻辑把它
        // 当成「有效背景」，于是 hasPendingLocal 时会把它推回云端，导致每次
        // 打开页面都把用户的渐变背景刷成一片白。这里必须把兜底色排除在外。
        const FALLBACK_BG = '#f5f5f7';
        const isRealBg = (v: unknown) => {
          if (typeof v !== 'string') return false;
          const t = v.trim().toLowerCase();
          if (!t || t === FALLBACK_BG) return false;
          // 纯白/近白也视作「没有背景」
          if (t === '#fff' || t === '#ffffff' || t === 'white') return false;
          return true;
        };
        const serverHasBackgrounds =
          isRealBg(wsSettings.workspace_background) ||
          isRealBg(wsSettings.login_background) ||
          isRealBg(wsSettings.portal_background) ||
          isRealBg(wsSettings.crm_background);
        // 本地备份里的背景是否残缺（旧版本写入的备份可能缺少这些字段，
        // 或只剩代码兜底值而没有用户真正设置过的背景）
        const localBackupMissingBg = !!backup && !(
          isRealBg(backup.workspaceBackground) ||
          isRealBg(backup.loginBackground) ||
          isRealBg(backup.portalBackground) ||
          isRealBg(backup.crmBackground)
        );
        // 背景设置这一行是否真的读到了。
        // 关键：settingsData 为 null 意味着「查询超时/报错」，此时 wsSettings 是 {}，
        // serverHasBackgrounds 必然为 false。若把它当作"服务器本来就没有背景"，
        // 会连带触发下面错误的 useLocal 降级与 pending 改写，导致：
        //   1) portal/workspace/crm 背景全部回落默认 #f5f5f7（一片白）
        //   2) 本地未同步备份被标记为 pending:false，下次刷新内容"消失"
        // 因此这里必须把"读不到设置"和"服务器确实没有背景"区分开。
        const settingsLoaded = settingsData !== null && settingsData !== undefined;

        // 采用本地备份的条件：有未同步改动；或服务器为空但本地有历史数据（恢复）。
        // 例外：若背景设置读取失败（settingsLoaded=false），不做任何本地降级决策，
        // 保持现状按服务器数据渲染，避免误判覆盖。
        const useLocal = settingsLoaded && (
          hasPendingLocal || (!serverHasData && !!backup && (backup.boards?.length > 0))
        );

        // 背景设置读取失败时，禁止本轮任何写回（否则会用兜底浅灰覆盖云端背景）
        if (!settingsLoaded) {
          blockSaveRef.current = true;
          console.warn('[bg] workspace_settings 未读到，本轮禁用写回，避免覆盖云端背景设置');
        }

        let dataToUse: BackupData;
        let savedAt: string;
        if (useLocal && backup) {
          // 只要服务器有「真实背景」（非兜底白底），一律优先用服务器值。
          // 本地备份即便有 pending 改动，背景也应该以云端为准，否则旧备份里的
          // 白底会把云端用户精心设置的渐变覆盖掉（2026-11-05 事故的直接成因）。
          const preferServerBg = serverHasBackgrounds;
          const pickBg = (serverVal: unknown, localVal: unknown, def: string) =>
            (preferServerBg && isRealBg(serverVal))
              ? (serverVal as string)
              : (isRealBg(localVal) ? (localVal as string)
                 : (isRealBg(serverVal) ? (serverVal as string) : def));
          dataToUse = {
            boards: backup.boards,
            users: backup.users || [],
            workspaceBackground: pickBg(wsSettings.workspace_background, backup.workspaceBackground, FALLBACK_BG),
            loginBackground: pickBg(wsSettings.login_background, backup.loginBackground, 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)'),
            portalBackground: pickBg(wsSettings.portal_background, backup.portalBackground, FALLBACK_BG),
            crmBackground: pickBg(wsSettings.crm_background, backup.crmBackground, FALLBACK_BG),
            portalImageOpacity: typeof backup.portalImageOpacity === 'number' ? backup.portalImageOpacity : 1,
            crmImageOpacity: typeof backup.crmImageOpacity === 'number' ? backup.crmImageOpacity : 1,
            logo: backup.logo || '',
          };
          savedAt = backup.savedAt;
        } else {
          // 服务器分支。若背景设置没读到（settingsLoaded=false），这里不能直接用
          // wsSettings 的兜底浅灰覆盖渲染值，否则一进页面就是"一片白"。
          // 优先沿用本地备份里已有的背景设置（首次访问且无备份时才用默认值）。
          const bgFallback = backup || null;
          dataToUse = {
            boards,
            users,
            workspaceBackground: wsSettings.workspace_background
              || bgFallback?.workspaceBackground || '#f5f5f7',
            loginBackground: wsSettings.login_background
              || bgFallback?.loginBackground || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            portalBackground: wsSettings.portal_background
              || bgFallback?.portalBackground || '#f5f5f7',
            crmBackground: wsSettings.crm_background
              || bgFallback?.crmBackground || '#f5f5f7',
            portalImageOpacity: typeof wsSettings.portal_image_opacity === 'number'
              ? wsSettings.portal_image_opacity
              : (typeof bgFallback?.portalImageOpacity === 'number' ? bgFallback.portalImageOpacity : 1),
            crmImageOpacity: typeof wsSettings.crm_image_opacity === 'number'
              ? wsSettings.crm_image_opacity
              : (typeof bgFallback?.crmImageOpacity === 'number' ? bgFallback.crmImageOpacity : 1),
            logo: wsSettings.logo || bgFallback?.logo || '',
          };
          savedAt = new Date().toISOString();
        }

        dispatch({ type: 'LOAD_ALL_DATA', payload: dataToUse });
        loadedRef.current = true;
        void restoreSession();

        // 快照记录“服务器当前值”，用于删除判断
        boardsSnapshotRef.current = JSON.stringify(boards);
        usersSnapshotRef.current = JSON.stringify(users);

        // 避免首次持久化 effect 重复写回 / 广播
        lastLocalContentRef.current = JSON.stringify(dataToUse);
        stableContentRef.current = stableKey(dataToUse);
        latestSnapshotRef.current = dataToUse;

        // 始终将当前加载结果落本地，作为离线兜底镜像。
        // 注意：pending 必须同时满足「背景设置读取成功」，否则本轮数据里的背景是兜底值，
        // 一旦被标记为已同步（pending:false），本地真实内容就再也不会被补传。
        const keepPending = hasPendingLocal || !settingsLoaded;
        try {
          window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...dataToUse, savedAt, pending: keepPending }));
        } catch {}

        if (useLocal && backup) {
          // 仅在「服务器为空、需要恢复」或「本地备份背景本来就完整」时才补保存，
          // 避免一份背景是白底的陈旧备份把服务器上正确的背景设置覆盖掉。
          //
          // 2026-11-05 事故：原条件是 `... || hasPendingLocal`，只要本地有未同步
          // 改动就会推全量数据（含背景），于是每次打开页面都可能把云端渐变刷白。
          // 现在改为：backgrounds 必须由服务器优先，只有服务器完全没有背景时才推。
          const shouldPushToServer =
            (!serverHasData && backup.boards?.length > 0) ||
            (!serverHasBackgrounds && !localBackupMissingBg);
          if (shouldPushToServer) {
            pendingSaveRef.current = true;
            // 推送前强制用「非白底」的背景，杜绝把兜底色写进云端
            const safeBg = {
              workspaceBackground: isRealBg(wsSettings.workspace_background)
                ? wsSettings.workspace_background
                : (isRealBg(dataToUse.workspaceBackground) ? dataToUse.workspaceBackground : FALLBACK_BG),
              loginBackground: wsSettings.login_background || dataToUse.loginBackground,
              portalBackground: isRealBg(wsSettings.portal_background)
                ? wsSettings.portal_background
                : dataToUse.portalBackground,
              crmBackground: isRealBg(wsSettings.crm_background)
                ? wsSettings.crm_background
                : dataToUse.crmBackground,
            };
            enqueueSave({ ...dataToUse, ...safeBg });
          } else {
            // 本地备份背景残缺且服务器数据完整：
            // 这里只丢弃「残缺的背景字段」，改用服务器值，但**绝不清除 pending 标记**。
            // 历史 bug：此处曾把整份备份写成 pending:false，等于把本地尚未同步的
            // 看板/卡片判定为"已同步"，导致下次刷新被服务器数据覆盖、内容凭空消失。
            // pending 只能由 doSave() 在真正写入成功之后清除。
            const repairedBg = {
              workspaceBackground: wsSettings.workspace_background || dataToUse.workspaceBackground,
              loginBackground: wsSettings.login_background || dataToUse.loginBackground,
              portalBackground: wsSettings.portal_background || dataToUse.portalBackground,
              crmBackground: wsSettings.crm_background || dataToUse.crmBackground,
            };
            pendingSaveRef.current = hasPendingLocal;
            try {
              window.localStorage.setItem(BACKUP_KEY, JSON.stringify({
                ...dataToUse,
                ...repairedBg,
                savedAt: new Date().toISOString(),
                pending: hasPendingLocal,
              }));
            } catch {}
            // 背景已用服务器值修复，补一次保存让云端与实际渲染保持一致
            enqueueSave({ ...dataToUse, ...repairedBg });
          }
        }
      } catch (err) {
        console.warn('Supabase load failed:', err);
        let dataToUse: BackupData;
        if (backup && backup.boards.length > 0) {
          dataToUse = {
            boards: backup.boards,
            users: backup.users || [],
            workspaceBackground: backup.workspaceBackground || '#f5f5f7',
            loginBackground: backup.loginBackground || 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            portalBackground: backup.portalBackground || '#f5f5f7',
            crmBackground: backup.crmBackground || '#f5f5f7',
            portalImageOpacity: typeof backup.portalImageOpacity === 'number' ? backup.portalImageOpacity : 1,
            crmImageOpacity: typeof backup.crmImageOpacity === 'number' ? backup.crmImageOpacity : 1,
            logo: backup.logo || '',
          };
          setSaveError('服务器连接失败，已加载本地备份数据');
        } else {
          // 服务器连不上且无本地备份：使用「空数据」而不是 mock 示例数据。
          // 历史遗留问题：这里曾加载 MOCK_BOARDS/MOCK_USERS，而它随后会被持久化
          // effect 当作真实数据写回 Supabase，导致「产品开发项目」等示例看板
          // 污染生产数据库。因此必须用空数据，并禁止本轮写回。
          dataToUse = {
            boards: [],
            users: [],
            workspaceBackground: '#f5f5f7',
            loginBackground: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
            portalBackground: '#f5f5f7',
            crmBackground: '#f5f5f7',
            portalImageOpacity: 1,
            crmImageOpacity: 1,
            logo: '',
          };
          // 关键保护：本轮数据来自「服务器不可用」的降级路径，绝不允许写回云端，
          // 否则会用空/示例数据覆盖服务器上的真实数据。
          blockSaveRef.current = true;
          setSaveError('服务器连接失败，请检查网络后刷新页面');
        }

        dispatch({ type: 'LOAD_ALL_DATA', payload: dataToUse });
        loadedRef.current = true;
        void restoreSession();
        boardsSnapshotRef.current = JSON.stringify(dataToUse.boards);
        usersSnapshotRef.current = JSON.stringify(dataToUse.users);
        // 注意：这里不更新 lastLocalContentRef / stableContentRef，
        // 使得网络恢复后 refetchFromServer 拉取到的真实数据能被正常应用。
      }
    }
    loadData();
  }, [dispatch, enqueueSave, restoreSession]);

  // ===== 持久化：内容变化时立即落本地 + 广播 + 串行保存 =====
  useEffect(() => {
    if (!state._loaded) return;
    // 降级路径（服务器不可用）下禁止写回，避免用空数据覆盖云端真实数据。
    if (blockSaveRef.current) return;

    const data = buildBackup(state);
    const content = JSON.stringify(data);
    if (content === lastLocalContentRef.current) return;

    lastLocalContentRef.current = content;
    stableContentRef.current = stableKey(data);
    latestSnapshotRef.current = data;
    const savedAt = new Date().toISOString();

    // 1. 本地兜底（标记为未同步，保存成功后再清除）
    pendingSaveRef.current = true;
    try {
      window.localStorage.setItem(BACKUP_KEY, JSON.stringify({ ...data, savedAt, pending: true }));
    } catch {}

    // 2. 广播给其他标签页
    broadcastSnapshot(data, savedAt);

    // 3. 落库
    //    - patch 通道生效时：增量已由 enqueuePatch 提交（带版本校验），
    //      这里绝不能再做全量 upsert，否则等于把修复撤销了。
    //    - patch 通道未启用/已熔断：走原来的全量保存路径。
    if (!patchActive()) {
      enqueueSave(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.boards,
    state.users,
    state.workspaceBackground,
    state.loginBackground,
    state.portalBackground,
    state.crmBackground,
    state.portalImageOpacity,
    state.crmImageOpacity,
    state.logo,
    state._loaded,
    broadcastSnapshot,
    enqueueSave,
  ]);

  // ===== 关页面/切后台时强制 flush，防止数据滞留内存 =====
  //
  // 流量优化（2026-11-10）：原来每次切后台/锁屏都无条件 enqueueSave，
  // 手机用户一天切几十次后台就会产生几十次全量上传（每次约 546KB）。
  // 现在改为：只有当「确实有未同步的改动」时才 flush。
  useEffect(() => {
    const flush = () => {
      // 没有待同步改动 → 不产生任何网络请求
      if (!pendingSaveRef.current) return;
      const data = latestSnapshotRef.current;
      if (data) enqueueSave(data);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [enqueueSave]);

  // ===== 包装 dispatch：拦截删除动作，记录被显式删除的 ID =====
  // 传入的 board 是「apply 该 action 之后」的看板（由 patch effect 计算），
  // 保证 actionToPatch 拿到的是 reducer 已经把改动算进去的最新状态。
  const dispatchWithPatch = useCallback((action: Action, boardAfter: Board) => {
    if (!patchActive()) {
      dispatch(action);
      return;
    }
    if (isLocalOnlyAction(action)) {
      dispatch(action);
      return;
    }
    try {
      const payload = actionToPatch(action, boardAfter);
      if (payload && (payload.ops.length > 0 || payload.title || payload.background || payload.labels || payload.data)) {
        void enqueuePatch(boardAfter.id, payload);
      }
    } catch (err) {
      console.warn('[patch] 生成 patch 失败，本次改动仍会由本地备份兜底:', err);
    }
    dispatch(action);
  }, [dispatch, patchActive, enqueuePatch]);

  const trackedDispatch = useCallback((action: Action) => {
    if (action.type === 'DELETE_BOARD') {
      deletedBoardIdsRef.current.add(action.payload);
    } else if (action.type === 'DELETE_USER') {
      deletedUserIdsRef.current.add(action.payload.userId);
    } else if (
      action.type === 'UPDATE_WORKSPACE_BG' ||
      action.type === 'UPDATE_LOGIN_BG' ||
      action.type === 'UPDATE_PORTAL_BG' ||
      action.type === 'UPDATE_CRM_BG' ||
      action.type === 'UPDATE_PORTAL_IMAGE_OPACITY' ||
      action.type === 'UPDATE_CRM_IMAGE_OPACITY' ||
      action.type === 'UPDATE_LOGO'
    ) {
      // 用户主动修改外观 → 允许本次保存真正写入背景字段
      appearanceDirtyRef.current = true;
    }

    if (!patchActive()) {
      dispatch(action);
      return;
    }
    // 用 reducer 预演一次得到「apply 后」的看板，供 actionToPatch 计算位置/字段
    let boardAfter: Board = state.board;
    try {
      boardAfter = baseReducer(state, action).board;
    } catch {
      boardAfter = state.board;
    }
    dispatchWithPatch(action, boardAfter);
  }, [dispatch, state, patchActive, dispatchWithPatch]);

  const broadcastChange = useCallback((action: Action) => {
    trackedDispatch(action);
  }, [trackedDispatch]);

  /**
   * 登出：先让服务端失效会话（清 HttpOnly Cookie），再重置前端状态。
   *
   * 旧实现只 dispatch({type:'SET_CURRENT_USER', payload:null})，
   * 服务端会话仍然有效 —— 这是审计 C3 的会话管理缺陷。
   */
  const logout = useCallback(async () => {
    // 登出前先把待提交的 patch 尽量发出去，避免丢改动
    try {
      if (patchEnabledRef.current) {
        const pending = await outboxListAll();
        for (const entry of pending) {
          await flushPatchEntry(entry);
        }
      }
    } catch (e) {
      console.warn('[logout] flush 待提交改动失败:', e);
    }

    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (e) {
      console.warn('[logout] 服务端登出失败:', e);
    }
    trackedDispatch({ type: 'SET_CURRENT_USER', payload: null });
  }, [trackedDispatch, flushPatchEntry]);


  // 优化：useMemo 包裹 context value，避免不必要的重渲染
  // 注意：对外暴露 trackedDispatch，确保删除动作能被追踪
  const contextValue = React.useMemo(() => ({
    state,
    dispatch: trackedDispatch,
    broadcastChange,
    saveError,
    logout,
  }), [state, trackedDispatch, broadcastChange, saveError, logout]);


  // 保存失败提示自动消失
  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(null), 8000);
    return () => clearTimeout(timer);
  }, [saveError]);

  // ===== patch 通道初始化：开关 / 版本同步 / outbox 重放（灰度）=====
  useEffect(() => {
    patchEnabledRef.current = isPatchRpcEnabled();
    exposeDiagnostics();
    if (!patchEnabledRef.current) {
      console.warn('[patch] 增量写入通道已被显式关闭（NEXT_PUBLIC_USE_PATCH_RPC=false）');
      return;
    }

    console.info('[patch] 增量写入通道已启用');

    // 1. 从服务端同步各看板当前版本（乐观锁基准）。
    //    单独用轻量请求只取 id+version，避免再拉一遍全量看板 JSON。
    let cancelled = false;
    (async () => {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) return;
        const res = await fetch(`${url}/rest/v1/boards?select=id,version`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (!res.ok) return;
        const rows = await res.json();
        if (cancelled || !Array.isArray(rows)) return;
        for (const row of rows) {
          if (row?.id) setBoardVersion(row.id, Number(row.version) || 0);
        }
        console.info('[patch] 已同步云端版本:', rows.length, '个看板');
      } catch (err) {
        console.warn('[patch] 同步云端版本失败:', err);
      }
    })();

    // 2. 重放上次未提交成功的 patch（关页/断网遗留）。
    //    同一看板的 baseVersion 必须串行，重放时按条目顺序推进。
    (async () => {
      const pending = await outboxListAll();
      if (cancelled || pending.length === 0) return;
      console.info(`[patch] 发现 ${pending.length} 条未提交改动，开始重放`);
      for (const entry of pending) {
        if (cancelled) break;
        await flushPatchEntry(entry);
      }
    })();

    // 3. 版本冲突后的处理
    //    【修复 2026-11-11】原实现会清空整个 outbox —— 等于把用户所有
    //    未提交改动全部丢弃（线上「修改内容被自动删除」的直接原因之一）。
    //    现在改为：只重新提交「冲突看板」的排队项（用最新 baseVersion），
    //    其他看板的待提交项完全不动。
    const onConflict = (ev: Event) => {
      const detail = (ev as CustomEvent).detail || {};
      const boardId: string | undefined = detail.boardId;

      void (async () => {
        try {
          const pending = await outboxListAll();
          const targets = boardId
            ? pending.filter(e => e.boardId === boardId)
            : pending;

          // 用最新的 baseVersion 重新提交，保留用户改动而不是丢弃
          for (const entry of targets) {
            const fresh: OutboxEntry = {
              ...entry,
              baseVersion: boardVersionsRef.current.get(entry.boardId) ?? entry.baseVersion,
              attempts: 0,
            };
            await outboxEnqueue(fresh);
            await flushPatchEntry(fresh);
          }
        } catch (e) {
          console.warn('[patch] 冲突后重试失败:', e);
        }
      })();
    };
    window.addEventListener('trello:patch-conflict', onConflict);

    return () => {
      cancelled = true;
      window.removeEventListener('trello:patch-conflict', onConflict);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 关页/切后台：outbox 里还有未提交项时用 sendBeacon 兜底 =====
  useEffect(() => {
    if (!patchEnabledRef.current) return;
    const flush = () => {
      void (async () => {
        const pending = await outboxListAll();
        for (const entry of pending) {
          // 服务端按 entryId 幂等，重复提交无副作用
          beaconSubmit(entry);
        }
      })();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  return (
    <BoardContext.Provider value={contextValue}>
      {children}
      {saveError && createPortal(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100000] max-w-[90vw]">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-600 text-white text-sm font-medium shadow-xl animate-slide-up">
            <span>{saveError}</span>
            <button
              onClick={() => setSaveError(null)}
              className="shrink-0 px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-xs"
            >
              ✕
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* 同步状态指示器：让用户直接看到「改动是否真的落库」，
          不必打开 Console 猜。v2.4.2 新增。 */}
      {state._loaded && state.currentUser && createPortal(
        <div
          className="fixed bottom-3 left-4 z-[99998] select-none pointer-events-none"
          title={syncState.detail}
        >
          <div
            className={
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium shadow-sm backdrop-blur ' +
              (syncState.kind === 'error'
                ? 'bg-red-500/90 text-white'
                : syncState.kind === 'pending'
                ? 'bg-amber-500/90 text-white'
                : 'bg-emerald-500/85 text-white')
            }
          >
            <span
              className={
                'w-1.5 h-1.5 rounded-full bg-white ' +
                (syncState.kind === 'pending' ? 'animate-pulse' : '')
              }
            />
            {syncState.label}
          </div>
        </div>,
        document.body
      )}
    </BoardContext.Provider>
  );
}

export function useBoardContext() {
  const context = useContext(BoardContext);
  if (!context) throw new Error('useBoardContext must be used within BoardProvider');
  return context;
}

export function useBoard() {
  const { state, dispatch, broadcastChange, saveError, logout } = useBoardContext();
  
  // 优化：缓存 findCard 函数，避免每次渲染重新创建
  const findCard = useCallback((cardId: string): { card: any; columnId: string } | undefined => {
    for (const col of state.board.columns) {
      const card = col.cards.find(c => c.id === cardId);
      if (card) return { card, columnId: col.id };
    }
    return undefined;
  }, [state.board.columns]);

  return {
    users: state.users,
    boards: state.boards,
    board: state.board,
    currentBoardId: state.currentBoardId,
    currentUser: state.currentUser,
    viewMode: state.viewMode,
    filters: state.filters,
    darkMode: state.darkMode,
    onlineUsers: state.onlineUsers,
    workspaceBackground: state.workspaceBackground,
    loginBackground: state.loginBackground,
    portalBackground: state.portalBackground,
    crmBackground: state.crmBackground,
    portalImageOpacity: state.portalImageOpacity,
    crmImageOpacity: state.crmImageOpacity,
    logo: state.logo,
    boardLabels: state.boardLabels,
    appSection: state.appSection,
    _loaded: state._loaded,
    dispatch,
    broadcastChange,
    saveError,
    logout,
    findCard,
  };
}

export function useBoardState() {
  return useBoardContext().state;
}

export function useBoardDispatch() {
  return useBoardContext().dispatch;
}

export function useBroadcastChange() {
  return useBoardContext().broadcastChange;
}
