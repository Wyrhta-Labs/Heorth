import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../../config/env.js';

const ALGO = 'aes-256-gcm';

/** Resolve a 32-byte key: explicit env key (base64) or HKDF over JWT_SECRET. */
function resolveKey(): Buffer {
  if (config.libraryEncryptionKey) {
    const key = Buffer.from(config.libraryEncryptionKey, 'base64');
    if (key.length !== 32) {
      throw new Error('LIBRARY_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
    return key;
  }
  // Deterministic fallback so the module works out-of-the-box. A dedicated key
  // is recommended in production (see startup warning below).
  const salt = Buffer.from('heorth-library-v1');
  return Buffer.from(hkdfSync('sha256', config.jwtSecret, salt, 'heorth-library-credentials', 32));
}

const KEY = resolveKey();

if (!config.libraryEncryptionKey) {
  console.warn(
    '[library] LIBRARY_ENCRYPTION_KEY not set — deriving credential key from JWT_SECRET. ' +
    'Set a dedicated 32-byte base64 key in production.',
  );
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
