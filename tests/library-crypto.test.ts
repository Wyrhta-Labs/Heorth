import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/modules/library/crypto.js';

describe('library crypto', () => {
  it('round-trips a secret', () => {
    const secret = 'trakt-access-token-123';
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptSecret('secret');
    const [iv, tag, ct] = enc.split(':');
    const flipped = `${iv}:${tag}:${Buffer.from(ct!, 'base64').toString('hex').replace(/.$/, '0')}`;
    expect(() => decryptSecret(flipped)).toThrow();
  });
});
