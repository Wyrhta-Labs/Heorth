import { apiGet } from './client';
import type { SingleResponse } from '@/lib/types';

export interface Features {
  finance: boolean;
  kithledger: boolean;
  kithledgerUrl: string | null;
}

export function getFeatures(): Promise<SingleResponse<Features>> { return apiGet('/features'); }
