import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../src/m365/crypto.js';

describe('m365 crypto', () => {
  it('round-trips a refresh token', () => {
    const token = 'refresh-token-abc.def.ghi';
    const enc = encryptToken(token);
    expect(enc).not.toContain(token);
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptToken(enc)).toBe(token);
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(encryptToken('same')).not.toBe(encryptToken('same'));
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptToken('secret');
    const [iv, tag, ct] = enc.split(':');
    const flipped = `${iv}:${tag}:${Buffer.from(ct!, 'base64').toString('hex').replace(/.$/, '0')}`;
    expect(() => decryptToken(flipped)).toThrow();
  });
});
