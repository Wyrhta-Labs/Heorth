import { Hono } from 'hono';
import { ok } from '@wyrhta/core/http';
import { requireAuth } from '../wiring.js';
import { config } from '../config/env.js';

/**
 * Runtime feature discovery for the web app: which optional built-in features
 * are enabled on this deployment (ADR 0007). One key per optional feature.
 * Auth required (any role) — feature flags are not public information.
 */
export const featuresRouter = new Hono();
featuresRouter.use('*', requireAuth);
featuresRouter.get('/', (c) => ok(c, { finance: config.feohEnabled }));
