import type { CrmType } from '@/types';

export const CRM_META: Record<CrmType, { emoji: string; bg: string; titleKey: string; descKey: string }> = {
  cours: {
    emoji: '🎓',
    bg: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
    titleKey: 'crm.cours',
    descKey: 'crm.cours.desc',
  },
  voyages: {
    emoji: '✈️',
    bg: 'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)',
    titleKey: 'crm.voyages',
    descKey: 'crm.voyages.desc',
  },
  projets: {
    emoji: '🚀',
    bg: 'linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)',
    titleKey: 'crm.projets',
    descKey: 'crm.projets.desc',
  },
};

export const CRM_TYPES: CrmType[] = ['cours', 'voyages', 'projets'];
