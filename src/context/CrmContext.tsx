'use client';

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CrmModules, CrmModule, CrmStage, CrmField, CrmContact } from '@/types';
import { useBoardState } from './BoardContext';
import { diffEntities, applyEntityOps } from './patch/delta';
import { enqueue, dequeue, listAll, newEntryId, type OutboxEntry } from './patch/outbox';
import { subscribeSync } from '@/lib/syncEvents';


export type CrmView = 'contacts' | 'pipeline';

interface CrmState {
  modules: CrmModules;
  activeModuleId: string;
  view: CrmView;
  _loaded: boolean;
}

type CrmAction = CrmActionBody & { at?: string };
type CrmActionBody =
  | { type: 'CRM_LOAD'; payload: CrmModules }
  | { type: 'CRM_SET_MODULE'; payload: string }
  | { type: 'CRM_SET_VIEW'; payload: CrmView }
  | { type: 'CRM_ADD_MODULE'; payload: CrmModule }
  | { type: 'CRM_RENAME_MODULE'; payload: { moduleId: string; name: string; nameEn: string; emoji: string; color: string } }
  | { type: 'CRM_DELETE_MODULE'; payload: string }
  | { type: 'CRM_ADD_CONTACT'; payload: { moduleId: string; contact: CrmContact } }
  | { type: 'CRM_UPDATE_CONTACT'; payload: { moduleId: string; contactId: string; updates: Partial<CrmContact> } }
  | { type: 'CRM_DELETE_CONTACT'; payload: { moduleId: string; contactId: string } }
  | { type: 'CRM_MOVE_CONTACT'; payload: { moduleId: string; contactId: string; stageId: string } }
  | { type: 'CRM_ADD_STAGE'; payload: { moduleId: string; stage: CrmStage } }
  | { type: 'CRM_RENAME_STAGE'; payload: { moduleId: string; stageId: string; name: string } }
  | { type: 'CRM_DELETE_STAGE'; payload: { moduleId: string; stageId: string } }
  | { type: 'CRM_REORDER_STAGES'; payload: { moduleId: string; stages: CrmStage[] } }
  | { type: 'CRM_ADD_FIELD'; payload: { moduleId: string; field: CrmField } }
  | { type: 'CRM_UPDATE_FIELD'; payload: { moduleId: string; fieldId: string; updates: Partial<CrmField> } }
  | { type: 'CRM_DELETE_FIELD'; payload: { moduleId: string; fieldId: string } }
  | { type: 'CRM_REORDER_FIELDS'; payload: { moduleId: string; fields: CrmField[] } };

function createInitialCrmState(): CrmState {
  const modules: CrmModules = [];
  return {
    modules,
    activeModuleId: modules[0]?.id || '',
    view: 'contacts',
    _loaded: false,
  };
}

function updateModule(
  state: CrmState,
  moduleId: string,
  updater: (m: CrmModule) => CrmModule
): CrmState {
  return {
    ...state,
    modules: state.modules.map(m => (m.id === moduleId ? updater(m) : m)),
  };
}

function crmReducer(state: CrmState, action: CrmAction): CrmState {
  switch (action.type) {
    case 'CRM_LOAD': {
      // 保留用户当前选中的板块，不要因为后台刷新/轮询就把视图弹回第一个模块。
      // 仅在两种情况下才需要切换：1) 首次加载；2) 当前选中的模块已不存在（被删除）。
      const stillExists = action.payload.some(m => m.id === state.activeModuleId);
      const nextActive = stillExists ? state.activeModuleId : (action.payload[0]?.id || '');

      return {
        ...state,
        modules: action.payload,
        activeModuleId: nextActive,
        _loaded: true,
      };
    }

    case 'CRM_SET_MODULE':
      return { ...state, activeModuleId: action.payload };

    case 'CRM_SET_VIEW':
      return { ...state, view: action.payload };

    case 'CRM_ADD_MODULE':
      return {
        ...state,
        modules: [...state.modules, action.payload],
        activeModuleId: action.payload.id,
      };

    case 'CRM_RENAME_MODULE': {
      const { moduleId, name, nameEn, emoji, color } = action.payload;
      return updateModule(state, moduleId, m => ({
        ...m,
        name,
        nameEn,
        emoji,
        color,
        updatedAt: action.at || '1970-01-01T00:00:00.000Z',
      }));
    }

    case 'CRM_DELETE_MODULE': {
      const remaining = state.modules.filter(m => m.id !== action.payload);

      const activeModuleId =
        state.activeModuleId === action.payload ? remaining[0]?.id || '' : state.activeModuleId;
      return { ...state, modules: remaining, activeModuleId };
    }

    case 'CRM_ADD_CONTACT':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        contacts: [...m.contacts, action.payload.contact],
        updatedAt: action.at || '1970-01-01T00:00:00.000Z',
      }));

    case 'CRM_UPDATE_CONTACT':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        contacts: m.contacts.map(c =>
          c.id === action.payload.contactId
            ? { ...c, ...action.payload.updates, updatedAt: action.at || '1970-01-01T00:00:00.000Z' }
            : c
        ),
      }));

    case 'CRM_DELETE_CONTACT':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        contacts: m.contacts.filter(c => c.id !== action.payload.contactId),
      }));

    case 'CRM_MOVE_CONTACT':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        contacts: m.contacts.map(c =>
          c.id === action.payload.contactId
            ? { ...c, stageId: action.payload.stageId, updatedAt: action.at || '1970-01-01T00:00:00.000Z' }
            : c
        ),
      }));

    case 'CRM_ADD_STAGE':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        stages: [...m.stages, action.payload.stage],
      }));

    case 'CRM_RENAME_STAGE':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        stages: m.stages.map(s => (s.id === action.payload.stageId ? { ...s, name: action.payload.name } : s)),
      }));

    case 'CRM_DELETE_STAGE': {
      const target = state.modules.find(m => m.id === action.payload.moduleId);
      const remaining = (target?.stages || []).filter(s => s.id !== action.payload.stageId);
      const fallbackId = remaining[0]?.id || '';
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        stages: remaining,
        contacts: m.contacts.map(c =>
          c.stageId === action.payload.stageId ? { ...c, stageId: fallbackId } : c
        ),
      }));
    }

    case 'CRM_REORDER_STAGES':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        stages: action.payload.stages.map((s, i) => ({ ...s, order: i })),
      }));

    case 'CRM_ADD_FIELD':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        fields: [...m.fields, action.payload.field],
      }));

    case 'CRM_UPDATE_FIELD':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        fields: m.fields.map(f => (f.id === action.payload.fieldId ? { ...f, ...action.payload.updates } : f)),
      }));

    case 'CRM_DELETE_FIELD':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        fields: m.fields.filter(f => f.id !== action.payload.fieldId),
      }));

    case 'CRM_REORDER_FIELDS':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        fields: action.payload.fields,
      }));

    default:
      return state;
  }
}

interface CrmContextType { state: CrmState; dispatch: React.Dispatch<CrmAction>; saveError: string | null; ensureLoaded: () => void }
const CrmContext = createContext<CrmContextType | undefined>(undefined);
function rowToModule(r: any): CrmModule { return { id: r.id, name: r.name, nameEn: r.name_en, emoji: r.emoji, color: r.color, stages: r.data?.stages || [], fields: r.data?.fields || [], contacts: r.data?.contacts || [], createdAt: r.created_at, updatedAt: r.updated_at, version: r.version }; }
export function CrmProvider({ children }: { children: React.ReactNode }) {
  const boardState = useBoardState();
  const uid = boardState.currentUser?.id || '';
  const [state, rawDispatch] = useReducer(crmReducer, undefined, createInitialCrmState);
  const optimistic = useRef(state);
  const pending = useRef(new Map<string, OutboxEntry>());
  const versions = useRef(new Map<string, number>());
  const epoch = useRef(0);
  const running = useRef<Promise<void> | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);
  const mutationRevision = useRef(0);
  const [active, setActive] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sequence = useRef(0);
  const apply = useCallback((action: CrmAction) => { optimistic.current = crmReducer(optimistic.current, action); rawDispatch(action); }, []);
  const ensureLoaded = useCallback(() => { setActive(true); }, []);
  const fetchModules = useCallback(async () => {
    const response = await fetch('/api/crm/modules', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    const body = await response.json(); if (!response.ok) throw new Error(body.message || body.error || 'CRM unavailable');
    if (body.accountId !== uid) throw new Error('Account changed');
    return (body.modules || []).map(rowToModule) as CrmModules;
  }, [uid]);
  const refresh = useCallback(async (generation: number) => {
    if (refreshing.current) { refreshAgain.current = true; return refreshing.current; }
    const task = (async () => {
    do {
    refreshAgain.current = false;
    const revision = mutationRevision.current;
    const remote = await fetchModules();
    if (generation !== epoch.current) return;
    if (revision !== mutationRevision.current) { refreshAgain.current = true; continue; }
    for (const m of remote) versions.current.set(m.id, m.version || 0);
    let merged = remote;
    for (const e of pending.current.values()) {
      if (e.input?.action === 'create' && !merged.some(m => m.id === e.boardId)) merged = [...merged, e.input.module];
      else if (e.input?.action === 'delete') merged = merged.filter(m => m.id !== e.boardId);
      else merged = merged.map(m => m.id === e.boardId ? applyEntityOps(m, e.payload.ops) : m);
    }
    apply({ type: 'CRM_LOAD', payload: merged });
    } while (refreshAgain.current && generation === epoch.current);
    })();
    refreshing.current = task;
    try { await task; } finally { if (refreshing.current === task) refreshing.current = null; }
  }, [apply, fetchModules]);
  const flush = useCallback(async () => {
    if (!uid) return;
    if (running.current) return running.current;
    const generation = epoch.current;
    const task = (async () => {
      const restored = await listAll(uid);
      if (generation !== epoch.current) return;
      for (const e of restored) if (e.kind === 'crm' && !pending.current.has(e.id)) pending.current.set(e.id, e);
      pending.current = new Map([...pending.current].sort(([,a],[,b]) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
      const blocked = new Set<string>();
      for (const entry of pending.current.values()) {
        if (generation !== epoch.current) return;
        if (blocked.has(entry.boardId)) continue;
        let accepted = false;
        try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await fetch('/api/crm/modules', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ id: entry.boardId, entryId: entry.id, accountId: uid, baseVersion: versions.current.get(entry.boardId) ?? entry.baseVersion, ops: entry.payload.ops, ...entry.input }) });
          const body = await response.json();
          if (generation !== epoch.current) return;
          if (response.ok && body.ok) { await dequeue(entry.id); pending.current.delete(entry.id); mutationRevision.current++; accepted = true; await refresh(generation); break; }
          if (body.code === 'VERSION_CONFLICT') { await refresh(generation); continue; }
          throw new Error(body.message || body.code || body.error || 'CRM synchronization failed');
        }
        if (!accepted) throw new Error('CRM conflict remains; edits retained locally');
        } catch (error) { blocked.add(entry.boardId); setSaveError('CRM 未同步，改动已保留：' + String(error)); }
      }
      if (!pending.current.size) setSaveError(null);
    })();
    running.current = task;
    try { await task; } catch (e) { setSaveError('CRM 未同步，改动已保留：' + String(e)); } finally { if (running.current === task) running.current = null; }
  }, [uid, refresh]);
  const dispatch = useCallback((input: CrmAction) => {
    const action = { ...input, at: new Date().toISOString() } as CrmAction;
    const before = optimistic.current; apply(action); const after = optimistic.current;
    if (!uid || ['CRM_LOAD','CRM_SET_MODULE','CRM_SET_VIEW'].includes(action.type)) return;
    const ids = new Set([...before.modules.map(m => m.id), ...after.modules.map(m => m.id)]);
    for (const id of ids) {
      const old = before.modules.find(m => m.id === id), next = after.modules.find(m => m.id === id);
      if (old === next) continue;
      const ops = old && next ? diffEntities(old, next) : [];
      if (old && next && !ops.length) continue;
      const e: OutboxEntry = { id: newEntryId(), accountId: uid, kind: 'crm', boardId: id, baseVersion: versions.current.get(id) || 0, payload: { ops }, attempts: 0, createdAt: sequence.current = Math.max(Date.now(), sequence.current + 1), input: next ? old ? { action: 'patch' } : { action: 'create', module: next } : { action: 'delete' } };
      pending.current.set(e.id, e);
      void enqueue(e).then(saved => { if (!saved) setSaveError('CRM 仅暂存内存，请勿关闭页面。'); return flush(); });
    }
  }, [uid, apply, flush]);
  useEffect(() => {
    epoch.current++; pending.current.clear(); versions.current.clear(); running.current = null; refreshing.current = null;
    apply({ type: 'CRM_LOAD', payload: [] });
  }, [uid, apply]);
  useEffect(() => {
    if (!uid || !active) return;
    let cancelled = false; const generation = epoch.current;
    const resume = async () => { if (cancelled || document.visibilityState === 'hidden') return; await flush(); try { await refresh(generation); } catch (e) { if (!cancelled) setSaveError(String(e)); } };
    void resume();
    const interval = setInterval(() => void resume(), 15000);
    const unsubscribe = subscribeSync(() => { void resume(); });
    const wake = () => { void resume(); };
    window.addEventListener('online', wake); window.addEventListener('pageshow', wake); document.addEventListener('visibilitychange', wake);
    return () => { cancelled = true; clearInterval(interval); unsubscribe(); window.removeEventListener('online', wake); window.removeEventListener('pageshow', wake); document.removeEventListener('visibilitychange', wake); };
  }, [uid, active, flush, refresh]);
  const value = useMemo(() => ({ state, dispatch, saveError, ensureLoaded }), [state, dispatch, saveError, ensureLoaded]);
  return <CrmContext.Provider value={value}>{children}{saveError && createPortal(<div role="alert" className="fixed bottom-6 left-4 z-[100000] max-w-sm rounded-xl bg-red-600 p-3 text-xs text-white">{saveError}</div>, document.body)}</CrmContext.Provider>;
}
export function useCrm() {
  const context = useContext(CrmContext);
  if (!context) throw new Error('useCrm must be used within CrmProvider');
  const { state, dispatch, saveError, ensureLoaded } = context;
  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);
  const activeModule = state.modules.find(m => m.id === state.activeModuleId) || state.modules[0] || null;
  return { state, dispatch, saveError, modules: state.modules, module: activeModule, activeModuleId: state.activeModuleId, view: state.view, contacts: activeModule?.contacts || [], stages: [...(activeModule?.stages || [])].sort((a,b) => a.order-b.order), fields: activeModule?.fields || [] };
}
