import type { Metadata } from 'next';
import './globals.css';
import { BoardProvider } from '@/context/BoardContext';
import { LangProvider } from '@/context/LangContext';

export const metadata: Metadata = {
  title: 'Trello Clone - 项目协作看板',
  description: '功能完整的Trello克隆 - 团队项目管理与协作工具',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <LangProvider>
          <BoardProvider>
            {children}
          </BoardProvider>
        </LangProvider>
      </body>
    </html>
  );
}
