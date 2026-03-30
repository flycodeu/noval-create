import { eq, and, desc } from 'drizzle-orm'
import { getDb } from '../database/db'
import { generationHistory } from '../database/schema'

function extractDigest(output: string): string {
  if (!output) return ''
  const cleaned = output.replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 300)
}

export function recordGeneration(
  novelId: number,
  entityType: string,
  entityId: number | null,
  taskType: string,
  output: string,
  attemptNumber: number = 1,
): number {
  const db = getDb()
  const digest = extractDigest(output)
  const result = db
    .insert(generationHistory)
    .values({
      novelId,
      entityType,
      entityId,
      taskType,
      outputDigest: digest,
      rejected: 0,
      attemptNumber,
    })
    .returning({ id: generationHistory.id })
    .get()
  return result.id
}

export function markRejected(historyId: number): void {
  const db = getDb()
  db.update(generationHistory)
    .set({ rejected: 1 })
    .where(eq(generationHistory.id, historyId))
    .run()
}

export function markAllRejectedForEntity(
  novelId: number,
  entityType: string,
  entityId: number | null,
  taskType: string,
): void {
  const db = getDb()
  const conditions = [
    eq(generationHistory.novelId, novelId),
    eq(generationHistory.entityType, entityType),
    eq(generationHistory.taskType, taskType),
  ]
  if (entityId != null) {
    conditions.push(eq(generationHistory.entityId, entityId))
  }
  db.update(generationHistory)
    .set({ rejected: 1 })
    .where(and(...conditions))
    .run()
}

export function getRecentRejectedDigests(
  novelId: number,
  entityType: string,
  entityId: number | null,
  taskType: string,
  limit: number = 3,
): string[] {
  const db = getDb()
  const conditions = [
    eq(generationHistory.novelId, novelId),
    eq(generationHistory.entityType, entityType),
    eq(generationHistory.taskType, taskType),
    eq(generationHistory.rejected, 1),
  ]
  if (entityId != null) {
    conditions.push(eq(generationHistory.entityId, entityId))
  }
  const rows = db
    .select({ outputDigest: generationHistory.outputDigest })
    .from(generationHistory)
    .where(and(...conditions))
    .orderBy(desc(generationHistory.createdAt))
    .limit(limit)
    .all()
  return rows.map((r) => r.outputDigest).filter(Boolean)
}

export function getAttemptCount(
  novelId: number,
  entityType: string,
  entityId: number | null,
  taskType: string,
): number {
  const db = getDb()
  const conditions = [
    eq(generationHistory.novelId, novelId),
    eq(generationHistory.entityType, entityType),
    eq(generationHistory.taskType, taskType),
  ]
  if (entityId != null) {
    conditions.push(eq(generationHistory.entityId, entityId))
  }
  const rows = db
    .select({ id: generationHistory.id })
    .from(generationHistory)
    .where(and(...conditions))
    .all()
  return rows.length
}
