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
  }));

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
    (key === 'createdAt' || key === 'updatedAt') ? undefined : value
  );
}

// 单个看板的内容键（剔除时间戳），用于判断某个看板是否真的发生了变化
function boardContentKey(board: any): string {
  return JSON.stringify(board, (key, value) =>
    (key === 'createdAt' || key === 'updatedAt') ? undefined : value
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
  // boards_history 表是否可用。null=未知，false=表不存在（不再尝试，省流量）
  const historyTableAvailableRef = useRef<boolean | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);


  // ===== 保存到 Supabase（增量保存：只写真正变化的看板，避免整表覆盖）=====
  // 关键修复：不再整表 upsert，也不再靠快照对比自动删除。
  // 只保存 updatedAt 比服务器快照更新的看板，从根本上避免“用旧数据覆盖别人新数据”。
  const doSave = useCallback(async (data: BackupData) => {
    try {
      // 0. 显式删除：只删除用户主动删除的看板/用户（不再靠快照对比自动删）
      if (deletedBoardIdsRef.current.size > 0) {
        const ids = Array.from(deletedBoardIdsRef.current);
        const { error } = await supabase.from('boards').delete().in('id', ids);
        if (error) throw error;
        deletedBoardIdsRef.current.clear();
      }
      if (deletedUserIdsRef.current.size > 0) {
        const ids = Array.from(deletedUserIdsRef.current);
        const { error } = await supabase.from('users').delete().in('id', ids);
        if (error) throw error;
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
            const localTotal = boardsToSave.reduce(
              (s, b) => s + countCards(b.columns), 0
            );
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

      // 写入前把被覆盖的旧数据快照存档（若历史表已建立）
      // 流量优化：仅当历史表存在时才下载全量存档；表不存在时直接跳过，
      // 避免每次保存都白白下载一遍看板内容。
      if (boardsToSave.length > 0 && historyTableAvailableRef.current !== false) {
        try {
          const ids = boardsToSave.map(b => b.id);
          const { data: before, error: histQueryErr } = await supabase
            .from('boards')
            .select('*')
            .in('id', ids);
          if (histQueryErr) throw histQueryErr;
          if (before && before.length > 0) {
            const { error: histErr } = await supabase.from('boards_history').insert(
              (before as any[]).map(row => ({
                board_id: row.id,
                title: row.title,
                payload: row,
                card_count: (row.data?.columns || []).reduce(
                  (s: number, c: any) => s + ((c?.cards || []).length), 0
                ),
                reason: 'pre-save',
              }))
            );
            // 表不存在（PGRST205）时永久跳过，避免每次都白下载
            if (histErr) {
              if ((histErr as any).code === 'PGRST205') {
                historyTableAvailableRef.current = false;
                console.info('[历史存档] boards_history 表不存在，已停止尝试（执行迁移后可启用）');
              }
            } else {
              historyTableAvailableRef.current = true;
            }
          }
        } catch {
          // 历史表未建立时静默跳过，不影响主流程
        }
      }


      if (boardsToSave.length > 0) {
        const rows = boardsToSave.map(b => ({
          id: b.id,
          title: b.title,
          background: b.background,
          labels: b.labels,
          data: { columns: b.columns, mindmap: b.mindmap },
          emoji: b.emoji || null,
          iconBg: b.iconBg || null,
          iconImage: b.iconImage || null,
          visibleTo: b.visibleTo || [],
          order: b.order ?? 0,
          updated_at: new Date().toISOString(),
        }));
        const { error: boardsError } = await supabase.from('boards').upsert(rows);
        if (boardsError) throw boardsError;
      }

      // 2. 用户：同样只保存有变化的
      const prevUsers: any[] = usersSnapshotRef.current ? JSON.parse(usersSnapshotRef.current) : [];
      const prevUserMap = new Map<string, any>(prevUsers.map((u: any) => [u.id, u]));
      const usersToSave = data.users.filter(u => {
        const prev = prevUserMap.get(u.id);
        if (!prev) return true;
        return JSON.stringify(prev) !== JSON.stringify(u);
      });

      if (usersToSave.length > 0) {
        const rows = usersToSave.map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
          avatar: u.avatar,
          color: u.color,
          role: u.role,
          password: u.password,
          lang: u.lang,
        }));
        const { error: usersError } = await supabase.from('users').upsert(rows);
        if (usersError) throw usersError;
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

        // 存档旧设置（历史表建好后生效）
        if (remoteSettings && appearanceDirtyRef.current) {
          try {
            await supabase.from('workspace_settings_history').insert({
              payload: remoteSettings,
              reason: 'pre-save',
            });
          } catch {}
        }
      } catch (e) {
        console.warn('[保护] 读取云端背景设置失败，本次按本地值写入:', e);
      }

      const { error: settingsError } = await supabase
        .from('workspace_settings')
        .upsert(settingsPayload);

      if (settingsError) throw settingsError;
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
  }, []);


  const enqueueSave = useCallback((data: BackupData) => {
    saveQueueRef.current = saveQueueRef.current.then(() => doSave(data)).catch(() => {});
  }, [doSave]);

  // ===== 跨标签页广播 =====
  const broadcastSnapshot = useCallback((data: BackupData, savedAt: string) => {
    try {
      bcRef.current?.postMessage({ kind: 'full-snapshot', savedAt, data });
    } catch {}
  }, []);

  // ===== 从服务器重新拉取，并在内容变化时应用到 state（跨用户实时同步）=====
  const refetchFromServer = useCallback(async () => {
    if (!loadedRef.current) return;
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!url) return;

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
      );

      const [{ data: usersData }, { data: boardsData }] = await Promise.race([
        Promise.all([
          supabase.from('users').select('*'),
          supabase.from('boards').select('*'),
        ]),
        timeout,
      ]) as any;

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
        const remoteTime = new Date(rb.updatedAt || 0).getTime();
        const localTime = new Date(lb.updatedAt || 0).getTime();
        // 远端更新（或时间相同但内容不同）则采用远端，否则保留本地
        if (remoteTime > localTime) {
          mergedBoards.push(rb);
        } else if (remoteTime === localTime && boardContentKey(rb) !== boardContentKey(lb)) {
          mergedBoards.push(rb);
        } else {
          mergedBoards.push(lb);
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
    }
  }, [dispatch]);


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
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refetchFromServer(), 800);
    };

    const channel = supabase
      .channel('board-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workspace_settings' }, scheduleRefetch)
      .subscribe();

    // 兜底轮询：即使 Realtime 未在 Supabase 后台开启，也能保证多用户最终一致
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refetchFromServer();
    }, 15000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
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

        const [{ data: usersData }, { data: boardsData }] = await Promise.race([
          Promise.all([
            supabase.from('users').select('*'),
            supabase.from('boards').select('*'),
          ]),
          timeout,
        ]) as any;

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
        // 服务器是否已有有效的背景设置（有值才算有效）
        const serverHasAppearance = (v: unknown) => typeof v === 'string' && v.length > 0;
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
        boardsSnapshotRef.current = JSON.stringify(dataToUse.boards);
        usersSnapshotRef.current = JSON.stringify(dataToUse.users);
        // 注意：这里不更新 lastLocalContentRef / stableContentRef，
        // 使得网络恢复后 refetchFromServer 拉取到的真实数据能被正常应用。
      }
    }
    loadData();
  }, [dispatch, enqueueSave]);

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

    // 3. 串行保存到 Supabase
    enqueueSave(data);
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
    dispatch(action);
  }, [dispatch]);

  const broadcastChange = useCallback((action: Action) => {
    trackedDispatch(action);
  }, [trackedDispatch]);


  // 优化：useMemo 包裹 context value，避免不必要的重渲染
  // 注意：对外暴露 trackedDispatch，确保删除动作能被追踪
  const contextValue = React.useMemo(() => ({
    state,
    dispatch: trackedDispatch,
    broadcastChange,
    saveError
  }), [state, trackedDispatch, broadcastChange, saveError]);


  // 保存失败提示自动消失
  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(null), 8000);
    return () => clearTimeout(timer);
  }, [saveError]);

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
    </BoardContext.Provider>
  );
}

export function useBoardContext() {
  const context = useContext(BoardContext);
  if (!context) throw new Error('useBoardContext must be used within BoardProvider');
  return context;
}

export function useBoard() {
  const { state, dispatch, broadcastChange, saveError } = useBoardContext();
  
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
