'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { LogIn, Languages, User2, Lock, Palette, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import BackgroundPicker from '@/components/ui/BackgroundPicker';

export default function LoginPage() {
  const { users, dispatch, loginBackground } = useBoard();
  const { lang, toggleLang, t, setLang } = useLang();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [isLogging, setIsLogging] = useState(false);
  const [error, setError] = useState('');
  const [showBgPicker, setShowBgPicker] = useState(false);

  const handleLogin = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(lang === 'zh' ? '请输入名字' : 'Please enter your name');
      return;
    }
    if (!password) {
      setError(lang === 'zh' ? '请输入密码' : 'Please enter your password');
      return;
    }
    setError('');
    setIsLogging(true);
    await new Promise(r => setTimeout(r, 600));

    const user = users.find(u => u.name.toLowerCase() === trimmed.toLowerCase());
    if (!user) {
      setError(lang === 'zh' ? '用户不存在，请联系管理员创建账号' : 'User not found. Contact admin to create an account.');
      setIsLogging(false);
      return;
    }
    if (user.password !== password) {
      setError(lang === 'zh' ? '密码错误' : 'Incorrect password');
      setIsLogging(false);
      return;
    }
    dispatch({ type: 'SET_CURRENT_USER', payload: user });
    dispatch({ type: 'SET_CURRENT_BOARD', payload: '' });
    setLang(user.lang || 'zh');
  };

  const getBgStyle = (bg: string): React.CSSProperties => {
    if (bg.startsWith('url(') || bg.startsWith('data:')) {
      return {
        backgroundImage: bg,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    }
    if (bg.startsWith('linear-gradient') || bg.startsWith('radial-gradient')) {
      return { background: bg };
    }
    return { backgroundColor: bg };
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative" style={getBgStyle(loginBackground)}>
      {/* Subtle gradient orb — only shown when bg is not an image */}
      {!(loginBackground.startsWith('url(') || loginBackground.startsWith('data:')) && (
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
      )}

      {/* Top-right buttons */}
      <div className="fixed top-5 right-5 z-50 flex items-center gap-2">
        <button
          onClick={() => setShowBgPicker(true)}
          className="px-3 py-2 rounded-full text-xs font-medium bg-white/80 dark:bg-slate-800/80 backdrop-blur text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 shadow-sm transition-all"
          title={lang === 'zh' ? '更换背景' : 'Change background'}
        >
          <Palette size={14} />
        </button>
        <button
          onClick={toggleLang}
          className="px-3 py-2 rounded-full text-xs font-medium bg-white/80 dark:bg-slate-800/80 backdrop-blur text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 shadow-sm transition-all"
        >
          <Languages size={14} className="inline mr-1" />
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </div>

      <div className="relative w-full max-w-sm">
        <div className="apple-card p-8 animate-slide-up">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight mb-1">
              LES FRANCOPHILES
            </h1>
            <p className="text-base font-semibold text-[#007AFF]">
              Gestion de projet
            </p>
          </div>

          {/* Form */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-2 pl-1">
                <User2 size={13} />
                {lang === 'zh' ? '名字' : 'Name'}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
                placeholder={lang === 'zh' ? '输入你的名字' : 'Enter your name'}
                autoFocus
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF]/40 transition-all"
                style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-500 mb-2 pl-1">
                <Lock size={13} />
                {lang === 'zh' ? '密码' : 'Password'}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLogin(); }}
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF]/40 transition-all"
                style={{ boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' }}
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 text-center">{error}</p>
            )}
          </div>

          {/* Login button */}
          <button
            disabled={isLogging}
            onClick={handleLogin}
            className={cn(
              'w-full rounded-full py-3 font-semibold text-white text-sm transition-all duration-200 active:scale-[0.98]',
              isLogging
                ? 'bg-[#007AFF]/60 cursor-not-allowed'
                : 'bg-[#007AFF] hover:bg-[#0066d6]'
            )}
            style={{ boxShadow: isLogging ? 'none' : '0 2px 12px rgba(0,122,255,0.3)' }}
          >
            {isLogging ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                </svg>
                {lang === 'zh' ? '登录中…' : 'Logging in…'}
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <LogIn className="w-4 h-4" />
                {lang === 'zh' ? '登录' : 'Log in'}
              </span>
            )}
          </button>

          <p className="text-center text-[11px] text-slate-400 mt-5">
            {lang === 'zh'
              ? `${users.length} 位成员 · 默认密码 123456`
              : `${users.length} members · Default password: 123456`}
          </p>
        </div>
      </div>

      {/* Version */}
      <p className="absolute bottom-6 right-4 text-xs text-black font-medium">v1.1.23</p>

      {/* Background Picker */}
      {showBgPicker && createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowBgPicker(false)} />
          <div className="relative w-full max-w-sm apple-card p-6 animate-slide-up max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900 text-lg">
                {lang === 'zh' ? '登录页背景设置' : 'Login page background'}
              </h3>
              <button
                onClick={() => setShowBgPicker(false)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <BackgroundPicker
              current={loginBackground}
              defaultBg="linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)"
              onSelect={(bg) => dispatch({ type: 'UPDATE_LOGIN_BG', payload: bg })}
              onClose={() => setShowBgPicker(false)}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
