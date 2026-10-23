import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { assetChangeEvents } from '../database/schema'

/** An exact current reference audit can retain the last narrative freshness baseline. */
export function referenceNarrativeUpdatedAt(novelId: number, contextVersion: number, updatedAt: string | null): string | null {
  const latest = getDb().select().from(assetChangeEvents).where(and(
    eq(assetChangeEvents.novelId, novelId),
    eq(assetChangeEvents.assetType, 'creative_reference'),
    eq(assetChangeEvents.assetId, novelId),
    eq(assetChangeEvents.triggeredBy, 'novel.service'),
  )).orderBy(desc(assetChangeEvents.id)).limit(1).all()[0]
  if (!latest || latest.operation !== 'update' || latest.impactLevel !== 'low') return updatedAt
  try {
    const payload = JSON.parse(latest.payloadJson || '') as Record<string, unknown>
    if (payload.schemaVersion !== 1 || payload.contextVersion !== contextVersion || payload.previousContextVersion !== contextVersion - 1
      || payload.novelUpdatedAt !== updatedAt || typeof payload.narrativeUpdatedAt !== 'string'
      || !Number.isFinite(Date.parse(payload.narrativeUpdatedAt)) || !updatedAt
      || !Number.isFinite(Date.parse(updatedAt))
      || Date.parse(payload.narrativeUpdatedAt) > Date.parse(updatedAt)) return updatedAt
    return payload.narrativeUpdatedAt
  } catch { return updatedAt }
}
