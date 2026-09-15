'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useCrm } from '@/context/CrmContext';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import ContactsView from './ContactsView';
import PipelineView from './PipelineView';
import ContactModal from './ContactModal';
import FieldManagerModal from './FieldManagerModal';
import ModuleModal from './ModuleModal';
import BackgroundPicker from '@/components/ui/BackgroundPicker';
import { getBgStyle, isImageBackground } from '@/lib/utils';
import {
  Users,
  List,
  LayoutGrid,
  Search,
  Plus,
  Moon,
  Sun,
  Languages,
  ArrowLeft,
  Settings2,
  Palette,
  Trash2,
  X,
} from 'lucide-react';
import type { CrmContact, CrmModule } from '@/types';

export default function CrmApp() {
  const { dispatch, modules, module, activeModuleId, view, contacts, stages, fields } = useCrm();
  const { users, currentUser, darkMode, crmBackground, crmImageOpacity, dispatch: boardDispatch } = useBoard();
  const { t, lang, toggleLang } = useLang();

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingContact, setEditingContact] = useState<CrmContact | null>(null);
  const [showFields, setShowFields] = useState(false);
  const [showAddModule, setShowAddModule] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);

  const isImageBg = isImageBackground(crmBackground);

  const modName = (m: CrmModule | null | undefined) => {
    if (!m) return '';
    return lang === 'en' ? (m.nameEn || m.name) : m.name;
  };

  const filteredContacts = contacts.filter(c => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q) ||
      c.tags.some(t => t.toLowerCase().includes(q)) ||
      Object.values(c.customFields).some(v => v.toLowerCase().includes(q))
    );
  });

  const handleDelete = (contactId: string) => {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;
    if (window.confirm(t('crm.deleteConfirm', { name: contact.name }))) {
      dispatch({ type: 'CRM_DELETE_CONTACT', payload: { moduleId: activeModuleId, contactId } });
    }
  };

  const handleMove = (contactId: string, stageId: string) => {
    dispatch({ type: 'CRM_MOVE_CONTACT', payload: { moduleId: activeModuleId, contactId, stageId } });
  };

  const handleDeleteModule = (m: CrmModule) => {
    if (!window.confirm(t('crm.deleteModuleConfirm', { name: modName(m) }))) return;
    dispatch({ type: 'CRM_DELETE_MODULE', payload: m.id });
  };

  const moduleNav = (
    <>
      {modules.map(m => {
        const active = m.id === activeModuleId;
        return (
          <div key={m.id} className="group relative">
            <button
              onClick={() => dispatch({ type: 'CRM_SET_MODULE', payload: m.id })}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-colors pr-9 ${
                active
                  ? 'bg-[#007AFF] text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              <span className="text-lg">{m.emoji}</span>
              <span className="truncate">{modName(m)}</span>
            </button>
            <button
              onClick={() => handleDeleteModule(m)}
              className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md transition-opacity opacity-0 group-hover:opacity-100 ${
                active
                  ? 'text-white/80 hover:text-white hover:bg-white/20'
                  : 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
              }`}
              title={t('crm.deleteModule')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}

      <button
        onClick={() => setShowAddModule(true)}
        className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
      >
        <Plus size={16} />
        <span>{t('crm.addModule')}</span>
      </button>

      <div className="mt-4 pt-4 border-t border-slate-200/60 dark:border-slate-700/50">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => dispatch({ type: 'CRM_SET_VIEW', payload: 'contacts' })}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              view === 'contacts'
                ? 'bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            <List size={16} />
            <span>{t('crm.contacts')}</span>
          </button>
          <button
            onClick={() => dispatch({ type: 'CRM_SET_VIEW', payload: 'pipeline' })}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              view === 'pipeline'
                ? 'bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
            }`}
          >
            <LayoutGrid size={16} />
            <span>{t('crm.pipeline')}</span>
          </button>
          <button
            onClick={() => setShowFields(true)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <Settings2 size={16} />
            <span>{t('crm.manageFields')}</span>
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="relative h-dvh overflow-hidden" style={isImageBg ? { backgroundColor: '#f5f5f7' } : getBgStyle(crmBackground)}>
      {isImageBg && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: crmBackground, opacity: crmImageOpacity }}
        />
      )}
      <div className={`relative h-dvh flex flex-col ${isImageBg ? '' : 'bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm'}`}>
        {/* Top bar */}
        <header className="shrink-0 glass border-b border-slate-200/60 dark:border-slate-700/50 flex items-center gap-2 px-3 sm:px-5 py-2.5">
        <button
          onClick={() => boardDispatch({ type: 'SET_APP_SECTION', payload: 'portal' })}
          className="p-2 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-200 shrink-0"
          title={t('crm.backToPortal')}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-[#007AFF] text-white flex items-center justify-center">
            <Users size={14} />
          </div>
          <span className="font-semibold text-slate-800 dark:text-white hidden sm:inline">CRM</span>
        </div>

        <div className="flex-1" />

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('crm.searchPlaceholder')}
            className="w-36 md:w-64 bg-white/80 dark:bg-slate-800/80 rounded-full pl-9 pr-3 py-2 text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none ring-1 ring-slate-200/60 dark:ring-slate-700/50"
          />
        </div>

        <button
          onClick={() => setShowBgPicker(true)}
          className="p-2 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-200 shrink-0"
          title={lang === 'zh' ? '背景设置' : 'Background'}
        >
          <Palette size={16} />
        </button>
        <button
          onClick={toggleLang}
          className="p-2 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-200 shrink-0"
          title={t('nav.language')}
        >
          <Languages size={16} />
        </button>
        <button
          onClick={() => boardDispatch({ type: 'TOGGLE_DARK_MODE' })}
          className="p-2 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-200 shrink-0"
        >
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={() => { setEditingContact(null); setShowAdd(true); }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#007AFF] text-white text-sm font-medium hover:bg-[#007AFF]/90 transition-colors shrink-0"
        >
          <Plus size={15} />
          <span className="hidden sm:inline">{t('crm.addContact')}</span>
        </button>
      </header>

      <div className="relative z-10 flex flex-1 min-h-0">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 border-r border-slate-200/60 dark:border-slate-700/50 bg-white/60 dark:bg-slate-900/40 p-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-3">
            {t('crm.subtitle')}
          </div>
          {moduleNav}
          <div className="mt-auto px-3 pt-4 text-xs text-slate-400 truncate">
            {currentUser?.name}
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile module nav */}
          <div className="lg:hidden shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-slate-200/60 dark:border-slate-700/50 overflow-x-auto">
            {modules.map(m => {
              const active = m.id === activeModuleId;
              return (
                <div key={m.id} className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => dispatch({ type: 'CRM_SET_MODULE', payload: m.id })}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                      active ? 'bg-[#007AFF] text-white' : 'bg-white/70 dark:bg-white/10 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <span>{m.emoji}</span>
                    <span>{modName(m)}</span>
                  </button>
                  <button
                    onClick={() => handleDeleteModule(m)}
                    className={`p-1.5 rounded-full shrink-0 ${
                      active ? 'text-white/70 hover:text-white' : 'text-slate-400 hover:text-red-500 bg-white/70 dark:bg-white/10'
                    }`}
                    title={t('crm.deleteModule')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setShowAddModule(true)}
              className="p-2 rounded-full bg-white/70 dark:bg-white/10 text-slate-600 dark:text-slate-300 shrink-0"
              title={t('crm.addModule')}
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Header line: module title + view toggle (mobile) */}
          <div className="shrink-0 flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-slate-200/60 dark:border-slate-700/50">
            <h2 className="font-bold text-slate-900 dark:text-white text-lg">
              {modName(module)}
            </h2>
            <span className="text-sm text-slate-400">{t('crm.contactCount', { count: filteredContacts.length })}</span>
            <div className="flex-1" />
            <div className="lg:hidden flex items-center bg-white/80 dark:bg-slate-800/80 rounded-full p-0.5 ring-1 ring-slate-200/60 dark:ring-slate-700/50">
              <button
                onClick={() => dispatch({ type: 'CRM_SET_VIEW', payload: 'contacts' })}
                className={`px-3 py-1 rounded-full text-xs font-medium ${view === 'contacts' ? 'bg-[#007AFF] text-white' : 'text-slate-500 dark:text-slate-300'}`}
              >
                {t('crm.contacts')}
              </button>
              <button
                onClick={() => dispatch({ type: 'CRM_SET_VIEW', payload: 'pipeline' })}
                className={`px-3 py-1 rounded-full text-xs font-medium ${view === 'pipeline' ? 'bg-[#007AFF] text-white' : 'text-slate-500 dark:text-slate-300'}`}
              >
                {t('crm.pipeline')}
              </button>
            </div>
            <button
              onClick={() => setShowFields(true)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-600 dark:text-slate-200"
              title={t('crm.manageFields')}
            >
              <Settings2 size={16} />
            </button>
          </div>

          {view === 'contacts' ? (
            <ContactsView
              contacts={filteredContacts}
              stages={stages}
              fields={fields}
              users={users}
              onEdit={setEditingContact}
              onDelete={handleDelete}
            />
          ) : (
            <PipelineView
              contacts={filteredContacts}
              stages={stages}
              users={users}
              onEdit={setEditingContact}
              onMove={handleMove}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {(showAdd || editingContact) && (
        <ContactModal
          contact={editingContact}
          onClose={() => { setShowAdd(false); setEditingContact(null); }}
        />
      )}
      {showFields && <FieldManagerModal onClose={() => setShowFields(false)} />}
      {showAddModule && <ModuleModal onClose={() => setShowAddModule(false)} />}
      {showBgPicker && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowBgPicker(false)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                {lang === 'zh' ? 'CRM 背景设置' : 'CRM background'}
              </h3>
              <button onClick={() => setShowBgPicker(false)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <BackgroundPicker
              current={crmBackground}
              defaultBg="#f5f5f7"
              imageOpacity={crmImageOpacity}
              onSelect={(bg, opacity) => {
                boardDispatch({ type: 'UPDATE_CRM_BG', payload: bg });
                if (typeof opacity === 'number') {
                  boardDispatch({ type: 'UPDATE_CRM_IMAGE_OPACITY', payload: opacity });
                }
              }}
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
