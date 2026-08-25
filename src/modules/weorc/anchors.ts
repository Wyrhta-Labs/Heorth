import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { ethelAssets, ethelPlaces } from '../ethel/schema.js';
import type { WeorcRoutine } from './schema.js';

/**
 * The display name of a routine's anchor, or null when it has none, which is
 * the normal case. Weorc reads Ethel's tables directly for one name rather than
 * importing its service: the dependency runs Weorc -> Ethel and stays a read.
 */
export async function anchorName(routine: WeorcRoutine): Promise<string | null> {
  if (routine.anchorAssetId) {
    const [row] = await db.select({ name: ethelAssets.name }).from(ethelAssets)
      .where(eq(ethelAssets.id, routine.anchorAssetId));
    return row?.name ?? null;
  }
  if (routine.anchorPlaceId) {
    const [row] = await db.select({ name: ethelPlaces.name }).from(ethelPlaces)
      .where(eq(ethelPlaces.id, routine.anchorPlaceId));
    return row?.name ?? null;
  }
  return null;
}
