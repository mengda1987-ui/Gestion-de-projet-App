'use client';

// ===== 临时诊断面板（v2.2.5）=====
// 用途：把运行时真实的背景值直接显示在页面右上角，
// 无需打开 F12 即可判断问题出在「数据为空」还是「样式/遮罩」。
// 定位完成后应删除此文件及其引用。
import { useEffect, useState } from 'react';

interface DiagInfo {
  stateBg: { portal: string; login: string; workspace: string; crm: string };
  localStorageBg: Record<string, unknown> | null;
  localStoragePending: unknown;
  computedBg: string;
}

export default function BgDiagnostics({
  portalBackground,
  loginBackground,
  workspaceBackground,
  crmBackground,
}: {
  portalBackground: string;
  loginBackground: string;
  workspaceBackground: string;
  crmBackground: string;
}) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<DiagInfo | null>(null);

  useEffect(() => {
    let stored: Record<string, unknown> | null = null;
    let pending: unknown = null;
    try {
      const raw = window.localStorage.getItem('trello_local_backup_v1');
      if (raw) {
        const p = JSON.parse(raw);
        pending = p?.pending;
        stored = {
          workspaceBackground: p?.workspaceBackground,
          loginBackground: p?.loginBackground,
          portalBackground: p?.portalBackground,
          crmBackground: p?.crmBackground,
        };
      }
    } catch {}

    // 读取实际渲染出来的背景（含遮罩层影响后的最终可见色）
    const el = document.querySelector('[data-bg-root]') as HTMLElement | null;
    const computed = el ? window.getComputedStyle(el).background.slice(0, 120) : '(未找到 data-bg-root)';

    setInfo({
      stateBg: {
        portal: portalBackground,
        login: loginBackground,
        workspace: workspaceBackground,
        crm: crmBackground,
      },
      localStorageBg: stored,
      localStoragePending: pending,
      computedBg: computed,
    });
  }, [portalBackground, loginBackground, workspaceBackground, crmBackground]);

  const row = (k: string, v: unknown) => (
    <div key={k} className="flex gap-2 py-0.5">
      <span className="text-slate-400 shrink-0">{k}:</span>
      <span className="break-all font-mono">
        {v === undefined ? 'undefined' : v === null ? 'null' : String(v) || '(空字符串)'}
      </span>
    </div>
  );

  return (
    <div className="fixed top-3 left-3 z-[999999] select-text">
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 rounded-full bg-black/75 text-white text-[11px] font-semibold shadow-lg backdrop-blur"
      >
        🎨 背景诊断 {open ? '▲' : '▼'}
      </button>
      {open && info && (
        <div className="mt-2 w-[420px] max-w-[90vw] max-h-[70vh] overflow-auto rounded-xl bg-white/95 text-slate-900 text-[11px] leading-relaxed shadow-2xl border border-slate-300 p-3">
          <div className="font-bold mb-1">① state 里的背景值（页面实际用的）</div>
          <div className="bg-slate-50 rounded p-2 mb-2">
            {row('portal', info.stateBg.portal)}
            {row('login', info.stateBg.login)}
            {row('workspace', info.stateBg.workspace)}
            {row('crm', info.stateBg.crm)}
          </div>

          <div className="font-bold mb-1">② localStorage 备份里的值</div>
          <div className="bg-slate-50 rounded p-2 mb-2">
            {info.localStorageBg
              ? Object.entries(info.localStorageBg).map(([k, v]) => row(k, v))
              : '(无本地备份)'}
            {row('pending', info.localStoragePending)}
          </div>

          <div className="font-bold mb-1">③ 浏览器实际渲染出来的背景</div>
          <div className="bg-slate-50 rounded p-2 mb-2">{info.computedBg}</div>

          <div className="text-slate-500 mt-2 pt-2 border-t border-slate-200">
            判断方法：若 ① 是 #f5f5f7 而 ② 也是空 → 数据丢失；<br />
            若 ① 有渐变色但页面仍白 → 样式/遮罩问题。
          </div>
        </div>
      )}
    </div>
  );
}
