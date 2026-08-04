'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { Avatar, AvatarStack } from '@/components/ui/Avatar';
import CardDetailModal from '../card/CardDetailModal';
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { cn, getDueDateStatus, formatDate } from '@/lib/utils';
import { Card, Column, User } from '@/types';
import { startOfWeek, addWeeks, eachDayOfInterval, format as f, isSameDay, parseISO, isBefore, startOfDay, differenceInDays, addDays } from 'date-fns';
import { zhCN, enUS } from 'date-fns/locale';

type ZoomLevel = 'day' | 'week' | 'month';
type DragMode = 'left' | 'right' | 'move' | null;

interface DragState {
  taskId: string;
  mode: DragMode;
  startX: number;
  initStartDays: number;
  initEndDays: number;
  curStartDays: number;
  curEndDays: number;
  didMove: boolean;
}

interface GanttTask {
  id: string;
  card: Card;
  column: Column;
  startDate: Date;
  endDate: Date;
}

export default function GanttView() {
  const { t, lang } = useLang();
  const dateLocale = lang === 'zh' ? zhCN : enUS;
  const { board, users, onlineUsers, filters, findCard, broadcastChange } = useBoard();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [viewStart, setViewStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const viewStartRef = useRef(viewStart);
  viewStartRef.current = viewStart;
  const cellWidthRef = useRef(56);
  const dayCountRef = useRef(28);

  useEffect(() => {
    const today = new Date();
    const offset = 200;
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = Math.max(0, todayOffset(today, viewStart, zoom) - offset);
    }
  }, [viewStart, zoom]);

  const tasks = useMemo<GanttTask[]>(() => {
    const all: GanttTask[] = [];
    for (const col of board.columns) {
      if (col.archived && !filters.showArchived) continue;
      for (const card of col.cards) {
        if (card.archived && !filters.showArchived) continue;
        if (filters.search) {
          const sl = filters.search.toLowerCase();
          if (!card.title.toLowerCase().includes(sl) && !card.description.toLowerCase().includes(sl)) continue;
        }
        if (filters.labels.length > 0 && !filters.labels.some(l => card.labels.includes(l))) continue;
        if (filters.assignees.length > 0 && !filters.assignees.some(a => card.assignees.includes(a))) continue;

        let s = card.startDate ? parseISO(card.startDate) : card.createdAt ? parseISO(card.createdAt) : new Date();
        let e = card.dueDate ? parseISO(card.dueDate) : addDays(s, 3);
        if (isBefore(e, s)) e = addDays(s, 2);
        all.push({ id: card.id, card, column: col, startDate: startOfDay(s), endDate: startOfDay(e) });
      }
    }
    return all.sort((a, b) => a.column.order - b.column.order || a.startDate.getTime() - b.startDate.getTime());
  }, [board.columns, filters]);

  const dayCount = zoom === 'day' ? 14 : zoom === 'week' ? 28 : 60;
  const days = useMemo(() => {
    return eachDayOfInterval({
      start: viewStart,
      end: addDays(viewStart, dayCount - 1),
    });
  }, [viewStart, dayCount]);

  function todayOffset(today: Date, start: Date, z: ZoomLevel) {
    const diff = differenceInDays(today, start);
    return diff * (z === 'day' ? 120 : z === 'week' ? 56 : 26);
  }

  const cellWidth = zoom === 'day' ? 120 : zoom === 'week' ? 56 : 26;
  cellWidthRef.current = cellWidth;
  const totalWidth = dayCount * cellWidth;
  dayCountRef.current = dayCount;

  const navigate = (delta: number) => {
    if (zoom === 'day') setViewStart(addDays(viewStart, delta * 7));
    else if (zoom === 'week') setViewStart(addWeeks(viewStart, delta * 2));
    else setViewStart(addWeeks(viewStart, delta * 4));
  };

  const resetView = () => {
    setViewStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  };

  function getTaskPosition(task: GanttTask) {
    let startOffset = differenceInDays(task.startDate, viewStart) * cellWidth;
    let endOffset = (differenceInDays(task.endDate, viewStart) + 1) * cellWidth;
    if (endOffset < 0) return null;
    if (startOffset < 0) startOffset = 0;
    if (startOffset > totalWidth) return null;
    const width = Math.max(cellWidth * 0.8, Math.min(endOffset - startOffset, totalWidth - startOffset));
    return { left: startOffset, width };
  }

  const weekGroups = useMemo(() => {
    const groups: { start: Date; label: string; span: number; offset: number }[] = [];
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (i === 0 || d.getDay() === 1) {
        const weekEnd = Math.min(i + 7, days.length) - 1;
        const dateFormat = lang === 'zh' ? 'MM月dd日' : 'MMM d';
        const label = f(d, dateFormat, { locale: dateLocale }) + ' - ' + f(days[weekEnd], dateFormat, { locale: dateLocale });
        groups.push({ start: d, label, span: weekEnd - i + 1, offset: i });
      }
    }
    return groups;
  }, [days, dateLocale, lang]);

  const columnGroups = useMemo(() => {
    const map = new Map<string, { column: Column; tasks: GanttTask[] }>();
    for (const t of tasks) {
      if (!map.has(t.column.id)) map.set(t.column.id, { column: t.column, tasks: [] });
      map.get(t.column.id)!.tasks.push(t);
    }
    return Array.from(map.values());
  }, [tasks]);

  const selectedCard = selectedCardId ? findCard(selectedCardId) : null;

  const today = new Date();
  const todayX = todayOffset(today, viewStart, zoom);

  // 任务横条拖拽：左右手柄 + 平移
  function clampDay(day: number) {
    return Math.max(-365, Math.min(dayCountRef.current + 365, Math.round(day)));
  }

  function startDrag(
    e: React.MouseEvent,
    mode: DragMode,
    task: GanttTask,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const containerRect = (e.currentTarget as HTMLElement).closest('.gantt-timeline-root')?.getBoundingClientRect();
    const timelineLeft = containerRect?.left ?? 0;
    const startX = e.clientX - timelineLeft + (scrollRef.current?.scrollLeft ?? 0);
    const vStart = viewStartRef.current;
    const initStartDays = differenceInDays(task.startDate, vStart);
    const initEndDays = differenceInDays(task.endDate, vStart);
    const newDrag: DragState = {
      taskId: task.id,
      mode,
      startX,
      initStartDays,
      initEndDays,
      curStartDays: initStartDays,
      curEndDays: initEndDays,
      didMove: false,
    };
    setDrag(newDrag);
    dragRef.current = newDrag;
  }

  useEffect(() => {
    if (!drag) return;
    const CLICK_THRESHOLD_PX = 3;
    const onMove = (e: MouseEvent) => {
      const cur = dragRef.current;
      if (!cur || !cur.mode) return;
      const containerEl = document.querySelector('.gantt-timeline-root') as HTMLElement | null;
      const containerRect = containerEl?.getBoundingClientRect();
      const timelineLeft = containerRect?.left ?? 0;
      const clientX = e.clientX - timelineLeft + (scrollRef.current?.scrollLeft ?? 0);
      const dx = clientX - cur.startX;
      const moved = cur.didMove || Math.abs(dx) > CLICK_THRESHOLD_PX;
      const dDays = dx / cellWidthRef.current;
      let s = cur.initStartDays;
      let en = cur.initEndDays;
      if (cur.mode === 'left') {
        s = clampDay(cur.initStartDays + dDays);
        if (s > en - 1) s = en - 1;
      } else if (cur.mode === 'right') {
        en = clampDay(cur.initEndDays + dDays);
        if (en < s + 1) en = s + 1;
      } else if (cur.mode === 'move') {
        const shift = clampDay(dDays);
        s = cur.initStartDays + shift;
        en = cur.initEndDays + shift;
      }
      const updated: DragState = { ...cur, curStartDays: s, curEndDays: en, didMove: moved };
      dragRef.current = updated;
      if (moved && !cur.didMove) setDrag(updated);
      else if (moved) setDrag(updated);
    };
    const onUp = () => {
      const cur = dragRef.current;
      if (cur) {
        if (cur.didMove) {
          const task = tasks.find(t => t.id === cur.taskId);
          if (task) {
            const vStart = viewStartRef.current;
            const newStart = startOfDay(addDays(vStart, cur.curStartDays));
            const newEnd = startOfDay(addDays(vStart, cur.curEndDays));
            broadcastChange({
              type: 'UPDATE_CARD',
              payload: {
                cardId: task.card.id,
                updates: {
                  startDate: newStart.toISOString(),
                  dueDate: newEnd.toISOString(),
                },
              },
            });
          }
        }
      }
      // 延迟一帧清空，让onClick先检测到didMove=true避免打开详情
      queueMicrotask(() => {
        setDrag(null);
        dragRef.current = null;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('selectstart', () => {});
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, tasks, broadcastChange]);

  function getDraggedTaskPosition(taskId: string, basePos: { left: number; width: number } | null) {
    if (!drag || drag.taskId !== taskId) return basePos;
    const newLeft = drag.curStartDays * cellWidthRef.current;
    const newWidth = (drag.curEndDays - drag.curStartDays + 1) * cellWidthRef.current;
    const left = Math.max(0, newLeft);
    const width = Math.max(cellWidthRef.current * 0.6, newWidth - 8);
    return { left, width };
  }

  function daysToLabel(startDays: number, endDays: number) {
    const vStart = viewStartRef.current;
    const s = addDays(vStart, startDays);
    const e = addDays(vStart, endDays);
    return `${f(s, 'MM/dd')} → ${f(e, 'MM/dd')}`;
  }

  return (
    <div className="min-h-full flex flex-col p-4 gap-3">
      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 pr-3 border-r border-slate-200 dark:border-slate-700">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <BarChart3 size={16} />
          </div>
          <div>
            <h2 className="font-semibold text-sm text-slate-800 dark:text-slate-100">{t('gantt.title')}</h2>
            <p className="text-[11px] text-slate-500">{t('gantt.subtitle', { n: tasks.length })}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-full p-0.5">
          {(['day', 'week', 'month'] as ZoomLevel[]).map(z => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-all',
                zoom === z
                  ? 'bg-[#007AFF] text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
              )}
            >
              {z === 'day' ? t('gantt.zoomDay') : z === 'week' ? t('gantt.zoomWeek') : t('gantt.zoomMonth')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="btn-ghost py-1 px-2">
            <ChevronLeft size={16} />
          </button>
          <button onClick={resetView} className="btn-ghost py-1 px-2 text-xs" title={t('gantt.reset')}>
            <RefreshCw size={14} className="mr-1" />
            {t('gantt.today')}
          </button>
          <button onClick={() => navigate(1)} className="btn-ghost py-1 px-2">
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 ml-auto text-xs text-slate-500">
          <CalendarDays size={14} />
          <span>
            {f(viewStart, lang === 'zh' ? 'yyyy年MM月dd日' : 'MMM d, yyyy', { locale: dateLocale })} ~ {f(addDays(viewStart, dayCount - 1), lang === 'zh' ? 'MM月dd日' : 'MMM d', { locale: dateLocale })}
          </span>
        </div>
      </div>

      <div className="glass rounded-xl overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto" ref={scrollRef}>
          <div className="flex min-w-max" style={{ minWidth: '100%' }}>
            {/* Left Side: Task Names */}
            <div className="sticky left-0 z-20 bg-white/95 dark:bg-slate-800/95 backdrop-blur w-72 border-r border-slate-200 dark:border-slate-700 shrink-0">
              {/* Header */}
              <div className="h-[72px] border-b border-slate-200 dark:border-slate-700 flex items-end px-4 pb-2 bg-white/80 dark:bg-slate-800/80">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('gantt.colTask')}</span>
              </div>

              {/* Body */}
              {tasks.length === 0 ? (
                <div className="py-20 text-center text-slate-400 text-sm">
                  {t('gantt.emptyTasks')}
                </div>
              ) : (
                columnGroups.map(({ column, tasks: colTasks }) => (
                  <div key={column.id}>
                    <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-700/50 text-[11px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider sticky z-10">
                      {column.title} <span className="text-slate-400 font-normal">({colTasks.length})</span>
                    </div>
                    {colTasks.map(task => {
                      const assignees = task.card.assignees.map(id => users.find(u => u.id === id)).filter((u): u is User => u !== undefined);
                      const completed = task.card.status === 'complete';
                      return (
                        <div
                          key={task.id}
                          onClick={() => setSelectedCardId(task.id)}
                          className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 hover:bg-sky-50/50 dark:hover:bg-sky-950/20 cursor-pointer transition-colors group"
                        >
                          <div className="flex items-center gap-2 min-h-6">
                            <div className="flex-1 min-w-0">
                              <div className={cn(
                                'text-sm font-medium text-slate-800 dark:text-slate-100 truncate',
                                completed && 'line-through text-slate-400'
                              )} title={task.card.title}>
                                {task.card.title}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-slate-400">
                                  {formatDate(task.card.createdAt)}
                                </span>
                              </div>
                            </div>
                            <AvatarStack users={assignees} max={2} size="sm" showOnline onlineUsers={onlineUsers} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Right Side: Timeline */}
            <div className="relative flex-1 min-w-0 gantt-timeline-root" style={{ minWidth: totalWidth }}>
              {/* Header Weeks */}
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

              {/* Header Days */}
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

              {/* Body Rows */}
              <div className="pt-[72px]">
                {columnGroups.map(({ column, tasks: colTasks }) => (
                  <div key={column.id}>
                    <div className="h-[22px] bg-slate-50 dark:bg-slate-900/60 border-b border-slate-100 dark:border-slate-700/50" />
                    {colTasks.map(task => {
                      const pos = getTaskPosition(task);
                      const dueStatus = getDueDateStatus(task.card.dueDate, task.card.status);
                      const labelColor = board.labels.find(l => l.id === task.card.labels[0])?.color;
                      const barColor = task.card.status === 'complete'
                        ? 'bg-emerald-500'
                        : dueStatus?.status === 'overdue'
                          ? 'bg-red-500'
                          : dueStatus?.status === 'due-soon'
                            ? 'bg-amber-500'
                            : labelColor
                              ? ''
                              : 'bg-[#007AFF]';
                      return (
                        <div
                          key={task.id}
                          className="relative h-[56px] border-b border-slate-100 dark:border-slate-700/50 hover:bg-sky-50/30 dark:hover:bg-sky-950/10 transition-colors"
                        >
                          {/* Grid lines */}
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

                          {/* Task Bar */}
                          {pos && (() => {
                            const curPos = getDraggedTaskPosition(task.id, pos);
                            if (!curPos) return null;
                            const isDragging = drag?.taskId === task.id;
                            return (
                              <div
                                onClick={(e) => {
                                  const cur = dragRef.current;
                                  // 若本次是拖动操作（didMove=true或仍在drag同task上下文），禁止打开详情
                                  if (cur && cur.taskId === task.id && cur.didMove) {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    return;
                                  }
                                  if (isDragging) {
                                    e.stopPropagation();
                                    return;
                                  }
                                  setSelectedCardId(task.id);
                                }}
                                className={cn(
                                  'absolute rounded-lg shadow-sm transition-all group flex items-center',
                                  barColor,
                                  !isDragging && 'hover:shadow-md hover:-translate-y-0.5',
                                  isDragging && 'ring-2 ring-white/70 ring-offset-1 ring-offset-slate-50 dark:ring-offset-slate-900 opacity-95 z-40 cursor-grabbing',
                                )}
                                style={{
                                  top: 8,
                                  bottom: 8,
                                  left: curPos.left + 4,
                                  width: curPos.width - 8,
                                  backgroundColor: task.card.status !== 'complete' && dueStatus?.status === 'normal' && labelColor ? labelColor : undefined,
                                }}
                              >
                                {/* Left resize handle */}
                                <div
                                  onMouseDown={(e) => startDrag(e, 'left', task)}
                                  className={cn(
                                    'absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize z-10 flex items-center justify-center transition-colors',
                                    'rounded-l-lg group-hover:bg-white/25 hover:bg-white/40',
                                    isDragging && drag.mode === 'left' && 'bg-white/50',
                                  )}
                                  title={t('gantt.dragStartHint')}
                                >
                                  <div className="w-0.5 h-6 bg-white/80 rounded-full" />
                                </div>

                                {/* Move handle (middle main area) */}
                                <div
                                  onMouseDown={(e) => startDrag(e, 'move', task)}
                                  className="absolute inset-x-3 top-0 bottom-0 cursor-grab flex items-center gap-1.5 px-2 overflow-hidden"
                                  title={t('gantt.dragMoveHint')}
                                >
                                  <div className="flex-1 min-w-0 pointer-events-none select-none">
                                    <div className="text-[11px] font-semibold text-white truncate leading-tight">
                                      {task.card.title}
                                    </div>
                                    {(curPos.width > 140 || isDragging) && (
                                      <div className="text-[9px] text-white/85 truncate">
                                        {isDragging
                                          ? daysToLabel(drag!.curStartDays, drag!.curEndDays)
                                          : `${f(task.startDate, 'MM/dd')} → ${f(task.endDate, 'MM/dd')}`
                                        }
                                      </div>
                                    )}
                                  </div>
                                  {pos.width > 100 && !isDragging && (
                                    <AvatarStack
                                      users={task.card.assignees.map(id => users.find(u => u.id === id)).filter((u): u is User => u !== undefined)}
                                      max={2}
                                      size="sm"
                                    />
                                  )}
                                </div>

                                {/* Right resize handle */}
                                <div
                                  onMouseDown={(e) => startDrag(e, 'right', task)}
                                  className={cn(
                                    'absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize z-10 flex items-center justify-center transition-colors',
                                    'rounded-r-lg group-hover:bg-white/25 hover:bg-white/40',
                                    isDragging && drag.mode === 'right' && 'bg-white/50',
                                  )}
                                  title={t('gantt.dragEndHint')}
                                >
                                  <div className="w-0.5 h-6 bg-white/80 rounded-full" />
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Today Line */}
              {todayX >= 0 && todayX <= totalWidth && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500/80 z-30 pointer-events-none"
                  style={{ left: todayX + (cellWidth / 2) }}
                >
                  <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-red-500 rounded-full shadow-lg animate-pulse" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="shrink-0 flex flex-wrap items-center gap-4 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-[#007AFF]" />
            <span>{t('gantt.status.normal')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-amber-500" />
            <span>{t('gantt.status.soon')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span>{t('gantt.status.overdue')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span>{t('gantt.status.done')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-0.5 h-3 bg-red-500 rounded" />
            <span>{t('gantt.today')}</span>
          </div>
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
