import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/env.js';
import * as schema from './schema/index.js';

const queryClient = postgres(config.databaseUrl, { max: config.dbPoolMax });
export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
