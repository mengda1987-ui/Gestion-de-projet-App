'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { AvatarStack } from '@/components/ui/Avatar';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowLeft,
  LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, Column, User, Board } from '@/types';
import {
  startOfWeek,
  addWeeks,
  eachDayOfInterval,
  format as f,
  isSameDay,
  parseISO,
  isBefore,
  startOfDay,
  differenceInDays,
  addDays,
} from 'date-fns';
import { zhCN, enUS } from 'date-fns/locale';

type ZoomLevel = 'day' | 'week' | 'month';

interface WTask {
  id: string;
  card: Card;
  column: Column;
  board: Board;
  startDate: Date;
  endDate: Date;
}

export default function WorkspaceGanttView({ onBack }: { onBack: () => void }) {
  const { t, lang } = useLang();
  const dateLocale = lang === 'zh' ? zhCN : enUS;
  const { boards, users, currentUser, dispatch } = useBoard();
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [viewStart, setViewStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const scrollRef = useRef<HTMLDivElement>(null);

  // 收集所有可见看板的所有任务（复用工作区可见性规则）
  const tasks = useMemo<WTask[]>(() => {
    const all: WTask[] = [];
    const visibleBoards = boards.filter(b => {
      if (currentUser?.role === 'admin') return true;
      if (!b.visibleTo || b.visibleTo.length === 0) return true;
      return b.visibleTo.includes(currentUser?.id || '');
    });
    for (const board of visibleBoards) {
      for (const col of board.columns) {
        if (col.archived) continue;
        if (col.visibleTo?.length && currentUser?.role !== 'admin' && !col.visibleTo.includes(currentUser?.id ?? '')) continue;
        for (const card of col.cards) {
          if (card.archived) continue;
          if (card.visibleTo?.length && currentUser?.role !== 'admin' && !card.visibleTo.includes(currentUser?.id ?? '')) continue;
          // 与单看板甘特图逻辑一致：优先用 startDate，没有则用 dueDate - 1天
          let e = card.dueDate ? parseISO(card.dueDate) : addDays(card.createdAt ? parseISO(card.createdAt) : new Date(), 3);
          let s = card.startDate ? parseISO(card.startDate) : addDays(e, -1);
          if (isBefore(e, s)) e = addDays(s, 1); // 确保 endDate >= startDate + 1天
          all.push({ id: card.id, card, column: col, board, startDate: startOfDay(s), endDate: startOfDay(e) });
        }
      }
    }
    return all.sort(
      (a, b) =>
        (a.board.order ?? 0) - (b.board.order ?? 0) ||
        a.column.order - b.column.order ||
        a.startDate.getTime() - b.startDate.getTime()
    );
  }, [boards, currentUser]);

  // 按看板分组
  const boardGroups = useMemo(() => {
    const map = new Map<string, { board: Board; tasks: WTask[] }>();
    for (const t of tasks) {
      if (!map.has(t.board.id)) map.set(t.board.id, { board: t.board, tasks: [] });
      map.get(t.board.id)!.tasks.push(t);
    }
    return Array.from(map.values());
  }, [tasks]);

  // 看板内再按列分组
  const columnGroupsOf = (boardTasks: WTask[]) => {
    const map = new Map<string, { column: Column; tasks: WTask[] }>();
    for (const t of boardTasks) {
      if (!map.has(t.column.id)) map.set(t.column.id, { column: t.column, tasks: [] });
      map.get(t.column.id)!.tasks.push(t);
    }
    return Array.from(map.values());
  };

  const dayCount = zoom === 'day' ? 14 : zoom === 'week' ? 28 : 60;
  const days = useMemo(() => {
    return eachDayOfInterval({ start: viewStart, end: addDays(viewStart, dayCount - 1) });
  }, [viewStart, dayCount]);

  const cellWidth = zoom === 'day' ? 120 : zoom === 'week' ? 56 : 26;
  const totalWidth = dayCount * cellWidth;

  useEffect(() => {
    const today = new Date();
    const offset = 200;
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayOffset(today, viewStart, zoom) - offset);
    }
  }, [viewStart, zoom]);

  function todayOffset(today: Date, start: Date, z: ZoomLevel) {
    const diff = differenceInDays(today, start);
    return diff * (z === 'day' ? 120 : z === 'week' ? 56 : 26);
  }

  const navigate = (delta: number) => {
    if (zoom === 'day') setViewStart(addDays(viewStart, delta * 7));
    else if (zoom === 'week') setViewStart(addWeeks(viewStart, delta * 2));
    else setViewStart(addWeeks(viewStart, delta * 4));
  };

  const resetView = () => setViewStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  function getTaskPosition(task: WTask) {
    let startOffset = differenceInDays(task.startDate, viewStart) * cellWidth;
    let endOffset = (differenceInDays(task.endDate, viewStart) + 1) * cellWidth;
    if (endOffset < 0) return null;
    if (startOffset < 0) startOffset = 0;
    if (startOffset > totalWidth) return null;
    const width = Math.max(cellWidth * 0.8, Math.min(endOffset - startOffset, totalWidth - startOffset));
    return { left: startOffset, width };
  }

  const weekGroups = useMemo(() => {
    const groups: { label: string; span: number }[] = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (i === 0 || d.getDay() === 1) {
        const weekEnd = Math.max(i, Math.min(i + 7, days.length) - 1);
        const dateFormat = lang === 'zh' ? 'MM月dd日' : 'MMM d';
        const label = f(d, dateFormat, { locale: dateLocale }) + ' - ' + f(days[weekEnd], dateFormat, { locale: dateLocale });
        groups.push({ label, span: weekEnd - i + 1 });
      }
    }
    return groups;
  }, [days, dateLocale, lang]);

  const today = new Date();
  const todayX = todayOffset(today, viewStart, zoom);

  const openBoard = (boardId: string) => {
    dispatch({ type: 'SET_CURRENT_BOARD', payload: boardId });
  };

  const statusColors: Record<string, string> = {
    todo: 'bg-white border-2 border-[#007AFF] text-[#007AFF]',
    in_progress: 'bg-amber-400 text-black',
    complete: 'bg-emerald-500 text-black',
  };

  return (
    <div className="min-h-dvh flex flex-col" style={{ backgroundColor: 'rgba(245,245,247,0.6)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 sm:px-8 pt-6 pb-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/70 backdrop-blur-md border border-slate-200/60 shadow-sm text-slate-600 hover:text-slate-800 hover:bg-white hover:shadow-md transition-all text-sm font-medium"
        >
          <ArrowLeft size={16} />
          {lang === 'zh' ? '返回工作区' : 'Back to Workspace'}
        </button>
        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600">
          <BarChart3 size={16} />
        </div>
        <div>
          <h2 className="font-semibold text-sm text-slate-800">{lang === 'zh' ? '全局甘特图' : 'All Boards Gantt'}</h2>
          <p className="text-[11px] text-slate-500">
            {lang === 'zh'
              ? `${boardGroups.length} 个看板 · ${tasks.length} 个任务`
              : `${boardGroups.length} boards · ${tasks.length} tasks`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Zoom */}
          <div className="flex items-center gap-1 bg-white/80 backdrop-blur rounded-full p-0.5 ring-1 ring-slate-200/60">
            {(['day', 'week', 'month'] as ZoomLevel[]).map(z => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-all',
                  zoom === z
                    ? 'bg-[#007AFF] text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {z === 'day' ? t('gantt.zoomDay') : z === 'week' ? t('gantt.zoomWeek') : t('gantt.zoomMonth')}
              </button>
            ))}
          </div>
          {/* Navigate */}
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-slate-200/60 text-slate-600">
              <ChevronLeft size={16} />
            </button>
            <button onClick={resetView} className="p-2 rounded-lg hover:bg-slate-200/60 text-slate-600 text-xs font-medium flex items-center gap-1">
              <RefreshCw size={13} />
              {t('gantt.today')}
            </button>
            <button onClick={() => navigate(1)} className="p-2 rounded-lg hover:bg-slate-200/60 text-slate-600">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Gantt body */}
      <div className="flex-1 mx-6 sm:mx-8 mb-6 glass rounded-xl overflow-hidden flex flex-col min-h-0">
        {tasks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-24 text-slate-400">
            <LayoutGrid size={40} className="mb-3 opacity-40" />
            <p className="text-sm">{lang === 'zh' ? '还没有可显示的任务' : 'No tasks to display'}</p>
            <p className="text-xs mt-1">{lang === 'zh' ? '在看板里添加卡片后即可在此查看' : 'Add cards in a board to see them here'}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto" ref={scrollRef}>
            <div className="flex min-w-max">
              {/* Left: board / task names */}
              <div className="sticky left-0 z-20 bg-white/95 dark:bg-slate-800/95 backdrop-blur w-80 border-r border-slate-200 dark:border-slate-700 shrink-0">
                <div className="h-[72px] border-b border-slate-200 dark:border-slate-700 flex items-end px-4 pb-2 bg-white/80 dark:bg-slate-800/80">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {lang === 'zh' ? '看板 / 任务' : 'Board / Task'}
                  </span>
                </div>
                {boardGroups.map(({ board, tasks: boardTasks }) => (
                  <div key={board.id}>
                    <div className="px-3 h-[34px] flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800/30 text-sm font-bold text-blue-900 dark:text-blue-100">
                      <span>{board.emoji || '📋'}</span>
                      <span className="truncate">{board.title}</span>
                      <span className="ml-auto text-[10px] font-normal text-blue-600 dark:text-blue-400">{boardTasks.length}</span>
                    </div>
                    {columnGroupsOf(boardTasks).map(({ column, tasks: colTasks }) => (
                      <div key={column.id}>
                        <div className="px-3 h-[24px] flex items-center bg-violet-50/80 dark:bg-violet-900/20 border-b border-violet-100/70 dark:border-violet-800/30 text-[10px] font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider">
                          {column.title}
                        </div>
                        {colTasks.map(task => {
                          const assignees = task.card.assignees
                            .map((id: string) => users.find((u: User) => u.id === id))
                            .filter((u: User | undefined): u is User => u !== undefined);
                          const completed = task.card.status === 'complete';
                          return (
                            <div
                              key={task.id}
                              onClick={() => openBoard(task.board.id)}
                              className="px-4 h-[56px] border-b border-slate-100 dark:border-slate-700/50 hover:bg-sky-50/50 dark:hover:bg-sky-950/20 cursor-pointer transition-colors flex items-center"
                            >
                              <div className="flex items-center gap-2 w-full">
                                <div className="flex-1 min-w-0">
                                  <div className={cn(
                                    'text-sm font-medium text-slate-800 dark:text-slate-100 truncate',
                                    completed && 'line-through text-slate-400'
                                  )} title={task.card.title}>
                                    {task.card.title}
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                                    {f(task.startDate, 'MM/dd')} → {f(task.endDate, 'MM/dd')}
                                  </div>
                                </div>
                                <AvatarStack users={assignees} max={2} size="sm" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Right: timeline */}
              <div className="relative flex-1 min-w-0" style={{ minWidth: totalWidth }}>
                {/* Week header */}
                <div className="absolute top-0 left-0 right-0 h-9 border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 backdrop-blur flex z-10">
                  {weekGroups.map((g, i) => (
                    <div
                      key={i}
                      className="h-full border-r border-slate-200 dark:border-slate-700/50 flex items-center px-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 shrink-0"
                      style={{ width: g.span * cellWidth }}
                    >
                      {g.label}
                    </div>
                  ))}
                </div>
                {/* Day header */}
                <div className="absolute top-9 left-0 right-0 h-[34px] border-b border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 backdrop-blur flex z-10">
                  {days.map((d, i) => {
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const isTod = isSameDay(d, today);
                    const weekdayRaw = f(d, 'EEE', { locale: dateLocale });
                    const weekdayStr = lang === 'zh' ? weekdayRaw.replace('星期', '周') : weekdayRaw;
                    return (
                      <div
                        key={i}
                        className={cn(
                          'h-full border-r border-slate-100 dark:border-slate-700/40 flex flex-col items-center justify-center text-[10px] shrink-0',
                          isWeekend && 'bg-slate-50 dark:bg-slate-900/40',
                          isTod && 'bg-sky-50 dark:bg-sky-950/40 font-bold text-sky-600 dark:text-sky-400'
                        )}
                        style={{ width: cellWidth }}
                      >
                        <span className="opacity-80">{weekdayStr}</span>
                        <span>{f(d, 'd')}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Body */}
                <div className="pt-[72px]">
                  {boardGroups.map(({ board, tasks: boardTasks }) => (
                    <div key={board.id}>
                      <div className="h-[34px] bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800/30" />
                      {columnGroupsOf(boardTasks).map(({ column, tasks: colTasks }) => (
                        <div key={column.id}>
                          <div className="h-[24px] bg-violet-50/80 dark:bg-violet-900/20 border-b border-violet-100/70 dark:border-violet-800/30" />
                          {colTasks.map(task => {
                            const pos = getTaskPosition(task);
                            const barColor = statusColors[task.card.status] || statusColors.todo;
                            const textColor = task.card.status === 'todo' ? 'text-[#007AFF]' : 'text-black';
                            return (
                              <div
                                key={task.id}
                                onClick={() => openBoard(task.board.id)}
                                className="relative h-[56px] border-b border-slate-100 dark:border-slate-700/50 hover:bg-sky-50/30 dark:hover:bg-sky-950/10 transition-colors cursor-pointer"
                              >
                                {/* Grid */}
                                <div className="absolute inset-0 flex">
                                  {days.map((d, i) => {
                                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                                    return (
                                      <div
                                        key={i}
                                        className={cn(
                                          'h-full border-r border-slate-100 dark:border-slate-700/30 shrink-0',
                                          isWeekend && 'bg-slate-50/50 dark:bg-slate-900/30'
                                        )}
                                        style={{ width: cellWidth }}
                                      />
                                    );
                                  })}
                                </div>
                                {/* Task bar */}
                                {pos && (
                                  <div
                                    className={cn('absolute rounded-lg shadow-sm flex items-center px-2', barColor)}
                                    style={{ top: 8, bottom: 8, left: pos.left + 4, width: Math.max(0, pos.width - 8) }}
                                  >
                                    <div className={cn('text-[11px] font-semibold truncate leading-tight w-full', textColor)}>
                                      {task.card.title}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* Today line */}
                {todayX >= 0 && todayX <= totalWidth && (
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 z-30 pointer-events-none"
                    style={{ left: todayX + cellWidth / 2 }}
                  >
                    <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-red-500 rounded-full shadow-lg animate-pulse" />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="shrink-0 flex flex-wrap items-center gap-4 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded border border-[#007AFF] bg-white" />
            <span>{t('gantt.status.todo')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-amber-400" />
            <span>{t('gantt.status.progress')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span>{t('gantt.status.done')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-0.5 h-3 bg-red-500 rounded" />
            <span>{t('gantt.today')}</span>
          </div>
          <span className="ml-auto text-[11px] text-slate-400">
            {lang === 'zh' ? '点击任务跳转到对应看板' : 'Click a task to open its board'}
          </span>
        </div>
      </div>
    </div>
  );
}
