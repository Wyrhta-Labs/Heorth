// Hand-synced from the Heorth backend (Drizzle schema + service return shapes).
// NOTE ON MONEY: Drizzle `numeric` columns serialize to STRINGS over REST on raw
// rows (e.g. openingBalance, monthlyBudget, amount, debit, credit, share). The
// /feoh/summary endpoint returns computed NUMBERS. Types below reflect that split.

export type Role = 'admin' | 'adult' | 'child';
export type AvatarColor = 'ember' | 'taupe' | 'sage' | 'sky';

export interface Member {
  id: string;
  createdAt: string;
  updatedAt: string;
  email: string;
  handle: string | null;
  role: Role;
  displayName: string;
  avatarColor: AvatarColor;
}

export interface Household {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  createdAt: string;
}

// ---- Calendar ----
export interface Event {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  category: string | null;
  color: string | null;
  createdBy: string;
  recurrence: string | null;
  attendeeIds: string[];
}
// A range query returns occurrences (recurrence expanded); each adds occurrenceStart.
export interface EventOccurrence extends Event {
  occurrenceStart: string;
}

// ---- Meals ----
export interface Ingredient { name: string; qty: number; unit: string; }
export type MealSlot = 'breakfast' | 'lunch' | 'supper';

export interface Recipe {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
  tags: string[];
  createdBy: string;
}

export interface MealPlanEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  date: string;       // YYYY-MM-DD
  slot: MealSlot;
  recipeId: string | null;
  freeText: string | null;
  cook: string | null;
  helper: string | null;
}

export interface ShoppingListItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  qty: string | null;   // numeric -> string
  unit: string | null;
  checked: boolean;
  sourceRecipeId: string | null;
}

// ---- Feoh (Finance) ----
export interface Account {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  kind: 'asset' | 'liability';
  openingBalance: string;   // numeric -> string
}

export interface Envelope {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  monthlyBudget: string;    // numeric -> string
  tone: string | null;
}

export interface Transaction {
  id: string;
  createdAt: string;
  updatedAt: string;
  date: string;             // YYYY-MM-DD
  payee: string;
  memo: string | null;
  amount: string;           // numeric -> string
  createdBy: string;
}

export interface Posting {
  id: string;
  transactionId: string;
  accountId: string | null;
  envelopeId: string | null;
  debit: string;            // numeric -> string
  credit: string;           // numeric -> string
}

export interface ExpenseSplit {
  id: string;
  transactionId: string;
  memberId: string;
  share: string;            // numeric -> string
}

// record_transaction / getTransaction return this composite shape.
export interface TransactionDetail {
  transaction: Transaction;
  postings: Posting[];
  splits: ExpenseSplit[];
}

export interface RecurringBill {
  id: string;
  createdAt: string;
  updatedAt: string;
  payee: string;
  amount: string;           // numeric -> string
  cadence: string;          // ISO-8601 duration
  nextDue: string;          // YYYY-MM-DD
  envelopeId: string | null;
}

// /feoh/summary — computed numbers (NOT strings).
export interface EnvelopeSummary {
  envelopeId: string;
  name: string;
  tone: string | null;
  budget: number;
  spent: number;
  remaining: number;
}
export interface MonthSummary {
  month: string;            // YYYY-MM
  envelopes: EnvelopeSummary[];
  totals: { budget: number; spent: number; remaining: number };
}

// ---- Auth / keys ----
export interface AuthToken { token: string; expires_in: number; }
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}
// Returned once at creation; the raw key field is `raw` (backend createApiKey).
export interface ApiKeyCreated {
  id: string;
  name: string;
  keyPrefix: string;
  raw: string;
  createdAt: string;
}

// ---- Envelopes (HTTP response) ----
export interface ListMeta { total: number; limit?: number; offset?: number; }
export interface ListResponse<T> { data: T[]; meta: ListMeta; }
export interface SingleResponse<T> { data: T; }
