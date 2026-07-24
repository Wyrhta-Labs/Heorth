/**
 * Manual M365 smoke test — run by a human against the REAL tenant (`.env`), never
 * in CI. It exercises the app-only path only (no member consent needed):
 *
 *   1. Acquire a client-credentials (app-only) token for the tenant.
 *   2. Probe GET /users/{M365_FAMILY_MAILBOX} to confirm the app registration +
 *      ApplicationAccessPolicy grant the shared mailbox.
 *
 * Run:  npx tsx scripts/m365-smoke.ts
 *
 * It prints ONLY non-secret signal (token length, mailbox display name). No token
 * or secret material is ever logged.
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
  console.log(`2. Probing GET /users/${mailbox} ...`);
  const user = await rt.graphFetch<{ userPrincipalName: string; displayName?: string }>(
    token, `/users/${encodeURIComponent(mailbox)}`,
  );
  console.log(`   OK — ${user.displayName ?? '(no display name)'} <${user.userPrincipalName}>`);

  console.log('\nSmoke test passed. App-only access to the family mailbox works.');
}

main().catch((e) => {
  // Print the error shape without any token material.
  console.error('Smoke test FAILED:', e?.name ?? 'Error', '-', e?.message ?? String(e));
  process.exit(1);
});
