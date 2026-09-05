import { describe, it, expect } from 'vitest';
import { startFeohImportScheduler, stopFeohImportScheduler } from '../src/modules/feoh/import/scheduler.js';

describe('feoh import scheduler', () => {
  it('never starts under tests (and would not with import disabled either)', () => {
    expect(process.env['VITEST']).toBeDefined();
    expect(startFeohImportScheduler()).toBeNull();
    stopFeohImportScheduler();
  });
});
