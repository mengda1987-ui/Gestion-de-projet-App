'use client';

import React, { createContext, useContext, useReducer, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CrmModules, CrmModule, CrmStage, CrmField, CrmContact, CrmFieldType } from '@/types';
import { generateId } from '@/lib/utils';

const BACKUP_KEY = 'trello_crm_backup_v2';

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

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(crmReducer, null, createInitialCrmState);
  const [saveError, setSaveError] = useState<string | null>(null);
  const snapshotRef = useRef<string>('');

  // 首次加载：优先读取本地备份，否则使用默认模块（含示例数据）
  useEffect(() => {
    const backup = readBackup();
    if (backup && backup.length > 0) {
      dispatch({ type: 'CRM_LOAD', payload: backup });
      snapshotRef.current = JSON.stringify(backup);
    } else {
      const def = createDefaultCrmModules();
      dispatch({ type: 'CRM_LOAD', payload: def });
      snapshotRef.current = JSON.stringify(def);
    }
  }, []);

  // 持久化：数据变化时写入 localStorage，留底防丢失
  useEffect(() => {
    if (!state._loaded) return;
    const current = JSON.stringify(state.modules);
    try {
      window.localStorage.setItem(BACKUP_KEY, current);
      snapshotRef.current = current;
      setSaveError(null);
    } catch (err) {
      console.error('[CRM] 保存失败:', err);
      setSaveError('CRM 数据保存失败，请检查浏览器存储空间');
    }
  }, [state.modules, state._loaded]);

  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => setSaveError(null), 8000);
    return () => clearTimeout(timer);
  }, [saveError]);

  const value = useMemo(() => ({ state, dispatch, saveError }), [state, saveError]);

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
  const module = state.modules.find(m => m.id === state.activeModuleId) || state.modules[0] || null;

  return {
    state,
    dispatch,
    saveError,
    modules: state.modules,
    module,
    activeModuleId: state.activeModuleId,
    view: state.view,
    contacts: module?.contacts || [],
    stages: [...(module?.stages || [])].sort((a, b) => a.order - b.order),
    fields: module?.fields || [],
  };
}
