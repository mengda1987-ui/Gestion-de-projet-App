import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, isBefore, isToday, differenceInDays, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string, lang?: string) {
  const fmt = lang === 'en' ? 'MMM dd, yyyy' : 'yyyy年MM月dd日';
  return format(parseISO(date), fmt, { locale: zhCN });
}

export function formatDateTime(date: string) {
  return format(parseISO(date), 'yyyy-MM-dd HH:mm', { locale: zhCN });
}

export function relativeTime(date: string) {
  return formatDistanceToNow(parseISO(date), { addSuffix: true, locale: zhCN });
}

export function getDueDateStatus(dueDate?: string, completed?: boolean, lang?: string) {
  if (!dueDate) return null;
  const isZh = lang !== 'en';
  if (completed) return { status: 'completed', label: isZh ? '已完成' : 'Done', color: 'bg-emerald-500' };
  const due = parseISO(dueDate);
  const now = new Date();
  if (isBefore(due, now)) {
    return { status: 'overdue', label: isZh ? '已逾期' : 'Overdue', color: 'bg-red-500' };
  }
  const diff = differenceInDays(due, now);
  if (isToday(due) || diff <= 2) {
    return { status: 'due-soon', label: diff === 0 ? (isZh ? '今天到期' : 'Due today') : (isZh ? `${diff}天内到期` : `Due in ${diff}d`), color: 'bg-amber-500' };
  }
  return { status: 'normal', label: formatDate(dueDate, lang), color: 'bg-sky-500' };
}

export function calculateChecklistProgress(items: { completed: boolean }[]) {
  if (items.length === 0) return { completed: 0, total: 0, percentage: 0 };
  const completed = items.filter(i => i.completed).length;
  return { completed, total: items.length, percentage: Math.round((completed / items.length) * 100) };
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function generateId() {
  return crypto.randomUUID();
}
