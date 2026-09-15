'use client';

import { CrmContact, CrmStage, User } from '@/types';
import { useLang } from '@/context/LangContext';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Mail, Phone } from 'lucide-react';

interface PipelineViewProps {
  contacts: CrmContact[];
  stages: CrmStage[];
  users: User[];
  onEdit: (contact: CrmContact) => void;
  onMove: (contactId: string, stageId: string) => void;
}

export default function PipelineView({ contacts, stages, users, onEdit, onMove }: PipelineViewProps) {
  const { t } = useLang();

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.droppableId !== result.source.droppableId) {
      onMove(result.draggableId, result.destination.droppableId);
    }
  };

  return (
    <div className="flex-1 overflow-auto thick-h-scroll">
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="flex gap-4 h-full p-5 min-w-max">
          {stages.map(stage => {
            const stageContacts = contacts.filter(c => c.stageId === stage.id);
            return (
              <Droppable key={stage.id} droppableId={stage.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`flex flex-col w-72 shrink-0 rounded-2xl bg-slate-100/70 dark:bg-slate-800/40 border ${
                      snapshot.isDraggingOver ? 'border-[#007AFF] bg-blue-50/70 dark:bg-blue-900/20' : 'border-slate-200/60 dark:border-slate-700/40'
                    } transition-colors`}
                  >
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200/60 dark:border-slate-700/40">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#007AFF]" />
                      <span className="font-semibold text-sm text-slate-700 dark:text-slate-200">{stage.name}</span>
                      <span className="ml-auto text-xs font-medium text-slate-400">{stageContacts.length}</span>
                    </div>

                    <div className="flex-1 p-2.5 space-y-2.5 overflow-y-auto">
                      {stageContacts.map((contact, index) => {
                        const owner = users.find(u => u.id === contact.ownerId);
                        return (
                          <Draggable key={contact.id} draggableId={contact.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                onClick={() => onEdit(contact)}
                                className={`group p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700/50 shadow-sm cursor-pointer hover:shadow-md transition-shadow ${
                                  snapshot.isDragging ? 'shadow-xl ring-2 ring-[#007AFF]' : ''
                                }`}
                              >
                                <div className="flex items-start gap-2.5">
                                  <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                    style={{ backgroundColor: owner?.color || '#007AFF' }}
                                  >
                                    {contact.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{contact.name}</div>
                                    {contact.company && (
                                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{contact.company}</div>
                                    )}
                                  </div>
                                </div>

                                {(contact.email || contact.phone) && (
                                  <div className="mt-2.5 space-y-1">
                                    {contact.email && (
                                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 truncate">
                                        <Mail size={11} className="shrink-0 text-slate-400" />
                                        <span className="truncate">{contact.email}</span>
                                      </div>
                                    )}
                                    {contact.phone && (
                                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                        <Phone size={11} className="shrink-0 text-slate-400" />
                                        <span>{contact.phone}</span>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {contact.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2.5">
                                    {contact.tags.slice(0, 3).map(tag => (
                                      <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500 dark:text-slate-400">
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>

                    {stageContacts.length === 0 && (
                      <div className="px-4 pb-4 text-center text-xs text-slate-400">
                        {t('crm.noContacts')}
                      </div>
                    )}
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
