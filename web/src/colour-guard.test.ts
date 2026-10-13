import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** Hard-coded Tailwind palette classes. Presentation colour must come from the
 *  theme tokens in index.css, or dark Slate breaks. Same pattern as the spec. */
const PALETTE = /\b(bg|text|border|ring|divide|from|to|fill|stroke|placeholder|outline|accent|shadow)-(white|black|(gray|slate|zinc|neutral|stone|red|green|blue|yellow|orange|amber|emerald|indigo|purple|pink|rose|teal|cyan|lime|violet|sky|fuchsia)-[0-9]{2,3})\b/g;
const HEX = /#[0-9a-fA-F]{6}\b/g;

/** Allowed per file, with the reason. Theme values must be literal (a <meta>
 *  cannot read a CSS variable); data colours are member/calendar identity. */
const ALLOW: Record<string, { classes?: string[]; hex?: true; why: string }> = {
  'lib/theme.ts': { hex: true, why: 'theme: browser chrome colours' },
  'lib/constants.ts': { hex: true, why: 'data: member avatar palette' },
  'lib/hearth.ts': { hex: true, why: 'data: wall display member/household colours' },
  'components/ui/member-avatar.tsx': { classes: ['text-white'], why: 'data: initials on a member colour' },
  'components/hearth/event-chip.tsx': { classes: ['text-white'], why: 'data: text on a member colour' },
};

/** Files not swept yet. Shrinks to empty in Tasks 12-13, then goes away. */
const PENDING_SWEEP = new Set<string>([
  'components/calendar/event-form.tsx',
  'components/dashboard/supper-card.tsx',
  'components/ethel/decommission-dialog.tsx',
  'components/ethel/facility-details.tsx',
  'components/ethel/vehicle-details.tsx',
  'components/feoh/bills-list.tsx',
  'components/feoh/envelope-card.tsx',
  'components/feoh/import-accounts.tsx',
  'components/feoh/import-inbox.tsx',
  'components/feoh/import-rules.tsx',
  'components/feoh/reconcile-dialog.tsx',
  'components/feoh/transaction-form.tsx',
  'components/gewrit/documents-panel.tsx',
  'components/gewrit/link-document-dialog.tsx',
  'components/gewrit/preview-dialog.tsx',
  'components/hearth/add-event-overlay.tsx',
  'components/hearth/display-prefs-modal.tsx',
  'components/hearth/recipe-overlay.tsx',
  'components/household/api-keys-panel.tsx',
  'components/household/connections-panel.tsx',
  'components/household/member-form.tsx',
  'components/household/members-table.tsx',
  'components/library/connections-panel.tsx',
  'components/meals/recipe-form.tsx',
  'components/meals/shopping-list.tsx',
  'components/profile/provider-card.tsx',
  'components/pwa/update-banner.tsx',
  'components/settings/calendar-sync-settings.tsx',
  'pages/calendar.tsx',
  'pages/ethel.tsx',
  'pages/feoh.tsx',
  'pages/hearth.tsx',
  'pages/library.tsx',
  'pages/login.tsx',
  'pages/profile.tsx',
  'pages/tasks.tsx',
]);

const SRC = resolve(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('colour guard', () => {
  it('no presentation colour outside the theme tokens', () => {
    const offenders: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(SRC, path).replaceAll('\\', '/');
      if (PENDING_SWEEP.has(rel)) continue;
      const text = readFileSync(path, 'utf8');
      const allow = ALLOW[rel];
      const classes = [...text.matchAll(PALETTE)].map((m) => m[0]).filter((c) => !allow?.classes?.includes(c));
      const hexes = allow?.hex ? [] : [...text.matchAll(HEX)].map((m) => m[0]);
      for (const hit of [...classes, ...hexes]) offenders.push(`${rel}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it('PENDING_SWEEP lists only files that still need it', () => {
    // Non-global copies: .test() on a /g regex keeps lastIndex state between calls.
    const palette = new RegExp(PALETTE.source);
    const hex = new RegExp(HEX.source);
    for (const rel of PENDING_SWEEP) {
      const text = readFileSync(join(SRC, rel), 'utf8');
      expect(palette.test(text) || hex.test(text), `${rel} is clean - remove it from PENDING_SWEEP`).toBe(true);
    }
  });
});
