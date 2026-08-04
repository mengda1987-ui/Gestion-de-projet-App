'use client';

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import {
  Plus,
  Pencil,
  Trash2,
  ListTodo,
  X,
  Check,
  Sparkles,
  LayoutGrid,
  CheckSquare,
  Clock,
  Users,
  Image,
  LogOut,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import MemberManageModal from '@/components/ui/MemberManageModal';
import BackgroundPicker from '@/components/ui/BackgroundPicker';

const BOARD_BG_GRADIENTS = [
  'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #14b8a6 100%)',
  'linear-gradient(135deg, #f97316 0%, #ef4444 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
  'linear-gradient(135deg, #22c55e 0%, #10b981 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #fbbf24 100%)',
  'linear-gradient(135deg, #1e293b 0%, #3b82f6 100%)',
  'linear-gradient(135deg, #f472b6 0%, #fb923c 100%)',
  'linear-gradient(135deg, #34d399 0%, #a3e635 100%)',
  'linear-gradient(135deg, #881337 0%, #dc2626 100%)',
  'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #d946ef 100%)',
  'linear-gradient(135deg, #c026d3 0%, #ec4899 100%)',
];

export default function BoardHome() {
  const { boards, currentUser, dispatch, workspaceBackground, logo } = useBoard();
  const { t, lang, toggleLang } = useLang();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [showMemberManage, setShowMemberManage] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const bgRef = [...BOARD_BG_GRADIENTS];
  let bgIdx = 0;

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

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert(lang === 'zh' ? '图片不能超过 2MB' : 'Image must be under 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height, 256);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
        }
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        dispatch({ type: 'UPDATE_LOGO', payload: dataUrl });
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCreate = () => {
    const title = createTitle.trim();
    if (!title) return;
    dispatch({
      type: 'CREATE_BOARD',
      payload: { title, background: BOARD_BG_GRADIENTS[Math.floor(Math.random() * BOARD_BG_GRADIENTS.length)] },
    });
    setCreateTitle('');
    setShowCreate(false);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    dispatch({ type: 'DELETE_BOARD', payload: deleteTarget });
    setDeleteTarget(null);
  };

  const handleRename = () => {
    if (!renameId || !renameText.trim()) return;
    dispatch({ type: 'RENAME_BOARD', payload: { boardId: renameId, title: renameText.trim() } });
    setRenameId(null);
    setRenameText('');
  };

  return (
    <div className="min-h-screen" style={getBgStyle(workspaceBackground)}>
      <div className="min-h-screen backdrop-blur-sm bg-white/50 dark:bg-slate-900/50">
      <div className="max-w-6xl mx-auto px-6 sm:px-8 py-10 sm:py-14">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{t('home.title')}</h1>
            <p className="text-slate-500 text-sm mt-2">{t('home.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => dispatch({ type: 'SET_CURRENT_USER', payload: null })}
              className="btn-secondary text-xs text-slate-500 hover:text-red-500"
              title={lang === 'zh' ? '退出登录' : 'Logout'}
            >
              <LogOut size={14} />
            </button>
            {currentUser?.role === 'admin' && (
              <>
                <button
                  onClick={() => setShowMemberManage(true)}
                  className="btn-secondary text-xs"
                >
                  <Users size={14} />
                  <span className="hidden sm:inline">{lang === 'zh' ? '成员管理' : 'Members'}</span>
                </button>
                <button
                  onClick={() => setShowBgPicker(true)}
                  className="btn-secondary text-xs"
                >
                  <Image size={14} />
                  <span className="hidden sm:inline">{lang === 'zh' ? '背景' : 'Background'}</span>
                </button>
                <button
                  onClick={() => logo ? dispatch({ type: 'UPDATE_LOGO', payload: '' }) : logoInputRef.current?.click()}
                  className="btn-secondary text-xs"
                  title={lang === 'zh' ? '公司 Logo' : 'Company Logo'}
                >
                  {logo ? <Trash2 size={14} /> : <Upload size={14} />}
                  <span className="hidden sm:inline">{logo ? (lang === 'zh' ? '删除Logo' : 'Del Logo') : 'Logo'}</span>
                </button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
              </>
            )}
            <button
              onClick={toggleLang}
              className="px-3 py-2 rounded-full text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-200/60 transition-all"
            >
              {lang === 'zh' ? 'EN' : '中'}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary text-sm"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">{t('home.createBoard')}</span>
            </button>
          </div>
        </div>

        {/* Board Grid */}
        {boards.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-5">
              <Sparkles size={28} className="text-slate-400" />
            </div>
            <p className="text-slate-500 text-base mb-5">{lang === 'zh' ? '还没有看板，创建一个吧' : 'No boards yet. Create one!'}</p>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary"
            >
              <Plus size={18} />
              {t('home.createBoard')}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {boards.map((board) => {
              const colCount = board.columns.length;
              const cardCount = board.columns.reduce((s, c) => s + c.cards.length, 0);
              const completedCount = board.columns.reduce((s, c) => s + c.cards.filter(cd => cd.completed).length, 0);
              const bg = bgRef[(bgIdx++) % bgRef.length];
              const emojis = ['📋', '🚀', '💡', '🎯', '🔥', '🌟', '💎', '🎨', '⚡', '🛠️', '📦', '🏗️'];
              const emoji = emojis[board.title.length % emojis.length];
              return (
                <div
                  key={board.id}
                  className="group apple-card cursor-pointer overflow-hidden"
                  onClick={() => dispatch({ type: 'SET_CURRENT_BOARD', payload: board.id })}
                >
                  {/* Header gradient bar */}
                  <div className="h-1.5 w-full" style={{ background: board.background || bg }} />

                  {/* Content */}
                  <div className="p-5">
                    {/* Title */}
                    <div className="flex items-start gap-3.5 mb-4">
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-sm"
                        style={{ background: board.background || bg }}>
                        <span>{emoji}</span>
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5">
                        {renameId === board.id ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              value={renameText}
                              onChange={(e) => setRenameText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenameId(null); }}
                              placeholder={t('home.renamePlaceholder')}
                              autoFocus
                              className="flex-1 bg-slate-100 text-slate-800 text-sm font-semibold px-2.5 py-1 rounded-lg border border-slate-300 focus:outline-none focus:border-[#007AFF] placeholder:text-slate-400"
                            />
                            <button onClick={handleRename} className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700"><Check size={14} /></button>
                            <button onClick={() => setRenameId(null)} className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700"><X size={14} /></button>
                          </div>
                        ) : (
                          <h3 className="font-bold text-slate-900 text-lg leading-snug line-clamp-2">{board.title}</h3>
                        )}
                      </div>
                    </div>

                    {/* Column preview - mini bars */}
                    <div className="flex gap-1.5 mb-5">
                      {board.columns.slice(0, 6).map((col, i) => (
                        <div
                          key={col.id}
                          className="flex-1 h-1.5 rounded-full"
                          style={{
                            background: board.background || bg,
                            opacity: 0.35 + (i / board.columns.length) * 0.4,
                          }}
                        />
                      ))}
                      {board.columns.length === 0 && (
                        <div className="flex-1 h-1.5 rounded-full bg-slate-200" />
                      )}
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1.5 text-sm text-slate-500">
                        <LayoutGrid size={14} />
                        <span className="font-semibold text-slate-700">{colCount}</span>
                        <span className="text-xs text-slate-400">{lang === 'zh' ? '列表' : 'lists'}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-slate-500">
                        <ListTodo size={14} />
                        <span className="font-semibold text-slate-700">{cardCount}</span>
                        <span className="text-xs text-slate-400">{lang === 'zh' ? '卡片' : 'cards'}</span>
                      </span>
                      {completedCount > 0 && (
                        <span className="flex items-center gap-1.5 text-sm text-emerald-600 ml-auto">
                          <CheckSquare size={14} />
                          <span className="font-semibold">{completedCount}</span>
                        </span>
                      )}
                    </div>

                    {/* Updated time */}
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-2.5">
                      <Clock size={11} />
                      <span>{new Date(board.updatedAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>

                  {/* Hover action buttons */}
                  <div className="absolute top-3.5 right-3.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenameId(board.id);
                        setRenameText(board.title);
                      }}
                      className="p-2 rounded-full bg-white/90 shadow-sm ring-1 ring-slate-200/50 text-slate-500 hover:text-slate-700 hover:bg-white transition-all"
                      title={t('home.renameBoard')}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(board.id);
                      }}
                      className="p-2 rounded-full bg-white/90 shadow-sm ring-1 ring-slate-200/50 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all"
                      title={t('home.deleteBoard')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
            {/* Add new board card */}
            <button
              onClick={() => setShowCreate(true)}
              className="rounded-2xl border-2 border-dashed border-slate-300 hover:border-[#007AFF]/40 text-slate-400 hover:text-[#007AFF] transition-all flex flex-col items-center justify-center gap-3 py-14 bg-white/40 hover:bg-white/60"
            >
              <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
                <Plus size={24} />
              </div>
              <span className="text-sm font-medium">{t('home.createBoard')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Create Board Modal */}
      {showCreate && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up">
            <h3 className="font-bold text-slate-900 text-lg mb-4">{t('home.createBoard')}</h3>
            <input
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder={t('home.renamePlaceholder')}
              autoFocus
              className="input mb-4"
            />
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowCreate(false)}
                className="btn-secondary flex-1"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={handleCreate}
                disabled={!createTitle.trim()}
                className={cn(
                  'btn-primary flex-1',
                  !createTitle.trim() && '!bg-slate-300 !shadow-none cursor-not-allowed opacity-50'
                )}
              >
                {lang === 'zh' ? '创建' : 'Create'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete Confirm */}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up">
            <h3 className="font-bold text-slate-900 text-lg mb-2">{t('home.deleteBoard')}</h3>
            <p className="text-slate-500 text-sm mb-5">
              {t('home.deleteConfirm', { name: boards.find(b => b.id === deleteTarget)?.title || '' })}
            </p>
            <div className="flex gap-2.5">
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary flex-1">
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button onClick={handleDelete} className="btn-danger flex-1">
                {lang === 'zh' ? '删除' : 'Delete'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showMemberManage && <MemberManageModal onClose={() => setShowMemberManage(false)} />}

      {/* Background Picker */}
      {showBgPicker && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowBgPicker(false)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-lg">
                {lang === 'zh' ? '工作区背景设置' : 'Workspace background'}
              </h3>
              <button
                onClick={() => setShowBgPicker(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <BackgroundPicker
              current={workspaceBackground}
              defaultBg="#f5f5f7"
              onSelect={(bg) => dispatch({ type: 'UPDATE_WORKSPACE_BG', payload: bg })}
              onClose={() => setShowBgPicker(false)}
            />
          </div>
        </div>,
        document.body
      )}
      </div>
    </div>
  );
}
