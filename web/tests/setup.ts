import '@testing-library/jest-dom/vitest';

// Work around Node's own experimental global `localStorage` (added Node 22+,
// stabilizing through 26.x) shadowing jsdom's implementation: it's a
// configurable accessor, but vitest-environment-jsdom populates globals via
// plain assignment, which invokes Node's setter instead of replacing the
// descriptor — leaving `localStorage` permanently `undefined` (with a noisy
// "--localstorage-file was not provided" warning) unless Node happens to be
// launched with --no-experimental-webstorage. Force a real in-memory Storage
// via defineProperty (which DOES replace the descriptor) so any code/tests
// using localStorage work the same as they would in a real browser tab.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage?.setItem !== 'function') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true, writable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true, writable: true });
  }
}
