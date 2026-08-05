'use client';

import { useMemo } from 'react';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ListTodo,
  TrendingUp,
  Layers,
  CheckSquare,
  UserCheck,
  BarChart3,
} from 'lucide-react';
import type { Card, User } from '@/types';

export default function SummaryView() {
  const { board, users, filters } = useBoard();
  const { t, lang } = useLang();

  const stats = useMemo(() => {
    // Collect all non-archived cards from non-archived columns
    const activeColumns = board.columns.filter(c => !c.archived || filters.showArchived);
    const allCards = activeColumns.flatMap(c => c.cards).filter(c => !c.archived || filters.showArchived);

    const totalCards = allCards.length;
    const totalLists = activeColumns.length;
    const totalSubtasks = allCards.reduce((s, c) => s + c.checklists.reduce((cs, cl) => cs + cl.items.length, 0), 0);
    const completedSubtasks = allCards.reduce(
      (s, c) => s + c.checklists.reduce((cs, cl) => cs + cl.items.filter(i => i.completed).length, 0),
      0
    );

    // Status breakdown
    const completedCards = allCards.filter(c => c.status === 'complete').length;
    const inProgressCards = allCards.filter(c => c.status === 'in_progress').length;
    const todoCards = allCards.filter(c => c.status === 'todo').length;

    // Overdue cards
    const now = new Date();
    const overdueCards = allCards.filter(c => {
      if (!c.dueDate || c.status === 'complete') return false;
      return new Date(c.dueDate) < now;
    }).length;

    const completionRate = totalCards > 0 ? Math.round((completedCards / totalCards) * 100) : 0;
    const subtaskRate = totalSubtasks > 0 ? Math.round((completedSubtasks / totalSubtasks) * 100) : 0;

    // Per-member stats
    const memberStats = users.map(user => {
      const assignedCards = allCards.filter(c => c.assignees.includes(user.id));
      const done = assignedCards.filter(c => c.status === 'complete').length;
      const inProg = assignedCards.filter(c => c.status === 'in_progress').length;
      const todo = assignedCards.filter(c => c.status === 'todo').length;
      const overdue = assignedCards.filter(c => {
        if (!c.dueDate || c.status === 'complete') return false;
        return new Date(c.dueDate) < now;
      }).length;
      const rate = assignedCards.length > 0 ? Math.round((done / assignedCards.length) * 100) : 0;
      const subtasksTotal = assignedCards.reduce((s, c) => s + c.checklists.reduce((cs, cl) => cs + cl.items.length, 0), 0);
      const subtasksDone = assignedCards.reduce(
        (s, c) => s + c.checklists.reduce((cs, cl) => cs + cl.items.filter(i => i.completed).length, 0),
        0
      );
      return { user, total: assignedCards.length, done, inProg, todo, overdue, rate, subtasksTotal, subtasksDone };
    }).filter(m => m.total > 0);

    // Per-list stats
    const listStats = activeColumns.map(col => {
      const cards = col.cards.filter(c => !c.archived || filters.showArchived);
      const done = cards.filter(c => c.status === 'complete').length;
      const inProg = cards.filter(c => c.status === 'in_progress').length;
      const todo = cards.filter(c => c.status === 'todo').length;
      const rate = cards.length > 0 ? Math.round((done / cards.length) * 100) : 0;
      return { column: col, total: cards.length, done, inProg, todo, rate };
    });

    return {
      totalCards,
      totalLists,
      totalSubtasks,
      completedSubtasks,
      completedCards,
      inProgressCards,
      todoCards,
      overdueCards,
      completionRate,
      subtaskRate,
      memberStats,
      listStats,
    };
  }, [board.columns, users, filters.showArchived]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Title */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#007AFF]/10 flex items-center justify-center">
          <BarChart3 size={22} className="text-[#007AFF]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('summary.title')}</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{board.title}</p>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          icon={<ListTodo size={18} />}
          label={t('summary.totalTasks')}
          value={stats.totalCards}
          color="blue"
        />
        <StatCard
          icon={<CheckCircle2 size={18} />}
          label={t('summary.completedTasks')}
          value={stats.completedCards}
          color="green"
        />
        <StatCard
          icon={<Clock size={18} />}
          label={t('summary.inProgressTasks')}
          value={stats.inProgressCards}
          color="amber"
        />
        <StatCard
          icon={<Circle size={18} />}
          label={t('summary.todoTasks')}
          value={stats.todoCards}
          color="slate"
        />
        <StatCard
          icon={<AlertTriangle size={18} />}
          label={t('summary.overdueTasks')}
          value={stats.overdueCards}
          color="red"
        />
        <StatCard
          icon={<TrendingUp size={18} />}
          label={t('summary.completionRate')}
          value={`${stats.completionRate}%`}
          color="purple"
        />
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="apple-card p-4 flex items-center gap-3">
          <Layers size={18} className="text-indigo-500 shrink-0" />
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">{stats.totalLists}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{t('summary.totalLists')}</div>
          </div>
        </div>
        <div className="apple-card p-4 flex items-center gap-3">
          <CheckSquare size={18} className="text-teal-500 shrink-0" />
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">{stats.totalSubtasks}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">{t('summary.totalSubtasks')}</div>
          </div>
        </div>
        <div className="apple-card p-4 flex items-center gap-3">
          <CheckSquare size={18} className="text-emerald-500 shrink-0" />
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">
              {stats.completedSubtasks}/{stats.totalSubtasks}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {lang === 'zh' ? '子任务完成' : 'Subtask progress'}
            </div>
          </div>
        </div>
        <div className="apple-card p-4 flex items-center gap-3">
          <TrendingUp size={18} className="text-cyan-500 shrink-0" />
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">{stats.subtaskRate}%</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {lang === 'zh' ? '子任务完成率' : 'Subtask rate'}
            </div>
          </div>
        </div>
      </div>

      {/* Member Statistics */}
      <div className="apple-card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            <UserCheck size={18} className="text-[#007AFF]" />
            <h2 className="font-semibold text-slate-900 dark:text-white">{t('summary.memberStats')}</h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          {stats.memberStats.length === 0 ? (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500 text-sm">
              {t('summary.noData')}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/30">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.person')}
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.tasks')}
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.done')}
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.notDone')}
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {lang === 'zh' ? '逾期' : 'Overdue'}
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.subtasks')}
                  </th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.completionRate')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.memberStats.map((m, i) => (
                  <tr
                    key={m.user.id}
                    className={cn(
                      'border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors',
                      i % 2 === 0 && 'bg-white/40 dark:bg-transparent'
                    )}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar user={m.user} size="sm" />
                        <span className="font-medium text-slate-700 dark:text-slate-200">{m.user.name}</span>
                      </div>
                    </td>
                    <td className="text-center px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                      {m.total}
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 size={13} />
                        {m.done}
                      </span>
                    </td>
                    <td className="text-center px-4 py-3 text-slate-500 dark:text-slate-400">
                      {m.todo + m.inProg}
                    </td>
                    <td className="text-center px-4 py-3">
                      {m.overdue > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-500 font-medium">
                          <AlertTriangle size={13} />
                          {m.overdue}
                        </span>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-600">-</span>
                      )}
                    </td>
                    <td className="text-center px-4 py-3 text-slate-500 dark:text-slate-400">
                      {m.subtasksDone}/{m.subtasksTotal}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all duration-500',
                              m.rate === 100 ? 'bg-emerald-500' : m.rate >= 50 ? 'bg-[#007AFF]' : 'bg-amber-500'
                            )}
                            style={{ width: `${m.rate}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 w-9 text-right">
                          {m.rate}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* List Statistics */}
      <div className="apple-card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200/60 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-[#007AFF]" />
            <h2 className="font-semibold text-slate-900 dark:text-white">{t('summary.listStats')}</h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          {stats.listStats.length === 0 ? (
            <div className="text-center py-12 text-slate-400 dark:text-slate-500 text-sm">
              {t('summary.noData')}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/30">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {lang === 'zh' ? '列表' : 'List'}
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.cards')}
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.done')}
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.notDone')}
                  </th>
                  <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('summary.completionRate')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.listStats.map((l, i) => (
                  <tr
                    key={l.column.id}
                    className={cn(
                      'border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors',
                      i % 2 === 0 && 'bg-white/40 dark:bg-transparent'
                    )}
                  >
                    <td className="px-5 py-3 font-medium text-slate-700 dark:text-slate-200">
                      {l.column.title}
                      {l.column.archived && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                          {lang === 'zh' ? '已归档' : 'Archived'}
                        </span>
                      )}
                    </td>
                    <td className="text-center px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">
                      {l.total}
                    </td>
                    <td className="text-center px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 size={13} />
                        {l.done}
                      </span>
                    </td>
                    <td className="text-center px-4 py-3 text-slate-500 dark:text-slate-400">
                      {l.todo + l.inProg}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all duration-500',
                              l.rate === 100 ? 'bg-emerald-500' : l.rate >= 50 ? 'bg-[#007AFF]' : 'bg-amber-500'
                            )}
                            style={{ width: `${l.rate}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 w-9 text-right">
                          {l.rate}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Overall Progress Bar */}
      {stats.totalCards > 0 && (
        <div className="apple-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {lang === 'zh' ? '总体进度' : 'Overall Progress'}
            </span>
            <span className="text-sm font-bold text-[#007AFF]">{stats.completionRate}%</span>
          </div>
          <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all duration-700 rounded-l-full"
              style={{ width: `${stats.completionRate}%` }}
            />
            <div
              className="h-full bg-amber-400 transition-all duration-700"
              style={{ width: `${stats.totalCards > 0 ? Math.round((stats.inProgressCards / stats.totalCards) * 100) : 0}%` }}
            />
            <div
              className="h-full bg-slate-300 dark:bg-slate-600 transition-all duration-700 rounded-r-full"
              style={{ width: `${stats.totalCards > 0 ? Math.round((stats.todoCards / stats.totalCards) * 100) : 0}%` }}
            />
          </div>
          <div className="flex items-center gap-5 mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              {t('summary.completedTasks')}: {stats.completedCards}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              {t('summary.inProgressTasks')}: {stats.inProgressCards}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
              {t('summary.todoTasks')}: {stats.todoCards}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Stat Card sub-component
function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: 'blue' | 'green' | 'amber' | 'slate' | 'red' | 'purple';
}) {
  const colorMap = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  };

  return (
    <div className="apple-card p-4 flex flex-col items-center gap-2 text-center">
      <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', colorMap[color])}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{label}</div>
    </div>
  );
}
