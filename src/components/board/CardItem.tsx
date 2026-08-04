'use client';

import { Card, User } from '@/types';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { AvatarStack } from '@/components/ui/Avatar';
import { LabelStrip } from '@/components/ui/LabelBadge';
import {
  CheckSquare,
  MessageSquare,
  Paperclip,
  Calendar,
  Clock,
  Trash2,
} from 'lucide-react';
import { cn, calculateChecklistProgress, getDueDateStatus } from '@/lib/utils';

interface CardItemProps {
  card: Card;
  onClick: () => void;
  isDragging?: boolean;
}

export default function CardItem({ card, onClick, isDragging }: CardItemProps) {
  const { t, lang } = useLang();
  const { board, users, onlineUsers, broadcastChange } = useBoard();

  const allChecklistItems = card.checklists.flatMap(cl => cl.items);
  const checklistProgress = calculateChecklistProgress(allChecklistItems);
  const rawDueStatus = getDueDateStatus(card.dueDate, card.status);
  const dueStatus = rawDueStatus ? {
    ...rawDueStatus,
    label: rawDueStatus.status === 'completed' ? t('date.done')
      : rawDueStatus.status === 'overdue' ? t('date.overdue')
      : rawDueStatus.status === 'due-soon' ? t('date.soon')
      : rawDueStatus.label
  } : null;
  const assignees = card.assignees.map(id => users.find(u => u.id === id)).filter((u): u is User => u !== undefined);

  const checklistDueAlerts = allChecklistItems
    .filter(item => !item.completed && item.dueDate)
    .map(item => ({ item, status: getDueDateStatus(item.dueDate!, false) }))
    .filter(x => x.status && (x.status.status === 'overdue' || x.status.status === 'dueSoon'));

  const checklistOverdue = checklistDueAlerts.filter(x => x.status!.status === 'overdue').length;
  const checklistDueSoon = checklistDueAlerts.filter(x => x.status!.status === 'dueSoon').length;

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-800 overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
        card.archived && 'opacity-50 line-through decoration-slate-400',
        card.status === 'complete' && 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800',
        card.status === 'in_progress' && 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800',
        isDragging && 'ring-2 ring-[#007AFF] shadow-2xl'
      )}
    >
      {/* Delete Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`确定要删除卡片「${card.title}」吗？`)) {
            broadcastChange({ type: 'DELETE_CARD', payload: { cardId: card.id } });
          }
        }}
        className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-sm"
        title="删除卡片"
      >
        <Trash2 size={14} />
      </button>

      {/* Cover Image */}
      {card.coverImage && (
        <div className="h-24 bg-slate-100 dark:bg-slate-700 overflow-hidden relative">
          <img
            src={card.coverImage}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          {dueStatus && dueStatus.status === 'overdue' && (
            <div className="absolute top-2 right-2 badge bg-red-500 text-white text-[10px] shadow-md">
              <Clock size={10} />
              {t('date.overdue')}
            </div>
          )}
        </div>
      )}

      <div className="p-2.5 space-y-2">
        {/* Labels */}
        {card.labels.length > 0 && !card.coverImage && (
          <div className="flex gap-0.5 -mt-0.5">
            {card.labels.slice(0, 5).map(labelId => {
              const label = board.labels.find(l => l.id === labelId);
              if (!label) return null;
              return (
                <div
                  key={labelId}
                  title={label.name}
                  className="h-1.5 w-8 rounded-sm first:rounded-l last:rounded-r"
                  style={{ backgroundColor: label.color }}
                />
              );
            })}
          </div>
        )}

        {card.labels.length > 0 && card.coverImage && (
          <LabelStrip labels={card.labels} allLabels={board.labels} className="-mt-1" />
        )}

        {/* Title */}
        <h4 className={cn(
          'text-sm font-medium text-slate-800 dark:text-slate-100 leading-snug',
          card.status === 'complete' && 'line-through decoration-emerald-500 text-slate-500 dark:text-slate-400'
        )}>
          {card.title}
        </h4>

        {/* Due Date Banner */}
        {dueStatus && !card.coverImage && (
          <div className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium shadow-sm',
            dueStatus.status === 'completed' && 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
            dueStatus.status === 'overdue' && 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
            dueStatus.status === 'due-soon' && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
            dueStatus.status === 'normal' && 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
          )}>
            <Calendar size={10} />
            {dueStatus.label}
          </div>
        )}

        {/* Checklist Progress */}
        {checklistProgress.total > 0 && (
          <div className="space-y-1">
            <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  checklistProgress.percentage === 100
                    ? 'bg-emerald-500'
                    : 'bg-[#007AFF]'
                )}
                style={{ width: `${checklistProgress.percentage}%` }}
              />
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <CheckSquare size={11} className={checklistProgress.percentage === 100 ? 'text-emerald-500' : ''} />
              {checklistProgress.completed}/{checklistProgress.total} {lang === 'zh' ? '个子任务' : 'items'}
            </div>
          </div>
        )}

        {/* Footer Badges & Assignees */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
            {card.comments.length > 0 && (
              <span className="flex items-center gap-0.5 hover:text-slate-700 dark:hover:text-slate-200">
                <MessageSquare size={12} />
                {card.comments.length}
              </span>
            )}
            {card.attachments.length > 0 && (
              <span className="flex items-center gap-0.5 hover:text-slate-700 dark:hover:text-slate-200">
                <Paperclip size={12} />
                {card.attachments.length}
              </span>
            )}
            {checklistProgress.total > 0 && (
              <span className="flex items-center gap-0.5">
                <CheckSquare size={11} className={checklistProgress.percentage === 100 ? 'text-emerald-500' : ''} />
                {checklistProgress.percentage}%
              </span>
            )}
            {checklistOverdue > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-red-500 text-white font-medium shadow-sm" title={lang === 'zh' ? `${checklistOverdue} 个子任务已逾期` : `${checklistOverdue} subtasks overdue`}>
                <Clock size={10} />
                {lang === 'zh' ? `子任务逾期 ${checklistOverdue}` : `Overdue ${checklistOverdue}`}
              </span>
            )}
            {checklistOverdue === 0 && checklistDueSoon > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500 text-white font-medium shadow-sm" title={lang === 'zh' ? `${checklistDueSoon} 个子任务即将到期` : `${checklistDueSoon} subtasks due soon`}>
                <Clock size={10} />
                {lang === 'zh' ? `即将到期 ${checklistDueSoon}` : `Due soon ${checklistDueSoon}`}
              </span>
            )}
          </div>
          
          {assignees.length > 0 && (
            <AvatarStack users={assignees} max={3} size="sm" showOnline onlineUsers={onlineUsers} />
          )}
        </div>
      </div>
    </div>
  );
}
