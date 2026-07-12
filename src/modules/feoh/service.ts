import { db } from '../../db/index.js';
import { accounts, envelopes, type Account, type Envelope } from './schema.js';
import { eq } from 'drizzle-orm';
import type { CreateAccountInput, CreateEnvelopeInput } from './validators.js';

export function listAccounts(): Promise<Account[]> {
  return db.select().from(accounts).orderBy(accounts.name);
}

export async function createAccount(i: CreateAccountInput): Promise<Account> {
  const [row] = await db.insert(accounts).values({
    name: i.name, kind: i.kind, openingBalance: String(i.openingBalance),
  }).returning();
  return row!;
}

export async function updateAccount(id: string, i: Partial<CreateAccountInput>): Promise<Account | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (i.name !== undefined) patch['name'] = i.name;
  if (i.kind !== undefined) patch['kind'] = i.kind;
  if (i.openingBalance !== undefined) patch['openingBalance'] = String(i.openingBalance);
  const [row] = await db.update(accounts).set(patch).where(eq(accounts.id, id)).returning();
  return row ?? null;
}

export async function deleteAccount(id: string): Promise<Account | null> {
  const [row] = await db.delete(accounts).where(eq(accounts.id, id)).returning();
  return row ?? null;
}

export function listEnvelopes(): Promise<Envelope[]> {
  return db.select().from(envelopes).orderBy(envelopes.name);
}

export async function createEnvelope(i: CreateEnvelopeInput): Promise<Envelope> {
  const [row] = await db.insert(envelopes).values({
    name: i.name, monthlyBudget: String(i.monthlyBudget), tone: i.tone ?? null,
  }).returning();
  return row!;
}

export async function updateEnvelope(id: string, i: Partial<CreateEnvelopeInput>): Promise<Envelope | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (i.name !== undefined) patch['name'] = i.name;
  if (i.monthlyBudget !== undefined) patch['monthlyBudget'] = String(i.monthlyBudget);
  if (i.tone !== undefined) patch['tone'] = i.tone;
  const [row] = await db.update(envelopes).set(patch).where(eq(envelopes.id, id)).returning();
  return row ?? null;
}

export async function deleteEnvelope(id: string): Promise<Envelope | null> {
  const [row] = await db.delete(envelopes).where(eq(envelopes.id, id)).returning();
  return row ?? null;
}
