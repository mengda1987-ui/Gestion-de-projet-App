'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, Label, User, Checklist, ChecklistItem, Attachment, Comment } from '@/types';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { Avatar, AvatarStack } from '@/components/ui/Avatar';
import { LabelBadge } from '@/components/ui/LabelBadge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  X,
  CreditCard,
  AlignLeft,
  Calendar,
  CheckSquare,
  Tags,
  Users,
  Paperclip,
  MessageSquare,
  FileText,
  Archive,
  Trash2,
  Copy,
  Plus,
  Check,
  ChevronDown,
  Send,
  Upload,
  Image,
  MoreHorizontal,
  Clock,
  Trash,
  Pencil,
  Palette,
  Bold,
  Underline,
  Italic,
  Strikethrough,
  Heading,
  Quote,
  List as ListIcon,
  Link,
} from 'lucide-react';
import {
  cn,
  formatDate,
  formatDateTime,
  relativeTime,
  getDueDateStatus,
  calculateChecklistProgress,
  formatFileSize,
  generateId,
} from '@/lib/utils';
import { parseISO, format } from 'date-fns';

interface CardDetailModalProps {
  card: Card;
  columnId: string;
  onClose: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

type SectionTab = 'activity' | 'checklist' | 'description' | 'attachments' | 'labels' | 'members' | 'duedate';

const LABEL_COLOR_PALETTE = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16',
  '#22C55E', '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9',
  '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF',
  '#EC4899', '#F43F5E', '#64748B',
];

interface LabelManagerProps {
  labels: Label[];
  onAdd: (label: { name: string; color: string }) => void;
  onUpdate: (labelId: string, updates: Partial<Label>) => void;
  onDelete: (labelId: string) => void;
  defaultName: string;
  setDefaultName: (v: string) => void;
  defaultColor: string;
  setDefaultColor: (v: string) => void;
}

function LabelManager({
  labels,
  onAdd,
  onUpdate,
  onDelete,
  defaultName,
  setDefaultName,
  defaultColor,
  setDefaultColor,
}: LabelManagerProps) {
  const { t, lang } = useLang();
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const submitAdd = () => {
    const name = defaultName.trim();
    if (!name) return;
    onAdd({ name, color: defaultColor });
    setDefaultName('');
  };

  const startEdit = (lbl: Label) => {
    setEditingLabelId(lbl.id);
    setEditName(lbl.name);
    setEditColor(lbl.color);
  };

  const saveEdit = (lbl: Label) => {
    const name = editName.trim() || lbl.name;
    onUpdate(lbl.id, { name, color: editColor });
    setEditingLabelId(null);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{lang === 'zh' ? '➕ 新建自定义标签' : '➕ New custom label'}</div>
        <div className="flex gap-2 items-center">
          <input
            value={defaultName}
            onChange={(e) => setDefaultName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitAdd()}
            placeholder={lang === 'zh' ? '标签名称，如：紧急' : 'Label name, e.g. Urgent'}
            className="flex-1 input text-xs h-8"
          />
          <button
            onClick={submitAdd}
            disabled={!defaultName.trim()}
            className="btn-primary text-xs h-8 px-3 disabled:opacity-40"
          >
            {t('labels.create')}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {LABEL_COLOR_PALETTE.map(c => (
            <button
              key={c}
              onClick={() => setDefaultColor(c)}
              className={cn(
                'w-5 h-5 rounded-full transition-all border-2 shrink-0',
                defaultColor === c ? 'border-slate-700 dark:border-white scale-110 shadow' : 'border-transparent hover:scale-110'
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100 dark:border-slate-700 pt-2 max-h-80 overflow-y-auto pr-1 space-y-1.5">
        {labels.map(label => {
          const editing = editingLabelId === label.id;
          return (
            <div key={label.id} className="space-y-1.5 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
              <div className="flex items-center gap-2">
                {!editing ? (
                  <>
                    <div
                      className="w-14 h-4 rounded-sm shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="text-xs text-slate-700 dark:text-slate-200 flex-1 text-left truncate">
                      {label.name}
                    </span>
                    <button
                      onClick={() => startEdit(label)}
                      className="p-1 rounded text-slate-400 hover:text-[#007AFF] hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                      title={lang === 'zh' ? '重命名/改色' : 'Rename/Change color'}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(lang === 'zh' ? `确定删除标签「${label.name}」？已关联卡片的该标签会一并清除。` : `Delete label "${label.name}"? Cards using this label will lose it.`)) {
                          onDelete(label.id);
                        }
                      }}
                      className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      title={t('labels.delete')}
                    >
                      <Trash size={12} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => saveEdit(label)}
                    className="ml-auto p-1 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors"
                    title={t('common.save')}
                  >
                    <Check size={14} />
                  </button>
                )}
              </div>
              {editing && (
                <div className="space-y-1.5 pl-1 pr-0.5">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit(label)}
                    className="input text-xs h-7 w-full"
                    placeholder={t('labels.renamePlaceholder')}
                  />
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {LABEL_COLOR_PALETTE.map(c => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        className={cn(
                          'w-4.5 h-4.5 w-[18px] h-[18px] rounded-full transition-all border-2 shrink-0',
                          editColor === c ? 'border-slate-700 dark:border-white scale-110 shadow' : 'border-transparent hover:scale-110'
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <label className="flex items-center gap-1 text-[10px] text-slate-500 ml-1 cursor-pointer hover:text-[#007AFF]">
                      <Palette size={11} />
                      {t('mindmap.color.custom')}
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="w-5 h-5 p-0 border-0 bg-transparent cursor-pointer"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CardDetailModal({
  card,
  columnId,
  onClose,
  onDuplicate,
  onArchive,
  onDelete,
}: CardDetailModalProps) {
  const { board, users, currentUser, dispatch, broadcastChange, findCard, onlineUsers } = useBoard();
  const { lang, t } = useLang();

  const latestCard = findCard(card.id)?.card || card;
  const column = board.columns.find(c => c.id === columnId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(latestCard.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(latestCard.description);
  const [showLabels, setShowLabels] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showDueDate, setShowDueDate] = useState(false);
  const [dueDateValue, setDueDateValue] = useState(
    latestCard.dueDate ? format(parseISO(latestCard.dueDate), 'yyyy-MM-dd') : ''
  );
  const [startDateValue, setStartDateValue] = useState(
    latestCard.startDate ? format(parseISO(latestCard.startDate), 'yyyy-MM-dd') : ''
  );
  const [commentText, setCommentText] = useState('');
  const [newChecklistName, setNewChecklistName] = useState('');
  const [showAddChecklist, setShowAddChecklist] = useState(false);
  const [checklistNewItems, setChecklistNewItems] = useState<Record<string, string>>({});
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState('');
  const [activeTab, setActiveTab] = useState<SectionTab>('activity');
  const [manageLabelsMode, setManageLabelsMode] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#3B82F6');

  const modalRef = useRef<HTMLDivElement>(null);
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);

  const insertFormat = (prefix: string, suffix = '') => {
    const ta = descTextareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = descValue.substring(start, end);
    const before = descValue.substring(0, start);
    const after = descValue.substring(end);
    const newText = prefix + selected + suffix;
    const newDesc = before + newText + after;
    setDescValue(newDesc);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start, start + newText.length);
    });
  };

  const formatButtons = [
    { label: lang === 'zh' ? '加粗' : 'Bold', icon: Bold, action: () => insertFormat('**', '**') },
    { label: lang === 'zh' ? '斜体' : 'Italic', icon: Italic, action: () => insertFormat('*', '*') },
    { label: lang === 'zh' ? '下划线' : 'Underline', icon: Underline, action: () => insertFormat('<u>', '</u>') },
    { label: lang === 'zh' ? '删除线' : 'Strikethrough', icon: Strikethrough, action: () => insertFormat('~~', '~~') },
    { label: lang === 'zh' ? '标题' : 'Heading', icon: Heading, action: () => insertFormat('## ') },
    { label: lang === 'zh' ? '引用' : 'Quote', icon: Quote, action: () => insertFormat('> ') },
    { label: lang === 'zh' ? '列表' : 'List', icon: ListIcon, action: () => insertFormat('- ') },
    { label: lang === 'zh' ? '链接' : 'Link', icon: Link, action: () => insertFormat('[', '](url)') },
  ];

  useEffect(() => {
    setTitleValue(latestCard.title);
    setDescValue(latestCard.description);
  }, [latestCard.title, latestCard.description]);

  // Stable onClose reference to avoid re-binding event listeners
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Prevent Esc from closing modal when a date picker or input is active
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      onCloseRef.current();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, []);

  const updateCard = (updates: Partial<Card>) => {
    broadcastChange({ type: 'UPDATE_CARD', payload: { cardId: latestCard.id, updates } });
  };

  const handleSaveTitle = () => {
    if (titleValue.trim() && titleValue !== latestCard.title) {
      updateCard({ title: titleValue.trim() });
    } else {
      setTitleValue(latestCard.title);
    }
    setEditingTitle(false);
  };

  const handleSaveDates = () => {
    const updates: Partial<Card> = {};
    if (dueDateValue) updates.dueDate = new Date(dueDateValue + 'T23:59:59').toISOString();
    else updates.dueDate = undefined;
    if (startDateValue) updates.startDate = new Date(startDateValue).toISOString();
    else updates.startDate = undefined;
    updateCard(updates);
    setShowDueDate(false);
  };

  const handleAddComment = () => {
    if (!commentText.trim() || !currentUser) return;
    broadcastChange({
      type: 'ADD_COMMENT',
      payload: { cardId: latestCard.id, text: commentText.trim(), userId: currentUser.id },
    });
    setCommentText('');
  };

  const handleAddChecklist = () => {
    if (!newChecklistName.trim()) return;
    broadcastChange({
      type: 'ADD_CHECKLIST',
      payload: { cardId: latestCard.id, name: newChecklistName.trim() },
    });
    setNewChecklistName('');
    setShowAddChecklist(false);
  };

  const handleAddChecklistItem = (clId: string) => {
    const text = checklistNewItems[clId] || '';
    if (!text.trim()) return;
    broadcastChange({
      type: 'ADD_CHECKLIST_ITEM',
      payload: { cardId: latestCard.id, checklistId: clId, text: text.trim(), itemId: generateId() },
    });
    setChecklistNewItems({ ...checklistNewItems, [clId]: '' });
  };

  const assignees = latestCard.assignees.map((id: string) => users.find((u: User) => u.id === id)).filter((u: User | undefined): u is User => u !== undefined);
  const dueStatus = getDueDateStatus(latestCard.dueDate, latestCard.status);

  return (
    <div className="fixed inset-0 z-[99999] flex items-start justify-center md:items-center p-0 md:p-4 bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full md:max-w-4xl h-full md:h-[90vh] md:rounded-2xl bg-[#f5f5f7] dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col animate-slide-up md:animate-slide-right border border-slate-200/50 dark:border-slate-700/50"
      >
        {/* Cover Image or Header */}
        {latestCard.coverImage ? (
          <div className="relative h-44 md:h-56 shrink-0">
            <img
              src={latestCard.coverImage}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-50/90 via-slate-50/20 to-transparent dark:from-slate-900/90 dark:via-slate-900/20" />
            <button
              onClick={onClose}
              className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/40 backdrop-blur text-white flex items-center justify-center hover:bg-black/60 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between p-4 pb-2 shrink-0">
            <div />
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 space-y-6">
            {/* Title & Column */}
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span>{t('card.inList')}</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{column?.title || (lang === 'zh' ? '未分类' : 'Uncategorized')}</span>
                {latestCard.archived && (
                  <span className="badge bg-slate-500 text-white ml-1">{lang === 'zh' ? '已归档' : 'Archived'}</span>
                )}
                {latestCard.status !== 'todo' && (
                  <span className={cn(
                    'badge ml-1',
                    latestCard.status === 'complete' && 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
                    latestCard.status === 'in_progress' && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
                  )}>
                    {latestCard.status === 'complete' ? (lang === 'zh' ? '已完成' : 'Done') : (lang === 'zh' ? '进行中' : 'In Progress')}
                  </span>
                )}
              </div>

              {editingTitle ? (
                <textarea
                  autoFocus
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setTitleValue(latestCard.title);
                      setEditingTitle(false);
                    }
                  }}
                  className="w-full text-xl md:text-2xl font-bold bg-white dark:bg-slate-800 rounded-xl border-2 border-[#007AFF]/30 px-3 py-2 outline-none resize-none text-slate-900 dark:text-white"
                  rows={2}
                />
              ) : (
                <h2
                  onClick={() => setEditingTitle(true)}
                  className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white cursor-text hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg px-3 py-2 -mx-3 transition-colors"
                >
                  {latestCard.title}
                </h2>
              )}

              {/* Assignees Row */}
              {assignees.length > 0 && (
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Users size={14} className="text-slate-500" />
                    <AvatarStack users={assignees} max={5} size="md" />
                  </div>
                  {assignees.map((u: User) => (
                    <span key={u.id} className="text-xs text-slate-600 dark:text-slate-300">{u.name}</span>
                  )).slice(0, 2)}
                </div>
              )}
            </div>

            {/* Labels */}
            {latestCard.labels.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Tags size={14} className="text-slate-500 shrink-0" />
                  <div className="flex flex-wrap gap-1.5">
                    {latestCard.labels.map((labelId: string) => {
                      const label = board.labels.find((l: Label) => l.id === labelId);
                      if (!label) return null;
                      return (
                        <LabelBadge
                          key={labelId}
                          label={label}
                          size="md"
                          clickable
                          onRemove={() => broadcastChange({
                            type: 'TOGGLE_CARD_LABEL',
                            payload: { cardId: latestCard.id, labelId },
                          })}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Due Date */}
            {dueStatus && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Calendar size={14} className="text-slate-500 shrink-0" />
                  <div className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium',
                    dueStatus.status === 'completed' && 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
                    dueStatus.status === 'overdue' && 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
                    dueStatus.status === 'due-soon' && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
                    dueStatus.status === 'normal' && 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
                  )}>
                    {dueStatus.status === 'overdue' && <Clock size={12} />}
                    {dueStatus.label}
                    {latestCard.dueDate && (
                      <span className="opacity-80 font-normal">
                        ({formatDate(latestCard.dueDate)})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5">
                  {(['todo', 'in_progress', 'complete'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => updateCard({ status: s })}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-all',
                        latestCard.status === s
                          ? s === 'todo'
                            ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-white'
                            : s === 'in_progress'
                              ? 'bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 shadow-sm'
                              : 'bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                      )}
                    >
                      {s === 'todo' ? (lang === 'zh' ? '待办' : 'To Do')
                        : s === 'in_progress' ? (lang === 'zh' ? '进行中' : 'In Progress')
                        : (lang === 'zh' ? '已完成' : 'Complete')}
                    </button>
                  ))}
                </div>
              </div>
                </div>
              </div>
            )}

            {/* Section Tabs (Mobile) */}
            <div className="md:hidden flex border-b border-slate-200 dark:border-slate-700 -mx-4 px-4 gap-1 overflow-x-auto">
              {[
                { id: 'activity' as SectionTab, label: t('card.activity'), icon: MessageSquare },
                { id: 'checklist' as SectionTab, label: t('card.checklist'), icon: CheckSquare },
                { id: 'description' as SectionTab, label: t('card.description'), icon: AlignLeft },
                { id: 'labels' as SectionTab, label: t('card.labels'), icon: Tags },
                { id: 'members' as SectionTab, label: t('card.members'), icon: Users },
                { id: 'duedate' as SectionTab, label: t('card.dueDate'), icon: Calendar },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'flex items-center gap-1 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                    activeTab === id
                      ? 'border-[#007AFF] text-[#007AFF] dark:text-[#007AFF]'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  )}
                >
                  <Icon size={14} />
                  {label}
                  {id === 'activity' && latestCard.comments.length > 0 && (
                    <span className="bg-slate-200 dark:bg-slate-700 rounded-full px-1.5 text-[10px]">
                      {latestCard.comments.length}
                    </span>
                  )}
                  {id === 'checklist' && latestCard.checklists.length > 0 && (
                    <span className="bg-slate-200 dark:bg-slate-700 rounded-full px-1.5 text-[10px]">
                      {latestCard.checklists.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Two Column Layout (Desktop) / Single (Mobile) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Main Content */}
              <div className="md:col-span-2 space-y-6">
                {/* Checklists */}
                <section className={cn(activeTab !== 'checklist' && 'hidden md:block')}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <CheckSquare size={16} className="text-slate-500" />
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('card.checklist')}</h3>
                    </div>
                    <button
                      onClick={() => setShowAddChecklist(true)}
                      className="btn-ghost text-xs py-1"
                    >
                      {t('card.checklist.addList')}
                    </button>
                  </div>

                  {showAddChecklist && (
                    <div className="mb-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 animate-slide-up">
                      <input
                        autoFocus
                        value={newChecklistName}
                        onChange={(e) => setNewChecklistName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddChecklist()}
                        placeholder={lang === 'zh' ? '清单名称，如：开发步骤' : 'Checklist name, e.g. Dev steps'}
                        className="input mb-2 text-sm"
                      />
                      <div className="flex items-center gap-2">
                        <button onClick={handleAddChecklist} className="btn-primary text-xs py-1.5">{t('common.add')}</button>
                        <button
                          onClick={() => {
                            setShowAddChecklist(false);
                            setNewChecklistName('');
                          }}
                          className="btn-ghost text-xs py-1.5"
                        >{t('common.cancel')}</button>
                      </div>
                    </div>
                  )}

                  {latestCard.checklists.length === 0 && !showAddChecklist && (
                    <div className="p-4 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center text-xs text-slate-400">
                      {lang === 'zh' ? '暂无清单，点击"新建清单"开始添加待办子任务' : 'No checklists yet. Click "New checklist" to start adding items.'}
                    </div>
                  )}

                  <div className="space-y-4">
                    {latestCard.checklists.map((cl: Checklist) => {
                      const progress = calculateChecklistProgress(cl.items);
                      return (
                        <div key={cl.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                          <div className="p-3 pb-2">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{cl.name}</h4>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-500 font-medium">
                                  {t('card.checklist.progress', { done: progress.completed, total: progress.total, pct: progress.percentage })}
                                </span>
                                <button
                                  onClick={() => {
                                    if (confirm(lang === 'zh' ? `删除整个清单「${cl.name}」？` : `Delete checklist "${cl.name}"?`)) {
                                      broadcastChange({
                                        type: 'DELETE_CHECKLIST',
                                        payload: { cardId: latestCard.id, checklistId: cl.id },
                                      });
                                    }
                                  }}
                                  className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                  title={lang === 'zh' ? '删除清单' : 'Delete checklist'}
                                >
                                  <Trash size={12} />
                                </button>
                              </div>
                            </div>
                            <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-3">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all duration-500',
                                  progress.percentage === 100 ? 'bg-emerald-500' : 'bg-[#007AFF]'
                                )}
                                style={{ width: `${progress.percentage}%` }}
                              />
                            </div>
                            <div className="space-y-1.5">
                              {cl.items.map((item: ChecklistItem) => {
                                const status = item.dueDate ? getDueDateStatus(item.dueDate, item.completed) : null;
                                const dueDateInputValue = item.dueDate
                                  ? format(parseISO(item.dueDate), 'yyyy-MM-dd')
                                  : '';
                                return (
                                  <div
                                    key={item.id}
                                    className={cn(
                                      'flex items-start gap-2 p-2 -mx-1 rounded-lg group hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors',
                                      item.completed && 'opacity-60'
                                    )}
                                  >
                                    <div className="pt-0.5">
                                      <div
                                        onClick={() => broadcastChange({
                                          type: 'TOGGLE_CHECKLIST_ITEM',
                                          payload: { cardId: latestCard.id, checklistId: cl.id, itemId: item.id },
                                        })}
                                        className={cn(
                                          'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition-all',
                                          item.completed
                                            ? 'bg-emerald-500 border-emerald-500 text-white'
                                            : 'border-slate-300 dark:border-slate-500 hover:border-[#007AFF]'
                                        )}
                                      >
                                        {item.completed && <Check size={10} strokeWidth={4} />}
                                      </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      {editingItemId === item.id ? (
                                        <input
                                          autoFocus
                                          value={editingItemText}
                                          onChange={(e) => setEditingItemText(e.target.value)}
                                          onBlur={() => setEditingItemId(null)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              broadcastChange({
                                                type: 'UPDATE_CHECKLIST_ITEM',
                                                payload: {
                                                  cardId: latestCard.id,
                                                  checklistId: cl.id,
                                                  itemId: item.id,
                                                  updates: { text: editingItemText.trim() },
                                                },
                                              });
                                              setEditingItemId(null);
                                            }
                                            if (e.key === 'Escape') setEditingItemId(null);
                                          }}
                                          className="w-full bg-transparent border-b border-[#007AFF]/50 text-sm text-slate-700 dark:text-slate-200 py-0.5 px-1 focus:outline-none"
                                        />
                                      ) : (
                                        <div
                                          onClick={() => {
                                            setEditingItemId(item.id);
                                            setEditingItemText(item.text);
                                          }}
                                          className={cn(
                                            'text-sm text-slate-700 dark:text-slate-200 break-words cursor-pointer hover:text-[#007AFF] dark:hover:text-[#007AFF]',
                                            item.completed && 'line-through decoration-slate-400',
                                          )}
                                        >
                                          {item.text}
                                        </div>
                                      )}
                                      {status && (
                                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                                          <span className={cn(
                                            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
                                            status.status === 'overdue' && 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
                                            status.status === 'dueSoon' && 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
                                            status.status === 'completed' && 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
                                            status.status === 'normal' && 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
                                          )}>
                                            <Clock size={9} />
                                            {formatDate(item.dueDate!)}
                                            <span className="opacity-80 ml-0.5">· {status.label}</span>
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="shrink-0 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                      <label className="relative inline-flex items-center">
                                        <span
                                          className={cn(
                                            'inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium cursor-pointer border transition-all',
                                            item.dueDate
                                              ? status
                                                ? cn(
                                                    'hover:brightness-95',
                                                    status.status === 'overdue' && 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300',
                                                    status.status === 'dueSoon' && 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
                                                    status.status === 'completed' && 'bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
                                                    status.status === 'normal' && 'bg-sky-50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300'
                                                  )
                                                : 'bg-slate-50 border-slate-200 dark:bg-slate-700 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                                              : 'bg-slate-50 border-slate-200 dark:bg-slate-700 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-600'
                                          )}
                                        >
                                          <Calendar size={9} />
                                          {item.dueDate ? formatDate(item.dueDate) : t('card.checklist.setItemDate')}
                                        </span>
                                        <input
                                          type="date"
                                          value={dueDateInputValue}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            broadcastChange({
                                              type: 'UPDATE_CHECKLIST_ITEM',
                                              payload: {
                                                cardId: latestCard.id,
                                                checklistId: cl.id,
                                                itemId: item.id,
                                                updates: val ? { dueDate: new Date(val + 'T09:00:00').toISOString() } : { dueDate: undefined },
                                              },
                                            });
                                          }}
                                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                        />
                                      </label>
                                      {item.dueDate && (
                                        <button
                                          onClick={() => broadcastChange({
                                            type: 'UPDATE_CHECKLIST_ITEM',
                                            payload: {
                                              cardId: latestCard.id,
                                              checklistId: cl.id,
                                              itemId: item.id,
                                              updates: { dueDate: undefined },
                                            },
                                          })}
                                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                          title={t('card.checklist.clearItemDate')}
                                        >
                                          <X size={10} />
                                        </button>
                                      )}
                                      <button
                                        onClick={() => {
                                          broadcastChange({
                                            type: 'DELETE_CHECKLIST_ITEM',
                                            payload: { cardId: latestCard.id, checklistId: cl.id, itemId: item.id },
                                          });
                                        }}
                                        className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                        title={lang === 'zh' ? '删除' : 'Delete'}
                                      >
                                        <Trash size={10} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div className="px-3 py-2 bg-slate-50 dark:bg-slate-750 border-t border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2">
                              <input
                                value={checklistNewItems[cl.id] || ''}
                                onChange={(e) => setChecklistNewItems({ ...checklistNewItems, [cl.id]: e.target.value })}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddChecklistItem(cl.id)}
                                placeholder={t('card.checklist.itemPlaceholder')}
                                className="flex-1 bg-transparent border-0 text-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#007AFF]/30 rounded text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                              />
                              <button
                                onClick={() => handleAddChecklistItem(cl.id)}
                                disabled={!checklistNewItems[cl.id]?.trim()}
                                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-500 disabled:opacity-30 transition-colors"
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Description */}
                <section className={cn(activeTab !== 'description' && 'hidden md:block')}>
                  <div className="flex items-center gap-2 mb-2">
                    <AlignLeft size={16} className="text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('card.description')}</h3>
                  </div>
                  {editingDesc ? (
                    <div className="space-y-2">
                      {/* Formatting Toolbar */}
                      <div className="flex items-center gap-0.5 flex-wrap p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        {formatButtons.map(btn => (
                          <button
                            key={btn.label}
                            type="button"
                            onClick={btn.action}
                            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-700 transition-colors"
                            title={btn.label}
                          >
                            <btn.icon size={14} />
                          </button>
                        ))}
                      </div>
                      <textarea
                        ref={descTextareaRef}
                        autoFocus
                        value={descValue}
                        onChange={(e) => setDescValue(e.target.value)}
                        onBlur={() => {
                          if (descValue !== latestCard.description) {
                            updateCard({ description: descValue });
                          }
                          setEditingDesc(false);
                        }}
                        className="input min-h-[160px] resize-y font-mono text-xs leading-relaxed"
                        placeholder={t('card.desc.placeholder')}
                      />
                    </div>
                  ) : latestCard.description ? (
                    <div
                      onClick={() => setEditingDesc(true)}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 cursor-text hover:border-[#007AFF]/50 transition-colors"
                    >
                      <div className="markdown-body text-slate-700 dark:text-slate-200">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {latestCard.description}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingDesc(true)}
                      className="w-full text-left p-4 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-[#007AFF]/50 hover:bg-blue-50/30 dark:hover:bg-sky-950/20 transition-all text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      + {lang === 'zh' ? '添加更详细的描述...（支持 Markdown）' : 'Add a more detailed description… (Markdown supported)'}
                    </button>
                  )}
                </section>

                {/* Attachments */}
                <section className={cn(activeTab !== 'attachments' && 'hidden md:block')}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Paperclip size={16} className="text-slate-500" />
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('card.attachments')}</h3>
                      {latestCard.attachments.length > 0 && (
                        <span className="text-xs text-slate-400">({latestCard.attachments.length})</span>
                      )}
                    </div>
                    <label className="btn-secondary text-xs py-1 cursor-pointer">
                      <Upload size={14} />
                      {lang === 'zh' ? '上传' : 'Upload'}
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = () => {
                            const url = reader.result as string;
                            broadcastChange({
                              type: 'ADD_ATTACHMENT',
                              payload: {
                                cardId: latestCard.id,
                                attachment: {
                                  name: file.name,
                                  size: file.size,
                                  type: file.type,
                                  url,
                                },
                              },
                            });
                          };
                          reader.readAsDataURL(file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {latestCard.coverImage && (
                    <div className="mb-3 relative rounded-lg overflow-hidden">
                      <img src={latestCard.coverImage} alt="Cover" className="w-full h-24 object-cover rounded-lg" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                      <button
                        onClick={() => broadcastChange({
                          type: 'SET_COVER_IMAGE',
                          payload: { cardId: latestCard.id, url: null },
                        })}
                        className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white text-xs hover:bg-black/70 transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}

                  {latestCard.attachments.length === 0 ? (
                    <div className="p-6 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-center gap-2">
                      <Image size={28} className="text-slate-300 dark:text-slate-600" />
                      <p className="text-xs text-slate-400">{t('card.attach.add')}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {latestCard.attachments.map((att: Attachment) => (
                        <div key={att.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex items-start gap-3 group hover:border-sky-300 transition-colors">
                          <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0 overflow-hidden">
                            {att.type.startsWith('image/') && att.url ? (
                              <img src={att.url} alt="" className="w-full h-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
                            ) : att.type.startsWith('image/') ? (
                              <Image size={18} className="text-slate-500" />
                            ) : (
                              <FileText size={18} className="text-slate-500" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <a
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate block hover:text-[#007AFF] dark:hover:text-[#007AFF]"
                            >
                              {att.name}
                            </a>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {formatFileSize(att.size)} · {relativeTime(att.uploadedAt)}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                            {att.type.startsWith('image/') && (
                              <button
                                onClick={() => broadcastChange({
                                  type: 'SET_COVER_IMAGE',
                                  payload: { cardId: latestCard.id, url: att.url },
                                })}
                                className="p-1 rounded text-slate-400 hover:text-[#007AFF] hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                                title={lang === 'zh' ? '设为封面' : 'Set as cover'}
                              >
                                <CreditCard size={12} />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (confirm(lang === 'zh' ? '删除此附件？' : 'Delete this attachment?')) {
                                  broadcastChange({
                                    type: 'DELETE_ATTACHMENT',
                                    payload: { cardId: latestCard.id, attachmentId: att.id },
                                  });
                                }
                              }}
                              className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                              title={lang === 'zh' ? '删除' : 'Delete'}
                            >
                              <Trash size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Labels (mobile accessible) */}
                <section className={cn(activeTab !== 'labels' && 'hidden md:block')}>
                  <div className="flex items-center gap-2 mb-2">
                    <Tags size={16} className="text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('card.labels')}</h3>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {board.labels.map((l: Label) => (
                      <button
                        key={l.id}
                        onClick={() => updateCard({ labels: latestCard.labels.includes(l.id) ? latestCard.labels.filter((lid: string) => lid !== l.id) : [...latestCard.labels, l.id] })}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-medium transition-all border-2',
                          latestCard.labels.includes(l.id) ? 'border-current shadow-sm' : 'border-transparent opacity-70 hover:opacity-100'
                        )}
                        style={{ backgroundColor: l.color + '22', color: l.color, borderColor: latestCard.labels.includes(l.id) ? l.color : 'transparent' }}
                      >
                        {l.name}
                      </button>
                    ))}
                    <button onClick={() => setManageLabelsMode(true)} className="px-2 py-1.5 rounded-full text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border border-dashed border-slate-300 dark:border-slate-600 hover:border-slate-400">
                      + {lang === 'zh' ? '管理' : 'Manage'}
                    </button>
                  </div>
                </section>

                {/* Members (mobile accessible) */}
                <section className={cn(activeTab !== 'members' && 'hidden md:block')}>
                  <div className="flex items-center gap-2 mb-2">
                    <Users size={16} className="text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('card.members')}</h3>
                  </div>
                  <div className="space-y-1.5">
                    {users.map((u: User) => {
                      const assigned = assignees.some((a: User) => a.id === u.id);
                      return (
                        <button
                          key={u.id}
                          onClick={() => updateCard({ assignees: assigned ? latestCard.assignees.filter((id: string) => id !== u.id) : [...latestCard.assignees, u.id] })}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-xs',
                            assigned ? 'bg-blue-50 dark:bg-sky-950/20 border-[#007AFF]/30' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                          )}
                        >
                          <Avatar user={u} size="sm" />
                          <span className="flex-1 text-left text-slate-700 dark:text-slate-200">{u.name}</span>
                          {assigned && <Check size={14} className="text-[#007AFF]" />}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Due Date (mobile accessible) */}
                <section className={cn(activeTab !== 'duedate' && 'hidden md:block')}>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar size={16} className="text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('card.dueDate')}</h3>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[11px] text-slate-500 font-medium mb-0.5 block">{lang === 'zh' ? '开始日期' : 'Start date'}</label>
                      <input
                        type="date"
                        value={startDateValue}
                        onChange={(e) => setStartDateValue(e.target.value)}
                        onBlur={(e) => {
                          const val = e.target.value;
                          if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                            updateCard({ startDate: new Date(val).toISOString() });
                          } else if (!val) {
                            updateCard({ startDate: undefined });
                          }
                        }}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400/50"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 font-medium mb-0.5 block">{t('card.dueDate')}</label>
                      <input
                        type="date"
                        value={dueDateValue}
                        onChange={(e) => setDueDateValue(e.target.value)}
                        onBlur={(e) => {
                          const val = e.target.value;
                          if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                            updateCard({ dueDate: new Date(val + 'T23:59:59').toISOString() });
                          } else if (!val) {
                            updateCard({ dueDate: undefined });
                          }
                        }}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400/50"
                      />
                    </div>
                    {latestCard.dueDate && (
                      <button onClick={() => { setDueDateValue(''); setStartDateValue(''); updateCard({ dueDate: undefined, startDate: undefined }); }}
                        className="btn-ghost text-xs py-1.5 w-full">
                        {t('card.clearDue')}
                      </button>
                    )}
                  </div>
                </section>

                {/* Activity / Comments */}
                <section className={cn(activeTab !== 'activity' && 'hidden md:block')}>
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare size={16} className="text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{lang === 'zh' ? '活动与评论' : 'Activity & Comments'}</h3>
                  </div>

                  {currentUser && (
                    <div className="flex items-start gap-3 mb-4">
                      <Avatar user={currentUser} size="sm" />
                      <div className="flex-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <textarea
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddComment();
                          }}
                          placeholder={t('card.comments.placeholder')}
                          className="w-full bg-transparent px-3.5 py-2.5 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 resize-none focus:outline-none min-h-[60px] rounded-xl"
                        />
                        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-750">
                          <span className="text-[10px] text-slate-400">{lang === 'zh' ? '支持 Markdown' : 'Markdown supported'}</span>
                          <button
                            onClick={handleAddComment}
                            disabled={!commentText.trim()}
                            className="btn-primary text-xs py-1 disabled:opacity-40"
                          >
                            <Send size={12} />
                            {t('card.comments.send')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    {latestCard.comments.length === 0 && (
                      <div className="py-8 text-center text-xs text-slate-400">
                        {t('card.comments.empty')}
                      </div>
                    )}
                    {[...latestCard.comments].reverse().map((comment: Comment) => {
                      const user = users.find((u: User) => u.id === comment.userId);
                      return (
                        <div key={comment.id} className="flex items-start gap-3 group">
                          <Avatar user={user} size="sm" />
                          <div className="flex-1">
                            <div className="flex items-baseline gap-2 mb-0.5">
                              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {user?.name || (lang === 'zh' ? '未知用户' : 'Unknown user')}
                              </span>
                              <span className="text-[11px] text-slate-400" title={formatDateTime(comment.createdAt)}>
                                {relativeTime(comment.createdAt)}
                              </span>
                            </div>
                            <div className="bg-white dark:bg-slate-800 rounded-xl rounded-tl-sm border border-slate-200 dark:border-slate-700 px-3.5 py-2.5">
                              <div className="markdown-body text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
                                {comment.text}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              {/* Sidebar Actions */}
              <aside className="hidden md:block space-y-4">
                <div className="space-y-1.5">
                  <h4 className="text-[11px] font-semibold uppercase text-slate-400 dark:text-slate-500 tracking-wider px-1 mb-1">
                    {lang === 'zh' ? '添加到卡片' : 'Add to card'}
                  </h4>

                  <button
                    onClick={() => setShowLabels(!showLabels)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 hover:border-[#007AFF]/40 hover:shadow-sm transition-all group"
                  >
                    <Tags size={15} className="text-slate-500 group-hover:text-[#007AFF]" />
                    <span className="flex-1 text-left">{t('card.labels')}</span>
                    <ChevronDown size={14} className={cn('text-slate-400 transition-transform', showLabels && 'rotate-180')} />
                  </button>

                  {showLabels && (
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 animate-slide-up space-y-3">
                      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100 dark:border-slate-700">
                        <span className="text-[11px] font-semibold uppercase text-slate-400 tracking-wider">
                          {manageLabelsMode ? (lang === 'zh' ? '🏷️ 管理自定义标签' : '🏷️ Manage custom labels') : (lang === 'zh' ? '📌 为卡片分配标签' : '📌 Assign labels to card')}
                        </span>
                        <button
                          onClick={() => setManageLabelsMode(v => !v)}
                          className="text-[11px] px-2 py-0.5 rounded-full text-[#007AFF] dark:text-[#007AFF] hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors"
                        >
                          {manageLabelsMode ? (lang === 'zh' ? '← 返回分配' : '← Back to assign') : (lang === 'zh' ? '管理标签' : 'Manage labels')}
                        </button>
                      </div>

                      {!manageLabelsMode ? (
                        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                          {board.labels.map((label: Label) => {
                            const active = latestCard.labels.includes(label.id);
                            return (
                              <button
                                key={label.id}
                                onClick={() => broadcastChange({
                                  type: 'TOGGLE_CARD_LABEL',
                                  payload: { cardId: latestCard.id, labelId: label.id },
                                })}
                                className={cn(
                                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all',
                                  active ? 'bg-slate-100 dark:bg-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                )}
                              >
                                <div
                                  className="w-16 h-4 rounded-sm shrink-0"
                                  style={{ backgroundColor: label.color }}
                                />
                                <span className="text-xs text-slate-700 dark:text-slate-200 flex-1 text-left">
                                  {label.name}
                                </span>
                                {active && <Check size={14} className="text-emerald-500" />}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <LabelManager
                          labels={board.labels}
                          onAdd={(label) => broadcastChange({ type: 'ADD_LABEL', payload: { label } })}
                          onUpdate={(labelId, updates) => broadcastChange({ type: 'UPDATE_LABEL', payload: { labelId, updates } })}
                          onDelete={(labelId) => broadcastChange({ type: 'DELETE_LABEL', payload: { labelId } })}
                          defaultName={newLabelName}
                          setDefaultName={setNewLabelName}
                          defaultColor={newLabelColor}
                          setDefaultColor={setNewLabelColor}
                        />
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => setShowMembers(!showMembers)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 hover:border-[#007AFF]/40 hover:shadow-sm transition-all group"
                  >
                    <Users size={15} className="text-slate-500 group-hover:text-[#007AFF]" />
                    <span className="flex-1 text-left">{t('card.members')}</span>
                    <ChevronDown size={14} className={cn('text-slate-400 transition-transform', showMembers && 'rotate-180')} />
                  </button>

                  {showMembers && (
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 animate-slide-up">
                      <div className="space-y-1.5">
                        {users.map((user: User) => {
                          const active = latestCard.assignees.includes(user.id);
                          return (
                            <button
                              key={user.id}
                              onClick={() => broadcastChange({
                                type: 'TOGGLE_CARD_ASSIGNEE',
                                payload: { cardId: latestCard.id, userId: user.id },
                              })}
                              className={cn(
                                'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-all',
                                active ? 'bg-slate-100 dark:bg-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                              )}
                            >
                              <Avatar user={user} size="sm" />
                              <span className="text-xs text-slate-700 dark:text-slate-200 flex-1 text-left">
                                {user.name}
                              </span>
                              {active && <Check size={14} className="text-emerald-500" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 hover:border-[#007AFF]/40 hover:shadow-sm transition-all group"
                    onClick={() => setShowDueDate(!showDueDate)}
                  >
                    <Calendar size={15} className="text-slate-500 group-hover:text-[#007AFF]" />
                    <span className="flex-1 text-left">{t('card.dueDate')}</span>
                    {dueStatus && (
                      <span className={cn('w-2 h-2 rounded-full', dueStatus.color)} />
                    )}
                  </button>

                  {showDueDate && (
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2 animate-slide-up">
                      <div>
                        <label className="text-[11px] text-slate-500 font-medium mb-0.5 block">{lang === 'zh' ? '开始日期' : 'Start date'}</label>
                        <input
                          type="date"
                          value={startDateValue}
                          onChange={(e) => setStartDateValue(e.target.value)}
                          onBlur={(e) => {
                            const val = e.target.value;
                            if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                              updateCard({ startDate: new Date(val).toISOString() });
                            } else if (!val) {
                              updateCard({ startDate: undefined });
                            }
                          }}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400/50"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500 font-medium mb-0.5 block">{t('card.dueDate')}</label>
                        <input
                          type="date"
                          value={dueDateValue}
                          onChange={(e) => setDueDateValue(e.target.value)}
                          onBlur={(e) => {
                            const val = e.target.value;
                            if (val && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
                              updateCard({ dueDate: new Date(val + 'T23:59:59').toISOString() });
                            } else if (!val) {
                              updateCard({ dueDate: undefined });
                            }
                          }}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400/50"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        {latestCard.dueDate && (
                          <button
                            onClick={() => {
                              setDueDateValue('');
                              setStartDateValue('');
                              updateCard({ dueDate: undefined, startDate: undefined });
                              setShowDueDate(false);
                            }}
                            className="btn-ghost text-xs py-1.5"
                          >
                            {t('card.clearDue')}
                          </button>
                        )}
                        <button
                          onClick={() => setShowDueDate(false)}
                          className="btn-primary text-xs py-1.5 ml-auto"
                        >
                          {lang === 'zh' ? '完成' : 'Done'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Meta */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5 text-[11px] text-slate-500">
                  <div className="flex items-center justify-between">
                    <span>{t('table.created')}</span>
                    <span title={formatDateTime(latestCard.createdAt)}>{relativeTime(latestCard.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('table.updated')}</span>
                    <span title={formatDateTime(latestCard.updatedAt)}>{relativeTime(latestCard.updatedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{lang === 'zh' ? '卡片ID' : 'Card ID'}</span>
                    <span className="font-mono text-[10px]">{latestCard.id.slice(0, 12)}</span>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
