/**
 * Manual M365 smoke test — run by a human against the REAL tenant (`.env`), never
 * in CI. It exercises the app-only path only (no member consent needed):
 *
 *   1. Acquire a client-credentials (app-only) token for the tenant.
 *   2. Probe GET /users/{M365_FAMILY_MAILBOX}/calendarView (next 7 days) to
 *      confirm the app registration's application Calendars.Read permission +
 *      ApplicationAccessPolicy grant access to the shared mailbox calendar.
 *      (The app deliberately does NOT have User.Read.All, so probing the user
 *      object itself would 403 even when everything is configured correctly.)
 *
 * Run:  npx tsx scripts/m365-smoke.ts
 *
 * It prints ONLY non-secret signal (token length, event count, at most one event
 * subject/start — household data shown to the household admin running this). No
 * token or secret material is ever logged.
 */
import { config } from '../src/config/env.js';
import { createM365Runtime } from '../src/m365/index.js';

async function main() {
  if (!config.m365) {
    console.error('M365 is disabled — set the M365_* variables in .env first.');
    process.exit(1);
  }
  const rt = createM365Runtime(config.m365);

  console.log('1. Acquiring app-only token (client_credentials, .default)...');
  const token = await rt.appOnly.getAccessToken();
  console.log(`   OK — received an access token (${token.length} chars).`);

  const mailbox = config.m365.familyMailbox;
  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  console.log(`2. Probing GET /users/${mailbox}/calendarView (next 7 days) ...`);
  const query = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $top: '3',
    $select: 'subject,start',
  });
  const view = await rt.graphFetch<{
    value: Array<{ subject?: string; start?: { dateTime?: string; timeZone?: string } }>;
  }>(token, `/users/${encodeURIComponent(mailbox)}/calendarView?${query.toString()}`);
  console.log(`   OK — ${view.value.length} event(s) in the next 7 days (showing at most 3).`);
  const first = view.value[0];
  if (first) {
    const when = first.start?.dateTime
      ? `${first.start.dateTime} (${first.start.timeZone ?? 'unknown tz'})`
      : '(no start)';
    console.log(`   First: "${first.subject ?? '(no subject)'}" at ${when}`);
  }

  console.log('\nSmoke test passed. App-only access to the family mailbox calendar works.');
}

main().catch((e) => {
  // Print the error shape without any token material.
  console.error('Smoke test FAILED:', e?.name ?? 'Error', '-', e?.message ?? String(e));
  process.exit(1);
});
