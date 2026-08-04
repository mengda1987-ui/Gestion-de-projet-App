'use client';

import { User } from '@/types';
import { cn } from '@/lib/utils';

interface AvatarProps {
  user?: User;
  size?: 'sm' | 'md' | 'lg';
  showOnline?: boolean;
  online?: boolean;
  className?: string;
  onClick?: () => void;
}

const sizeClasses = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
};

const dotClasses = {
  sm: 'w-2 h-2 -bottom-0.5 -right-0.5',
  md: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5',
  lg: 'w-3 h-3 -bottom-1 -right-1',
};

export function Avatar({ user, size = 'md', showOnline, online, className, onClick }: AvatarProps) {
  if (!user) return null;
  const initials = user.name.slice(0, 1);
  return (
    <div className={cn('relative inline-flex shrink-0', className)}>
      <div
        onClick={onClick}
        className={cn(
          sizeClasses[size],
          'rounded-full flex items-center justify-center font-semibold text-white shadow-sm ring-2 ring-white dark:ring-slate-900 overflow-hidden',
          onClick && 'cursor-pointer hover:ring-sky-300 transition-all'
        )}
        style={{ backgroundColor: user.color }}
      >
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          initials
        )}
      </div>
      {showOnline && (
        <span
          className={cn(
            dotClasses[size],
            'absolute rounded-full ring-2 ring-white dark:ring-slate-900',
            online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
          )}
        />
      )}
    </div>
  );
}

interface AvatarStackProps {
  users: User[];
  max?: number;
  size?: 'sm' | 'md';
  showOnline?: boolean;
  onlineUsers?: string[];
}

export function AvatarStack({ users, max = 3, size = 'sm', showOnline, onlineUsers }: AvatarStackProps) {
  const displayUsers = users.slice(0, max);
  const remaining = users.length - max;
  return (
    <div className="flex -space-x-2">
      {displayUsers.map((user, idx) => (
        <Avatar
          key={user.id}
          user={user}
          size={size}
          showOnline={showOnline}
          online={onlineUsers?.includes(user.id)}
          className={idx > 0 ? 'z-10' : ''}
        />
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            sizeClasses[size],
            'rounded-full flex items-center justify-center font-semibold text-slate-600 dark:text-slate-300 bg-slate-200 dark:bg-slate-700 ring-2 ring-white dark:ring-slate-900 z-20'
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
