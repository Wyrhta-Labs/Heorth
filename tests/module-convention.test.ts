import { describe, it, expect } from 'vitest';
import { ALL_MODULES } from '../src/modules/index.js';

describe('module convention', () => {
  it('every module exposes a name and a register function', () => {
    for (const mod of ALL_MODULES) {
      expect(typeof mod.name).toBe('string');
      expect(typeof mod.register).toBe('function');
    }
  });
});
