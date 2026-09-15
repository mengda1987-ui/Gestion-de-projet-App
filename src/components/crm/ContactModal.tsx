'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CrmContact } from '@/types';
import { useCrm } from '@/context/CrmContext';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { X } from 'lucide-react';
import { generateId } from '@/lib/utils';

interface ContactModalProps {
  contact: CrmContact | null;
  onClose: () => void;
}

export default function ContactModal({ contact, onClose }: ContactModalProps) {
  const { stages, fields, activeModuleId, dispatch } = useCrm();
  const { users, currentUser } = useBoard();
  const { t } = useLang();

  const [name, setName] = useState(contact?.name || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [company, setCompany] = useState(contact?.company || '');
  const [tags, setTags] = useState(contact?.tags.join(', ') || '');
  const [ownerId, setOwnerId] = useState(contact?.ownerId || currentUser?.id || '');
  const [stageId, setStageId] = useState(contact?.stageId || stages[0]?.id || '');
  const [notes, setNotes] = useState(contact?.notes || '');
  const [customFields, setCustomFields] = useState<Record<string, string>>(contact?.customFields || {});

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const tagList = tags.split(',').map(s => s.trim()).filter(Boolean);

    if (contact) {
      dispatch({
        type: 'CRM_UPDATE_CONTACT',
        payload: {
          moduleId: activeModuleId,
          contactId: contact.id,
          updates: { name: trimmed, email, phone, company, tags: tagList, ownerId, stageId, notes, customFields },
        },
      });
    } else {
      const now = new Date().toISOString();
      const newContact: CrmContact = {
        id: generateId(),
        name: trimmed,
        email,
        phone,
        company,
        tags: tagList,
        ownerId,
        stageId,
        notes,
        customFields,
        createdAt: now,
        updatedAt: now,
      };
      dispatch({ type: 'CRM_ADD_CONTACT', payload: { moduleId: activeModuleId, contact: newContact } });
    }
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto apple-card p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 dark:text-white text-lg">
            {contact ? t('crm.editContact') : t('crm.addContact')}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.name')} *</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} className="input" placeholder={t('crm.name')} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.email')}</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="input" placeholder="name@example.com" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.phone')}</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className="input" placeholder="+33 …" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.company')}</label>
            <input value={company} onChange={e => setCompany(e.target.value)} className="input" placeholder={t('crm.company')} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.tags')}</label>
            <input value={tags} onChange={e => setTags(e.target.value)} className="input" placeholder={t('crm.tagsPlaceholder')} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.stage')}</label>
            <select value={stageId} onChange={e => setStageId(e.target.value)} className="input">
              {stages.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.owner')}</label>
            <select value={ownerId} onChange={e => setOwnerId(e.target.value)} className="input">
              <option value="">—</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        </div>

        {fields.length > 0 && (
          <div className="mt-5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2.5">{t('crm.fieldsTitle')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {fields.map(field => {
                const value = customFields[field.id] || '';
                const setValue = (v: string) => setCustomFields(prev => ({ ...prev, [field.id]: v }));
                return (
                  <div key={field.id}>
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{field.name}</label>
                    {field.type === 'select' ? (
                      <select value={value} onChange={e => setValue(e.target.value)} className="input">
                        <option value="">—</option>
                        {(field.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        className="input"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5 block">{t('crm.notes')}</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input min-h-[90px] resize-y" placeholder={t('crm.notes')} />
        </div>

        <div className="mt-6 flex gap-2.5">
          <button onClick={onClose} className="btn-secondary flex-1">{t('common.cancel')}</button>
          <button onClick={handleSave} disabled={!name.trim()} className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
            {t('crm.saveContact')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
