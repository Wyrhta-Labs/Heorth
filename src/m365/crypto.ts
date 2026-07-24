import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';

/**
 * Refresh-token encryption at rest for the M365 area.
 *
 * This is a deliberate SIBLING of the Library's credential crypto
 * (`src/modules/library/crypto.ts`) — same AES-256-GCM `iv:tag:ct` envelope and
 * the same HKDF-over-`JWT_SECRET` key derivation, but with an M365-specific salt
 * and info string so the two areas derive independent keys from the same secret.
 * A verbatim shared helper was not extracted because the Library variant is
 * coupled to its own `LIBRARY_ENCRYPTION_KEY` env + startup warning; the M365
 * group is intentionally self-contained (no extra env var — the six canonical
 * `M365_*` names plus `JWT_SECRET` are all it needs).
 *
 * Token material is NEVER logged.
 */

const ALGO = 'aes-256-gcm';

const KEY = Buffer.from(
  hkdfSync('sha256', config.jwtSecret, Buffer.from('heorth-m365-v1'), 'heorth-m365-tokens', 32),
);

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptToken(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed M365 token ciphertext');
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
