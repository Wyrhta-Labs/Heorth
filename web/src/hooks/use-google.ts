import { useProviderStatus } from './use-m365';

/** Google's binding of the shared derived status hook. */
export function useGoogleProviderStatus() {
  return useProviderStatus('google');
}
