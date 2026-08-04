'use client';

import { useBoard } from '@/context/BoardContext';
import dynamic from 'next/dynamic';

const LoginPageDynamic = dynamic(() => import('./login/page'), { ssr: false });
const MainBoardDynamic = dynamic(() => import('@/components/board/MainBoard'), { ssr: false });
const BoardHomeDynamic = dynamic(() => import('@/components/workspace/BoardHome'), { ssr: false });

export default function Home() {
  const { currentUser, boards, currentBoardId } = useBoard();

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
