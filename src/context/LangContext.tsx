'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Lang, DEFAULT_LANG, detectLang, LANG_KEY, t as tRaw } from '@/lib/i18n';

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);
  const langRef = useRef<Lang>(DEFAULT_LANG);

  useEffect(() => {
    const detected = detectLang();
    setLangState(detected);
    langRef.current = detected;
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    langRef.current = l;
    try { window.localStorage.setItem(LANG_KEY, l); } catch {}
    try { document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'; } catch {}
  }, []);

  const toggleLang = useCallback(() => {
    setLang(langRef.current === 'zh' ? 'en' : 'zh');
  }, [setLang]);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    return tRaw(langRef.current, key, vars);
  }, []);

  useEffect(() => { langRef.current = lang; }, [lang]);

  const value = useMemo(() => ({ lang, setLang, toggleLang, t }), [lang, setLang, toggleLang, t]);

  return React.createElement(Ctx.Provider, { value }, children);
}

export function useLang(): LangCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      lang: DEFAULT_LANG,
      setLang: () => {},
      toggleLang: () => {},
      t: (k, v) => tRaw(DEFAULT_LANG, k, v),
    };
  }
  return ctx;
}
