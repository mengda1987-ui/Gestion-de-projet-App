'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { X, Plus, Trash2 } from 'lucide-react';
import type { CrmType, CrmField, CrmFieldType } from '@/types';
import { generateId } from '@/lib/utils';

interface CrmFieldsManagerProps {
  crmType: CrmType;
  onClose: () => void;
}

export default function CrmFieldsManager({ crmType, onClose }: CrmFieldsManagerProps) {
  const { crmFields, currentUser, dispatch } = useBoard();
  const { t, lang } = useLang();

  const fields = crmFields[crmType] || [];

  const [name, setName] = useState('');
  const [type, setType] = useState<CrmFieldType>('text');
  const [options, setOptions] = useState('');

  const addField = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const field: CrmField = {
      id: generateId(),
      name: trimmed,
      type,
      ...(type === 'select' ? { options: options.split(',').map(s => s.trim()).filter(Boolean) } : {}),
    };
    dispatch({ type: 'ADD_CRM_FIELD', payload: { crmType, field } });
    dispatch({
      type: 'ADD_OPERATION_LOG',
      payload: {
        log: {
          id: generateId(),
          userId: currentUser?.id || '',
          userName: currentUser?.name || '',
          action: 'add_crm_field',
          detail: `${trimmed} (${type})`,
          createdAt: new Date().toISOString(),
        },
      },
    });
    setName('');
    setOptions('');
  };

  const deleteField = (field: CrmField) => {
    if (confirm(t('crm.fields.deleteConfirm', { name: field.name }))) {
      dispatch({ type: 'DELETE_CRM_FIELD', payload: { crmType, fieldId: field.id } });
      dispatch({
        type: 'ADD_OPERATION_LOG',
        payload: {
          log: {
            id: generateId(),
            userId: currentUser?.id || '',
            userName: currentUser?.name || '',
            action: 'delete_crm_field',
            detail: field.name,
            createdAt: new Date().toISOString(),
          },
        },
      });
    }
  };

  const typeLabel = (ft: CrmFieldType) => {
    switch (ft) {
      case 'text': return t('crm.fields.text');
      case 'number': return t('crm.fields.number');
      case 'date': return t('crm.fields.date');
      case 'select': return t('crm.fields.select');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md apple-card overflow-hidden flex flex-col animate-slide-up max-h-[80vh]">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="font-bold text-slate-900 text-lg">{t('crm.fields.manage')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {fields.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              <p>{t('crm.fields.empty')}</p>
              <p className="text-xs mt-1">{t('crm.fields.emptyHint')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {fields.map(field => (
                <div key={field.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{field.name}</div>
                    <div className="text-[11px] text-slate-400">{typeLabel(field.type)}</div>
                  </div>
                  <button
                    onClick={() => deleteField(field)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add field */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Plus size={14} />
              {t('crm.fields.add')}
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addField()}
              placeholder={t('crm.fields.name')}
              className="input mb-2 text-sm"
            />
            <select value={type} onChange={e => setType(e.target.value as CrmFieldType)} className="input mb-2 text-sm">
              <option value="text">{t('crm.fields.text')}</option>
              <option value="number">{t('crm.fields.number')}</option>
              <option value="date">{t('crm.fields.date')}</option>
              <option value="select">{t('crm.fields.select')}</option>
            </select>
            {type === 'select' && (
              <input
                value={options}
                onChange={e => setOptions(e.target.value)}
                placeholder={t('crm.fields.options')}
                className="input mb-2 text-sm"
              />
            )}
            <button onClick={addField} disabled={!name.trim()} className="btn-primary text-sm w-full">
              {lang === 'zh' ? '添加字段' : 'Add field'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
