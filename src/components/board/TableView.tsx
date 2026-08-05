'use client';

import { useState, useMemo } from 'react';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { AvatarStack } from '@/components/ui/Avatar';
import { LabelBadge } from '@/components/ui/LabelBadge';
import CardDetailModal from '../card/CardDetailModal';
import {
  CheckSquare,
  MessageSquare,
  Paperclip,
  Calendar,
  Archive,
  ArrowUpDown,
  Columns3,
} from 'lucide-react';
import { cn, formatDate, calculateChecklistProgress, getDueDateStatus, relativeTime } from '@/lib/utils';
import { Card, User } from '@/types';

type SortField = 'title' | 'dueDate' | 'createdAt' | 'updatedAt' | 'checklist';
type SortOrder = 'asc' | 'desc';

interface CardWithMeta {
  card: Card;
  columnId: string;
  columnTitle: string;
}

export default function TableView() {
  const { t, lang } = useLang();
  const { board, users, onlineUsers, currentUser, filters, dispatch, findCard, broadcastChange } = useBoard();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const cardsWithMeta = useMemo<CardWithMeta[]>(() => {
    const result: CardWithMeta[] = [];
    for (const col of board.columns) {
      if (col.archived && !filters.showArchived) continue;
      // Column visibility control
      if (col.visibleTo?.length && currentUser?.role !== 'admin' && !col.visibleTo.includes(currentUser?.id ?? '')) continue;
      for (const card of col.cards) {
        if (card.archived && !filters.showArchived) continue;
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          const inTitle = card.title.toLowerCase().includes(searchLower);
          const inDesc = card.description.toLowerCase().includes(searchLower);
          const inComments = card.comments.some(c => c.text.toLowerCase().includes(searchLower));
          if (!inTitle && !inDesc && !inComments) continue;
        }
        if (filters.labels.length > 0) {
          const has = filters.labels.some(l => card.labels.includes(l));
          if (!has) continue;
        }
        if (filters.assignees.length > 0) {
          const has = filters.assignees.some(a => card.assignees.includes(a));
          if (!has) continue;
        }
        // Admin visibility control
        if (card.visibleTo?.length && currentUser?.role !== 'admin' && !card.visibleTo.includes(currentUser?.id ?? '')) continue;
        result.push({ card, columnId: col.id, columnTitle: col.title });
      }
    }

    result.sort((a, b) => {
      let va: string | number = '';
      let vb: string | number = '';
      switch (sortField) {
        case 'title':
          va = a.card.title;
          vb = b.card.title;
          break;
        case 'dueDate':
          va = a.card.dueDate || '';
          vb = b.card.dueDate || '';
          break;
        case 'createdAt':
          va = a.card.createdAt;
          vb = b.card.createdAt;
          break;
        case 'updatedAt':
          va = a.card.updatedAt;
          vb = b.card.updatedAt;
          break;
        case 'checklist':
          va = calculateChecklistProgress(a.card.checklists.flatMap(cl => cl.items)).percentage;
          vb = calculateChecklistProgress(b.card.checklists.flatMap(cl => cl.items)).percentage;
          break;
      }
      if (sortOrder === 'asc') {
        return va > vb ? 1 : va < vb ? -1 : 0;
      }
      return va < vb ? 1 : va > vb ? -1 : 0;
    });

    return result;
  }, [board.columns, filters, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 text-left group hover:text-slate-900 dark:hover:text-white transition-colors"
    >
      <span>{label}</span>
      <ArrowUpDown size={12} className={cn(
        'opacity-30 group-hover:opacity-100 transition-opacity',
        sortField === field && 'opacity-100 text-[#007AFF]'
      )} />
    </button>
  );

  const selectedCard = selectedCardId ? findCard(selectedCardId) : null;

  return (
    <div className="min-h-full flex flex-col p-4">
      <div className="glass rounded-xl overflow-hidden flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-950 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Columns3 size={16} />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">{t('table.viewTitle')}</h2>
              <p className="text-xs text-slate-500">{t('table.cardCount', { count: cardsWithMeta.length })}</p>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white/90 dark:bg-slate-800/90 backdrop-blur text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold text-left w-[30%] min-w-[280px]">
                  <SortHeader field="title" label={t('table.title')} />
                </th>
                <th className="px-4 py-3 font-semibold text-left w-[120px] min-w-[100px]">
                  {t('table.column')}
                </th>
                <th className="px-4 py-3 font-semibold text-left w-[140px] min-w-[120px]">
                  {t('table.labels')}
                </th>
                <th className="px-4 py-3 font-semibold text-left w-[150px] min-w-[130px]">
                  {t('table.members')}
                </th>
                <th className="px-4 py-3 font-semibold text-left w-[110px] min-w-[110px]">
                  <SortHeader field="dueDate" label={t('table.due')} />
                </th>
                <th className="px-4 py-3 font-semibold text-left w-[130px] min-w-[130px]">
                  <SortHeader field="checklist" label={t('table.subtasks')} />
                </th>
                <th className="px-4 py-3 font-semibold text-center w-[70px] min-w-[70px]">
                  <MessageSquare size={14} className="mx-auto" />
                </th>
                <th className="px-4 py-3 font-semibold text-center w-[70px] min-w-[70px]">
                  <Paperclip size={14} className="mx-auto" />
                </th>
                <th className="px-4 py-3 font-semibold text-left w-[110px] min-w-[110px]">
                  <SortHeader field="updatedAt" label={t('table.updated')} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {cardsWithMeta.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <CheckSquare size={40} className="text-slate-300 dark:text-slate-700" />
                      <p className="text-sm">{t('table.noMatch')}</p>
                      <p className="text-xs">{t('table.noMatchHint')}</p>
                    </div>
                  </td>
                </tr>
              )}
              {cardsWithMeta.map(({ card, columnId, columnTitle }) => {
                const progress = calculateChecklistProgress(card.checklists.flatMap(cl => cl.items));
                const rawDueStatus = getDueDateStatus(card.dueDate, card.status);
                const dueStatus = rawDueStatus ? {
                  ...rawDueStatus,
                  label: rawDueStatus.status === 'completed' ? t('date.done')
                    : rawDueStatus.status === 'overdue' ? t('date.overdue')
                    : rawDueStatus.status === 'due-soon' ? t('date.soon')
                    : rawDueStatus.label
                } : null;
                const assignees = card.assignees.map(id => users.find(u => u.id === id)).filter((u): u is User => u !== undefined);
                return (
                  <tr
                    key={card.id}
                    onClick={() => setSelectedCardId(card.id)}
                    className={cn(
                      'cursor-pointer hover:bg-sky-50/60 dark:hover:bg-sky-950/20 transition-colors',
                      card.archived && 'opacity-50'
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800 dark:text-slate-100 line-clamp-2">
                        {card.title}
                      </div>
                      {card.archived && (
                        <span className="inline-flex items-center gap-1 mt-1 badge bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          <Archive size={10} />
                          {t('nav.archived')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded-md bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 text-xs font-medium">
                        {columnTitle}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {card.labels.slice(0, 4).map(lid => {
                          const label = board.labels.find(l => l.id === lid);
                          return label ? <LabelBadge key={lid} label={label} size="sm" clickable={false} /> : null;
                        })}
                        {card.labels.length > 4 && (
                          <span className="text-xs text-slate-400">+{card.labels.length - 4}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <AvatarStack users={assignees} max={3} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      {dueStatus ? (
                        <div className={cn(
                          'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium shadow-sm',
                          dueStatus.status === 'completed' && 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
                          dueStatus.status === 'overdue' && 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
                          dueStatus.status === 'due-soon' && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
                          dueStatus.status === 'normal' && 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
                        )}>
                          <Calendar size={10} />
                          {dueStatus.label}
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {progress.total > 0 ? (
                        <div className="space-y-1">
                          <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden w-full max-w-[90px]">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                progress.percentage === 100 ? 'bg-emerald-500' : 'bg-[#007AFF]'
                              )}
                              style={{ width: `${progress.percentage}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">
                            {progress.completed}/{progress.total}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500">
                      {card.comments.length > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium">
                          <MessageSquare size={12} />
                          {card.comments.length}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500">
                      {card.attachments.length > 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium">
                          <Paperclip size={12} />
                          {card.attachments.length}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500" title={formatDate(card.updatedAt)}>
                      {relativeTime(card.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCard && (
        <CardDetailModal
          card={selectedCard.card}
          columnId={selectedCard.columnId}
          onClose={() => setSelectedCardId(null)}
          onDuplicate={() => broadcastChange({ type: 'DUPLICATE_CARD', payload: { cardId: selectedCard.card.id } })}
          onArchive={() => broadcastChange({ type: 'ARCHIVE_CARD', payload: { cardId: selectedCard.card.id } })}
          onDelete={() => {
            broadcastChange({ type: 'DELETE_CARD', payload: { cardId: selectedCard.card.id } });
            setSelectedCardId(null);
          }}
        />
      )}
    </div>
  );
}
