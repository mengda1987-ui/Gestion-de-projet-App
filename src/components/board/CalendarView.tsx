'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Trash2,
  Phone,
  Video,
  CheckSquare,
  Bell,
} from 'lucide-react';
import { cn, generateId } from '@/lib/utils';
import type { CalendarEvent, CalendarEventType } from '@/types';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
} from 'date-fns';

const TYPE_META: Record<CalendarEventType, { color: string; icon: typeof Phone; labelKey: string }> = {
  meeting: { color: '#007AFF', icon: Video, labelKey: 'calendar.meeting' },
  call: { color: '#10B981', icon: Phone, labelKey: 'calendar.call' },
  task: { color: '#F59E0B', icon: CheckSquare, labelKey: 'calendar.task' },
  reminder: { color: '#8B5CF6', icon: Bell, labelKey: 'calendar.reminder' },
};

export default function CalendarView() {
  const { board, calendarEvents, currentUser, dispatch } = useBoard();
  const { t, lang } = useLang();

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<CalendarEventType>('meeting');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [note, setNote] = useState('');

  const boardEvents = useMemo(
    () => calendarEvents.filter(e => !e.boardId || e.boardId === board.id),
    [calendarEvents, board.id]
  );

  const days = useMemo(() => {
    const s = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const e = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: s, end: e });
  }, [month]);

  const weekDays = ['calendar.week.mon', 'calendar.week.tue', 'calendar.week.wed', 'calendar.week.thu', 'calendar.week.fri', 'calendar.week.sat', 'calendar.week.sun'];

  const addEvent = () => {
    const tTitle = title.trim();
    if (!tTitle || !start) return;
    const event: CalendarEvent = {
      id: generateId(),
      title: tTitle,
      start: new Date(start).toISOString(),
      end: end ? new Date(end).toISOString() : undefined,
      type,
      boardId: board.id,
      note: note.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_CALENDAR_EVENT', payload: { event } });
    dispatch({
      type: 'ADD_OPERATION_LOG',
      payload: {
        log: {
          id: generateId(),
          userId: currentUser?.id || '',
          userName: currentUser?.name || '',
          action: 'add_calendar_event',
          detail: tTitle,
          createdAt: new Date().toISOString(),
        },
      },
    });
    setTitle('');
    setStart('');
    setEnd('');
    setNote('');
    setShowAdd(false);
  };

  const deleteEvent = (e: CalendarEvent) => {
    if (confirm(t('calendar.deleteConfirm', { name: e.title }))) {
      dispatch({ type: 'DELETE_CALENDAR_EVENT', payload: { eventId: e.id } });
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#007AFF]/10 flex items-center justify-center">
            <CalendarIcon size={22} className="text-[#007AFF]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('calendar.title')}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{board.title}</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={16} />
          {t('calendar.addEvent')}
        </button>
      </div>

      {/* Month header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
          <ChevronLeft size={18} />
        </button>
        <h2 className="font-semibold text-slate-800 dark:text-slate-100">
          {format(month, lang === 'zh' ? 'yyyy年 M月' : 'MMMM yyyy')}
        </h2>
        <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {weekDays.map(d => (
          <div key={d} className="text-center text-xs font-semibold text-slate-500 dark:text-slate-400 py-2">
            {t(d)}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const dayEvents = boardEvents.filter(e => isSameDay(new Date(e.start), day));
          const inMonth = isSameMonth(day, month);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'min-h-[92px] rounded-lg border p-1.5 transition-colors',
                inMonth ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-100 dark:border-slate-800 opacity-60'
              )}
            >
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{format(day, 'd')}</div>
              <div className="space-y-1">
                {dayEvents.map(e => {
                  const meta = TYPE_META[e.type];
                  const Icon = meta.icon;
                  return (
                    <div key={e.id} className="group flex items-start gap-1 rounded px-1 py-0.5 text-[10px] leading-tight" style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                      <Icon size={10} className="mt-0.5 shrink-0" />
                      <span className="flex-1 truncate">{e.title}</span>
                      <button onClick={() => deleteEvent(e)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 shrink-0">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add event modal */}
      {showAdd && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowAdd(false)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-lg">{t('calendar.addEvent')}</h3>
              <button onClick={() => setShowAdd(false)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400">
                <X size={18} />
              </button>
            </div>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('calendar.eventTitle')} className="input mb-2 text-sm" autoFocus />
            <select value={type} onChange={e => setType(e.target.value as CalendarEventType)} className="input mb-2 text-sm">
              <option value="meeting">{t('calendar.meeting')}</option>
              <option value="call">{t('calendar.call')}</option>
              <option value="task">{t('calendar.task')}</option>
              <option value="reminder">{t('calendar.reminder')}</option>
            </select>
            <label className="text-[11px] text-slate-500 font-medium mb-0.5 block">{t('calendar.start')}</label>
            <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className="input mb-2 text-sm" />
            <label className="text-[11px] text-slate-500 font-medium mb-0.5 block">{t('calendar.end')}</label>
            <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className="input mb-2 text-sm" />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder={t('calendar.note')} className="input mb-4 text-sm" />
            <div className="flex gap-2.5">
              <button onClick={() => setShowAdd(false)} className="btn-secondary flex-1">{lang === 'zh' ? '取消' : 'Cancel'}</button>
              <button onClick={addEvent} disabled={!title.trim() || !start} className="btn-primary flex-1">{t('common.save')}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
