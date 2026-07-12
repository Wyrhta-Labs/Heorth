import { Hono } from 'hono';
import { ok } from '@wyrhta/core/http';

export const healthRouter = new Hono();

healthRouter.get('/health', (c) => ok(c, { status: 'ok' }));
