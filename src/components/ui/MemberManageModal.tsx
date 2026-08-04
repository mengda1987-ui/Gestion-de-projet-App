'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '@/context/BoardContext';
import { useLang } from '@/context/LangContext';
import { Avatar } from '@/components/ui/Avatar';
import { generateId } from '@/lib/utils';
import {
  X,
  Plus,
  Trash2,
  Shield,
  User2,
  Users,
  Key,
  Mail,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onClose: () => void;
}

const COLORS = ['#3B82F6', '#EC4899', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#F97316'];

export default function MemberManageModal({ onClose }: Props) {
  const { users, currentUser, dispatch } = useBoard();
  const { lang } = useLang();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleAddUser = () => {
    const name = newName.trim();
    if (!name || !newPassword.trim()) return;

    const user = {
      id: generateId(),
      name,
      email: newEmail.trim() || `${name.toLowerCase().replace(/\s/g, '')}@team.com`,
      avatar: `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=cute%20cartoon%20avatar%20kawaii%20style%20big%20eyes%20round%20face%20pastel%20background&image_size=square`,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      role: 'member' as const,
      password: newPassword.trim(),
    };

    // 检查重名
    if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) {
      alert(lang === 'zh' ? '该名字已存在，请换一个' : 'Name already taken');
      return;
    }

    dispatch({ type: 'ADD_USER', payload: { user } });
    setNewName('');
    setNewEmail('');
    setNewPassword('');
    setShowAdd(false);
  };

  const handleDeleteUser = (userId: string, userName: string) => {
    const target = users.find(u => u.id === userId);
    if (target?.role === 'admin') {
      alert(lang === 'zh' ? '不能删除管理员账号' : 'Cannot delete admin account');
      return;
    }
    if (!confirm(lang === 'zh' ? `确定删除成员「${userName}」？此操作不可撤销。` : `Delete member "${userName}"? This cannot be undone.`)) return;
    dispatch({ type: 'DELETE_USER', payload: { userId } });
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md apple-card overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
                <Users size={18} className="text-violet-600" />
              </div>
              <div>
                <h2 className="font-bold text-slate-800 text-base">
                  {lang === 'zh' ? '成员管理' : 'Member Management'}
                </h2>
                <p className="text-xs text-slate-400">
                  {lang === 'zh' ? `${users.length} 位成员` : `${users.length} members`}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Member List */}
        <div className="p-2 max-h-[50vh] overflow-y-auto">
          <div className="space-y-0.5">
            {users.map(user => (
              <div
                key={user.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors',
                  user.id === currentUser?.id && 'bg-sky-50 border border-sky-100'
                )}
              >
                <Avatar user={user} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-800 truncate">{user.name}</span>
                    {user.id === currentUser?.id && (
                      <span className="text-[10px] font-medium text-sky-600 bg-sky-100 px-1.5 py-0.5 rounded-full shrink-0">
                        {lang === 'zh' ? '我' : 'Me'}
                      </span>
                    )}
                    {user.role === 'admin' && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full shrink-0">
                        <Shield size={9} />
                        {lang === 'zh' ? '管理员' : 'Admin'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                    <Mail size={10} />
                    <span className="truncate">{user.email}</span>
                  </div>
                </div>
                {user.role !== 'admin' && user.id !== currentUser?.id && (
                  <button
                    onClick={() => handleDeleteUser(user.id, user.name)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                    title={lang === 'zh' ? '删除成员' : 'Delete member'}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Add New Member */}
        <div className="p-4 border-t border-slate-100 bg-slate-50">
          {!showAdd ? (
            <button
              onClick={() => setShowAdd(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-sm font-medium text-slate-500 hover:border-[#007AFF] hover:text-[#007AFF] hover:bg-blue-50/50 transition-all"
            >
              <Plus size={16} />
              {lang === 'zh' ? '添加新成员' : 'Add new member'}
            </button>
          ) : (
            <div className="space-y-3 animate-slide-up">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 pl-1">
                <User2 size={12} />
                {lang === 'zh' ? '新建成员账号' : 'New member account'}
              </div>

              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddUser(); if (e.key === 'Escape') setShowAdd(false); }}
                placeholder={lang === 'zh' ? '姓名' : 'Name'}
                className="input"
              />

              <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
                <Mail size={10} />
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={lang === 'zh' ? '邮箱（选填）' : 'Email (optional)'}
                  className="flex-1 bg-transparent border-0 text-slate-600 placeholder:text-slate-300 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-400">
                <Key size={10} />
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddUser(); }}
                  placeholder={lang === 'zh' ? '登录密码（必填）' : 'Login password (required)'}
                  className="flex-1 bg-transparent border-0 text-slate-600 placeholder:text-slate-300 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleAddUser}
                  disabled={!newName.trim() || !newPassword.trim()}
                  className={cn(
                    'flex-1 py-2 rounded-full text-sm font-medium text-white transition-all',
                    newName.trim() && newPassword.trim()
                      ? 'bg-[#007AFF] hover:bg-[#0066d6] shadow-sm'
                      : 'bg-slate-300 cursor-not-allowed'
                  )}
                >
                  {lang === 'zh' ? '创建账号' : 'Create account'}
                </button>
                <button
                  onClick={() => {
                    setShowAdd(false);
                    setNewName('');
                    setNewEmail('');
                    setNewPassword('');
                  }}
                  className="py-2 px-4 rounded-full text-sm font-medium border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
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
