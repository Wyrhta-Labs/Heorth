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

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true',
  );
}

interface DialogLabelContext {
  titleId: string;
  descriptionId: string;
  /** Register the id a title/description actually renders; returns the unregister function. */
  registerTitle: (id: string) => () => void;
  registerDescription: (id: string) => () => void;
}

const DialogLabelCtx = React.createContext<DialogLabelContext | null>(null);

function Dialog({ open, onOpenChange, children, className }: DialogProps) {
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const panelRef = React.useRef<HTMLDivElement>(null);
  const openerRef = React.useRef<Element | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const [titleIds, setTitleIds] = React.useState<string[]>([]);
  const [descriptionIds, setDescriptionIds] = React.useState<string[]>([]);
  const labelCtx = React.useMemo(() => {
    // Several titles/descriptions may be mounted at once; the panel references
    // the most recent one that is still there.
    const registrar = (set: React.Dispatch<React.SetStateAction<string[]>>) => (id: string) => {
      set((ids) => [...ids, id]);
      return () =>
        set((ids) => {
          const i = ids.lastIndexOf(id);
          return i === -1 ? ids : ids.filter((_, j) => j !== i);
        });
    };
    return { titleId, descriptionId, registerTitle: registrar(setTitleIds), registerDescription: registrar(setDescriptionIds) };
  }, [titleId, descriptionId]);
  const renderedTitleId = titleIds[titleIds.length - 1];
  const renderedDescriptionId = descriptionIds[descriptionIds.length - 1];

  // Remember what had focus before the dialog (and any autoFocus child, which
  // focuses during commit, before effects) took it.
  if (!open) openerRef.current = null;
  else if (openerRef.current === null) openerRef.current = document.activeElement;

  React.useEffect(() => {
    if (!open) return;
    return lockScroll();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const id = Symbol('dialog');
    openStack.push(id);
    const opener = openerRef.current;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      (focusableIn(panel)[0] ?? panel).focus();
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        onOpenChangeRef.current(false);
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = focusableIn(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active) || (!e.shiftKey && active === last) || (e.shiftKey && (active === first || active === panel))) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = openStack.indexOf(id);
      if (i !== -1) openStack.splice(i, 1);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-backdrop" onClick={() => onOpenChange(false)} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={renderedTitleId}
        aria-describedby={renderedDescriptionId}
        tabIndex={-1}
        className={cn('relative z-50 w-full max-w-lg outline-none', className)}
      >
        <DialogLabelCtx.Provider value={labelCtx}>{children}</DialogLabelCtx.Provider>
      </div>
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

function DialogTitle({ className, id, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const ctx = React.useContext(DialogLabelCtx);
  const register = ctx?.registerTitle;
  const effectiveId = id ?? ctx?.titleId;
  React.useLayoutEffect(() => {
    if (!register || !effectiveId) return;
    return register(effectiveId);
  }, [register, effectiveId]);
  return <h2 id={effectiveId} className={cn('text-base font-bold text-fg', className)} {...props} />;
}

function DialogDescription({ className, id, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const ctx = React.useContext(DialogLabelCtx);
  const register = ctx?.registerDescription;
  const effectiveId = id ?? ctx?.descriptionId;
  React.useLayoutEffect(() => {
    if (!register || !effectiveId) return;
    return register(effectiveId);
  }, [register, effectiveId]);
  return <p id={effectiveId} className={cn('text-[13px] text-muted', className)} {...props} />;
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
