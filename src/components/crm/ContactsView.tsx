'use client';

import { useState, useMemo } from 'react';
import { CrmContact, CrmStage, CrmField, User } from '@/types';
import { useLang } from '@/context/LangContext';
import { Pencil, Trash2, Mail, ArrowUp, ArrowDown, ArrowUpDown, Link2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export interface LinkedTask {
  boardTitle: string;
  columnTitle: string;
  cardTitle: string;
}

interface ContactsViewProps {
  contacts: CrmContact[];
  stages: CrmStage[];
  fields: CrmField[];
  users: User[];
  onEdit: (contact: CrmContact) => void;
  onDelete: (contactId: string) => void;
  // 反查：某个 CRM 联系人在看板里被哪些卡片关联（跨模块打通）
  getLinkedTasks?: (contactId: string) => LinkedTask[];
  onOpenTask?: (contactId: string) => void;
}

function stageName(stages: CrmStage[], id: string): string {
  return stages.find(s => s.id === id)?.name || '—';
}

function userName(users: User[], id: string): string {
  return users.find(u => u.id === id)?.name || '—';
}

export default function ContactsView({ contacts, stages, fields, users, onEdit, onDelete, getLinkedTasks, onOpenTask }: ContactsViewProps) {
  const { t, lang } = useLang();
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);

  const toggleSort = (key: string) => {
    setSort(prev => {
      if (prev?.key === key) {
        return prev.dir === 'asc' ? { key, dir: 'desc' } : null;
      }
      return { key, dir: 'asc' };
    });
  };

  const sortedContacts = useMemo(() => {
    if (!sort) return contacts;
    const { key, dir } = sort;
    const field = fields.find(f => f.id === key);
    const getVal = (c: CrmContact): string | number => {
      if (key === 'name') return c.name.toLowerCase();
      if (key === 'stage') return stageName(stages, c.stageId);
      if (key === 'owner') return userName(users, c.ownerId);
      if (key === 'updated') return new Date(c.updatedAt).getTime();
      const raw = c.customFields[key] || '';
      if (field?.type === 'number') return Number(raw) || 0;
      if (field?.type === 'date') return new Date(raw).getTime() || 0;
      return String(raw).toLowerCase();
    };
    return [...contacts].sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [contacts, sort, fields, stages, users]);

  const sortIcon = (key: string) => {
    if (sort?.key !== key) return <ArrowUpDown size={12} className="opacity-40" />;
    return sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  if (contacts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-10">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
          <Mail size={26} className="text-slate-400" />
        </div>
        <p className="text-slate-600 dark:text-slate-300 font-medium">{t('crm.noContacts')}</p>
        <p className="text-sm text-slate-400 mt-1">{t('crm.noContactsHint')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto thick-h-scroll">
      <table className="w-full min-w-max text-sm">
        <thead className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <tr className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            <th className="px-5 py-3 sticky left-0 z-30 bg-slate-50 dark:bg-slate-900">
              <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-[#007AFF] transition-colors">
                {t('crm.name')}
                {sortIcon('name')}
              </button>
            </th>
            {fields.map(f => (
              <th key={f.id} className="px-4 py-3 whitespace-nowrap">
                <button onClick={() => toggleSort(f.id)} className="flex items-center gap-1 hover:text-[#007AFF] transition-colors">
                  {f.name}
                  {sortIcon(f.id)}
                </button>
              </th>
            ))}
            <th className="px-4 py-3 whitespace-nowrap">
              <button onClick={() => toggleSort('stage')} className="flex items-center gap-1 hover:text-[#007AFF] transition-colors">
                {t('crm.stage')}
                {sortIcon('stage')}
              </button>
            </th>
            <th className="px-4 py-3 whitespace-nowrap hidden xl:table-cell">
              <button onClick={() => toggleSort('owner')} className="flex items-center gap-1 hover:text-[#007AFF] transition-colors">
                {t('crm.owner')}
                {sortIcon('owner')}
              </button>
            </th>
            {getLinkedTasks && (
              <th className="px-4 py-3 whitespace-nowrap">
                <span className="flex items-center gap-1">
                  <Link2 size={12} />
                  {t('crm.linkedTasks')}
                </span>
              </th>
            )}
            <th className="px-4 py-3 whitespace-nowrap hidden xl:table-cell">
              <button onClick={() => toggleSort('updated')} className="flex items-center gap-1 hover:text-[#007AFF] transition-colors">
                {t('crm.updated')}
                {sortIcon('updated')}
              </button>
            </th>
            <th className="px-5 py-3 text-right">{''}</th>
          </tr>
        </thead>
        <tbody>
          {sortedContacts.map(contact => {
            const owner = users.find(u => u.id === contact.ownerId);
            const color = owner?.color || '#007AFF';
            return (
              <tr
                key={contact.id}
                onClick={() => onEdit(contact)}
                className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
              >
                <td className="px-5 py-3 sticky left-0 z-10 bg-white dark:bg-slate-900">
                  <div className="flex items-center gap-3 min-w-[180px] max-w-[200px]">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {contact.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 dark:text-slate-100 break-words whitespace-normal leading-snug line-clamp-2">{contact.name}</div>
                      {contact.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {contact.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                {fields.map(f => (
                  <td key={f.id} className="px-4 py-3 align-top max-w-[240px] break-words text-slate-600 dark:text-slate-300">
                    {contact.customFields[f.id] || '—'}
                  </td>
                ))}
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                    {stageName(stages, contact.stageId)}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300 hidden xl:table-cell">
                  {userName(users, contact.ownerId)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-400 dark:text-slate-500 hidden xl:table-cell">
                  {formatDate(contact.updatedAt, lang)}
                </td>
                {getLinkedTasks && (
                  <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {(() => {
                      const tasks = getLinkedTasks(contact.id);
                      if (tasks.length === 0) {
                        return <span className="text-xs text-slate-300 dark:text-slate-600">{t('crm.linkedTasks.none')}</span>;
                      }
                      const expanded = expandedContactId === contact.id;
                      return (
                        <div className="relative">
                          <button
                            onClick={() => setExpandedContactId(expanded ? null : contact.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                            title={t('crm.linkedTasks.title')}
                          >
                            <Link2 size={11} />
                            {tasks.length}
                          </button>
                          {expanded && (
                            <div className="absolute left-0 top-full mt-1 z-40 w-72 p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-lg animate-slide-up">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                                {t('crm.linkedTasks.title')}
                              </div>
                              <div className="space-y-1 max-h-56 overflow-y-auto">
                                {tasks.map((task, i) => (
                                  <div key={i} className="px-2 py-1.5 rounded-md bg-slate-50 dark:bg-slate-700/50">
                                    <div className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
                                      {task.cardTitle}
                                    </div>
                                    <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                                      {task.boardTitle} › {task.columnTitle}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                )}
                <td className="px-5 py-3 whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => onEdit(contact)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title={t('crm.editContact')}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => onDelete(contact.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      title={t('common.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
