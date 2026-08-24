import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp([]);

// Regression guard for the redirect Heorth used to get from Hono's own
// trimTrailingSlash(): an ABSOLUTE Location, built from the URL the app itself
// sees. Behind the deployed reverse proxy that is the wrong URL — it names the
// internal upstream host, and loses any path prefix the proxy stripped before
// forwarding. Core's replacement emits a path-only Location, which the client
// resolves against the URL it actually requested.
//
// Only paths that would otherwise 404 reach the redirect — a registered route
// is answered by the router, slash and all.
describe('trailing-slash redirect', () => {
  it('redirects with a path-only Location, naming no scheme or host', async () => {
    const res = await app.request('http://internal-upstream:3000/api/v1/no-such-route/');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/api/v1/no-such-route');
  });

  it('keeps the query string on the redirect', async () => {
    const res = await app.request('http://internal-upstream:3000/api/v1/no-such-route/?limit=5');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('/api/v1/no-such-route?limit=5');
  });

  it('leaves the root path alone', async () => {
    const res = await app.request('http://internal-upstream:3000/');
    expect(res.status).not.toBe(301);
  });
});
