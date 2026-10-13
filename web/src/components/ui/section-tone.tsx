import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** The accents a section card can carry, one per section on a page so they
 *  tell apart at a glance. Built from the theme tokens, so Hearth and Slate
 *  both carry them. Full class strings, so Tailwind sees them. */
export type Tone = 'ember' | 'sky' | 'amber' | 'sage' | 'taupe';

/** A faint, flat wash of the accent over the card colour — for small cards
 *  that sit side by side (the start page, Today). */
const tint: Record<Tone, string> = {
  ember: 'bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface))] border-primary/20',
  sky: 'bg-[color-mix(in_srgb,var(--color-info)_7%,var(--color-surface))] border-info/20',
  amber: 'bg-[color-mix(in_srgb,var(--color-warning)_7%,var(--color-surface))] border-warning/20',
  sage: 'bg-[color-mix(in_srgb,var(--color-success)_8%,var(--color-surface))] border-success/25',
  taupe: 'bg-[color-mix(in_srgb,var(--color-accent)_7%,var(--color-surface))] border-accent/20',
};

/** Shades of one accent, from barely there (1) to clearly tinted (4) — for
 *  the stacked sections of a work page (Feoh, Ethel): one colour per page,
 *  neighbouring sections on different steps so they still tell apart. */
export type Shade = 1 | 2 | 3 | 4;
const shades: Record<Tone, readonly [string, string, string, string]> = {
  ember: [
    'bg-[color-mix(in_srgb,var(--color-primary)_5%,var(--color-surface))] border-primary/20',
    'bg-[color-mix(in_srgb,var(--color-primary)_9%,var(--color-surface))] border-primary/20',
    'bg-[color-mix(in_srgb,var(--color-primary)_13%,var(--color-surface))] border-primary/20',
    'bg-[color-mix(in_srgb,var(--color-primary)_17%,var(--color-surface))] border-primary/20',
  ],
  sky: [
    'bg-[color-mix(in_srgb,var(--color-info)_5%,var(--color-surface))] border-info/20',
    'bg-[color-mix(in_srgb,var(--color-info)_9%,var(--color-surface))] border-info/20',
    'bg-[color-mix(in_srgb,var(--color-info)_13%,var(--color-surface))] border-info/20',
    'bg-[color-mix(in_srgb,var(--color-info)_17%,var(--color-surface))] border-info/20',
  ],
  amber: [
    'bg-[color-mix(in_srgb,var(--color-warning)_5%,var(--color-surface))] border-warning/20',
    'bg-[color-mix(in_srgb,var(--color-warning)_9%,var(--color-surface))] border-warning/20',
    'bg-[color-mix(in_srgb,var(--color-warning)_13%,var(--color-surface))] border-warning/20',
    'bg-[color-mix(in_srgb,var(--color-warning)_17%,var(--color-surface))] border-warning/20',
  ],
  sage: [
    'bg-[color-mix(in_srgb,var(--color-success)_5%,var(--color-surface))] border-success/25',
    'bg-[color-mix(in_srgb,var(--color-success)_9%,var(--color-surface))] border-success/25',
    'bg-[color-mix(in_srgb,var(--color-success)_13%,var(--color-surface))] border-success/25',
    'bg-[color-mix(in_srgb,var(--color-success)_17%,var(--color-surface))] border-success/25',
  ],
  taupe: [
    'bg-[color-mix(in_srgb,var(--color-accent)_5%,var(--color-surface))] border-accent/20',
    'bg-[color-mix(in_srgb,var(--color-accent)_9%,var(--color-surface))] border-accent/20',
    'bg-[color-mix(in_srgb,var(--color-accent)_13%,var(--color-surface))] border-accent/20',
    'bg-[color-mix(in_srgb,var(--color-accent)_17%,var(--color-surface))] border-accent/20',
  ],
};

/** The 24px icon square of a section header: the tone's light ground, its colour. */
const iconSquare: Record<Tone, string> = {
  ember: 'bg-primary-light text-primary',
  sky: 'bg-info-bg text-info',
  amber: 'bg-warning-bg text-warning',
  sage: 'bg-success-bg text-success',
  taupe: 'bg-accent-bg text-accent',
};

/** A stable shade for a free-text key (an asset category): the same key
 *  always lands on the same step, so cards of one kind look alike. */
export function shadeFor(key: string | null | undefined): Shade {
  if (!key) return 1;
  let h = 0;
  for (const ch of key.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 4) + 1) as Shade;
}

/** The card classes for a tone: the flat tint, or one of its shades. */
export function toneCard(tone: Tone, shade?: Shade): string {
  return shade ? shades[tone][shade - 1] : tint[tone];
}

/** A card headline led by its icon in a small tinted square (the mockup's .card-ic). */
export function SectionTitle({ icon: Icon, tone, className, children }: {
  icon: LucideIcon;
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <CardTitle className={cn('flex items-center gap-2', className)}>
      <span data-slot="section-icon" className={cn('flex size-6 shrink-0 items-center justify-center rounded-md', iconSquare[tone])}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      {children}
    </CardTitle>
  );
}

/** A headed card in one accent: icon headline, tinted (or shaded) ground. On a
 *  toned card the header strip takes the tint instead of surface-2. */
export function SectionCard({ title, icon, tone, shade, children }: {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  shade?: Shade;
  children: ReactNode;
}) {
  return (
    <Card className={toneCard(tone, shade)}>
      <CardHeader className="bg-transparent"><SectionTitle icon={icon} tone={tone}>{title}</SectionTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
