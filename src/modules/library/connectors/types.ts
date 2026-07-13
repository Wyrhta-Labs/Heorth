import type { MediaType, ItemStatus, StandardList, Provider } from '../schema.js';

export interface LibraryItem {
  mediaType: MediaType;
  externalId: string;
  title: string;
  sortTitle: string;
  creators: string[];
  year: number | null;
  coverUrl: string | null;
  status: ItemStatus | null;
  lists: StandardList[];
  rating: number | null;
  tags: string[];
  sourceUrl: string | null;
  raw: unknown;
}

export interface RawConnection {
  id: string;
  provider: Provider;
  externalRef: string;
  credentials: string | null;
}

export interface Connector {
  provider: Provider;
  /** Validate user input; return externalRef + label + (encrypted) credentials. */
  connect(input: unknown): Promise<{ externalRef: string; label: string; credentials: string | null }>;
  /** Pull the whole account, already normalized. `credentials` is set only when rotated (e.g. token refresh). */
  fetchItems(conn: RawConnection): Promise<{ items: LibraryItem[]; credentials?: string | null }>;
}
