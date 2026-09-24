import { apiGet, apiPost, apiPatch, apiDelete, apiGetBlob, qs } from './client';
import type { GewritElement, GewritLink, GewritLinkRole, GewritListResponse, GewritSearchHit, SingleResponse } from '@/lib/types';

export function listDocuments(el: GewritElement): Promise<GewritListResponse> {
  return apiGet('assetId' in el ? `/gewrit/assets/${el.assetId}/documents` : `/gewrit/places/${el.placeId}/documents`);
}

export function searchDocuments(q: string): Promise<SingleResponse<GewritSearchHit[]>> {
  return apiGet(`/gewrit/documents/search${qs({ q })}`);
}

export interface CreateLinkInput {
  externalId: string;
  role: GewritLinkRole;
  note?: string | null;
  assetId?: string;
  placeId?: string;
}

export function createLink(input: CreateLinkInput): Promise<SingleResponse<GewritLink>> {
  return apiPost('/gewrit/links', input);
}

export function updateLink(id: string, input: { role?: GewritLinkRole; note?: string | null }): Promise<SingleResponse<GewritLink>> {
  return apiPatch(`/gewrit/links/${id}`, input);
}

export function deleteLink(id: string): Promise<SingleResponse<{ id: string }>> {
  return apiDelete(`/gewrit/links/${id}`);
}

/** Aborting `signal` drops the connection, which Heorth passes upstream so the
 *  Paperless download stops too. */
export function fetchPreview(documentId: string, signal?: AbortSignal): Promise<Blob> {
  return apiGetBlob(`/gewrit/documents/${documentId}/preview`, signal);
}
