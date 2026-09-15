'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CrmFieldType } from '@/types';
import { useCrm } from '@/context/CrmContext';
import { useLang } from '@/context/LangContext';
import { X, Plus, Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { generateId } from '@/lib/utils';

const MODULE_COLORS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
  'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #a855f7 100%)',
  'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
];

export default function FieldManagerModal({ onClose }: { onClose: () => void }) {
  const { module, stages, fields, activeModuleId, dispatch } = useCrm();
  const { t, lang } = useLang();

  const [newStageName, setNewStageName] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState<CrmFieldType>('text');
  const [newFieldOptions, setNewFieldOptions] = useState('');

  const renameModule = (patch: Partial<{ name: string; nameEn: string; emoji: string; color: string }>) => {
    dispatch({
      type: 'CRM_RENAME_MODULE',
      payload: {
        moduleId: activeModuleId,
        name: patch.name ?? module?.name ?? '',
        nameEn: patch.nameEn ?? module?.nameEn ?? '',
        emoji: patch.emoji ?? module?.emoji ?? '',
        color: patch.color ?? module?.color ?? MODULE_COLORS[0],
      },
    });
  };

  const deleteModule = () => {
    if (!window.confirm(t('crm.deleteModuleConfirm', { name: module?.name || '' }))) return;
    dispatch({ type: 'CRM_DELETE_MODULE', payload: activeModuleId });
    onClose();
  };

  const addStage = () => {
    const name = newStageName.trim();
    if (!name) return;
    const order = stages.reduce((max, s) => Math.max(max, s.order), -1) + 1;
    dispatch({
      type: 'CRM_ADD_STAGE',
      payload: { moduleId: activeModuleId, stage: { id: generateId(), name, order } },
    });
    setNewStageName('');
  };

  const moveStage = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    dispatch({ type: 'CRM_REORDER_STAGES', payload: { moduleId: activeModuleId, stages: next } });
  };

  const deleteStage = (stageId: string) => {
    if (!window.confirm(lang === 'zh' ? '删除该阶段？该阶段的联系人将移到第一个阶段。' : 'Delete this stage? Contacts in it will move to the first stage.')) return;
    dispatch({ type: 'CRM_DELETE_STAGE', payload: { moduleId: activeModuleId, stageId } });
  };

  const addField = () => {
    const name = newFieldName.trim();
    if (!name) return;
    const options = newFieldType === 'select'
      ? newFieldOptions.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    dispatch({
      type: 'CRM_ADD_FIELD',
      payload: {
        moduleId: activeModuleId,
        field: { id: generateId(), name, type: newFieldType, ...(options ? { options } : {}) },
      },
    });
    setNewFieldName('');
    setNewFieldOptions('');
  };

  const deleteField = (fieldId: string) => {
    dispatch({ type: 'CRM_DELETE_FIELD', payload: { moduleId: activeModuleId, fieldId } });
  };

  const onDragEndFields = (result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    const next = Array.from(fields);
    const [moved] = next.splice(result.source.index, 1);
    next.splice(result.destination.index, 0, moved);
    dispatch({ type: 'CRM_REORDER_FIELDS', payload: { moduleId: activeModuleId, fields: next } });
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto apple-card p-6 animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 dark:text-white text-lg">{t('crm.manageFields')}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Module settings */}
        <div className="mb-7 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">{t('crm.moduleSettings')}</div>
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl text-white shrink-0"
              style={{ background: module?.color || MODULE_COLORS[0] }}
            >
              {module?.emoji || '📋'}
            </div>
            <div className="grid grid-cols-2 gap-2 flex-1">
              <input
                value={module?.name || ''}
                onChange={e => renameModule({ name: e.target.value })}
                className="input"
                placeholder={t('crm.moduleName')}
              />
              <input
                value={module?.nameEn || ''}
                onChange={e => renameModule({ nameEn: e.target.value })}
                className="input"
                placeholder={t('crm.moduleNameEn')}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-slate-500 w-14 shrink-0">{t('crm.moduleEmoji')}</span>
            <input
              value={module?.emoji || ''}
              onChange={e => renameModule({ emoji: e.target.value })}
              className="input w-20 text-center"
            />
            <div className="flex items-center gap-1.5 ml-1">
              {MODULE_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => renameModule({ color: c })}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${module?.color === c ? 'ring-2 ring-offset-2 ring-[#007AFF] dark:ring-offset-slate-900' : ''}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <button onClick={deleteModule} className="inline-flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 transition-colors">
            <Trash2 size={14} /> {t('crm.deleteModule')}
          </button>
        </div>

        {/* Stages */}
        <div className="mb-7">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2.5">{t('crm.stagesTitle')}</div>
          <div className="space-y-1.5">
            {stages.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2">
                <div className="flex flex-col gap-0.5">
                  <button
                    onClick={() => moveStage(i, 'up')}
                    disabled={i === 0}
                    className="text-slate-400 hover:text-[#007AFF] disabled:opacity-25"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    onClick={() => moveStage(i, 'down')}
                    disabled={i === stages.length - 1}
                    className="text-slate-400 hover:text-[#007AFF] disabled:opacity-25"
                  >
                    <ChevronDown size={12} />
                  </button>
                </div>
                <input
                  value={s.name}
                  onChange={e => dispatch({ type: 'CRM_RENAME_STAGE', payload: { moduleId: activeModuleId, stageId: s.id, name: e.target.value } })}
                  className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 focus:outline-none"
                />
                <button onClick={() => deleteStage(s.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2.5">
            <input
              value={newStageName}
              onChange={e => setNewStageName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addStage(); }}
              className="input flex-1"
              placeholder={t('crm.stagePlaceholder')}
            />
            <button onClick={addStage} disabled={!newStageName.trim()} className="btn-primary px-3 disabled:opacity-50">
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Fields */}
        <div>
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2.5">{t('crm.fieldsTitle')}</div>
          {fields.length === 0 ? (
            <div className="text-sm text-slate-400 py-2">{t('crm.fields.empty')}</div>
          ) : (
            <DragDropContext onDragEnd={onDragEndFields}>
              <Droppable droppableId="fields">
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1.5">
                    {fields.map((f, i) => (
                      <Draggable key={f.id} draggableId={f.id} index={i}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2 ${snapshot.isDragging ? 'shadow-lg ring-2 ring-[#007AFF]' : ''}`}
                          >
                            <div {...provided.dragHandleProps} className="shrink-0 text-slate-400 hover:text-[#007AFF] cursor-grab active:cursor-grabbing">
                              <GripVertical size={14} />
                            </div>
                            <input
                              value={f.name}
                              onChange={e => dispatch({ type: 'CRM_UPDATE_FIELD', payload: { moduleId: activeModuleId, fieldId: f.id, updates: { name: e.target.value } } })}
                              className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-100 focus:outline-none"
                            />
                            <span className="text-xs text-slate-400 capitalize">{f.type}</span>
                            <button onClick={() => deleteField(f.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          )}

          <div className="flex flex-col sm:flex-row gap-2 mt-2.5">
            <input
              value={newFieldName}
              onChange={e => setNewFieldName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addField(); }}
              className="input flex-1"
              placeholder={t('crm.fields.name')}
            />
            <select value={newFieldType} onChange={e => setNewFieldType(e.target.value as CrmFieldType)} className="input sm:w-32">
              <option value="text">{t('crm.fields.text')}</option>
              <option value="number">{t('crm.fields.number')}</option>
              <option value="date">{t('crm.fields.date')}</option>
              <option value="select">{t('crm.fields.select')}</option>
            </select>
            <button onClick={addField} disabled={!newFieldName.trim()} className="btn-primary px-3 disabled:opacity-50">
              <Plus size={16} />
            </button>
          </div>
          {newFieldType === 'select' && (
            <input
              value={newFieldOptions}
              onChange={e => setNewFieldOptions(e.target.value)}
              className="input mt-2"
              placeholder={t('crm.fields.options')}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
