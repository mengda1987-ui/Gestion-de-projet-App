import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BoardProvider } from '@/context/BoardContext';
import { LangProvider } from '@/context/LangContext';

export const metadata: Metadata = {
  title: 'Trello Clone - 项目协作看板',
  description: '功能完整的Trello克隆 - 团队项目管理与协作工具',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { rel: 'apple-touch-icon-precomposed', url: '/apple-touch-icon.png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '看板',
  },
  applicationName: '看板',
  authors: [{ name: 'Les Francophiles' }],
  keywords: ['看板', 'Trello', '项目管理', '协作', '团队'],
  category: 'productivity',
  openGraph: {
    type: 'website',
    title: 'Trello Clone - 项目协作看板',
    description: '功能完整的Trello克隆 - 团队项目管理与协作工具',
    images: [{ url: '/icon-512.png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#007AFF',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
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
