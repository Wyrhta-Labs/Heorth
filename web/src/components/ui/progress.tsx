import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;            // 0..100
  color?: string;           // hex fill; defaults to ember
  className?: string;
}

export function Progress({ value, color = '#b5542f', className }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-tan/60', className)}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}
