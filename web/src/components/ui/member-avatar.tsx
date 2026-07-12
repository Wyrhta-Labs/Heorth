import { cn } from '@/lib/utils';
import { MEMBER_COLORS } from '@/lib/constants';
import type { AvatarColor } from '@/lib/types';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

interface MemberAvatarProps {
  name: string;
  color: AvatarColor;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
}

const SIZES = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' };

export function MemberAvatar({ name, color, size = 'md', className, title }: MemberAvatarProps) {
  return (
    <span
      title={title ?? name}
      className={cn('inline-flex items-center justify-center rounded-full font-semibold text-white select-none', SIZES[size], className)}
      style={{ backgroundColor: MEMBER_COLORS[color] }}
    >
      {initials(name)}
    </span>
  );
}
