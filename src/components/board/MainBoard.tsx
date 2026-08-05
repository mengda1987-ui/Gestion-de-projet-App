'use client';

import { useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { Avatar, AvatarStack } from '@/components/ui/Avatar';
import UserProfileModal from '@/components/ui/UserProfileModal';
import {
  LayoutGrid,
  List,
  BarChart3,
  Search,
  Moon,
  Sun,
  LogOut,
  ChevronDown,
  X,
  Filter,
  Tag,
  Users,
  LayoutDashboard,
  UserCircle2,
  Network,
  Languages,
  Menu,
  ArrowLeft,
  Archive,
  Image,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ViewMode } from '@/types';
import BoardView from './BoardView';
import TableView from './TableView';
import GanttView from './GanttView';
import MindMapView from './MindMapView';
import BackgroundPicker from '@/components/ui/BackgroundPicker';

export default function MainBoard() {
  const {
    board,
    currentUser,
    users,
    onlineUsers,
    viewMode,
    dispatch,
    darkMode,
    filters,
  } = useBoard();
  const { lang, toggleLang, t } = useLang();

  const [searchFocused, setSearchFocused] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAppMenu, setShowAppMenu] = useState(false);
  const [showBoardBgPicker, setShowBoardBgPicker] = useState(false);
  const [showArchivePanel, setShowArchivePanel] = useState(false);

  const viewOptions = useMemo<{ id: ViewMode; label: string; icon: typeof LayoutGrid }[]>(() => [
    { id: 'board', label: t('nav.kanban'), icon: LayoutDashboard },
    { id: 'table', label: t('nav.table'), icon: List },
    { id: 'gantt', label: t('nav.gantt'), icon: BarChart3 },
    { id: 'mindmap', label: t('nav.mindmap'), icon: Network },
  ], [t]);

  const handleLogout = () => {
    dispatch({ type: 'SET_CURRENT_USER', payload: null });
  };

  // Compute the background CSS style
  const getBgStyle = (bg: string): React.CSSProperties => {
    if (bg.startsWith('url(') || bg.startsWith('data:')) {
      return {
        backgroundImage: bg,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    }
    if (bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient')) {
      return { background: bg };
    }
    return { backgroundColor: bg };
  };

  const goToWorkspace = useCallback(() => {
    dispatch({ type: 'SET_CURRENT_BOARD', payload: '' });
  }, [dispatch]);

  // Keyboard shortcut: Esc or B to go back to workspace (when no modal open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      // Only go back if not typing in an input and no modals are open
      if (isInput) return;
      if (showAppMenu || showUserMenu || showFilterMenu || showProfile || showBoardBgPicker || showArchivePanel) return;
      if (e.key === 'Escape' || (e.key === 'b' && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        goToWorkspace();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showAppMenu, showUserMenu, showFilterMenu, showProfile, showBoardBgPicker, showArchivePanel, goToWorkspace]);

  // Browser back/forward button support: push history state on mount, go back on popstate
  useEffect(() => {
    // Push a state when entering a board so browser back can return to workspace
    const boardId = board?.id || 'board';
    if (!history.state?.boardId) {
      history.pushState({ boardId }, '', `#${boardId}`);
    }
    const handlePopState = () => {
      goToWorkspace();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [board?.id, goToWorkspace]);

  const filteredColumnCount = board.columns.filter(c => !c.archived || filters.showArchived).length;
  const totalCardCount = board.columns.reduce(
    (sum, col) => sum + col.cards.filter(c => !c.archived || filters.showArchived).length,
    0
  );
  const totalItemCount = board.columns.reduce(
    (sum, col) => sum + col.cards.reduce(
      (s, c) => s + c.checklists.reduce((cc, cl) => cc + cl.items.length, 0),
      0
    ),
    0
  );

  const archivedColumns = useMemo(() => board.columns.filter(c => c.archived), [board.columns]);
  const archivedCards = useMemo(() => {
    const cards: Array<{ card: typeof board.columns[number]['cards'][number]; columnTitle: string }> = [];
    board.columns.forEach(col => {
      col.cards.forEach(card => {
        if (card.archived) cards.push({ card, columnTitle: col.title });
      });
    });
    return cards;
  }, [board.columns]);
  const totalArchived = archivedColumns.length + archivedCards.length;

  return (
    <div className="h-dvh flex flex-col" style={getBgStyle(board.background)}>
      {/* Top Header */}
      <header className="glass border-b border-slate-200/60 dark:border-slate-700/50 shrink-0 relative z-[9000]">
        <div className="flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-4 py-2">
          {/* Back to Workspace — always visible */}
          <button
            onClick={goToWorkspace}
            className="p-2 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-200 shrink-0"
            title={t('home.backToHome')}
          >
            <ArrowLeft size={18} />
          </button>

          {/* Hamburger Menu Button */}
          <button
            onClick={() => setShowAppMenu(true)}
            className="p-2 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-200 shrink-0"
            title={t('nav.menu')}
          >
            <Menu size={18} />
          </button>

          {/* Search Bar */}
          <div className="relative flex-1 sm:flex-none min-w-0">
            <div className={cn(
              'flex items-center gap-1.5 rounded-lg transition-all duration-200',
              'bg-white/90 dark:bg-slate-800/90 backdrop-blur',
              searchFocused ? 'ring-2 ring-[#007AFF]/30' : ''
            )}>
              <Search size={14} className="ml-2 text-slate-500 shrink-0" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => dispatch({ type: 'SET_FILTERS', payload: { search: e.target.value } })}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder={t('nav.searchPlaceholder')}
                className="w-full sm:w-36 md:w-44 lg:w-56 bg-transparent py-1.5 pr-2 text-xs sm:text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none"
              />
              {filters.search && (
                <button
                  onClick={() => dispatch({ type: 'SET_FILTERS', payload: { search: '' } })}
                  className="mr-1.5 text-slate-500 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                >
                  <X size={13} />
                </button>
              )}
          </div>
          </div>

          {/* View Toggle — icon only, label on lg+ */}
          <div className="flex items-center bg-white/90 dark:bg-slate-800/90 backdrop-blur rounded-full p-0.5 shrink-0 ring-1 ring-slate-200/50 dark:ring-slate-700/50">
            {viewOptions.map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: id })}
                className={cn(
                  'flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200',
                  viewMode === id
                    ? 'bg-[#007AFF] text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                )}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>

          {/* Filter Button */}
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className={cn(
              'relative p-2 rounded-full hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-200 shrink-0 transition-all',
              (filters.labels.length > 0 || filters.assignees.length > 0) && 'bg-slate-100 dark:bg-white/20'
            )}
          >
            <Filter size={16} />
            {(filters.labels.length > 0 || filters.assignees.length > 0) && (
              <span className="absolute -top-0.5 -right-0.5 bg-[#007AFF] text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center">
                {filters.labels.length + filters.assignees.length}
              </span>
            )}
          </button>

          {/* Current User Avatar */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-0.5 hover:bg-slate-200/60 dark:hover:bg-white/10 rounded-full p-0.5 pr-1.5 transition-colors"
            >
              <Avatar user={currentUser!} size="sm" className="ring-2 ring-slate-200/60 dark:ring-white/40" />
            <ChevronDown size={12} className="text-slate-500 dark:text-slate-200 hidden sm:block" />
          </button>

            {showUserMenu && (
              <div
                className="absolute right-0 top-full mt-1.5 w-64 glass rounded-xl shadow-2xl overflow-hidden animate-slide-up z-[9500]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 border-b border-slate-200/60 dark:border-slate-700/50 bg-white/60 dark:bg-slate-800/60">
                  <div className="flex items-center gap-3">
                    <Avatar user={currentUser!} size="lg" />
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {currentUser?.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {currentUser?.email}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="py-1 bg-white/80 dark:bg-slate-900/80">
                  <button
                    onClick={() => {
                      setShowProfile(true);
                      setShowUserMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <UserCircle2 size={16} />
                    {t('user.editProfile')}
                  </button>
                  <div className="border-t border-slate-200 dark:border-slate-700/60 my-1" />
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                  >
                    <LogOut size={16} />
                    {t('user.logout')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ===== Hamburger Slide-out Menu ===== */}
      {showAppMenu && createPortal(
        <div className="fixed inset-0 z-[99999] flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAppMenu(false)} />
          {/* Panel */}
          <div className="relative w-72 max-w-[85vw] h-full glass border-r border-slate-200/50 dark:border-slate-700/50 shadow-2xl animate-fade-in flex flex-col">
            {/* Panel Header — Board Info */}
            <div className="p-5 border-b border-slate-200/50 dark:border-slate-700/50">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">✨</span>
                <h2 className="font-bold text-slate-800 dark:text-white text-base truncate">{board.title}</h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-white/60">
                {t('board.stats', { cols: filteredColumnCount, cards: totalCardCount, items: totalItemCount })}
              </p>
              {/* Online Users */}
              <div className="mt-3">
                <AvatarStack
                  users={users.filter(u => onlineUsers.includes(u.id))}
                  max={6}
                  size="sm"
                  onlineUsers={onlineUsers}
                />
              </div>
            </div>

            {/* Menu Items */}
            <div className="flex-1 overflow-y-auto py-3">
              {/* Back to Workspace */}
              <button
                onClick={() => { dispatch({ type: 'SET_CURRENT_BOARD', payload: '' }); setShowAppMenu(false); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"
              >
                <ArrowLeft size={18} className="text-slate-500 dark:text-white/70" />
                <span>{t('home.backToHome')}</span>
                <kbd className="ml-auto text-[10px] font-mono text-slate-500 dark:text-white/50 bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded">Esc</kbd>
              </button>

              <div className="mx-5 my-2 border-t border-slate-200/50 dark:border-slate-700/50" />

              {/* Dark Mode */}
              <button
                onClick={() => dispatch({ type: 'TOGGLE_DARK_MODE' })}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"
              >
                {darkMode ? <Sun size={18} className="text-amber-500" /> : <Moon size={18} className="text-slate-500 dark:text-slate-300" />}
                <span>{darkMode ? t('nav.lightMode') : t('nav.darkMode')}</span>
              </button>

              {/* Language */}
              <button
                onClick={toggleLang}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"
              >
                <Languages size={18} className="text-slate-500 dark:text-white/70" />
                <span>{t('nav.language')}</span>
                <span className="ml-auto text-xs font-semibold text-slate-500 dark:text-white/60">{lang === 'zh' ? 'EN' : '中'}</span>
              </button>

              {/* Change Background (admin only) */}
              {currentUser?.role === 'admin' && (
                <button
                  onClick={() => { setShowBoardBgPicker(true); setShowAppMenu(false); }}
                  className="w-full flex items-center gap-3 px-5 py-3 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"
                >
                  <Image size={18} className="text-slate-500 dark:text-white/70" />
                  <span>{lang === 'zh' ? '更换看板背景' : 'Change board background'}</span>
                </button>
              )}

              {/* Archiver Items */}
              <button
                onClick={() => { setShowArchivePanel(true); setShowAppMenu(false); }}
                className="w-full flex items-center gap-3 px-5 py-3 text-sm text-slate-700 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/10 rounded-full transition-colors"
              >
                <Archive size={18} className="text-slate-500 dark:text-white/70" />
                <span>{lang === 'zh' ? '归档内容' : 'Archived Items'}</span>
                {totalArchived > 0 && (
                  <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                    {totalArchived}
                  </span>
                )}
              </button>
            </div>

            {/* Close button */}
            <div className="p-4 border-t border-slate-200/50 dark:border-slate-700/50">
              <button
                onClick={() => setShowAppMenu(false)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-slate-700 dark:text-white text-sm font-medium transition-colors"
              >
                <X size={16} />
                <span>{lang === 'zh' ? '关闭菜单' : 'Close menu'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Filter Panel */}
      {showFilterMenu && (
        <div className="glass border-b border-slate-200/60 dark:border-slate-700/50 px-4 py-3 animate-fade-in shrink-0 relative z-[8900]">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold text-slate-600 dark:text-white/90">
                <Tag size={12} />
                {lang === 'zh' ? '按标签筛选' : 'Filter by labels'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {board.labels.map(label => {
                  const active = filters.labels.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      onClick={() => {
                        const newLabels = active
                          ? filters.labels.filter(l => l !== label.id)
                          : [...filters.labels, label.id];
                        dispatch({ type: 'SET_FILTERS', payload: { labels: newLabels } });
                      }}
                      className={cn(
                        'px-2 py-1 rounded text-xs font-medium text-white transition-all',
                        active ? 'ring-2 ring-white shadow-md scale-105' : 'opacity-80 hover:opacity-100'
                      )}
                      style={{ backgroundColor: label.color }}
                    >
                      {active && '✓ '}
                      {label.name}
                    </button>
                  );
                })}
                {filters.labels.length > 0 && (
                  <button
                    onClick={() => dispatch({ type: 'SET_FILTERS', payload: { labels: [] } })}
                    className="px-2 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-white/15 text-slate-600 dark:text-white/80 hover:bg-slate-200 dark:hover:bg-white/25"
                  >
                    {lang === 'zh' ? '清除' : 'Clear'}
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold text-slate-600 dark:text-white/90">
                <Users size={12} />
                {lang === 'zh' ? '按负责人筛选' : 'Filter by assignees'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {users.map(user => {
                  const active = filters.assignees.includes(user.id);
                  return (
                    <button
                      key={user.id}
                      onClick={() => {
                        const newAs = active
                          ? filters.assignees.filter(u => u !== user.id)
                          : [...filters.assignees, user.id];
                        dispatch({ type: 'SET_FILTERS', payload: { assignees: newAs } });
                      }}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all',
                        active
                          ? 'bg-[#007AFF] text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-white/15 text-slate-600 dark:text-white/80 hover:bg-slate-200 dark:hover:bg-white/25'
                      )}
                    >
                      <Avatar user={user} size="sm" />
                      {user.name}
                    </button>
                  );
                })}
                {filters.assignees.length > 0 && (
                  <button
                    onClick={() => dispatch({ type: 'SET_FILTERS', payload: { assignees: [] } })}
                    className="px-2 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-white/15 text-slate-600 dark:text-white/80 hover:bg-slate-200 dark:hover:bg-white/25"
                  >
                    {lang === 'zh' ? '清除' : 'Clear'}
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-end gap-3 shrink-0">
              <label className="flex items-center gap-2 text-slate-600 dark:text-white/80 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.showArchived}
                  onChange={(e) => dispatch({ type: 'SET_FILTERS', payload: { showArchived: e.target.checked } })}
                  className="rounded text-sky-500 focus:ring-sky-400"
                />
                <Archive size={14} />
                {lang === 'zh' ? '显示已归档' : 'Show archived'}
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden relative">
        {viewMode === 'board' && <BoardView />}
        {viewMode === 'table' && <TableView />}
        {viewMode === 'gantt' && <GanttView />}
        {viewMode === 'mindmap' && <MindMapView />}
      </main>

      {showProfile && (
        <UserProfileModal onClose={() => setShowProfile(false)} />
      )}

      {/* Board Background Picker */}
      {showBoardBgPicker && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowBoardBgPicker(false)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-lg">
                {lang === 'zh' ? '看板背景设置' : 'Board background'}
              </h3>
              <button
                onClick={() => setShowBoardBgPicker(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <BackgroundPicker
              current={board.background}
              defaultBg="#f5f5f7"
              onSelect={(bg) => dispatch({ type: 'UPDATE_BOARD', payload: { background: bg } })}
              onClose={() => setShowBoardBgPicker(false)}
            />
          </div>
        </div>,
        document.body
      )}

      {/* Archive Panel */}
      {showArchivePanel && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowArchivePanel(false)} />
          <div className="relative w-full max-w-md apple-card p-6 animate-slide-up max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div className="flex items-center gap-2">
                <Archive size={20} className="text-amber-500" />
                <h3 className="font-bold text-slate-900 text-lg">
                  {lang === 'zh' ? '归档内容' : 'Archived Items'}
                </h3>
              </div>
              <button
                onClick={() => setShowArchivePanel(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto -mx-2 px-2">
              {totalArchived === 0 ? (
                <div className="text-center py-12">
                  <Archive size={40} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
                  <p className="text-slate-500 text-sm">
                    {lang === 'zh' ? '暂无归档内容' : 'No archived items'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Archived Columns */}
                  {archivedColumns.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-2">
                        {lang === 'zh' ? '已归档列表' : 'Archived Lists'} ({archivedColumns.length})
                      </div>
                      <div className="space-y-1.5">
                        {archivedColumns.map(col => (
                          <div
                            key={col.id}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                {col.title}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                {col.cards.length} {lang === 'zh' ? '张卡片' : 'cards'}
                              </div>
                            </div>
                            <button
                              onClick={() => dispatch({ type: 'ARCHIVE_COLUMN', payload: { columnId: col.id } })}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                            >
                              <Undo2 size={12} />
                              {lang === 'zh' ? '恢复' : 'Restore'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Archived Cards */}
                  {archivedCards.length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wider mb-2">
                        {lang === 'zh' ? '已归档卡片' : 'Archived Cards'} ({archivedCards.length})
                      </div>
                      <div className="space-y-1.5">
                        {archivedCards.map(({ card, columnTitle }) => (
                          <div
                            key={card.id}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700/50"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                {card.title}
                              </div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {lang === 'zh' ? '列表：' : 'List: '}{columnTitle}
                              </div>
                            </div>
                            <button
                              onClick={() => dispatch({ type: 'ARCHIVE_CARD', payload: { cardId: card.id } })}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                            >
                              <Undo2 size={12} />
                              {lang === 'zh' ? '恢复' : 'Restore'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Version */}
      <span className="fixed bottom-3 right-4 text-[10px] text-white/40 select-none pointer-events-none z-50">v1.1.16</span>
    </div>
  );
}
