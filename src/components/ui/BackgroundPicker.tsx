'use client';

import { useState, useRef } from 'react';
import { useLang } from '@/context/LangContext';
import { Upload, X, RotateCcw, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const PRESET_GRADIENTS = [
  { label: 'ocean', gradient: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #14b8a6 100%)' },
  { label: 'sunset', gradient: 'linear-gradient(135deg, #f97316 0%, #ef4444 100%)' },
  { label: 'amethyst', gradient: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)' },
  { label: 'forest', gradient: 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)' },
  { label: 'peach', gradient: 'linear-gradient(135deg, #f43f5e 0%, #fbbf24 100%)' },
  { label: 'cosmic', gradient: 'linear-gradient(135deg, #1e293b 0%, #3b82f6 100%)' },
  { label: 'coral', gradient: 'linear-gradient(135deg, #f472b6 0%, #fb923c 100%)' },
  { label: 'mint', gradient: 'linear-gradient(135deg, #34d399 0%, #a3e635 100%)' },
  { label: 'velvet', gradient: 'linear-gradient(135deg, #881337 0%, #dc2626 100%)' },
  { label: 'arctic', gradient: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)' },
  { label: 'golden', gradient: 'linear-gradient(135deg, #f59e0b 0%, #d946ef 100%)' },
  { label: 'berry', gradient: 'linear-gradient(135deg, #c026d3 0%, #ec4899 100%)' },
];

const PRESET_SOLIDS = [
  '#f5f5f7',
  '#1c1c1e',
  '#0f172a',
  '#fef3c7',
  '#ecfdf5',
  '#eff6ff',
  '#fdf2f8',
  '#faf5ff',
];

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

interface BackgroundPickerProps {
  current: string;
  defaultBg: string;
  onSelect: (bg: string) => void;
  onClose: () => void;
}

export default function BackgroundPicker({ current, defaultBg, onSelect, onClose }: BackgroundPickerProps) {
  const { lang } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (file.size > MAX_FILE_SIZE) {
      setError(lang === 'zh' ? '文件大小不能超过 2MB' : 'File size must be under 2MB');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError(lang === 'zh' ? '仅支持图片文件' : 'Only image files are supported');
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (dataUrl.length > 1 * 1024 * 1024) {
        const img = new window.Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1920;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          setUploadPreview(compressed);
          setUploading(false);
        };
        img.src = dataUrl;
      } else {
        setUploadPreview(dataUrl);
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleApplyUpload = () => {
    if (uploadPreview) {
      onSelect(`url(${uploadPreview})`);
      onClose();
    }
  };

  const handleReset = () => {
    onSelect(defaultBg);
    onClose();
  };

  return (
    <div className="space-y-5">
      {/* Custom Upload */}
      <div>
        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">
          {lang === 'zh' ? '自定义图片上传' : 'Custom image upload'}
          <span className="text-slate-400 font-normal ml-1">{lang === 'zh' ? '(最大 2MB)' : '(Max 2MB)'}</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        {uploadPreview ? (
          <div className="space-y-2">
            <div className="relative rounded-xl overflow-hidden h-28 border border-slate-200 dark:border-slate-700">
              <img src={uploadPreview} alt="Preview" className="w-full h-full object-cover" />
              <button
                onClick={() => { setUploadPreview(null); setError(null); }}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
            <button onClick={handleApplyUpload} className="btn-primary w-full text-xs py-2">
              <Check size={14} />
              {lang === 'zh' ? '应用此图片' : 'Apply this image'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-sm text-slate-500 dark:text-slate-400 hover:border-[#007AFF] hover:text-[#007AFF] hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-all"
          >
            {uploading ? (
              <span className="animate-pulse">{lang === 'zh' ? '处理中...' : 'Processing...'}</span>
            ) : (
              <>
                <Upload size={16} />
                {lang === 'zh' ? '上传背景图片' : 'Upload background image'}
              </>
            )}
          </button>
        )}
        {error && (
          <p className="text-[11px] text-red-500 mt-1.5 flex items-center gap-1">
            <X size={11} />
            {error}
          </p>
        )}
      </div>

      {/* Preset Gradients */}
      <div>
        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">
          {lang === 'zh' ? '预设渐变' : 'Preset gradients'}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {PRESET_GRADIENTS.map(({ label, gradient }) => (
            <button
              key={label}
              onClick={() => { onSelect(gradient); onClose(); }}
              className={cn(
                'h-12 rounded-xl transition-all hover:scale-105 active:scale-95',
                current === gradient && 'ring-2 ring-[#007AFF] ring-offset-2'
              )}
              style={{ background: gradient }}
              title={label}
            />
          ))}
        </div>
      </div>

      {/* Preset Solids */}
      <div>
        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">
          {lang === 'zh' ? '纯色背景' : 'Solid colors'}
        </div>
        <div className="grid grid-cols-8 gap-2">
          {PRESET_SOLIDS.map((color) => (
            <button
              key={color}
              onClick={() => { onSelect(color); onClose(); }}
              className={cn(
                'h-9 rounded-lg transition-all hover:scale-110 active:scale-95 border border-slate-200 dark:border-slate-700',
                current === color && 'ring-2 ring-[#007AFF] ring-offset-2'
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={handleReset}
        className="w-full flex items-center justify-center gap-2 py-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
      >
        <RotateCcw size={13} />
        {lang === 'zh' ? '恢复默认背景' : 'Reset to default'}
      </button>
    </div>
  );
}
