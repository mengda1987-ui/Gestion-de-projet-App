'use client';

import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import dynamic from 'next/dynamic';

const LoginPageDynamic = dynamic(() => import('./login/page'), { ssr: false });
const MainBoardDynamic = dynamic(() => import('@/components/board/MainBoard'), { ssr: false });
const BoardHomeDynamic = dynamic(() => import('@/components/workspace/BoardHome'), { ssr: false });

export default function Home() {
  const { currentUser, boards, currentBoardId, _loaded } = useBoard();
  const { lang } = useLang();

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

  // If there's a current board open (after user clicked one), show the board
  if (currentBoardId && boards.some(b => b.id === currentBoardId)) {
    return <MainBoardDynamic />;
  }

  // Show workspace home (user just logged in or went back)
  return <BoardHomeDynamic />;
}
