'use client';

import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { CRM_META, CRM_TYPES } from './crmMeta';
import { generateId } from '@/lib/utils';

export default function CrmSection() {
  const { boards, currentUser, dispatch } = useBoard();
  const { t } = useLang();

  const openCrmBoard = (crmType: (typeof CRM_TYPES)[number]) => {
    const meta = CRM_META[crmType];
    const existing = boards.find(b => b.crmType === crmType);

    // 记录操作日志
    dispatch({
      type: 'ADD_OPERATION_LOG',
      payload: {
        log: {
          id: generateId(),
          userId: currentUser?.id || '',
          userName: currentUser?.name || '',
          action: 'open_crm',
          detail: `${t(meta.titleKey)} ${existing ? '(打开)' : '(创建)'}`,
          createdAt: new Date().toISOString(),
        },
      },
    });

    if (existing) {
      dispatch({ type: 'SET_CURRENT_BOARD', payload: existing.id });
    } else {
      dispatch({
        type: 'CREATE_BOARD',
        payload: { title: t(meta.titleKey), background: meta.bg, crmType },
      });
    }
  };

  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">📊</span>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">{t('crm.title')}</h2>
        <span className="text-sm text-slate-400">{t('crm.subtitle')}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {CRM_TYPES.map(type => {
          const meta = CRM_META[type];
          const existing = boards.find(b => b.crmType === type);
          const cardCount = existing
            ? existing.columns.reduce((s, c) => s + c.cards.length, 0)
            : 0;
          return (
            <button
              key={type}
              onClick={() => openCrmBoard(type)}
              className="apple-card cursor-pointer overflow-hidden flex flex-col h-[150px] text-left hover:shadow-lg transition-shadow"
            >
              <div className="h-1.5 w-full shrink-0" style={{ background: meta.bg }} />
              <div className="p-4 flex flex-col flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 shadow-sm"
                    style={{ background: meta.bg }}
                  >
                    {meta.emoji}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 text-base leading-snug">{t(meta.titleKey)}</h3>
                    <p className="text-xs text-slate-500">{t(meta.descKey)}</p>
                  </div>
                </div>
                <div className="mt-auto text-xs text-slate-400">
                  {existing
                    ? `${existing.columns.length} ${t('summary.totalLists')} · ${cardCount} ${t('summary.cards')}`
                    : t('crm.fields.emptyHint')}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
