'use client';

import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import dynamic from 'next/dynamic';
import BgDiagnostics from '@/components/ui/BgDiagnostics';

const LoginPageDynamic = dynamic(() => import('./login/page'), { ssr: false });
const MainBoardDynamic = dynamic(() => import('@/components/board/MainBoard'), { ssr: false });
const BoardHomeDynamic = dynamic(() => import('@/components/workspace/BoardHome'), { ssr: false });
const PortalDynamic = dynamic(() => import('@/components/portal/Portal'), { ssr: false });
const CrmAppDynamic = dynamic(() => import('@/components/crm/CrmApp'), { ssr: false });

export default function Home() {
  const { currentUser, boards, currentBoardId, appSection, _loaded, portalBackground, loginBackground, workspaceBackground, crmBackground } = useBoard();
  const { lang } = useLang();

  // 临时诊断面板：仅在有用户登录后显示，便于在 Portal/看板页面直接查看背景值
  const diag = currentUser ? (
    <BgDiagnostics
      portalBackground={portalBackground}
      loginBackground={loginBackground}
      workspaceBackground={workspaceBackground}
      crmBackground={crmBackground}
    />
  ) : null;

  if (!_loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 dark:from-slate-950 dark:to-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-10 h-10 border-[3px] border-slate-200 dark:border-slate-700 border-t-[#007AFF] rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-3 h-3 bg-[#007AFF] rounded-full opacity-20 animate-pulse" />
            </div>
          </div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{lang === 'zh' ? '正在连接服务器...' : 'Connecting to server...'}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{lang === 'zh' ? '首次加载可能需要几秒钟' : 'First load may take a few seconds'}</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPageDynamic />;
  }

  if (appSection === 'crm') {
    return <>{diag}<CrmAppDynamic /></>;
  }

  if (appSection === 'board') {
    if (currentBoardId && boards.some(b => b.id === currentBoardId)) {
      return <>{diag}<MainBoardDynamic /></>;
    }
    return <>{diag}<BoardHomeDynamic /></>;
  }

  // Portal: choose between Board and CRM
  return <>{diag}<PortalDynamic /></>;
}
