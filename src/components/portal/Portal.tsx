'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import BackgroundPicker from '@/components/ui/BackgroundPicker';
import { getBgStyle, isImageBackground } from '@/lib/utils';
import { LayoutDashboard, Users, LogOut, Languages, ArrowRight, Palette, X } from 'lucide-react';

export default function Portal() {
  const { currentUser, dispatch, portalBackground, portalImageOpacity } = useBoard();
  const { t, lang, toggleLang } = useLang();
  const [showBgPicker, setShowBgPicker] = useState(false);

  const isImageBg = isImageBackground(portalBackground);

  return (
    <div className="relative min-h-dvh" style={isImageBg ? { backgroundColor: '#f5f5f7' } : getBgStyle(portalBackground)}>
      {isImageBg && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: portalBackground, opacity: portalImageOpacity }}
        />
      )}
      <div className={`relative min-h-dvh flex flex-col ${isImageBg ? '' : 'bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm'}`}>
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 sm:px-10 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#007AFF] text-white flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-500/30">
              LF
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{currentUser?.name}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{currentUser?.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBgPicker(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 dark:bg-white/10 backdrop-blur border border-slate-200/60 dark:border-white/10 text-slate-600 dark:text-slate-200 text-sm font-medium hover:bg-white dark:hover:bg-white/20 transition-colors"
            >
              <Palette size={15} />
              <span className="hidden sm:inline">{lang === 'zh' ? '背景' : 'Background'}</span>
            </button>
            <button
              onClick={toggleLang}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 dark:bg-white/10 backdrop-blur border border-slate-200/60 dark:border-white/10 text-slate-600 dark:text-slate-200 text-sm font-medium hover:bg-white dark:hover:bg-white/20 transition-colors"
            >
              <Languages size={15} />
              {lang === 'zh' ? 'EN' : '中'}
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_CURRENT_USER', payload: null })}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 dark:bg-white/10 backdrop-blur border border-slate-200/60 dark:border-white/10 text-slate-600 dark:text-slate-200 text-sm font-medium hover:bg-white dark:hover:bg-white/20 transition-colors"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">{t('portal.logout')}</span>
            </button>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 flex items-center justify-center px-6 pb-16">
          <div className="w-full max-w-3xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Board */}
              <button
                onClick={() => dispatch({ type: 'SET_CURRENT_BOARD', payload: '' })}
                className="group relative overflow-hidden rounded-3xl p-7 text-left bg-white/80 dark:bg-white/[0.06] backdrop-blur-xl border border-slate-200/60 dark:border-white/10 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 to-indigo-500" />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-lg mb-5">
                  <LayoutDashboard size={26} />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('portal.board')}</h2>
                <div className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-[#007AFF]">
                  {lang === 'zh' ? '进入看板' : 'Open Board'}
                  <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* CRM */}
              <button
                onClick={() => dispatch({ type: 'SET_APP_SECTION', payload: 'crm' })}
                className="group relative overflow-hidden rounded-3xl p-7 text-left bg-white/80 dark:bg-white/[0.06] backdrop-blur-xl border border-slate-200/60 dark:border-white/10 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 to-teal-500" />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-lg mb-5">
                  <Users size={26} />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('portal.crm')}</h2>
                <div className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {lang === 'zh' ? '进入 CRM' : 'Open CRM'}
                  <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            </div>
          </div>
        </main>
      </div>

      {showBgPicker && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowBgPicker(false)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                {lang === 'zh' ? '门户背景设置' : 'Portal background'}
              </h3>
              <button onClick={() => setShowBgPicker(false)} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X size={18} />
              </button>
            </div>
            <BackgroundPicker
              current={portalBackground}
              defaultBg="#f5f5f7"
              imageOpacity={portalImageOpacity}
              onSelect={(bg, opacity) => {
                dispatch({ type: 'UPDATE_PORTAL_BG', payload: bg });
                if (typeof opacity === 'number') {
                  dispatch({ type: 'UPDATE_PORTAL_IMAGE_OPACITY', payload: opacity });
                }
              }}
              onClose={() => setShowBgPicker(false)}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
