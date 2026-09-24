import type { Hono } from 'hono';
import type { HeorthModule } from '../registry.js';
import { isGewritEnabled } from './runtime.js';
import { gewritRouter } from './routes.js';

/** Gewrit — household documents in Paperless-ngx, linked to Ethel (ADR 0017).
 *  Disabled (GEWRIT_PROVIDER blank, the default): registers nothing — routes
 *  fall through to the /api catch-all 404, the UI hides via GET
 *  /api/v1/features (`gewrit`). The tables exist either way; disabling never
 *  touches data. */
export const gewritModule: HeorthModule = {
  name: 'gewrit',
  register(app: Hono): void {
    if (!isGewritEnabled()) return;
    app.route('/api/v1/gewrit', gewritRouter);
  },
};
