import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerProvider, getProvider, listProviders, clearProviders, getTaskProviderFor,
} from '../src/integrations/registry.js';
import { IntegrationStore } from '../src/integrations/store.js';

function fake(id: string, tasks: unknown = null) {
  return {
    id,
    store: new IntegrationStore(id),
    classifyError: () => 'error',
    fullResyncIntervalMs: 1000,
    authorizeUrl: (state: string) => `https://example.test/${id}?state=${state}`,
    completeConnect: async () => ({ accountLabel: `a@${id}`, refreshToken: 'r', scopes: '' }),
    calendar: null,
    tasks: tasks as never,
    runCalendarSync: async () => [],
    runTaskSync: async () => [],
  };
}

describe('provider registry', () => {
  beforeEach(() => clearProviders());

  it('registers and looks up by id', () => {
    registerProvider(fake('m365'));
    expect(getProvider('m365')!.id).toBe('m365');
    expect(getProvider('google')).toBeNull();
  });

  it('holds several providers at once, in registration order', () => {
    registerProvider(fake('m365'));
    registerProvider(fake('google'));
    expect(listProviders().map((p) => p.id)).toEqual(['m365', 'google']);
  });

  it('re-registering the same id replaces rather than duplicates', () => {
    registerProvider(fake('m365'));
    registerProvider(fake('m365'));
    expect(listProviders()).toHaveLength(1);
  });

  it('resolves a task provider by mirror row source', () => {
    const graphTasks = { source: 'm365' };
    const googleTasks = { source: 'google' };
    registerProvider(fake('m365', graphTasks));
    registerProvider(fake('google', googleTasks));

    expect(getTaskProviderFor('m365')).toBe(graphTasks);
    expect(getTaskProviderFor('google')).toBe(googleTasks);
    expect(getTaskProviderFor('caldav')).toBeNull();
  });

  it('returns null for a provider registered without a task surface', () => {
    registerProvider(fake('m365', null));
    expect(getTaskProviderFor('m365')).toBeNull();
  });
});
