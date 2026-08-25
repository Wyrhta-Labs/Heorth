/**
 * Contract guard: every list request the Weorc page makes must satisfy the
 * SERVER's query schema.
 *
 * `weorc.test.tsx` mocks `@/api/weorc` wholesale, so a param the page sends
 * never meets the real validator. The server's schema cannot be imported
 * here: web/ and the backend are independent dependency trees (separate
 * package-locks; the web image stage and the CI web job see neither backend
 * source nor backend node_modules). The contract is therefore mirrored in
 * `@/api/weorc-query` and pinned on both sides: this test validates whatever
 * the page ACTUALLY sends against the mirror, and the backend's route tests
 * pin the server half. It replays each captured params object through the
 * real `qs()` serializer, so what is validated is the query string as it
 * would go on the wire, not the typed object.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '@/api/weorc';
import { qs } from '@/api/client';
import { listRoutinesQuerySchema } from '@/api/weorc-query';

vi.mock('@/api/weorc');

import WeorcPage from './weorc';

const TODAY = '2026-08-25';
const routine = (over = {}) => ({
  id: 'r1', name: 'Put the bins out', notes: null, mode: 'fixed',
  intervalUnit: 'week', intervalCount: 1, anchorDate: TODAY, leadDays: 0,
  ownerMemberId: null, anchorAssetId: null, anchorPlaceId: null, active: true,
  nextDueOn: TODAY, openOccurrence: null, ...over,
});
const listing = (...rows: unknown[]) => ({ data: rows, meta: { total: rows.length } });

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

function renderWeorc() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WeorcPage />
    </QueryClientProvider>,
  );
}

/** Serialize like the browser, then validate like the server. */
function assertServerAccepts(params: Record<string, unknown>) {
  const query = Object.fromEntries(new URLSearchParams(qs(params).replace(/^\?/, '')));
  const parsed = listRoutinesQuerySchema.safeParse(query);
  expect(
    parsed.success,
    `server would reject ?${new URLSearchParams(query).toString()}: ${
      parsed.success ? '' : JSON.stringify(parsed.error.issues)
    }`,
  ).toBe(true);
}

function assertEveryRequestAccepted() {
  expect(vi.mocked(api.listRoutines).mock.calls.length).toBeGreaterThan(0);
  for (const [params] of vi.mocked(api.listRoutines).mock.calls) {
    assertServerAccepts((params ?? {}) as Record<string, unknown>);
  }
}

describe('WeorcPage → server query contract', () => {
  it('sends a first-load request the server accepts', async () => {
    vi.mocked(api.listRoutines).mockResolvedValue(listing(routine()) as never);
    renderWeorc();
    await waitFor(() => expect(api.listRoutines).toHaveBeenCalled());
    assertEveryRequestAccepted();
  });

  it('sends a request the server accepts even with no routines yet', async () => {
    vi.mocked(api.listRoutines).mockResolvedValue(listing() as never);
    renderWeorc();
    await waitFor(() => expect(api.listRoutines).toHaveBeenCalled());
    assertEveryRequestAccepted();
  });
});
