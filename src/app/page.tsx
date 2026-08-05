'use client';

import { useBoard } from '@/context/BoardContext';
import dynamic from 'next/dynamic';

const LoginPageDynamic = dynamic(() => import('./login/page'), { ssr: false });
const MainBoardDynamic = dynamic(() => import('@/components/board/MainBoard'), { ssr: false });
const BoardHomeDynamic = dynamic(() => import('@/components/workspace/BoardHome'), { ssr: false });

export default function Home() {
  const { currentUser, boards, currentBoardId, _loaded } = useBoard();

  if (!_loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-sky-500 rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading...</p>
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
