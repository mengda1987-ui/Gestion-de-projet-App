'use client';

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  BrainCircuit,
  ListTodo,
  Columns3,
  CheckSquare,
  Play,
  Mic,
  Square,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLang } from '@/context/LangContext';
import { useBoard } from '@/context/BoardContext';
import { generateId } from '@/lib/utils';

interface AIAnalysisResult {
  title: string;
  columns: Array<{
    title: string;
    cards: Array<{
      title: string;
      description?: string;
      dueDate?: string;
      checklists?: Array<{
        name: string;
        items: Array<{
          text: string;
          dueDate?: string;
        }>;
      }>;
    }>;
  }>;
}

interface Props {
  onClose: () => void;
}

// TypeScript declarations for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function AIAssistant({ onClose }: Props) {
  const { t, lang } = useLang();
  const { broadcastChange } = useBoard();
  const [transcript, setTranscript] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<AIAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any | null>(null);

  // ---- Voice Recording via Web Speech API ----
  const SpeechRecognitionCtor: any =
    (typeof window !== 'undefined'
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : null) ?? null;

  const startRecording = () => {
    if (!SpeechRecognitionCtor) {
      setError(t('ai.noSpeechSupport'));
      return;
    }
    setError(null);
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    let finalTranscript = transcript;

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          finalTranscript += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      setTranscript(finalTranscript + (interim ? ' ' + interim : ''));
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setError(lang === 'zh' ? '麦克风权限被拒绝' : 'Microphone permission denied');
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsRecording(false);
  };

  // ---- Analyze via DeepSeek API ----
  const analyze = async () => {
    const text = transcript.trim();
    if (!text) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/analyze-recording', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('ai.error'));
        setIsAnalyzing(false);
        return;
      }
      const normalized: AIAnalysisResult = {
        title: data.title || (lang === 'zh' ? '未命名会议' : 'Untitled Meeting'),
        columns: (data.columns || []).map((col: any) => ({
          title: col.title || (lang === 'zh' ? '未命名主题' : 'Untitled Topic'),
          cards: (col.cards || []).map((card: any) => ({
            title: card.title || (lang === 'zh' ? '未命名任务' : 'Untitled Task'),
            description: card.description || '',
            dueDate: card.dueDate || undefined,
            checklists: (card.checklists || []).map((cl: any) => ({
              name: cl.name || 'Steps',
              items: (cl.items || []).map((item: any) => ({
                text: item.text || '',
                dueDate: item.dueDate || undefined,
              })),
            })),
          })),
        })),
      };
      setResult(normalized);
    } catch {
      setError(t('ai.networkError'));
    }
    setIsAnalyzing(false);
  };

  // ---- Apply to Board ----
  const applyToBoard = () => {
    if (!result) return;
    setIsApplying(true);
    result.columns.forEach((col) => {
      const colId = generateId();
      broadcastChange({
        type: 'ADD_COLUMN',
        payload: { title: col.title },
      } as any);
      col.cards.forEach((card, cdi) => {
        const cardId = generateId();
        broadcastChange({
          type: 'ADD_CARD',
          payload: {
            columnId: colId,
            card: {
              id: cardId,
              title: card.title,
              description: card.description || '',
              dueDate: card.dueDate || undefined,
              checklists: [],
              labels: [],
              assignees: [],
              completed: false,
              archived: false,
              comments: [],
              attachments: [],
              order: cdi,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        } as any);
        (card.checklists || []).forEach((cl) => {
          const clId = generateId();
          broadcastChange({
            type: 'ADD_CHECKLIST',
            payload: { cardId, name: cl.name },
          } as any);
          cl.items.forEach((item) => {
            broadcastChange({
              type: 'ADD_CHECKLIST_ITEM',
              payload: { cardId, checklistId: clId, text: item.text },
            } as any);
          });
        });
      });
    });
    setTimeout(() => {
      setIsApplying(false);
      onClose();
    }, 500);
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[90vh] glass rounded-2xl shadow-2xl border border-white/30 dark:border-slate-700/50 overflow-hidden animate-slide-up flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <BrainCircuit size={20} className="text-white" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-base">{t('ai.title')}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('ai.subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {!result && (
            <>
              {/* Transcript Textarea */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <FileText size={14} />
                    {t('ai.inputLabel')}
                  </label>
                  <span className="text-[11px] text-slate-400">{t('ai.charCount', { n: transcript.length })}</span>
                </div>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder={t('ai.inputPlaceholder')}
                  rows={10}
                  className="input resize-none min-h-[160px]"
                />
              </div>

              {/* Record Button */}
              {SpeechRecognitionCtor && (
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  className={cn(
                    'w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2',
                    isRecording
                      ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                      : 'border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-violet-400 hover:text-violet-500 dark:hover:text-violet-400'
                  )}
                >
                  {isRecording ? (
                    <>
                      <Square size={16} />
                      {t('ai.recording')}
                    </>
                  ) : (
                    <>
                      <Mic size={16} />
                      {t('ai.record')}
                    </>
                  )}
                </button>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
                  <AlertCircle size={18} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Analyze Button */}
              <button
                disabled={!transcript.trim() || isAnalyzing}
                onClick={analyze}
                className={cn(
                    'w-full py-3.5 rounded-full font-semibold text-white transition-all duration-300 flex items-center justify-center gap-2',
                    transcript.trim() && !isAnalyzing
                      ? 'bg-[#007AFF] hover:bg-[#0066d6] shadow-md hover:shadow-lg'
                      : 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed'
                  )}
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    {t('ai.analyzing')}
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    {t('ai.analyze')}
                  </>
                )}
              </button>
            </>
          )}

          {/* Results Preview */}
          {result && (
            <div className="space-y-4">
              {/* Success Banner */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-sm">
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{t('ai.complete')}</p>
                  <p className="opacity-70 text-xs mt-0.5">
                    {result.columns.length} {t('ai.topics')} ·{' '}
                    {result.columns.reduce((s, c) => s + c.cards.length, 0)} {t('ai.tasks')}
                  </p>
                </div>
              </div>

              {/* Meeting Title */}
              <div className="flex items-center gap-2 px-1">
                <FileText size={18} className="text-violet-500" />
                <h3 className="font-bold text-slate-900 dark:text-white text-base">{result.title}</h3>
              </div>

              {/* Columns & Cards Preview */}
              {result.columns.map((col, ci) => (
                <div key={ci} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2.5 flex items-center gap-2">
                    <Columns3 size={16} className="text-indigo-500" />
                    <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">{col.title}</span>
                    <span className="text-xs text-slate-400 ml-auto">{col.cards.length} {t('ai.tasks')}</span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {col.cards.map((card, cdi) => (
                      <div key={cdi} className="px-4 py-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <ListTodo size={15} className="text-amber-500 shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-slate-800 dark:text-slate-200">{card.title}</p>
                            {card.description && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{card.description}</p>
                            )}
                            {card.dueDate && (
                              <span className="inline-block mt-1.5 text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                {card.dueDate}
                              </span>
                            )}
                          </div>
                        </div>
                        {(card.checklists || []).length > 0 && (
                          <div className="ml-7 space-y-1">
                            {(card.checklists || []).map((cl, cli) => (
                              <div key={cli} className="space-y-0.5">
                                {(cl.items || []).map((item, ii) => (
                                  <div key={ii} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                                    <CheckSquare size={12} className="shrink-0 opacity-50" />
                                    <span>{item.text}</span>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setResult(null); setError(null); }}
                  className="flex-1 py-2.5 rounded-full font-medium text-sm border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {t('ai.retry')}
                </button>
                <button
                  onClick={applyToBoard}
                  disabled={isApplying}
                  className={cn(
                    'flex-1 py-2.5 rounded-xl font-bold text-sm text-white transition-all flex items-center justify-center gap-2',
                    isApplying
                      ? 'bg-slate-400 cursor-not-allowed'
                      : 'bg-[#007AFF] hover:bg-[#0066d6] shadow-sm'
                  )}
                >
                  {isApplying ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Play size={16} />
                  )}
                  {t('ai.apply')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
