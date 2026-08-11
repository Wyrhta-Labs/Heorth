import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HearthDisplayPrefs } from '@/lib/hearth-prefs';

interface Props {
  prefs: HearthDisplayPrefs;
  /** Render the KithLedger row (features query resolved to kithledger: true). */
  showKithRow: boolean;
  onChange: (patch: Partial<HearthDisplayPrefs>) => void;
  onClose: () => void;
}

/**
 * Small centered settings dialog for the wall: which elements the wallboard
 * shows. Unlike the full-bleed overlays this one is a quick in-and-out, so it
 * closes on Escape and direct backdrop taps (nothing half-filled to lose).
 * Focus is trapped while open and returns to the opener on close.
 */
export default function DisplayPrefsModal({ prefs, showKithRow, onChange, onClose }: Props) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus in on open, restore to the opener (Display button) on unmount.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = cardRef.current?.querySelectorAll<HTMLElement>('button');
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const rows: Array<{ key: keyof HearthDisplayPrefs; label: string }> = [
    ...(showKithRow ? [{ key: 'kithReminders' as const, label: t('hearth.display.rows.reminders') }] : []),
    { key: 'tasks', label: t('hearth.display.rows.tasks') },
    { key: 'meals', label: t('hearth.display.rows.meals') },
    { key: 'staleFooter', label: t('hearth.display.rows.footer') },
  ];

  return (
    <div
      data-testid="display-prefs-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-8"
      onClick={(e) => {
        // Direct backdrop taps only — clicks inside the card bubble up here
        // but must not close the dialog.
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hearth-display-title"
        className="w-full max-w-md rounded-2xl border border-tan bg-card p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="hearth-display-title" className="font-serif text-3xl text-ink">{t('hearth.display.title')}</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label={t('hearth.display.close')}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ember text-white"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const on = prefs[row.key];
            return (
              <li key={row.key}>
                <button
                  onClick={() => onChange({ [row.key]: !on })}
                  aria-pressed={on}
                  className={`flex w-full items-center justify-between gap-4 rounded-xl border border-tan px-5 py-4 text-lg ${on ? 'bg-ember text-white' : 'bg-parchment text-ash'}`}
                >
                  <span>{row.label}</span>
                  <span aria-hidden className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? 'bg-white/90' : 'bg-tan'}`}>
                    <span className={`absolute top-1 h-5 w-5 rounded-full transition-all ${on ? 'right-1 bg-ember' : 'left-1 bg-card'}`} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
