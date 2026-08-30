import { IntegrationStore, type PublicIntegrationConnection } from '../integrations/store.js';

/**
 * TEMPORARY SHIM — the store moved to `src/integrations/store.ts` and gained a
 * provider scope. Deleted in the task that rewires `src/m365/` onto the
 * integrations layer.
 */
export type PublicM365Connection = PublicIntegrationConnection;

export class M365Store extends IntegrationStore {
  constructor() {
    super('m365');
  }

  /** Back-compat: the old input field was `accountUpn`. */
  override async upsertConnection(input: {
    memberId: string; accountUpn?: string; accountLabel?: string;
    refreshToken: string; scopes: string;
  }): Promise<PublicIntegrationConnection> {
    return super.upsertConnection({
      memberId: input.memberId,
      accountLabel: input.accountLabel ?? input.accountUpn ?? '',
      refreshToken: input.refreshToken,
      scopes: input.scopes,
    });
  }
}
