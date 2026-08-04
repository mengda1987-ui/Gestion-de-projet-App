'use client';

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Droppable, Draggable, DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import { Column, Card as CardType } from '@/types';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import CardItem from './CardItem';
import {
  MoreHorizontal,
  Plus,
  GripVertical,
  Trash2,
  Archive,
  Copy,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface BoardColumnProps {
  column: Column;
  isDragging: boolean;
  dragHandleProps?: DraggableProvidedDragHandleProps;
  onCardClick: (cardId: string) => void;
}

export default function BoardColumn({ column, isDragging, dragHandleProps, onCardClick }: BoardColumnProps) {
  const { t, lang } = useLang();
  const { dispatch, broadcastChange } = useBoard();
  const [addingCard, setAddingCard] = useState(false);
  const [newCardTitle, setNewCardTitle] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(column.title);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const handleAddCard = () => {
    if (!newCardTitle.trim()) {
      setAddingCard(false);
      return;
    }
    broadcastChange({
      type: 'ADD_CARD',
      payload: { columnId: column.id, card: { title: newCardTitle.trim() } },
    });
    setNewCardTitle('');
  };

  const handleSaveTitle = () => {
    if (titleValue.trim() && titleValue !== column.title) {
      broadcastChange({
        type: 'UPDATE_COLUMN',
        payload: { columnId: column.id, updates: { title: titleValue.trim() } },
      });
    } else {
      setTitleValue(column.title);
    }
    setEditingTitle(false);
  };

  const cardsCount = column.cards.length;

  return (
    <div
      className={cn(
        'glass rounded-2xl overflow-hidden flex flex-col max-h-[calc(100vh-120px)]',
        isDragging ? 'ring-2 ring-[#007AFF] ring-offset-2' : '',
        column.archived && 'opacity-60'
      )}
    >
      {/* Column Header */}
      <div
        className="flex items-center gap-1 p-2.5 cursor-grab active:cursor-grabbing group"
        {...dragHandleProps}
      >
        <GripVertical size={16} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle();
                if (e.key === 'Escape') {
                  setTitleValue(column.title);
                  setEditingTitle(false);
                }
              }}
              className="w-full font-semibold text-sm input rounded-lg px-1.5 py-0.5 text-slate-800 dark:text-slate-100"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h3
              className="font-semibold text-sm text-slate-800 dark:text-slate-100 whitespace-normal break-words cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded px-1.5 py-0.5 -mx-1.5"
              onDoubleClick={() => setEditingTitle(true)}
              onClick={(e) => e.stopPropagation()}
            >
              {column.title}
              <span className="ml-2 text-xs font-normal text-slate-400">{cardsCount}</span>
            </h3>
          )}
        </div>

        <div className="relative">
          <button
            ref={menuBtnRef}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors shrink-0"
          >
            <MoreHorizontal size={16} />
          </button>

          {showMenu && menuBtnRef.current && createPortal(
            <div
              className="fixed apple-card rounded-xl shadow-xl overflow-hidden z-[99999] animate-slide-up w-44"
              style={{
                left: Math.min(menuBtnRef.current.getBoundingClientRect().right - 176, window.innerWidth - 192),
                top: menuBtnRef.current.getBoundingClientRect().bottom + 4,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  broadcastChange({
                    type: 'ADD_CARD',
                    payload: { columnId: column.id, card: { title: lang === 'zh' ? '新卡片' : 'New card' } },
                  });
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Plus size={14} />
                {t('board.addCard')}
              </button>
              <button
                onClick={() => {
                  broadcastChange({
                    type: 'ARCHIVE_COLUMN',
                    payload: { columnId: column.id },
                  });
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <Archive size={14} />
                {column.archived ? t('board.unarchive') : t('board.archive')}
              </button>
              <button
                onClick={() => {
                  const sampleCard = column.cards[0];
                  if (sampleCard) {
                    broadcastChange({
                      type: 'ADD_CARD',
                      payload: {
                        columnId: column.id,
                        card: {
                          title: sampleCard.title + (lang === 'zh' ? ' (从模板)' : ' (from template)'),
                          description: sampleCard.description,
                          labels: sampleCard.labels,
                          checklists: sampleCard.checklists.map(cl => ({
                            ...cl,
                            id: `tpl-${Date.now()}-${cl.id}`,
                            items: cl.items.map(i => ({ ...i, id: `tpl-${Date.now()}-${i.id}`, completed: false })),
                          })),
                        },
                      },
                    });
                  }
                  setShowMenu(false);
                }}
                disabled={column.cards.length === 0}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
              >
                <Copy size={14} />
                {t('board.template')}
              </button>
              <div className="border-t border-slate-200 dark:border-slate-700" />
              <button
                onClick={() => {
                  if (confirm(t('board.deleteConfirm', { name: column.title }))) {
                    broadcastChange({ type: 'DELETE_COLUMN', payload: { columnId: column.id } });
                  }
                  setShowMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              >
                <Trash2 size={14} />
                {t('board.delete')}
              </button>
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* Cards Container */}
      <Droppable droppableId={column.id} type="DEFAULT">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              'flex-1 overflow-y-auto px-2 pb-2 min-h-[40px]',
              snapshot.isDraggingOver && 'bg-sky-100/60 dark:bg-sky-950/30 rounded-lg mx-1'
            )}
            onClick={() => { setShowMenu(false); }}
          >
            {column.cards.map((card: CardType, index: number) => (
              <Draggable key={card.id} draggableId={card.id} index={index}>
                {(cardProvided, cardSnapshot) => (
                  <div
                    ref={cardProvided.innerRef}
                    {...cardProvided.draggableProps}
                    {...cardProvided.dragHandleProps}
                    className={cn(
                      'mb-2 last:mb-0',
                      cardSnapshot.isDragging && 'shadow-2xl z-50 rotate-1 opacity-90'
                    )}
                    style={{ ...cardProvided.draggableProps.style }}
                  >
                    <CardItem
                      card={card}
                      onClick={() => onCardClick(card.id)}
                      isDragging={cardSnapshot.isDragging}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}

            {/* Add Card */}
            {addingCard ? (
              <div className="mt-2 animate-slide-up">
                <textarea
                  autoFocus
                  value={newCardTitle}
                  onChange={(e) => setNewCardTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleAddCard();
                    }
                    if (e.key === 'Escape') {
                      setAddingCard(false);
                      setNewCardTitle('');
                    }
                  }}
                  placeholder={t('board.placeholder')}
                  className="input resize-none min-h-[60px] mb-2"
                />
                <div className="flex items-center gap-1.5">
                  <button onClick={handleAddCard} className="btn-primary text-xs py-1.5">
                    {t('board.addCard')}
                  </button>
                  <button
                    onClick={() => {
                      setAddingCard(false);
                      setNewCardTitle('');
                    }}
                    className="p-1.5 rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingCard(true)}
                className="w-full mt-1 flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 hover:text-slate-700 dark:hover:text-slate-200 transition-colors group"
              >
                <Plus size={14} className="group-hover:scale-110 transition-transform" />
                {t('board.addCard')}
              </button>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}
