'use client';

import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { X, ScrollText } from 'lucide-react';

export default function OperationLogsModal({ onClose }: { onClose: () => void }) {
  const { operationLogs } = useBoard();
  const { t, lang } = useLang();

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
    } catch {
      return iso;
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl apple-card overflow-hidden flex flex-col animate-slide-up max-h-[80vh]">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <ScrollText size={18} className="text-[#007AFF]" />
            <h3 className="font-bold text-slate-900 text-lg">{t('logs.title')}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {operationLogs.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm">{t('logs.empty')}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/30 text-left">
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('logs.user')}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('logs.action')}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('logs.detail')}</th>
                  <th className="px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('logs.time')}</th>
                </tr>
              </thead>
              <tbody>
                {operationLogs.map((log, i) => (
                  <tr key={log.id} className="border-b border-slate-50 dark:border-slate-800/50">
                    <td className="px-5 py-3 font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{log.userName || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">{log.action}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{log.detail}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs whitespace-nowrap">{formatTime(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
