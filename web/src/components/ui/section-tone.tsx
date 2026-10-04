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
  ember: 'bg-[color-mix(in_srgb,var(--color-ember)_6%,var(--color-card))] border-ember/20',
  sky: 'bg-[color-mix(in_srgb,var(--color-sky)_7%,var(--color-card))] border-sky/20',
  amber: 'bg-[color-mix(in_srgb,var(--color-amber)_7%,var(--color-card))] border-amber/20',
  sage: 'bg-[color-mix(in_srgb,var(--color-sage)_8%,var(--color-card))] border-sage/25',
  taupe: 'bg-[color-mix(in_srgb,var(--color-taupe)_7%,var(--color-card))] border-taupe/20',
};

/** Shades of one accent, from barely there (1) to clearly tinted (4) — for
 *  the stacked sections of a work page (Feoh, Ethel): one colour per page,
 *  neighbouring sections on different steps so they still tell apart. */
export type Shade = 1 | 2 | 3 | 4;
const shades: Record<Tone, readonly [string, string, string, string]> = {
  ember: [
    'bg-[color-mix(in_srgb,var(--color-ember)_5%,var(--color-card))] border-ember/20',
    'bg-[color-mix(in_srgb,var(--color-ember)_9%,var(--color-card))] border-ember/20',
    'bg-[color-mix(in_srgb,var(--color-ember)_13%,var(--color-card))] border-ember/20',
    'bg-[color-mix(in_srgb,var(--color-ember)_17%,var(--color-card))] border-ember/20',
  ],
  sky: [
    'bg-[color-mix(in_srgb,var(--color-sky)_5%,var(--color-card))] border-sky/20',
    'bg-[color-mix(in_srgb,var(--color-sky)_9%,var(--color-card))] border-sky/20',
    'bg-[color-mix(in_srgb,var(--color-sky)_13%,var(--color-card))] border-sky/20',
    'bg-[color-mix(in_srgb,var(--color-sky)_17%,var(--color-card))] border-sky/20',
  ],
  amber: [
    'bg-[color-mix(in_srgb,var(--color-amber)_5%,var(--color-card))] border-amber/20',
    'bg-[color-mix(in_srgb,var(--color-amber)_9%,var(--color-card))] border-amber/20',
    'bg-[color-mix(in_srgb,var(--color-amber)_13%,var(--color-card))] border-amber/20',
    'bg-[color-mix(in_srgb,var(--color-amber)_17%,var(--color-card))] border-amber/20',
  ],
  sage: [
    'bg-[color-mix(in_srgb,var(--color-sage)_5%,var(--color-card))] border-sage/25',
    'bg-[color-mix(in_srgb,var(--color-sage)_9%,var(--color-card))] border-sage/25',
    'bg-[color-mix(in_srgb,var(--color-sage)_13%,var(--color-card))] border-sage/25',
    'bg-[color-mix(in_srgb,var(--color-sage)_17%,var(--color-card))] border-sage/25',
  ],
  taupe: [
    'bg-[color-mix(in_srgb,var(--color-taupe)_5%,var(--color-card))] border-taupe/20',
    'bg-[color-mix(in_srgb,var(--color-taupe)_9%,var(--color-card))] border-taupe/20',
    'bg-[color-mix(in_srgb,var(--color-taupe)_13%,var(--color-card))] border-taupe/20',
    'bg-[color-mix(in_srgb,var(--color-taupe)_17%,var(--color-card))] border-taupe/20',
  ],
};

const iconColor: Record<Tone, string> = {
  ember: 'text-ember',
  sky: 'text-sky',
  amber: 'text-amber',
  sage: 'text-sage',
  taupe: 'text-taupe',
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

/** A card headline led by an icon in the section's accent. */
export function SectionTitle({ icon: Icon, tone, className, children }: {
  icon: LucideIcon;
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <CardTitle className={cn('text-base flex items-center gap-2', className)}>
      <Icon className={cn('h-4 w-4 shrink-0', iconColor[tone])} aria-hidden="true" />
      {children}
    </CardTitle>
  );
}

/** A headed card in one accent: icon headline, tinted (or shaded) ground. */
export function SectionCard({ title, icon, tone, shade, children }: {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  shade?: Shade;
  children: ReactNode;
}) {
  return (
    <Card className={toneCard(tone, shade)}>
      <CardHeader className="pb-3"><SectionTitle icon={icon} tone={tone}>{title}</SectionTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
