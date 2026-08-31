import type { HeorthModule } from '../modules/registry.js';
import { getGoogleRuntime, isGoogleEnabled } from './runtime.js';
import { GoogleCalendarProvider } from './calendar-provider.js';
import { GoogleTaskProvider } from './task-provider.js';
import { registerProvider } from '../integrations/registry.js';
import { runGoogleCalendarSync } from './calendar-sync.js';
import { runGoogleTaskSync } from './task-sync.js';
import { classify, googleFullResyncIntervalMs } from './sync-runner.js';

/**
 * The Google area registers as a module but is a NO-OP when the integration is
 * disabled (no `GOOGLE_*` env) — the same contract as `src/m365/index.ts`. When
 * enabled it registers itself into the integrations registry; it mounts no
 * routes of its own, because `/api/v1/integrations/:provider/*` already hosts
 * them for every provider.
 */
export const googleModule: HeorthModule = {
  name: 'google',
  register(): void {
    if (!isGoogleEnabled()) return;
    const rt = getGoogleRuntime();
    registerProvider({
      id: 'google',
      store: rt.store,
      classifyError: classify,
      fullResyncIntervalMs: googleFullResyncIntervalMs(),
      authorizeUrl: (state) => rt.oauth.authorizeUrl(state),
      completeConnect: async (code) => {
        // Throws GoogleNoRefreshTokenError when Google issued none. That error
        // carries `connectErrorCode`, so the callback redirects with
        // GOOGLE_NO_REFRESH_TOKEN specifically and stores nothing, rather than
        // persisting a connection that dies within the hour.
        const { refreshToken, accessToken, scopes } = await rt.oauth.exchangeCode(code);
        const accountLabel = await rt.oauth.getUserEmail(accessToken);
        return { accountLabel, refreshToken, scopes };
      },
      calendar: new GoogleCalendarProvider(rt),
      tasks: new GoogleTaskProvider(rt),
      runCalendarSync: () => runGoogleCalendarSync(rt),
      runTaskSync: () => runGoogleTaskSync(rt),
    });
  },
};

export {
  getGoogleRuntime, setGoogleRuntime, createGoogleRuntime, isGoogleEnabled, type GoogleRuntime,
} from './runtime.js';
export { runGoogleCalendarSync } from './calendar-sync.js';
export { runGoogleTaskSync } from './task-sync.js';
export { GoogleCalendarProvider } from './calendar-provider.js';
export { GoogleTaskProvider } from './task-provider.js';
export { GoogleApiError } from './api.js';
export { GOOGLE_SCOPES, GoogleNoRefreshTokenError } from './oauth.js';
