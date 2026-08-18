import { Hono } from 'hono';
import { getSatelliteJwks } from '../satellite/keys.js';

/**
 * The public JSON Web Key Set for satellite identity (B1c), served at the
 * conventional `/.well-known/jwks.json`.
 *
 * DELIBERATELY UNAUTHENTICATED. That is the whole point of a public key set:
 * a satellite service fetches it with no credentials in order to verify the
 * tokens Heorth signs. It is mounted OUTSIDE `/api/v1` (and so outside the
 * `/api/*` catch-all and every auth guard) alongside `/health`.
 *
 * It also DELIBERATELY does NOT use core's `ok()` envelope. A JWKS is a
 * standard document consumed by off-the-shelf JWKS clients, which expect the
 * bare `{ "keys": [...] }` at the top level — wrapping it in `{ data: ... }`
 * would break every one of them. This is the one Heorth response that is not
 * an envelope, and it is a wire-format contract, not a style lapse.
 *
 * The body is built by `@wyrhta/core`'s `toJwks`, which emits public key
 * members only: no private component, no `JWT_SECRET`, nothing else about the
 * deployment can appear here.
 *
 * When no key is configured — the default — this returns `{"keys": []}` with a
 * 200. An empty key set is the standard way to say "nothing is published"; a
 * satellite reading it simply finds no key to verify against.
 */
export const jwksRouter = new Hono();

jwksRouter.get('/.well-known/jwks.json', async (c) => {
  const jwks = await getSatelliteJwks();
  // Public, cacheable, and short enough that a newly published key reaches
  // satellites quickly during a rotation.
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(jwks);
});
