import { describe, it, expect } from 'vitest';
import { startWeorcScheduler, stopWeorcScheduler } from '../src/modules/weorc/scheduler.js';

describe('weorc scheduler', () => {
  it('never starts under tests', () => {
    expect(process.env['VITEST']).toBeDefined();
    expect(startWeorcScheduler()).toBeNull();
    stopWeorcScheduler();
  });
});
