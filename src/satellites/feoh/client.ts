import { SatelliteClient, type SatelliteRequest, type SatelliteResponse } from '../satellite-client.js';

/** A party as Feoh returns it (id + the Heorth member cross-reference). */
export interface FeohParty {
  id: string;
  kind: 'member' | 'external';
  heorthMemberId: string | null;
  displayName: string;
  kithledgerPersonId: string | null;
}

/**
 * Feoh-specific satellite client. Thin layer over {@link SatelliteClient}:
 *  - `forward` is the raw pass-through the finance proxy uses (body/query/status
 *    untouched by this layer; the proxy handles field translation);
 *  - `upsertPartyByMember`/`listParties` are the two roster operations Heorth
 *    uses to keep Feoh's party table mirrored to the household member list.
 */
export class FeohClient {
  constructor(private readonly http: SatelliteClient) {}

  /** Pass a finance request straight through to Feoh under `/api/v1/feoh`. */
  forward(req: SatelliteRequest): Promise<SatelliteResponse> {
    return this.http.send(req);
  }

  /** Idempotent roster upsert: `PUT /api/v1/parties/by-heorth-member/:id`. */
  async upsertPartyByMember(
    heorthMemberId: string,
    input: { displayName: string; kithledgerPersonId?: string | null },
  ): Promise<FeohParty> {
    const res = await this.http.send({
      method: 'PUT',
      path: `/api/v1/parties/by-heorth-member/${encodeURIComponent(heorthMemberId)}`,
      body: JSON.stringify(input),
      contentType: 'application/json',
    });
    if (res.status >= 400) {
      throw new Error(`Feoh party upsert failed (${res.status}): ${res.text}`);
    }
    return (JSON.parse(res.text) as { data: FeohParty }).data;
  }

  /** List all parties (used to rebuild the mapping cache). */
  async listParties(): Promise<FeohParty[]> {
    const res = await this.http.send({ method: 'GET', path: '/api/v1/parties' });
    if (res.status >= 400) {
      throw new Error(`Feoh list parties failed (${res.status}): ${res.text}`);
    }
    return (JSON.parse(res.text) as { data: FeohParty[] }).data;
  }
}
