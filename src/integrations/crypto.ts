import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config/env.js';

/**
 * Refresh-token encryption at rest for every integration provider.
 *
 * A deliberate SIBLING of the Library's credential crypto
 * (`src/modules/library/crypto.ts`) — same AES-256-GCM `iv:tag:ct` envelope and
 * the same HKDF-over-`JWT_SECRET` derivation, with its own salt and info string
 * so the two areas derive independent keys from the same secret.
 *
 * !!! THE SALT AND INFO STRINGS BELOW STILL SAY `m365`. THAT IS DELIBERATE. !!!
 * They are INPUTS TO THE KEY, not labels. This file was moved here from
 * `src/m365/crypto.ts`; changing either string would derive a different key and
 * make every already-stored refresh token undecryptable, forcing every member to
 * reconnect. They are frozen. Google tokens are encrypted with this same key —
 * same process, same secret, same threat model, so a per-provider derivation
 * would add a second thing to get wrong and buy nothing.
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
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed integration token ciphertext');
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
