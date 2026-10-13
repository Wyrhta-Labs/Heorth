import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;            // 0..100
  color?: string;           // any CSS colour; defaults to the theme's primary
  className?: string;
}

export function Progress({ value, color = 'var(--color-primary)', className }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-[5px] w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}
