'use client';

import { useState, useRef } from 'react';
import { useLang } from '@/context/LangContext';
import { Upload, X, RotateCcw, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const IMG_API = 'https://coresg-normal.trae.ai/api/ide/v1/text_to_image';

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

const NATURE_SCENES = [
  { name: 'misty mountains', prompt: 'breathtaking%20sunrise%20over%20misty%20mountains%20with%20fog%20valley%20warm%20golden%20light%20professional%20landscape%20photography' },
  { name: 'tropical beach', prompt: 'beautiful%20tropical%20beach%20at%20sunset%20palm%20trees%20crystal%20clear%20turquoise%20water%20soft%20pastel%20sky%20professional%20photography' },
  { name: 'cherry blossoms', prompt: 'japanese%20cherry%20blossom%20garden%20in%20full%20bloom%20pink%20petals%20stone%20path%20traditional%20temple%20spring%20sunlight%20professional%20photography' },
  { name: 'aurora borealis', prompt: 'aurora%20borealis%20northern%20lights%20over%20snowy%20mountain%20peaks%20green%20purple%20sky%20reflection%20on%20frozen%20lake%20professional%20photography' },
  { name: 'lavender field', prompt: 'endless%20lavender%20field%20in%20Provence%20at%20golden%20hour%20purple%20flowers%20rolling%20hills%20warm%20sunset%20light%20professional%20photography' },
  { name: 'bamboo forest', prompt: 'serene%20bamboo%20forest%20with%20sunbeams%20streaming%20through%20tall%20green%20stalks%20peaceful%20meditative%20atmosphere%20professional%20photography' },
  { name: 'autumn maple', prompt: 'beautiful%20autumn%20maple%20forest%20path%20vibrant%20red%20orange%20yellow%20leaves%20sunlight%20filtering%20through%20trees%20professional%20photography' },
  { name: 'starry lake', prompt: 'starry%20night%20sky%20over%20mountain%20lake%20milky%20way%20galaxy%20reflection%20on%20calm%20water%20snow%20capped%20peaks%20professional%20photography' },
  { name: 'ocean waves', prompt: 'turquoise%20ocean%20waves%20crashing%20on%20white%20sand%20beach%20aerial%20view%20crystal%20clear%20water%20gradient%20blue%20depths%20professional%20photography' },
  { name: 'winter pines', prompt: 'snowy%20pine%20forest%20in%20winter%20morning%20light%20fresh%20snow%20covering%20trees%20soft%20fog%20peaceful%20atmosphere%20professional%20photography' },
  { name: 'desert dunes', prompt: 'golden%20sand%20dunes%20in%20the%20Sahara%20desert%20at%20sunset%20dramatic%20shadows%20warm%20orange%20light%20wind%20ripples%20professional%20photography' },
  { name: 'tea plantation', prompt: 'lush%20green%20tea%20plantation%20terraces%20on%20rolling%20hills%20sunrise%20mist%20geometric%20patterns%20peaceful%20landscape%20professional%20photography' },
  { name: 'tropical waterfall', prompt: 'majestic%20waterfall%20in%20tropical%20rainforest%20lush%20green%20vegetation%20rainbow%20in%20mist%20crystal%20pool%20below%20professional%20photography' },
  { name: 'wildflower meadow', prompt: 'beautiful%20wildflower%20meadow%20under%20blue%20summer%20sky%20colorful%20flowers%20daisies%20poppies%20rolling%20hills%20fluffy%20clouds%20professional%20photography' },
  { name: 'norwegian fjord', prompt: 'dramatic%20Norwegian%20fjord%20with%20towering%20cliffs%20emerald%20water%20waterfall%20cascading%20down%20sunrise%20golden%20light%20professional%20photography' },
  { name: 'wheat field', prompt: 'golden%20wheat%20field%20at%20golden%20hour%20sunset%20warm%20amber%20light%20gentle%20breeze%20rippling%20through%20grain%20distant%20trees%20professional%20photography' },
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

      {/* Nature Scenes */}
      <div>
        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wider">
          {lang === 'zh' ? '自然风景封面' : 'Nature scenes'}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {NATURE_SCENES.map((scene) => {
            const imgUrl = `${IMG_API}?prompt=${scene.prompt}&image_size=landscape_16_9`;
            const bgValue = `url(${imgUrl})`;
            return (
              <button
                key={scene.name}
                onClick={() => { onSelect(bgValue); onClose(); }}
                className={cn(
                  'relative h-16 rounded-xl overflow-hidden transition-all hover:scale-105 active:scale-95 group',
                  current.includes(scene.prompt) && 'ring-2 ring-[#007AFF] ring-offset-2'
                )}
              >
                <img
                  src={imgUrl}
                  alt={scene.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/50 to-transparent flex items-end justify-center pb-0.5">
                  <span className="text-[9px] text-white font-medium capitalize truncate px-1">{scene.name}</span>
                </div>
              </button>
            );
          })}
        </div>
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
