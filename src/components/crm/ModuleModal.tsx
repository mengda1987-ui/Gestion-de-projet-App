'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCrm } from '@/context/CrmContext';
import { useLang } from '@/context/LangContext';
import { X } from 'lucide-react';
import { generateId } from '@/lib/utils';

const EMOJIS = ['📋', '💼', '🎓', '✈️', '🚀', '🏠', '🎯', '🌐', '📦', '🏗️', '🎨', '📈', '🧳', '🤝', '⭐', '❤️'];

const COLORS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
  'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #a855f7 100%)',
  'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
];

export default function ModuleModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useCrm();
  const { t } = useLang();

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [emoji, setEmoji] = useState('📋');
  const [color, setColor] = useState(COLORS[0]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    dispatch({
      type: 'CRM_ADD_MODULE',
      payload: {
        id: generateId(),
        name: trimmed,
        nameEn: nameEn.trim() || trimmed,
        emoji,
        color,
        stages: ['Nouveau', 'En cours', 'Terminé'].map((n, i) => ({ id: generateId(), name: n, order: i })),
        fields: [],
        contacts: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto apple-card p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 dark:text-white text-lg">{t('crm.addModule')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.moduleName')} *</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} className="input" placeholder={t('crm.moduleName')} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.moduleNameEn')}</label>
            <input value={nameEn} onChange={e => setNameEn(e.target.value)} className="input" placeholder={t('crm.moduleNameEn')} />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.moduleEmoji')}</label>
            <div className="flex flex-wrap gap-1.5">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-colors ${emoji === e ? 'bg-blue-100 dark:bg-blue-900/40 ring-2 ring-[#007AFF]' : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.moduleColor')}</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-2 ring-[#007AFF] dark:ring-offset-slate-900' : ''}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-2.5">
          <button onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
          <button onClick={handleSave} disabled={!name.trim()} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
            {t('crm.saveModule')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
