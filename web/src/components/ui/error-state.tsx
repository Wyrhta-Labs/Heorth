import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  /** What failed to load. Falls back to a generic line. */
  message?: string;
  /** When provided, a "Try again" button is shown that calls this. */
  onRetry?: () => void;
  /** Compact inline treatment for dashboard widgets (no large padding). */
  compact?: boolean;
  className?: string;
}

/**
 * Consistent, on-brand surface for a failed query. Replaces the silent
 * empty-state pages used to fall back to, and offers a retry affordance.
 */
export function ErrorState({ message, onRetry, compact, className }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-tan bg-card text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      <AlertTriangle className={cn('text-ember', compact ? 'h-5 w-5' : 'h-7 w-7')} aria-hidden />
      <div className={cn('font-medium text-ink', compact ? 'text-sm' : 'text-base')}>
        {message ?? t('common.loadFailed')}
      </div>
      {!compact && (
        <p className="text-sm text-ash">{t('common.checkConnection')}</p>
      )}
      {onRetry && (
        <Button variant="outline" size={compact ? 'sm' : 'default'} onClick={onRetry} className="mt-1">
          <RefreshCw className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
          {t('common.tryAgain')}
        </Button>
      )}
    </div>
  );
}
