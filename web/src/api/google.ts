import { getConnectUrl, disconnectProvider } from './m365';
import type { SingleResponse } from '@/lib/types';

/**
 * Google connection adapter. The routes are provider-scoped, so these are thin
 * bindings of the shared helpers rather than a second copy of them — the M365
 * adapter is the same two calls with a different id.
 */
export function getGoogleConnectUrl(): Promise<SingleResponse<{ url: string }>> {
  return getConnectUrl('google');
}

export function disconnectGoogle(): Promise<SingleResponse<{ disconnected: boolean }>> {
  return disconnectProvider('google');
}
