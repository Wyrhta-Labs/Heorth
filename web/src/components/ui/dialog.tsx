import * as React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  /** Width of the panel; defaults to `max-w-lg`. */
  className?: string;
}

/** Marks the element that scrolls the page (the shell's <main>), so an open
 *  dialog can lock it as well as <body>. */
export const SCROLL_ROOT_ATTR = 'data-scroll-root';

// Open dialogs share one lock per element, so stacked dialogs keep the page
// locked until the last one closes, and the original inline value comes back.
const scrollLocks = new Map<HTMLElement, { count: number; previous: string }>();

function lockScroll(): () => void {
  const targets = [document.body, ...document.querySelectorAll<HTMLElement>(`[${SCROLL_ROOT_ATTR}]`)];
  for (const el of targets) {
    const lock = scrollLocks.get(el);
    if (lock) {
      lock.count += 1;
    } else {
      scrollLocks.set(el, { count: 1, previous: el.style.overflow });
      el.style.overflow = 'hidden';
    }
  }
  return () => {
    for (const el of targets) {
      const lock = scrollLocks.get(el);
      if (!lock) continue;
      lock.count -= 1;
      if (lock.count === 0) {
        el.style.overflow = lock.previous;
        scrollLocks.delete(el);
      }
    }
  };
}

// Open dialogs, oldest first; Escape closes only the last (topmost) one.
const openStack: symbol[] = [];

function Dialog({ open, onOpenChange, children, className }: DialogProps) {
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  React.useEffect(() => {
    if (!open) return;
    return lockScroll();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const id = Symbol('dialog');
    openStack.push(id);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) onOpenChangeRef.current(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = openStack.indexOf(id);
      if (i !== -1) openStack.splice(i, 1);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-backdrop" onClick={() => onOpenChange(false)} />
      <div role="dialog" aria-modal="true" className={cn('relative z-50 w-full max-w-lg', className)}>{children}</div>
    </div>
  );
}

const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // Never taller than the viewport: long content scrolls inside the panel.
        'relative max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[10px] border border-line bg-surface p-[18px] shadow-pop',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);
DialogContent.displayName = 'DialogContent';

interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div className={cn('flex flex-col space-y-1.5 mb-4', className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-base font-bold text-fg', className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[13px] text-muted', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('-mx-[18px] -mb-[18px] mt-4 flex justify-end gap-2 rounded-b-[10px] border-t border-line bg-surface-2 px-[18px] py-3', className)} {...props} />;
}

interface DialogCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onClose?: () => void;
}

function DialogClose({ onClose, className, ...props }: DialogCloseProps) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClose}
      aria-label={t('common.close')}
      className={cn('absolute right-4 top-4 rounded-sm text-faint hover:text-fg', className)}
      {...props}
    >
      <X className="h-4 w-4" />
    </button>
  );
}

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose };
