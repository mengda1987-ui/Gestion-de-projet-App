'use client';

import { Label } from '@/types';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

interface LabelBadgeProps {
  label?: Label;
  name?: string;
  color?: string;
  onRemove?: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  clickable?: boolean;
  onClick?: () => void;
}

const sizeClasses = {
  sm: 'h-1.5 rounded-sm',
  md: 'h-2 rounded',
  lg: 'h-2.5 rounded-md',
};

const badgeSizeClasses = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-0.5',
  lg: 'text-sm px-2.5 py-1',
};

export function LabelBadge({ label, name, color, onRemove, size = 'sm', className, clickable, onClick }: LabelBadgeProps) {
  const labelName = label?.name || name || '';
  const labelColor = label?.color || color || '#64748B';

  if (clickable) {
    return (
      <button
        onClick={onClick}
        style={{ backgroundColor: labelColor }}
        className={cn(
          badgeSizeClasses[size],
          'rounded font-medium text-white flex items-center gap-1 hover:opacity-90 transition-opacity',
          className
        )}
      >
        {labelName}
        {onRemove && (
          <X size={12} className="shrink-0" onClick={(e) => { e.stopPropagation(); onRemove(); }} />
        )}
      </button>
    );
  }

  if (size === 'sm' || size === 'md' || size === 'lg') {
    if (!labelName) {
      return (
        <div
          style={{ backgroundColor: labelColor }}
          className={cn(sizeClasses[size], 'w-full min-w-[40px]', className)}
          title={labelName}
        />
      );
    }
    return (
      <span
        style={{ backgroundColor: labelColor }}
        className={cn(
          badgeSizeClasses[size],
          'rounded font-medium text-white flex items-center gap-1',
          className
        )}
      >
        {labelName}
        {onRemove && (
          <button onClick={onRemove} className="hover:bg-white/20 rounded transition-colors">
            <X size={12} />
          </button>
        )}
      </span>
    );
  }

  return null;
}

export function LabelStrip({ labels, allLabels, className }: { labels: string[]; allLabels: Label[]; className?: string }) {
  const matchedLabels = labels.map((id: string) => allLabels.find((l: Label) => l.id === id)).filter(Boolean) as Label[];
  if (matchedLabels.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {matchedLabels.map(label => (
        <LabelBadge key={label.id} label={label} size="sm" />
      ))}
    </div>
  );
}
