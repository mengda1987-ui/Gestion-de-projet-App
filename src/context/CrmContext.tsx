'use client';

import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CrmModules, CrmModule, CrmStage, CrmField, CrmContact, CrmFieldType } from '@/types';
import { generateId } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

const BACKUP_KEY = 'trello_crm_backup_v2';
const SYNC_CHANNEL = 'trello-crm-sync-channel';

export type CrmView = 'contacts' | 'pipeline';

interface CrmState {
  modules: CrmModules;
  activeModuleId: string;
  view: CrmView;
  _loaded: boolean;
}

type CrmAction =
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

function field(name: string, type: CrmFieldType, options?: string[]): CrmField {
  return { id: generateId(), name, type, ...(options ? { options } : {}) };
}

function stage(name: string, order: number): CrmStage {
  return { id: generateId(), name, order };
}

function makeStages(names: string[]): CrmStage[] {
  return names.map((name, i) => stage(name, i));
}

// 根据字段名构建一条联系人的自定义字段值
function makeContact(
  fields: CrmField[],
  name: string,
  stageId: string,
  data: Record<string, string>
): CrmContact {
  const customFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    const id = fields.find(f => f.name === key)?.id;
    if (id && value) customFields[id] = value;
  }
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    email: '',
    phone: '',
    company: '',
    tags: [],
    ownerId: '',
    stageId,
    notes: '',
    customFields,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultCrmModules(): CrmModules {
  const now = new Date().toISOString();

  // ===== Courses / 课程 =====
  const coursFields: CrmField[] = [
    field('ID Contact', 'text'),
    field("Date d'ajout", 'date'),
    field('Nom parent', 'text'),
    field('Prénom parent', 'text'),
    field('Titre parent', 'text'),
    field('Nom élève', 'text'),
    field('Prénom élève', 'text'),
    field('Titre', 'text'),
    field('Age élève', 'number'),
    field('Nom établissement', 'text'),
    field('Type établissement', 'text'),
    field('Pays', 'text'),
    field('Ville', 'text'),
    field('Fuseau horaire', 'text'),
    field('Adresse postale', 'text'),
    field('ID Wechat parent', 'text'),
    field('ID Wechat enfant', 'text'),
    field('Mail parent', 'text'),
    field('Mail enfant', 'text'),
    field('Langue parlée à la maison', 'text'),
    field('Créneaux horaires disponibles', 'text'),
    field('Besoins', 'text'),
    field('Niveau', 'text'),
    field('Statut lead', 'select', ['1er contact pris', '1er entretien fait', 'Inscrit', 'Perdu']),
  ];
  const coursStages = makeStages(['1er contact pris', '1er entretien fait', 'Inscrit', 'Perdu']);

  // ===== Trips / 旅行 =====
  const voyageFields: CrmField[] = [
    field('ID Contact', 'text'),
    field("Date d'ajout", 'date'),
    field('ID Etablissement', 'text'),
    field('Pays', 'text'),
    field('Ville', 'text'),
    field('Adresse', 'text'),
    field('Nom contact', 'text'),
    field('Prénom contact', 'text'),
    field('Titre contact', 'text'),
    field('Fonction contact', 'text'),
    field('Mail contact', 'text'),
    field('ID Wechat contact', 'text'),
    field('Fuseau horaire', 'text'),
    field('Besoins', 'text'),
    field("Niveau d'engagement", 'select', ['Chaud', 'Neutre', 'Résistant']),
    field('Actions', 'text'),
  ];
  const voyageStages = makeStages(['Nouveau', 'Qualifié', 'Devis envoyé', 'Gagné', 'Perdu']);
  const voyageContacts: CrmContact[] = [
    makeContact(voyageFields, 'Hui Mingyang', voyageStages[0].id, {
      'Nom contact': 'Hui',
      'Prénom contact': 'Mingyang',
      "Niveau d'engagement": 'Chaud',
      'Actions': 'Appel pour faire un point sur les voyages',
    }),
  ];

  // ===== Projects / 项目 =====
  const projetFields: CrmField[] = [
    field('ID Projet', 'text'),
    field('Nom Projet', 'text'),
    field('ID Etablissement', 'text'),
    field('Etablissement', 'text'),
    field('ID Responsable Voyage', 'text'),
    field('Nom Responsable Voyage', 'text'),
    field('ID Autre Contact', 'text'),
    field('Nom Autre Contact', 'text'),
    field('Dates Voyage', 'text'),
    field('Effectif Estimé', 'number'),
    field('Prix Estimé', 'text'),
    field('Budget Total Voyage', 'text'),
    field('Etape Cycle de Vente', 'select', [
      'Projet validé par le responsable',
      'Projet validé par le n+1',
      'Inscriptions reçues',
    ]),
    field('Statut Projet', 'select', ['En cours', 'Gagné', 'Perdu', 'Reporté']),
    field('Action', 'text'),
  ];
  const projetStages = makeStages(['En cours', 'Gagné', 'Perdu', 'Reporté']);

  const projetRows: Array<{ name: string; data: Record<string, string> }> = [
    {
      name: 'Voyage Chine Les Chartreux 2026',
      data: {
        'Nom Projet': 'Voyage Chine Les Chartreux 2026',
        'Etablissement': 'Les Chartreux',
        'Nom Responsable Voyage': 'Vincent Li',
        'Nom Autre Contact': 'Arthur Gouhier',
        'Dates Voyage': '16 au 24 octobre 2026',
        'Effectif Estimé': '20',
        'Prix Estimé': '800,00 €',
        'Budget Total Voyage': '16 000,00 €',
      },
    },
    {
      name: 'Voyage France',
      data: {
        'Nom Projet': 'Voyage France',
        'Etablissement': 'Keystone',
        'Nom Responsable Voyage': 'Yanjun',
        'Dates Voyage': 'octobre 2027',
        'Action': 'Envoi devis à Yanjun',
      },
    },
    {
      name: 'Voyage UK',
      data: {
        'Nom Projet': 'Voyage UK',
        'Etablissement': 'Keystone',
        'Nom Responsable Voyage': '??',
        'Action': 'Demande Sarah + autre prof pour voyage cette année',
      },
    },
    {
      name: 'Voyage Allemagne',
      data: {
        'Nom Projet': 'Voyage Allemagne',
        'Etablissement': 'Keystone',
        'Nom Responsable Voyage': 'Tingting',
        'Action': "Parler à Tingting de l'Allemagne",
      },
    },
    {
      name: 'Voyage Italie',
      data: {
        'Nom Projet': 'Voyage Italie',
        'Etablissement': 'Keystone',
        'Nom Responsable Voyage': 'Yanjun',
        'Action': 'Envoi devis à Yanjun',
      },
    },
    {
      name: 'Voyage Allemagne',
      data: {
        'Nom Projet': 'Voyage Allemagne',
        'Etablissement': 'Shanghai Waiguoyu',
        'Nom Responsable Voyage': "Prof d'allemand",
        'Action': "Trouver échange scolaire en Allemagne : Sophie Santini, Lena, école partenaire des Chartreux, pote de Houli",
      },
    },
    {
      name: 'Voyage France',
      data: {
        'Nom Projet': 'Voyage France',
        'Etablissement': 'Shanghai Waiguoyu',
        'Nom Responsable Voyage': 'M. Chen',
        'Action': 'Reprise contact M. Chen et Mme Hui',
      },
    },
    {
      name: 'Voyage Italie',
      data: {
        'Nom Projet': 'Voyage Italie',
        'Etablissement': 'Hangzhou Jack Ma',
        'Nom Responsable Voyage': "Prof d'art",
        'Action': 'Relance avec catalogue',
      },
    },
    {
      name: 'Voyage France',
      data: {
        'Nom Projet': 'Voyage France',
        'Etablissement': 'Shenyang',
        'Action': 'Relance avec propale été Chartreux internat',
      },
    },
    {
      name: 'Voyage France',
      data: {
        'Nom Projet': 'Voyage France',
        'Etablissement': 'Haidian Waiguoyu',
        'Action': 'Pause',
      },
    },
    {
      name: 'Voyage Chine',
      data: {
        'Nom Projet': 'Voyage Chine',
        'Etablissement': 'Ecole de Wuhan',
        'Action': "Trouver échange scolaire en Allemagne : Sophie Santini, Lena, école partenaire des Chartreux, pote de Houli",
      },
    },
  ];
  const projetContacts: CrmContact[] = projetRows.map(row =>
    makeContact(projetFields, row.name, projetStages[0].id, row.data)
  );

  return [
    {
      id: 'cours',
      name: '课程',
      nameEn: 'Courses',
      emoji: '🎓',
      color: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
      stages: coursStages,
      fields: coursFields,
      contacts: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'voyages',
      name: '旅行',
      nameEn: 'Trips',
      emoji: '✈️',
      color: 'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)',
      stages: voyageStages,
      fields: voyageFields,
      contacts: voyageContacts,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'projets',
      name: '项目',
      nameEn: 'Projects',
      emoji: '🚀',
      color: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
      stages: projetStages,
      fields: projetFields,
      contacts: projetContacts,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function createInitialCrmState(): CrmState {
  const modules = createDefaultCrmModules();
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
    case 'CRM_LOAD':
      return {
        ...state,
        modules: action.payload,
        activeModuleId: action.payload[0]?.id || state.activeModuleId,
        _loaded: true,
      };

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
        updatedAt: new Date().toISOString(),
      }));
    }

    case 'CRM_DELETE_MODULE': {
      const remaining = state.modules.filter(m => m.id !== action.payload);
      if (remaining.length === 0) return state;
      const activeModuleId =
        state.activeModuleId === action.payload ? remaining[0].id : state.activeModuleId;
      return { ...state, modules: remaining, activeModuleId };
    }

    case 'CRM_ADD_CONTACT':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        contacts: [...m.contacts, action.payload.contact],
        updatedAt: new Date().toISOString(),
      }));

    case 'CRM_UPDATE_CONTACT':
      return updateModule(state, action.payload.moduleId, m => ({
        ...m,
        contacts: m.contacts.map(c =>
          c.id === action.payload.contactId
            ? { ...c, ...action.payload.updates, updatedAt: new Date().toISOString() }
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
            ? { ...c, stageId: action.payload.stageId, updatedAt: new Date().toISOString() }
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

interface CrmContextType {
  state: CrmState;
  dispatch: React.Dispatch<CrmAction>;
  saveError: string | null;
}

const CrmContext = createContext<CrmContextType | undefined>(undefined);

function readBackup(): CrmModules | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as CrmModules;
  } catch {
    return null;
  }
}

// ===== Supabase 行 <-> 模块 映射（与 boards 表同构）=====
interface CrmModuleRow {
  id: string;
  name: string;
  name_en: string;
  emoji: string;
  color: string;
  data: { stages?: CrmStage[]; fields?: CrmField[]; contacts?: CrmContact[] };
  order: number;
  created_at: string;
  updated_at: string;
}

function rowToModule(r: any): CrmModule {
  return {
    id: r.id,
    name: r.name || '',
    nameEn: r.name_en || '',
    emoji: r.emoji || '📋',
    color: r.color || '#007AFF',
    stages: r.data?.stages || [],
    fields: r.data?.fields || [],
    contacts: r.data?.contacts || [],
    createdAt: r.created_at || new Date().toISOString(),
    updatedAt: r.updated_at || new Date().toISOString(),
  };
}

function moduleToRow(m: CrmModule, order: number): CrmModuleRow {
  return {
    id: m.id,
    name: m.name,
    name_en: m.nameEn,
    emoji: m.emoji,
    color: m.color,
    data: { stages: m.stages, fields: m.fields, contacts: m.contacts },
    order,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

// 剔除时间戳的稳定键：用于判断模块内容是否真的变化，避免时间差造成回环
function moduleContentKey(m: any): string {
  return JSON.stringify(m, (key, value) =>
    (key === 'createdAt' || key === 'updatedAt') ? undefined : value
  );
}

function modulesStableKey(modules: CrmModules): string {
  return JSON.stringify(
    modules.map(m => JSON.parse(moduleContentKey(m))),
  );
}

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(crmReducer, null, createInitialCrmState);
  const [saveError, setSaveError] = useState<string | null>(null);
  const snapshotRef = useRef<string>('');          // 上次成功保存到服务器的模块快照
  const lastLocalContentRef = useRef<string>('');
  const stableContentRef = useRef<string>('');
  const latestModulesRef = useRef<CrmModules>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveRef = useRef(false);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const loadedRef = useRef(false);
  // 显式删除追踪：只有用户主动删除的模块才会从服务器删除，避免误删他人数据
  const deletedModuleIdsRef = useRef<Set<string>>(new Set());

  // ===== 保存到 Supabase（增量：只 upsert 真正有变化的模块）=====
  const doSave = useCallback(async (modules: CrmModules) => {
    try {
      // 0. 显式删除
      if (deletedModuleIdsRef.current.size > 0) {
        const ids = Array.from(deletedModuleIdsRef.current);
        const { error } = await supabase.from('crm_modules').delete().in('id', ids);
        if (error) throw error;
        deletedModuleIdsRef.current.clear();
      }

      // 1. 与上次成功保存的快照比对，只写变化的模块
      const prevModules: CrmModule[] = snapshotRef.current ? JSON.parse(snapshotRef.current) : [];
      const prevMap = new Map<string, CrmModule>(prevModules.map(m => [m.id, m]));

      const toSave = modules.filter(m => {
        const prev = prevMap.get(m.id);
        if (!prev) return true;
        return moduleContentKey(prev) !== moduleContentKey(m);
      });

      if (toSave.length > 0) {
        const rows = toSave.map(m => moduleToRow(m, modules.findIndex(x => x.id === m.id)));
        const { error } = await supabase.from('crm_modules').upsert(rows);
        if (error) throw error;
      }

      // 保存成功：更新快照
      snapshotRef.current = JSON.stringify(modules);

      if (JSON.stringify(modules) === lastLocalContentRef.current) {
        pendingSaveRef.current = false;
      }
      setSaveError(null);
    } catch (err) {
      console.error('[CRM] 保存到服务器失败:', err);
      setSaveError('CRM 数据保存失败，已暂存在本地。请检查网络后重试。');
    }
  }, []);

  const enqueueSave = useCallback((modules: CrmModules) => {
    saveQueueRef.current = saveQueueRef.current.then(() => doSave(modules)).catch(() => {});
  }, [doSave]);

  // ===== 从服务器重新拉取，内容变化时应用到 state（跨用户实时同步）=====
  const refetchFromServer = useCallback(async () => {
    if (!loadedRef.current) return;
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!url) return;

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
      );

      const { data: rows } = await Promise.race([
        supabase.from('crm_modules').select('*').order('order', { ascending: true }),
        timeout.then(() => { throw new Error('timeout'); }),
      ]) as any;

      const remote: CrmModules = (rows || []).map(rowToModule);

      // 逐模块合并：以 updatedAt 为准，谁新用谁（与看板策略一致）
      const localModules = latestModulesRef.current;
      const localMap = new Map<string, CrmModule>(localModules.map(m => [m.id, m]));

      const merged: CrmModule[] = [];
      const remoteIds = new Set<string>();

      for (const rm of remote) {
        remoteIds.add(rm.id);
        const lm = localMap.get(rm.id);
        if (!lm) { merged.push(rm); continue; }
        const remoteTime = new Date(rm.updatedAt || 0).getTime();
        const localTime = new Date(lm.updatedAt || 0).getTime();
        if (remoteTime > localTime) {
          merged.push(rm);
        } else if (remoteTime === localTime && moduleContentKey(rm) !== moduleContentKey(lm)) {
          merged.push(rm);
        } else {
          merged.push(lm);
        }
      }

      // 本地有、远端没有的模块：保留（可能是刚创建还没保存成功）
      for (const lm of localModules) {
        if (!remoteIds.has(lm.id)) merged.push(lm);
      }

      const stable = modulesStableKey(merged);
      if (stable === stableContentRef.current) return;

      stableContentRef.current = stable;
      lastLocalContentRef.current = JSON.stringify(merged);
      latestModulesRef.current = merged;
      snapshotRef.current = JSON.stringify(remote);
      try {
        window.localStorage.setItem(BACKUP_KEY, JSON.stringify(merged));
      } catch {}
      dispatch({ type: 'CRM_LOAD', payload: merged });
    } catch (err) {
      console.warn('[CRM Realtime] 重新拉取失败:', err);
    }
  }, []);

  // ===== 加载数据：本地备份与 Supabase 比较，取较新者 =====
  useEffect(() => {
    async function loadData() {
      const backup = readBackup();
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!url) throw new Error('No Supabase URL configured');

        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Supabase request timed out')), 8000)
        );

        const { data: rows } = await Promise.race([
          supabase.from('crm_modules').select('*').order('order', { ascending: true }),
          timeout.then(() => { throw new Error('timeout'); }),
        ]) as any;

        const remote: CrmModules = (rows || []).map(rowToModule);
        const serverHasData = remote.length > 0;

        // 服务器为空但本地有数据 -> 用本地并补传（首次迁移，把老数据搬上云）
        const useLocal = !serverHasData && !!backup && backup.length > 0;

        let dataToUse: CrmModules;
        if (useLocal && backup) {
          dataToUse = backup;
        } else if (serverHasData) {
          dataToUse = remote;
        } else {
          dataToUse = createDefaultCrmModules();
        }

        dispatch({ type: 'CRM_LOAD', payload: dataToUse });
        loadedRef.current = true;
        lastLocalContentRef.current = JSON.stringify(dataToUse);
        stableContentRef.current = modulesStableKey(dataToUse);
        latestModulesRef.current = dataToUse;
        snapshotRef.current = JSON.stringify(serverHasData ? remote : []);

        try {
          window.localStorage.setItem(BACKUP_KEY, JSON.stringify(dataToUse));
        } catch {}

        // 本地有历史数据但服务器为空：补传到服务器
        if (useLocal) {
          pendingSaveRef.current = true;
          enqueueSave(dataToUse);
        }
      } catch (err) {
        console.warn('[CRM] 服务器加载失败，使用本地备份:', err);
        let dataToUse: CrmModules;
        if (backup && backup.length > 0) {
          dataToUse = backup;
          setSaveError('服务器连接失败，已加载本地 CRM 备份数据');
        } else {
          dataToUse = createDefaultCrmModules();
        }
        dispatch({ type: 'CRM_LOAD', payload: dataToUse });
        loadedRef.current = true;
        lastLocalContentRef.current = JSON.stringify(dataToUse);
        stableContentRef.current = modulesStableKey(dataToUse);
        latestModulesRef.current = dataToUse;
      }
    }
    loadData();
  }, [enqueueSave]);

  // ===== 跨标签页实时同步 =====
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof BroadcastChannel === 'undefined') return;

    const bc = new BroadcastChannel(SYNC_CHANNEL);
    bcRef.current = bc;
    bc.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || msg.kind !== 'full-snapshot' || !Array.isArray(msg.modules)) return;
      const content = JSON.stringify(msg.modules);
      if (content === lastLocalContentRef.current) return;
      lastLocalContentRef.current = content;
      stableContentRef.current = modulesStableKey(msg.modules);
      latestModulesRef.current = msg.modules;
      try {
        window.localStorage.setItem(BACKUP_KEY, content);
      } catch {}
      dispatch({ type: 'CRM_LOAD', payload: msg.modules });
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
      .channel('crm-realtime-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_modules' }, scheduleRefetch)
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

  // 持久化：内容变化时落本地 + 广播给其他标签页 + 串行保存到服务器
  useEffect(() => {
    if (!state._loaded) return;
    const modules = state.modules;
    const current = JSON.stringify(modules);
    if (current === lastLocalContentRef.current) return;

    lastLocalContentRef.current = current;
    stableContentRef.current = modulesStableKey(modules);
    latestModulesRef.current = modules;

    // 1. 本地兜底
    pendingSaveRef.current = true;
    try {
      window.localStorage.setItem(BACKUP_KEY, current);
    } catch (err) {
      console.error('[CRM] 本地保存失败:', err);
      setSaveError('CRM 数据保存失败，请检查浏览器存储空间');
    }

    // 2. 广播给其他标签页
    try {
      bcRef.current?.postMessage({ kind: 'full-snapshot', modules });
    } catch {}

    // 3. 串行保存到 Supabase
    enqueueSave(modules);
  }, [state.modules, state._loaded, enqueueSave]);

  // ===== 关页面/切后台时强制 flush，防止数据滞留内存 =====
  useEffect(() => {
    const flush = () => {
      const modules = latestModulesRef.current;
      if (modules && modules.length > 0) enqueueSave(modules);
    };
    window.addEventListener('pagehide', flush);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enqueueSave]);

  // ===== 包装 dispatch：拦截删除动作，记录被显式删除的模块 ID =====
  const trackedDispatch = useCallback((action: CrmAction) => {
    if (action.type === 'CRM_DELETE_MODULE') {
      deletedModuleIdsRef.current.add(action.payload);
    }
    dispatch(action);
  }, [dispatch]);

  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(null), 8000);
    return () => clearTimeout(timer);
  }, [saveError]);

  const value = useMemo(() => ({ state, dispatch: trackedDispatch, saveError }), [state, trackedDispatch, saveError]);

  return (
    <CrmContext.Provider value={value}>
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
    </CrmContext.Provider>
  );
}

export function useCrm() {
  const context = useContext(CrmContext);
  if (!context) throw new Error('useCrm must be used within CrmProvider');
  const { state, dispatch, saveError } = context;
  const activeModule = state.modules.find(m => m.id === state.activeModuleId) || state.modules[0] || null;

  return {
    state,
    dispatch,
    saveError,
    modules: state.modules,
    module: activeModule,
    activeModuleId: state.activeModuleId,
    view: state.view,
    contacts: activeModule?.contacts || [],
    stages: [...(activeModule?.stages || [])].sort((a, b) => a.order - b.order),
    fields: activeModule?.fields || [],
  };
}
