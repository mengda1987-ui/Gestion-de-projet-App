'use client';

import React, { useState, useMemo } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
  DragStart,
} from '@hello-pangea/dnd';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { Column, Card as CardType } from '@/types';
import BoardColumn from './BoardColumn';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import CardDetailModal from '../card/CardDetailModal';

export default function BoardView() {
  const { t, lang } = useLang();
  const { board, dispatch, filters, broadcastChange, findCard } = useBoard();
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [draggingListId, setDraggingListId] = useState<string | null>(null);

  const visibleColumns = useMemo(() => {
    let cols = board.columns.filter(c => !c.archived || filters.showArchived);
    
    if (filters.search || filters.labels.length > 0 || filters.assignees.length > 0) {
      cols = cols.map(col => ({
        ...col,
        cards: col.cards.filter(card => {
          if (card.archived && !filters.showArchived) return false;

          if (filters.search) {
            const searchLower = filters.search.toLowerCase();
            const inTitle = card.title.toLowerCase().includes(searchLower);
            const inDesc = card.description.toLowerCase().includes(searchLower);
            const inComments = card.comments.some(c => c.text.toLowerCase().includes(searchLower));
            if (!inTitle && !inDesc && !inComments) return false;
          }

          if (filters.labels.length > 0) {
            const hasLabel = filters.labels.some(l => card.labels.includes(l));
            if (!hasLabel) return false;
          }

          if (filters.assignees.length > 0) {
            const hasAssignee = filters.assignees.some(a => card.assignees.includes(a));
            if (!hasAssignee) return false;
          }

          return true;
        }),
      }));
    }
    
    return cols;
  }, [board.columns, filters]);

  const handleDragStart = (start: DragStart) => {
    if (start.type === 'COLUMN') {
      setDraggingListId(start.draggableId);
    }
  };

  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId, type } = result;
    setDraggingListId(null);

    if (!destination) return;
    if (source.index === destination.index && source.droppableId === destination.droppableId) return;

    if (type === 'COLUMN') {
      const fromRealIndex = board.columns.findIndex(c => c.id === draggableId);
      if (fromRealIndex === -1) return;

      const visibleColIds = visibleColumns.map(c => c.id);
      let toRealIndex: number;

      if (destination.index >= visibleColIds.length) {
        toRealIndex = board.columns.length - 1;
      } else {
        const destVisibleId = visibleColIds[destination.index];
        toRealIndex = board.columns.findIndex(c => c.id === destVisibleId);
      }

      if (toRealIndex === -1) toRealIndex = board.columns.length - 1;
      
      broadcastChange({
        type: 'REORDER_COLUMNS',
        payload: { fromIndex: fromRealIndex, toIndex: toRealIndex },
      });
      return;
    }

    if (type === 'DEFAULT') {
      const fromCol = board.columns.find(c => c.id === source.droppableId);
      const toCol = board.columns.find(c => c.id === destination.droppableId);
      if (!fromCol || !toCol) return;

      if (source.droppableId === destination.droppableId) {
        const visibleCol = visibleColumns.find(c => c.id === source.droppableId);
        if (!visibleCol) return;

        const srcVisibleCardIds = visibleCol.cards.map(c => c.id);
        const fromRealIdx = fromCol.cards.findIndex(c => c.id === srcVisibleCardIds[source.index]);
        if (fromRealIdx === -1) return;

        let toRealIdx: number;
        if (destination.index >= srcVisibleCardIds.length) {
          toRealIdx = fromCol.cards.length - 1;
        } else {
          const destVisibleId = srcVisibleCardIds[destination.index];
          toRealIdx = fromCol.cards.findIndex(c => c.id === destVisibleId);
        }

        if (toRealIdx === -1) toRealIdx = fromCol.cards.length - 1;

        broadcastChange({
          type: 'REORDER_CARDS',
          payload: {
            columnId: source.droppableId,
            fromIndex: fromRealIdx,
            toIndex: toRealIdx,
          },
        });
      } else {
        const srcVisibleCol = visibleColumns.find(c => c.id === source.droppableId);
        const dstVisibleCol = visibleColumns.find(c => c.id === destination.droppableId);
        if (!srcVisibleCol || !dstVisibleCol) return;

        const srcVisibleCardIds = srcVisibleCol.cards.map(c => c.id);
        const dstVisibleCardIds = dstVisibleCol.cards.map(c => c.id);

        const fromRealIdx = fromCol.cards.findIndex(c => c.id === srcVisibleCardIds[source.index]);
        if (fromRealIdx === -1) return;

        let toRealIdx: number;
        if (destination.index >= dstVisibleCardIds.length) {
          toRealIdx = toCol.cards.length;
        } else {
          const destVisibleId = dstVisibleCardIds[destination.index];
          toRealIdx = toCol.cards.findIndex(c => c.id === destVisibleId);
          if (toRealIdx === -1) toRealIdx = toCol.cards.length;
        }

        broadcastChange({
          type: 'MOVE_CARD',
          payload: {
            fromColumnId: source.droppableId,
            toColumnId: destination.droppableId,
            fromIndex: fromRealIdx,
            toIndex: toRealIdx,
          },
        });
      }
    }
  };

  const handleAddColumn = () => {
    if (!newColumnTitle.trim()) {
      setAddingColumn(false);
      return;
    }
    broadcastChange({ type: 'ADD_COLUMN', payload: { title: newColumnTitle.trim() } });
    setNewColumnTitle('');
    setAddingColumn(false);
  };

  const selectedCard = selectedCardId ? findCard(selectedCardId) : null;

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
        <Droppable droppableId="board-columns" type="COLUMN" direction="horizontal">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={cn(
                'min-h-full flex items-start gap-3 p-4 overflow-x-auto overflow-y-visible',
                snapshot.isDraggingOver && 'bg-white/5'
              )}
              style={{ scrollBehavior: 'smooth' }}
            >
              {visibleColumns.map((column: Column, idx: number) => (
                <Draggable key={column.id} draggableId={column.id} index={idx}>
                  {(colProvided, colSnapshot) => (
                    <div
                      ref={colProvided.innerRef}
                      {...colProvided.draggableProps}
                      className={cn(
                        'shrink-0 w-72 md:w-80',
                        colSnapshot.isDragging && 'opacity-80 rotate-1 shadow-2xl z-50'
                      )}
                      style={{ ...colProvided.draggableProps.style }}
                    >
                      <BoardColumn
                        column={column}
                        isDragging={draggingListId === column.id}
                        dragHandleProps={colProvided.dragHandleProps || undefined}
                        onCardClick={(cardId) => setSelectedCardId(cardId)}
                      />
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}

              {/* Add Column */}
              <div className="shrink-0 w-72 md:w-80">
                {addingColumn ? (
                  <div className="glass rounded-xl p-2 animate-slide-up">
                    <input
                      autoFocus
                      value={newColumnTitle}
                      onChange={(e) => setNewColumnTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddColumn();
                        if (e.key === 'Escape') {
                          setAddingColumn(false);
                          setNewColumnTitle('');
                        }
                      }}
                      placeholder={t('board.placeholder')}
                      className="input mb-2"
                    />
                    <div className="flex items-center gap-2">
                      <button onClick={handleAddColumn} className="btn-primary text-xs py-1.5">
                        {lang === 'zh' ? '添加列表' : 'Add list'}
                      </button>
                      <button
                        onClick={() => {
                          setAddingColumn(false);
                          setNewColumnTitle('');
                        }}
                        className="btn-ghost text-xs py-1.5"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingColumn(true)}
                    className="w-full flex items-center gap-2 p-3 rounded-xl bg-white/20 dark:bg-black/20 backdrop-blur-sm text-white/90 hover:bg-white/30 dark:hover:bg-black/30 transition-all group"
                  >
                    <Plus size={18} className="group-hover:scale-110 transition-transform" />
                    <span className="font-medium text-sm">{t('board.addColumn')}</span>
                  </button>
                )}
              </div>

              {/* Extra space for horizontal scroll */}
              <div className="w-4 shrink-0" />
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {selectedCard && (
        <CardDetailModal
          card={selectedCard.card}
          columnId={selectedCard.columnId}
          onClose={() => setSelectedCardId(null)}
          onDuplicate={() => {
            broadcastChange({ type: 'DUPLICATE_CARD', payload: { cardId: selectedCard.card.id } });
          }}
          onArchive={() => {
            broadcastChange({ type: 'ARCHIVE_CARD', payload: { cardId: selectedCard.card.id } });
          }}
          onDelete={() => {
            broadcastChange({ type: 'DELETE_CARD', payload: { cardId: selectedCard.card.id } });
            setSelectedCardId(null);
          }}
        />
      )}
    </>
  );
}
