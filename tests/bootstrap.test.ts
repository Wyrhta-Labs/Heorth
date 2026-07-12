import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { bootstrap } from '../src/index.js';
import { db } from '../src/db/index.js';
import { household } from '@wyrhta/core/household';
import { users } from '@wyrhta/core/identity';
import { config } from '../src/config/env.js';

describe('bootstrap', () => {
  it('seeds the household and admin idempotently', async () => {
    await bootstrap();
    await bootstrap(); // second run must not create a duplicate household or admin

    const households = await db.select().from(household);
    expect(households.length).toBe(1);
    expect(households[0]!.name).toBe(config.householdName);

    const admins = await db.select().from(users).where(eq(users.role, 'admin'));
    expect(admins.length).toBe(1);
    expect(admins[0]!.email).toBe(config.adminEmail);
  });
});
