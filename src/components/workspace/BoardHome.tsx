'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import type { User } from '@/types';
import {
  Plus,
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
  MoreHorizontal,
  Eye,
  EyeOff,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import MemberManageModal from '@/components/ui/MemberManageModal';
import BackgroundPicker from '@/components/ui/BackgroundPicker';
import { parseISO, isToday } from 'date-fns';

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
  const { boards, currentUser, users, dispatch, broadcastChange, workspaceBackground, logo } = useBoard();
  const { t, lang, toggleLang } = useLang();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [showMemberManage, setShowMemberManage] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [emojiPickerId, setEmojiPickerId] = useState<string | null>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ top: number; left: number } | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [showVisibilityPanel, setShowVisibilityPanel] = useState(false);
  const [uploadingIconBoard, setUploadingIconBoard] = useState<string | null>(null);

  const visibleBoards = boards.filter(b => {
    if (currentUser?.role === 'admin') return true;
    if (!b.visibleTo || b.visibleTo.length === 0) return true;
    return b.visibleTo.includes(currentUser?.id || '');
  });

  const [expandedBoardId, setExpandedBoardId] = useState<string | null>(null);

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const fromBoardId = result.draggableId;
    const toBoardId = visibleBoards[result.destination.index]?.id;
    const fromGlobal = boards.findIndex(b => b.id === fromBoardId);
    const toGlobal = boards.findIndex(b => b.id === toBoardId);
    if (fromGlobal >= 0 && toGlobal >= 0 && fromGlobal !== toGlobal) {
      broadcastChange({ type: 'REORDER_BOARDS', payload: { fromIndex: fromGlobal, toIndex: toGlobal } });
    }
  };

  const bgRef = [...BOARD_BG_GRADIENTS];
  let bgIdx = 0;

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

  useEffect(() => {
    const handler = () => {
      setMenuOpenId(null);
      setMenuPos(null);
      setEmojiPickerId(null);
      setEmojiPickerPos(null);
    };
    if (menuOpenId || emojiPickerId) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [menuOpenId, emojiPickerId]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      alert(lang === 'zh' ? '图片不能超过 2MB' : 'Image must be under 2MB');
      e.target.value = '';
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

  const handleIconImageUpload = (e: React.ChangeEvent<HTMLInputElement>, boardId: string) => {
    const file = e.target.files?.[0];
    if (!file) {
      e.target.value = '';
      return;
    }
    
    // 文件大小检查
    if (file.size > 2 * 1024 * 1024) {
      alert(lang === 'zh' ? '图片不能超过 2MB' : 'Image must be under 2MB');
      e.target.value = '';
      return;
    }
    
    // 文件类型检查
    if (!file.type.startsWith('image/')) {
      alert(lang === 'zh' ? '请选择图片文件' : 'Please select an image file');
      e.target.value = '';
      return;
    }
    
    setUploadingIconBoard(boardId);
    
    const reader = new FileReader();
    reader.onerror = () => {
      alert(lang === 'zh' ? '图片读取失败' : 'Failed to read image');
      setUploadingIconBoard(null);
      e.target.value = '';
    };
    
    reader.onload = (ev) => {
      const img = new window.Image();
      
      img.onerror = () => {
        alert(lang === 'zh' ? '图片加载失败，请选择有效的图片文件' : 'Failed to load image. Please select a valid image file');
        setUploadingIconBoard(null);
        e.target.value = '';
      };
      
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          // 居中裁剪为正方形
          const size = Math.min(img.width, img.height);
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;
          
          // 输出为 128x128，使用高质量缩放
          canvas.width = 128;
          canvas.height = 128;
          const ctx = canvas.getContext('2d', { alpha: true });
          
          if (!ctx) {
            alert(lang === 'zh' ? '浏览器不支持图片处理' : 'Browser does not support image processing');
            setUploadingIconBoard(null);
            e.target.value = '';
            return;
          }
          
          // 启用高质量缩放
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // 绘制图片
          ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
          
          // 转换为 PNG 保持透明度，质量 0.9
          const dataUrl = canvas.toDataURL('image/png', 0.9);
          
          // 获取当前看板信息保持其他属性
          const board = boards.find(b => b.id === boardId);
          
          // 更新看板图标
          dispatch({
            type: 'SET_BOARD_ICON',
            payload: { 
              boardId, 
              iconImage: dataUrl, 
              emoji: undefined, 
              iconBg: board?.iconBg 
            },
          });
          
          setUploadingIconBoard(null);
        } catch (err) {
          console.error('Image processing error:', err);
          alert(lang === 'zh' ? '图片处理失败' : 'Failed to process image');
          setUploadingIconBoard(null);
        }
        e.target.value = '';
      };
      
      img.src = ev.target?.result as string;
    };
    
    reader.readAsDataURL(file);
  };

  const handleCreate = () => {
    const title = createTitle.trim();
    if (!title) { return; }
    dispatch({
      type: 'CREATE_BOARD',
      payload: { title, background: BOARD_BG_GRADIENTS[Math.floor(Math.random() * BOARD_BG_GRADIENTS.length)] },
    });
    setCreateTitle('');
    setShowCreate(false);
  };

  const handleDelete = () => {
    if (!deleteTarget) { return; }
    dispatch({ type: 'DELETE_BOARD', payload: deleteTarget });
    setDeleteTarget(null);
  };

  const handleRename = () => {
    if (!renameId || !renameText.trim()) { return; }
    dispatch({ type: 'RENAME_BOARD', payload: { boardId: renameId, title: renameText.trim() } });
    setRenameId(null);
    setRenameText('');
  };

  return (
    <div className="min-h-dvh flex flex-col" style={getBgStyle(workspaceBackground)}>
      <div className="flex-1 backdrop-blur-sm bg-white/50 dark:bg-slate-900/50 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 sm:px-8 py-10 sm:py-14">
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{lang === 'zh' ? '工作区' : 'Workspace'}</h1>
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
                <button onClick={() => setShowMemberManage(true)} className="btn-secondary text-xs">
                  <Users size={14} />
                  <span className="hidden sm:inline">{lang === 'zh' ? '成员管理' : 'Members'}</span>
                </button>
                <button onClick={() => setShowBgPicker(true)} className="btn-secondary text-xs">
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
                <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </>
            )}
            <button onClick={toggleLang} className="px-3 py-2 rounded-full text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-200/60 transition-all">
              {lang === 'zh' ? 'EN' : '中'}
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
              <Plus size={15} />
              <span className="hidden sm:inline">{t('home.createBoard')}</span>
            </button>
          </div>
        </div>

        {/* Board Grid */}
        {visibleBoards.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-5">
              <Sparkles size={28} className="text-slate-400" />
            </div>
            <p className="text-slate-500 text-base mb-5">{lang === 'zh' ? '还没有看板，创建一个吧' : 'No boards yet. Create one!'}</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus size={18} />{t('home.createBoard')}
            </button>
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="board-grid" type="BOARD">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
                >
                  {visibleBoards.map((board, idx) => {
                    const colCount = board.columns.length;
                    const cardCount = board.columns.reduce((s, c) => s + c.cards.length, 0);
                    const completedCount = board.columns.reduce((s, c) => s + c.cards.filter(cd => cd.status === 'complete').length, 0);

                    // Find "urgent" label
                    const urgentLabel = board.labels.find(l =>
                      l.name.toLowerCase() === 'urgent' || l.name === '紧急' || l.name.toLowerCase() === 'urgente'
                    );

                    // Count urgent todo cards and due-today cards
                    let urgentCount = 0;
                    let dueTodayCount = 0;
                    board.columns.forEach(col => {
                      if (col.visibleTo?.length && currentUser?.role !== 'admin' && !col.visibleTo.includes(currentUser?.id ?? '')) return;
                      col.cards.forEach(card => {
                        if (card.status === 'complete' || card.archived) return;
                        if (card.visibleTo?.length && currentUser?.role !== 'admin' && !card.visibleTo.includes(currentUser?.id ?? '')) return;
                        if (urgentLabel && card.labels.includes(urgentLabel.id)) urgentCount++;
                        if (card.dueDate && isToday(parseISO(card.dueDate))) dueTodayCount++;
                      });
                    });

                    const bg = bgRef[(bgIdx++) % bgRef.length];
                    const emojis = ['📋', '🚀', '💡', '🎯', '🔥', '🌟', '💎', '🎨', '⚡', '🛠️', '📦', '🏗️'];
                    const emoji = board.emoji || emojis[board.title.length % emojis.length];
                    return (
                      <Draggable key={board.id} draggableId={board.id} index={idx}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={cn(
                              'group apple-card cursor-pointer overflow-hidden flex flex-col',
                              snapshot.isDragging && 'shadow-2xl opacity-90 scale-[1.02]'
                            )}
                            onClick={() => dispatch({ type: 'SET_CURRENT_BOARD', payload: board.id })}
                          >
                            <div className="h-1.5 w-full shrink-0" style={{ background: board.background || bg }} />
                            <div className="p-4 flex flex-col flex-1">
                              <div className="flex items-start gap-3.5 mb-3">
                                <button
                                  className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-sm hover:scale-110 transition-transform cursor-pointer overflow-hidden"
                                  style={{ background: board.iconBg || board.background || bg }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (emojiPickerId === board.id) {
                                      setEmojiPickerId(null);
                                      setEmojiPickerPos(null);
                                    } else {
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      setEmojiPickerPos({ top: rect.bottom + 4, left: rect.left });
                                      setEmojiPickerId(board.id);
                                    }
                                  }}
                                  title={lang === 'zh' ? '更换图标' : 'Change icon'}
                                >
                                  {board.iconImage ? (
                                    <img src={board.iconImage} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <span>{emoji}</span>
                                  )}
                                </button>
                                <div className="min-w-0 flex-1 pt-0.5">
                                  {renameId === board.id ? (
                                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                      <input
                                        value={renameText}
                                        onChange={(e) => setRenameText(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setRenameId(null); }}
                                        autoFocus
                                        className="flex-1 bg-slate-100 text-slate-800 text-sm font-semibold px-2.5 py-1 rounded-lg border border-slate-300 focus:outline-none focus:border-[#007AFF] placeholder:text-slate-400"
                                        placeholder={t('home.renamePlaceholder')}
                                      />
                                      <button onClick={handleRename} className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700"><Check size={14} /></button>
                                      <button onClick={() => setRenameId(null)} className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700"><X size={14} /></button>
                                    </div>
                                  ) : (
                                    <h3 className="font-bold text-slate-900 text-lg leading-snug line-clamp-2">{board.title}</h3>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                <span className="flex items-center gap-1 text-sm text-slate-600"><LayoutGrid size={13} /><span className="font-semibold text-slate-700">{colCount}</span></span>
                                <span className="flex items-center gap-1 text-sm text-slate-600"><ListTodo size={13} /><span className="font-semibold text-slate-700">{cardCount}</span></span>
                                {completedCount > 0 && (
                                  <span className="flex items-center gap-1 text-sm text-emerald-600 ml-auto"><CheckSquare size={13} /><span className="font-semibold">{completedCount}</span></span>
                                )}
                              </div>

                              <div className="flex-1" />

                              {(urgentCount > 0 || dueTodayCount > 0) && (
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                  {urgentCount > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500 text-white text-[11px] font-semibold shadow-sm">
                                      <AlertTriangle size={10} />
                                      {lang === 'zh' ? `紧急 ${urgentCount}` : `Urgent ${urgentCount}`}
                                    </span>
                                  )}
                                  {dueTodayCount > 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500 text-white text-[11px] font-semibold shadow-sm">
                                      <Clock size={10} />
                                      {lang === 'zh' ? `今天到期 ${dueTodayCount}` : `Due today ${dueTodayCount}`}
                                    </span>
                                  )}
                                </div>
                              )}

                              <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-2">
                                <Clock size={11} />
                                <span>{new Date(board.updatedAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })}</span>
                                <div className="ml-auto">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (menuOpenId === board.id) {
                                        setMenuOpenId(null);
                                        setMenuPos(null);
                                      } else {
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setMenuPos({ top: rect.bottom + 4, left: Math.min(rect.right - 128, window.innerWidth - 144) });
                                        setMenuOpenId(board.id);
                                      }
                                    }}
                                    className="p-0.5 rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                                  >
                                    <MoreHorizontal size={14} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                  {/* Add new board card */}
                  <button
                    onClick={() => setShowCreate(true)}
                    className="rounded-2xl border-2 border-dashed border-slate-300 hover:border-[#007AFF]/40 text-slate-400 hover:text-[#007AFF] transition-all flex flex-col items-center justify-center gap-3 py-14 bg-white/40 hover:bg-white/60"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center"><Plus size={24} /></div>
                    <span className="text-sm font-medium">{t('home.createBoard')}</span>
                  </button>
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      {/* Three-dot menu portal */}
      {menuOpenId && menuPos && createPortal(
        <div className="fixed z-[99999] animate-slide-up" style={{ left: menuPos.left, top: menuPos.top }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="w-32 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 py-1">
            <button
              onClick={() => {
                const board = boards.find(b => b.id === menuOpenId);
                if (board) { setRenameId(board.id); setRenameText(board.title); }
                setMenuOpenId(null); setMenuPos(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            >
              <MoreHorizontal size={13} className="rotate-90" />
              {lang === 'zh' ? '重命名' : 'Rename'}
            </button>
            {currentUser?.role === 'admin' && (
              <button
                onClick={() => {
                  setExpandedBoardId(menuOpenId);
                  setShowVisibilityPanel(true);
                  setMenuOpenId(null); setMenuPos(null);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Eye size={13} />
                {lang === 'zh' ? '可见性' : 'Visibility'}
              </button>
            )}
            <button
              onClick={() => { setDeleteTarget(menuOpenId); setMenuOpenId(null); setMenuPos(null); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={13} />
              {lang === 'zh' ? '删除' : 'Delete'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Icon editor portal */}
      {emojiPickerId && emojiPickerPos && createPortal(
        <div className="fixed z-[99999] animate-slide-up" style={{ left: emojiPickerPos.left, top: emojiPickerPos.top }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="w-64 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 p-3">
            {/* Background color */}
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{lang === 'zh' ? '背景颜色' : 'Background'}</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {['#ef4444','#f97316','#f59e0b','#22c55e','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#ec4899','#78716c','#94a3b8','#1e293b'].map(color => (
                <button
                  key={color}
                  onClick={() => {
                    const b = boards.find(b2 => b2.id === emojiPickerId);
                    dispatch({ type: 'SET_BOARD_ICON', payload: { boardId: emojiPickerId!, iconBg: color, emoji: b?.emoji, iconImage: b?.iconImage } });
                  }}
                  className="w-6 h-6 rounded-full border-2 border-white dark:border-slate-700 shadow-sm hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                />
              ))}
              <button
                onClick={() => {
                  const b = boards.find(b2 => b2.id === emojiPickerId);
                  dispatch({ type: 'SET_BOARD_ICON', payload: { boardId: emojiPickerId!, iconBg: undefined, emoji: b?.emoji, iconImage: b?.iconImage } });
                }}
                className="w-6 h-6 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 hover:scale-110 transition-transform flex items-center justify-center"
              >
                <X size={10} className="text-slate-400" />
              </button>
            </div>

            {/* Emoji grid */}
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{lang === 'zh' ? '图标' : 'Icon'}</p>
            <div className="grid grid-cols-6 gap-1 mb-3">
              {['📋','🚀','💡','🎯','🔥','🌟','💎','🎨','⚡','🛠️','📦','🏗️','💼','📊','🎵','🛒','🏠','🌍'].map(e => (
                <button
                  key={e}
                  onClick={() => {
                    const b = boards.find(b2 => b2.id === emojiPickerId);
                    dispatch({ type: 'SET_BOARD_ICON', payload: { boardId: emojiPickerId!, emoji: e, iconBg: b?.iconBg, iconImage: undefined } });
                    setEmojiPickerId(null);
                    setEmojiPickerPos(null);
                  }}
                  className="w-8 h-8 flex items-center justify-center text-lg rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  {e}
                </button>
              ))}
            </div>

            {/* Upload custom image */}
            <label className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleIconImageUpload(e, emojiPickerId!)}
                className="hidden"
                disabled={uploadingIconBoard === emojiPickerId}
              />
              <Upload size={13} />
              {uploadingIconBoard === emojiPickerId 
                ? (lang === 'zh' ? '上传中...' : 'Uploading...') 
                : (lang === 'zh' ? '上传图片' : 'Upload Image')
              }
            </label>
          </div>
        </div>,
        document.body
      )}

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
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">{lang === 'zh' ? '取消' : 'Cancel'}</button>
              <button
                onClick={handleCreate}
                disabled={!createTitle.trim()}
                className={cn('btn-primary flex-1', !createTitle.trim() && '!bg-slate-300 !shadow-none cursor-not-allowed opacity-50')}
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
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary flex-1">{lang === 'zh' ? '取消' : 'Cancel'}</button>
              <button onClick={handleDelete} className="btn-danger flex-1">{lang === 'zh' ? '删除' : 'Delete'}</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showMemberManage && <MemberManageModal onClose={() => setShowMemberManage(false)} />}

      {/* Admin: Board Visibility Management Panel */}
      {showVisibilityPanel && expandedBoardId && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setShowVisibilityPanel(false); setExpandedBoardId(null); }} />
          <div className="relative w-full max-w-md apple-card overflow-hidden flex flex-col animate-slide-up">
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700 shrink-0">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">{lang === 'zh' ? '看板可见性管理' : 'Board Visibility'}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === 'zh' ? '设置谁可以看到此看板' : 'Set who can see this board'}: 
                  <span className="ml-1 font-semibold text-slate-700">{boards.find(b => b.id === expandedBoardId)?.title}</span>
                </p>
              </div>
              <button onClick={() => { setShowVisibilityPanel(false); setExpandedBoardId(null); }} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {(() => {
                const board = boards.find(b => b.id === expandedBoardId);
                if (!board) return null;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{lang === 'zh' ? '成员访问权限' : 'Member Access'}</span>
                      <button
                        onClick={() => {
                          dispatch({ type: 'UPDATE_BOARD_DATA', payload: { boardId: board.id, updates: { visibleTo: undefined } } });
                        }}
                        className={cn(
                          'text-xs px-3 py-1 rounded-full font-medium transition-all border',
                          !board.visibleTo?.length
                            ? 'bg-[#007AFF] text-white border-[#007AFF]'
                            : 'text-slate-500 border-slate-200 dark:border-slate-700 hover:border-[#007AFF]/50'
                        )}
                      >
                        {lang === 'zh' ? '所有人可见' : 'Public (All)'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {users.map((u: User) => {
                        const isVisible = !board.visibleTo?.length || board.visibleTo?.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            onClick={() => {
                              const current = board.visibleTo || users.map((x: User) => x.id);
                              const next = isVisible
                                ? current.filter((id: string) => id !== u.id)
                                : [...current, u.id];
                              dispatch({
                                type: 'UPDATE_BOARD_DATA',
                                payload: { boardId: board.id, updates: { visibleTo: next.length === users.length ? undefined : next } },
                              });
                            }}
                            className={cn(
                              'flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                              isVisible
                                ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm'
                                : 'bg-slate-50 dark:bg-slate-900/50 border-transparent opacity-60'
                            )}
                          >
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold shrink-0"
                              style={{ backgroundColor: u.color }}
                            >
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{u.name}</div>
                              <div className="text-[10px] text-slate-500 truncate">{u.email}</div>
                            </div>
                            <div className={cn(
                              'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
                              isVisible ? 'bg-[#007AFF] border-[#007AFF]' : 'border-slate-300'
                            )}>
                              {isVisible && <Check size={12} className="text-white" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-end">
              <button
                onClick={() => { setShowVisibilityPanel(false); setExpandedBoardId(null); }}
                className="btn-primary px-6"
              >
                {lang === 'zh' ? '完成' : 'Done'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showBgPicker && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowBgPicker(false)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-lg">
                {lang === 'zh' ? '工作区背景设置' : 'Workspace background'}
              </h3>
              <button onClick={() => setShowBgPicker(false)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
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

      {/* Version */}
      <div className="fixed bottom-3 right-4 text-[11px] text-black font-medium select-none pointer-events-none z-50">
        v1.3.2
      </div>
    </div>
  );
}
