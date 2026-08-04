import { Cloud, type LucideIcon } from 'lucide-react';
import { getM365ConnectUrl, disconnectM365 } from '@/api/m365';
import { useM365ProviderStatus } from '@/hooks/use-m365';
import type { ProviderState } from '@/hooks/use-m365';

export type { ProviderState };

/**
 * Provider-neutral connection shape — every provider adapter maps its own wire
 * type onto this so the rendering component (Task 11) never touches
 * provider-specific vocabulary. `status`/reauth-ness is not part of this shape:
 * it is already folded into the derived `ProviderState` each adapter's
 * `useStatus()` returns.
 */
export interface ProviderConnection {
  memberId: string;
  /** Human-readable account identity for display. M365 maps its UPN here. */
  accountLabel: string;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface ProviderApi {
  useStatus: () => { state: ProviderState; connection: ProviderConnection | null; isLoading: boolean };
  getConnectUrl: () => Promise<string>;
  disconnect: () => Promise<void>;
}

export interface ConnectionProvider {
  id: string;
  nameKey: string;
  descriptionKey: string;
  capabilities: ('calendar' | 'tasks')[];
  icon: LucideIcon;
  api: ProviderApi;
}

async function getM365ConnectUrlUnwrapped(): Promise<string> {
  const res = await getM365ConnectUrl();
  return res.data.url;
}

async function disconnectM365Wrapped(): Promise<void> {
  await disconnectM365();
}

export const PROVIDERS: ConnectionProvider[] = [
  {
    id: 'm365',
    nameKey: 'connections.m365.name',
    descriptionKey: 'connections.m365.description',
    capabilities: ['calendar', 'tasks'],
    icon: Cloud,
    api: {
      useStatus: useM365ProviderStatus,
      getConnectUrl: getM365ConnectUrlUnwrapped,
      disconnect: disconnectM365Wrapped,
    },
  },
];
