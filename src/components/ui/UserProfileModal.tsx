'use client';

import { useState, useEffect } from 'react';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { User } from '@/types';
import {
  X,
  UserCircle2,
  Mail,
  Palette,
  Upload,
  Image as ImageIcon,
  Sparkles,
  Check,
  Lock,
  Key,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface UserProfileModalProps {
  onClose: () => void;
}

const PRESET_COLORS = [
  '#3B82F6',
  '#EC4899',
  '#8B5CF6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#06B6D4',
  '#F97316',
  '#14B8A6',
  '#6366F1',
  '#84CC16',
  '#DB2777',
];

const AVATAR_PRESETS = [
  // ===== 6 位女性 · 著名绘画 =====
  { name: '🖼️ 蒙娜丽莎', prompt: 'cute%20cartoon%20Mona%20Lisa%20portrait%20avatar%20kawaii%20style%20mysterious%20smile%20dark%20hair%20renaissance%20dress%20pastel%20background%20big%20eyes' },
  { name: '💎 珍珠耳环', prompt: 'cute%20cartoon%20Girl%20with%20a%20Pearl%20Earring%20avatar%20kawaii%20style%20blue%20turban%20large%20pearl%20earring%20soft%20gaze%20golden%20background' },
  { name: '🌺 弗里达', prompt: 'cute%20cartoon%20Frida%20Kahlo%20avatar%20kawaii%20style%20flower%20crown%20unibrow%20colorful%20mexican%20dress%20vibrant%20background' },
  { name: '🐚 维纳斯', prompt: 'cute%20cartoon%20Botticelli%20Venus%20avatar%20kawaii%20style%20flowing%20golden%20hair%20seashell%20soft%20pastel%20pink%20sky%20background' },
  { name: '✨ 阿黛尔', prompt: 'cute%20cartoon%20Klimt%20Adele%20Bloch%20Bauer%20avatar%20kawaii%20style%20golden%20mosaic%20dress%20dark%20hair%20ornate%20gold%20background' },
  { name: '👑 玛丽皇后', prompt: 'cute%20cartoon%20Marie%20Antoinette%20avatar%20kawaii%20style%20tall%20powdered%20white%20wig%20rococo%20dress%20powder%20blue%20background' },
  // ===== 6 位男性 · 著名绘画 =====
  { name: '😱 呐喊', prompt: 'cute%20cartoon%20The%20Scream%20Munch%20avatar%20kawaii%20style%20hands%20on%20cheeks%20surprised%20face%20wavy%20blue%20orange%20sky%20background' },
  { name: '🎨 梵高', prompt: 'cute%20cartoon%20Van%20Gogh%20self%20portrait%20avatar%20kawaii%20style%20bandaged%20ear%20brush%20strokes%20straw%20hat%20blue%20swirly%20background' },
  { name: '🖌️ 伦勃朗', prompt: 'cute%20cartoon%20Rembrandt%20self%20portrait%20avatar%20kawaii%20style%20beret%20hat%20warm%20chiaroscuro%20lighting%20dark%20brown%20background%20big%20eyes' },
  { name: '🐴 拿破仑', prompt: 'cute%20cartoon%20Napoleon%20crossing%20Alps%20avatar%20kawaii%20style%20bicorne%20hat%20military%20coat%20horse%20heroic%20pose%20golden%20background' },
  { name: '🔷 毕加索', prompt: 'cute%20cartoon%20Picasso%20self%20portrait%20avatar%20kawaii%20style%20cubist%20geometric%20face%20bold%20colors%20abstract%20background' },
  { name: '🌾 哥特式', prompt: 'cute%20cartoon%20American%20Gothic%20farmer%20avatar%20kawaii%20style%20pitchfork%20overalls%20serious%20face%20white%20house%20background' },
];

export default function UserProfileModal({ onClose }: UserProfileModalProps) {
  const { currentUser, dispatch, broadcastChange } = useBoard();
  const { lang, t } = useLang();
  const [form, setForm] = useState({ name: '', email: '', avatar: '', color: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // 密码修改
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  // 头像缩放
  const [rawAvatar, setRawAvatar] = useState<string | null>(null);
  const [uploadScale, setUploadScale] = useState(100);

  // Canvas 缩放图片
  const resizeImageOnCanvas = (dataUrl: string, scalePercent: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.round(Math.min(img.width, img.height) * scalePercent / 100);
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const sx = (img.width - Math.min(img.width, img.height)) / 2;
        const sy = (img.height - Math.min(img.width, img.height)) / 2;
        const sSize = Math.min(img.width, img.height);
        ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = dataUrl;
    });
  };

  useEffect(() => {
    if (currentUser) {
      setForm({
        name: currentUser.name,
        email: currentUser.email,
        avatar: currentUser.avatar,
        color: currentUser.color,
      });
    }
  }, [currentUser]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!currentUser) return null;

  const buildAvatar = (prompt: string) =>
    `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${prompt}&image_size=square`;

  const handleSave = async () => {
    setSaving(true);
    const updates: Partial<User> = {};
    if (form.name.trim()) updates.name = form.name.trim();
    if (form.email.trim()) updates.email = form.email.trim();
    if (form.color.trim()) updates.color = form.color.trim();

    // 如果有上传的头像，先缩放
    if (rawAvatar && rawAvatar === form.avatar) {
      const resized = await resizeImageOnCanvas(rawAvatar, uploadScale);
      updates.avatar = resized;
    } else if (form.avatar.trim()) {
      updates.avatar = form.avatar.trim();
    }

    broadcastChange({
      type: 'UPDATE_USER',
      payload: { userId: currentUser.id, updates },
    });

    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setRawAvatar(null);
      setUploadScale(100);
      setTimeout(() => setSaved(false), 1500);
    }, 300);
  };

  const handlePasswordChange = () => {
    setPasswordError('');
    setPasswordSuccess(false);

    if (currentPassword !== currentUser.password) {
      setPasswordError(lang === 'zh' ? '当前密码不正确' : 'Current password is incorrect');
      return;
    }
    if (!newPassword.trim() || newPassword.trim().length < 4) {
      setPasswordError(lang === 'zh' ? '新密码至少需要4个字符' : 'New password must be at least 4 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(lang === 'zh' ? '两次输入的密码不一致' : 'Passwords do not match');
      return;
    }

    broadcastChange({
      type: 'UPDATE_USER',
      payload: { userId: currentUser.id, updates: { password: newPassword.trim() } },
    });

    setPasswordSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setTimeout(() => setPasswordSuccess(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-lg glass rounded-2xl overflow-hidden shadow-2xl animate-slide-up"
        style={{ isolation: 'isolate' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header cover */}
        <div
          className="h-28 relative"
          style={{
            background: `linear-gradient(135deg, ${form.color}CC 0%, ${form.color}55 100%)`,
          }}
        >
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Avatar */}
        <div className="relative px-6">
          <div
            className="w-24 h-24 -mt-12 rounded-2xl border-4 border-white dark:border-slate-800 overflow-hidden shadow-lg bg-white"
            style={{ boxShadow: `0 8px 24px ${form.color}40` }}
          >
            {form.avatar ? (
              <img
                src={form.avatar}
                alt={form.name}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-white text-2xl font-bold"
                style={{ backgroundColor: form.color }}
              >
                {form.name?.charAt(0) || '?'}
              </div>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="p-6 pt-4 space-y-5 max-h-[65vh] overflow-y-auto">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('profile.title')}</h2>
            <p className="text-xs text-slate-500 mt-1">{lang === 'zh' ? '修改后将同步给其他协作者' : 'Changes will sync to all collaborators'}</p>
          </div>

          {/* Name */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
              <UserCircle2 size={14} />
              {t('user.name')}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              placeholder={lang === 'zh' ? '输入你的名字' : 'Enter your name'}
            />
          </div>

          {/* Email */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
              <Mail size={14} />
              {t('user.email')}
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="input"
              placeholder="you@example.com"
            />
          </div>

          {/* Password Change */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
            <button
              onClick={() => setShowPasswordSection(!showPasswordSection)}
              className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
            >
              <Lock size={14} />
              {lang === 'zh' ? '修改密码' : 'Change password'}
              <span className="text-[10px] text-slate-400">{showPasswordSection ? '▲' : '▼'}</span>
            </button>

            {showPasswordSection && (
              <div className="mt-3 space-y-3 animate-slide-up">
                {/* Current Password */}
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 pl-1">
                    <Key size={11} />
                    {lang === 'zh' ? '当前密码' : 'Current password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPw ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => { setCurrentPassword(e.target.value); setPasswordError(''); }}
                      className="input pr-9 text-sm"
                      placeholder="••••••"
                    />
                    <button
                      onClick={() => setShowCurrentPw(!showCurrentPw)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600"
                    >
                      {showCurrentPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* New Password */}
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 pl-1">
                    <Lock size={11} />
                    {lang === 'zh' ? '新密码' : 'New password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPw ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                      className="input pr-9 text-sm"
                      placeholder={lang === 'zh' ? '至少4个字符' : 'At least 4 characters'}
                    />
                    <button
                      onClick={() => setShowNewPw(!showNewPw)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600"
                    >
                      {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 pl-1">
                    <Check size={11} />
                    {lang === 'zh' ? '确认新密码' : 'Confirm new password'}
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(''); }}
                    className="input text-sm"
                    placeholder={lang === 'zh' ? '再次输入新密码' : 'Re-enter new password'}
                  />
                </div>

                {/* Error / Success */}
                {passwordError && (
                  <p className="text-[11px] text-red-500 dark:text-red-400 pl-1">{passwordError}</p>
                )}
                {passwordSuccess && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 pl-1 flex items-center gap-1">
                    <Check size={12} />
                    {lang === 'zh' ? '密码修改成功！' : 'Password changed successfully!'}
                  </p>
                )}

                <button
                  onClick={handlePasswordChange}
                  disabled={!currentPassword || !newPassword || !confirmPassword}
                  className={cn(
                    'w-full py-2 rounded-xl text-xs font-bold transition-all',
                    currentPassword && newPassword && confirmPassword
                      ? 'bg-gradient-to-r from-violet-500 to-indigo-600 text-white hover:from-violet-600 hover:to-indigo-700 shadow-md'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                  )}
                >
                  {lang === 'zh' ? '更新密码' : 'Update password'}
                </button>
              </div>
            )}
          </div>

          {/* Color */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
              <Palette size={14} />
              {t('user.themeColor')}
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className={cn(
                    'w-8 h-8 rounded-lg transition-all ring-2 ring-offset-2 dark:ring-offset-slate-800',
                    form.color === c
                      ? 'ring-slate-800 dark:ring-white scale-110'
                      : 'ring-transparent hover:scale-105'
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={(lang === 'zh' ? '选择颜色' : 'Select color') + ' ' + c}
                />
              ))}
            </div>
          </div>

          {/* Avatar Presets */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
              <Sparkles size={14} />
              {lang === 'zh' ? '预设头像' : 'Preset avatars'}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {AVATAR_PRESETS.map((p) => {
                const url = buildAvatar(p.prompt);
                const isActive = form.avatar === url;
                return (
                  <button
                    key={p.prompt}
                    onClick={() => setForm({ ...form, avatar: url })}
                    className={cn(
                      'relative aspect-square rounded-xl overflow-hidden border-2 transition-all',
                      isActive
                        ? 'border-sky-500 ring-2 ring-sky-200 dark:ring-sky-800'
                        : 'border-transparent hover:border-slate-300 dark:hover:border-slate-600'
                    )}
                    title={p.name}
                  >
                    <img
                      src={url}
                      alt={p.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {isActive && (
                      <div className="absolute inset-0 bg-sky-500/30 flex items-center justify-center">
                        <Check size={18} className="text-white drop-shadow" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Avatar — Upload or URL */}
          <div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
              <ImageIcon size={14} />
              {lang === 'zh' ? '自定义头像' : 'Custom avatar'}
            </label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-sky-400 cursor-pointer transition-all shrink-0">
                <Upload size={13} />
                {lang === 'zh' ? '上传图片' : 'Upload image'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1024 * 1024) {
                      alert(lang === 'zh' ? '图片不能超过 1MB' : 'Image must be less than 1MB');
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = reader.result as string;
                      setRawAvatar(dataUrl);
                      setUploadScale(100);
                      setForm({ ...form, avatar: dataUrl });
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="text-[10px] text-slate-400 shrink-0">{lang === 'zh' ? '< 1MB' : '< 1MB'}</span>
              <input
                value={form.avatar}
                onChange={(e) => setForm({ ...form, avatar: e.target.value })}
                className="flex-1 input text-xs min-w-0"
                placeholder="https://..."
              />
            </div>
            {form.avatar && !form.avatar.startsWith('http') && (
              <div className="mt-2 pl-1 space-y-1.5">
                <p className="text-[10px] text-emerald-500 dark:text-emerald-400 flex items-center gap-1">
                  <Check size={11} />
                  {lang === 'zh' ? '已上传自定义头像' : 'Custom avatar uploaded'}
                </p>
                {/* Scale / zoom slider */}
                {rawAvatar && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 w-8 text-right shrink-0">
                      {uploadScale}%
                    </span>
                    <input
                      type="range"
                      min={50}
                      max={150}
                      value={uploadScale}
                      onChange={(e) => {
                        const scale = Number(e.target.value);
                        setUploadScale(scale);
                        resizeImageOnCanvas(rawAvatar, scale).then(resized => {
                          setForm({ ...form, avatar: resized });
                        });
                      }}
                      className="flex-1 h-1 accent-sky-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {lang === 'zh' ? '缩放' : 'Zoom'}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm py-2">
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (!form.name.trim() && !form.email.trim())}
            className="btn-primary text-sm py-2 min-w-[110px] flex items-center justify-center gap-1.5"
          >
            {saving ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" className="opacity-75" />
              </svg>
            ) : saved ? (
              <>
                <Check size={16} />
                {lang === 'zh' ? '已保存' : 'Saved!'}
              </>
            ) : (
              <>
                <Upload size={14} />
                {lang === 'zh' ? '保存修改' : 'Save changes'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
