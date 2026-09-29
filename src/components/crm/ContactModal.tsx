'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** 明确指定联系人归属的板块，避免后台同步把 activeModuleId 改动后联系人存错板块 */
  moduleId?: string;
}

export default function ContactModal({ contact, onClose, moduleId }: ContactModalProps) {
  const { stages, fields, activeModuleId, dispatch } = useCrm();
  const { users, currentUser } = useBoard();
  const { t } = useLang();

  // 优先用调用方显式传入的板块（用户看得见的那个），否则退回当前激活板块
  const targetModuleId = moduleId || activeModuleId;

  const [name, setName] = useState(contact?.name || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [phone, setPhone] = useState(contact?.phone || '');
  const [company, setCompany] = useState(contact?.company || '');
  const [tags, setTags] = useState(contact?.tags.join(', ') || '');
  const [ownerId, setOwnerId] = useState(contact?.ownerId || currentUser?.id || '');
  const [stageId, setStageId] = useState(contact?.stageId || stages[0]?.id || '');
  const [notes, setNotes] = useState(contact?.notes || '');
  const [customFields, setCustomFields] = useState<Record<string, string>>(contact?.customFields || {});

  // 新建时先记录已生成的 id，避免每次自动保存都重复创建联系人
  const contactIdRef = useRef<string>(contact?.id || '');
  const createdRef = useRef<boolean>(!!contact);
  // 保存上一条后已落库的内容，用于跳过无意义的重复提交
  const lastSavedRef = useRef<string>(contact ? JSON.stringify(contact) : '');

  const buildPayload = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    return {
      name: trimmed,
      email,
      phone,
      company,
      tags: tags.split(',').map(s => s.trim()).filter(Boolean),
      ownerId,
      stageId,
      notes,
      customFields,
    };
  }, [name, email, phone, company, tags, ownerId, stageId, notes, customFields]);

  // 提交到 reducer：首次是新增，之后都是原地更新
  const commit = useCallback((payload: ReturnType<typeof buildPayload>) => {
    if (!payload) return;
    const serialized = JSON.stringify(payload);
    if (serialized === lastSavedRef.current) return;

    if (!createdRef.current) {
      const now = new Date().toISOString();
      const newContact: CrmContact = {
        id: contactIdRef.current || generateId(),
        ...payload,
        createdAt: now,
        updatedAt: now,
      };
      contactIdRef.current = newContact.id;
      createdRef.current = true;
      dispatch({ type: 'CRM_ADD_CONTACT', payload: { moduleId: targetModuleId, contact: newContact } });
    } else {
      dispatch({
        type: 'CRM_UPDATE_CONTACT',
        payload: { moduleId: targetModuleId, contactId: contactIdRef.current, updates: payload },
      });
    }
    lastSavedRef.current = serialized;
  }, [dispatch, targetModuleId]);

  // 自动保存：字段变化后 600ms 落库（防抖，避免每敲一个字就写一次）
  useEffect(() => {
    const payload = buildPayload();
    if (!payload) return;                       // 名称为空时不保存，避免产生空联系人
    const timer = setTimeout(() => commit(payload), 600);
    return () => clearTimeout(timer);
  }, [buildPayload, commit]);

  // 关闭（点遮罩、点 X、或组件卸载）时立即落库，确保最后输入的内容不丢
  const handleClose = useCallback(() => {
    commit(buildPayload());
    onClose();
  }, [commit, buildPayload, onClose]);

  useEffect(() => {
    // 卸载兜底：即使不是通过 handleClose 关闭，也把内容保存下来
    return () => {
      commit(buildPayload());
    };
    // 仅在卸载时执行，依赖保持为空以免频繁触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto apple-card p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 dark:text-white text-lg">
            {contact ? t('crm.editContact') : t('crm.addContact')}
          </h3>
          <button onClick={handleClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
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

        <div className="mt-6 flex items-center gap-2.5">
          <p className="flex-1 text-xs text-slate-400 dark:text-slate-500">
            {t('crm.autosaveHint')}
          </p>
          <button onClick={handleClose} className="btn-primary px-6">
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
