import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapterSegments,
  characters,
  factions,
  storyItems,
  storyThreads,
  timelineEvents,
} from '../database/schema'
import { markTimelineEventsSegmentAnchorInvalid } from './timeline.service'

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item)))]
  } catch {
    return []
  }
}

function stringifyNumberArray(values: number[]): string {
  return JSON.stringify([...new Set(values.filter((item) => Number.isFinite(item)))])
}

function removeNumberFromArray(raw: string | null | undefined, targetId: number): string {
  return stringifyNumberArray(parseNumberArray(raw).filter((item) => item !== targetId))
}

export function cleanupCharacterSoftReferences(novelId: number, characterId: number): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all().forEach((item) => {
    const nextOwnerCharacterId = item.ownerCharacterId === characterId ? null : item.ownerCharacterId
    const nextLinkedCharacterIdsJson = removeNumberFromArray(item.linkedCharacterIdsJson, characterId)
    if (nextOwnerCharacterId === item.ownerCharacterId && nextLinkedCharacterIdsJson === (item.linkedCharacterIdsJson || '[]')) return
    db.update(storyItems).set({
      ownerCharacterId: nextOwnerCharacterId,
      linkedCharacterIdsJson: nextLinkedCharacterIdsJson,
      updatedAt: now,
    }).where(eq(storyItems.id, item.id)).run()
  })

  db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all().forEach((event) => {
    const nextPresentCharacterIdsJson = removeNumberFromArray(event.presentCharacterIdsJson, characterId)
    const nextAffectedCharacterIdsJson = removeNumberFromArray(event.affectedCharacterIdsJson, characterId)
    if (
      nextPresentCharacterIdsJson === (event.presentCharacterIdsJson || '[]')
      && nextAffectedCharacterIdsJson === (event.affectedCharacterIdsJson || '[]')
    ) return
    db.update(timelineEvents).set({
      presentCharacterIdsJson: nextPresentCharacterIdsJson,
      affectedCharacterIdsJson: nextAffectedCharacterIdsJson,
      updatedAt: now,
    }).where(eq(timelineEvents.id, event.id)).run()
  })

  db.select().from(storyThreads).where(eq(storyThreads.novelId, novelId)).all().forEach((thread) => {
    const nextRelatedCharacterIdsJson = removeNumberFromArray(thread.relatedCharacterIdsJson, characterId)
    if (nextRelatedCharacterIdsJson === (thread.relatedCharacterIdsJson || '[]')) return
    db.update(storyThreads).set({
      relatedCharacterIdsJson: nextRelatedCharacterIdsJson,
      updatedAt: now,
    }).where(eq(storyThreads.id, thread.id)).run()
  })

  db.select().from(chapterSegments).where(eq(chapterSegments.novelId, novelId)).all().forEach((segment) => {
    const nextPresentCharacterIdsJson = removeNumberFromArray(segment.presentCharacterIdsJson, characterId)
    if (nextPresentCharacterIdsJson === (segment.presentCharacterIdsJson || '[]')) return
    db.update(chapterSegments).set({
      presentCharacterIdsJson: nextPresentCharacterIdsJson,
      updatedAt: now,
    }).where(eq(chapterSegments.id, segment.id)).run()
  })

  db.select().from(factions).where(eq(factions.novelId, novelId)).all().forEach((faction) => {
    if (faction.leaderCharacterId !== characterId) return
    db.update(factions).set({
      leaderCharacterId: null,
      updatedAt: now,
    }).where(eq(factions.id, faction.id)).run()
  })
}

export function cleanupStoryItemSoftReferences(novelId: number, itemId: number): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all().forEach((event) => {
    const nextLinkedItemIdsJson = removeNumberFromArray(event.linkedItemIdsJson, itemId)
    if (nextLinkedItemIdsJson === (event.linkedItemIdsJson || '[]')) return
    db.update(timelineEvents).set({
      linkedItemIdsJson: nextLinkedItemIdsJson,
      updatedAt: now,
    }).where(eq(timelineEvents.id, event.id)).run()
  })

  db.select().from(storyThreads).where(eq(storyThreads.novelId, novelId)).all().forEach((thread) => {
    const nextRelatedItemIdsJson = removeNumberFromArray(thread.relatedItemIdsJson, itemId)
    if (nextRelatedItemIdsJson === (thread.relatedItemIdsJson || '[]')) return
    db.update(storyThreads).set({
      relatedItemIdsJson: nextRelatedItemIdsJson,
      updatedAt: now,
    }).where(eq(storyThreads.id, thread.id)).run()
  })

  db.select().from(chapterSegments).where(eq(chapterSegments.novelId, novelId)).all().forEach((segment) => {
    const nextLinkedItemIdsJson = removeNumberFromArray(segment.linkedItemIdsJson, itemId)
    if (nextLinkedItemIdsJson === (segment.linkedItemIdsJson || '[]')) return
    db.update(chapterSegments).set({
      linkedItemIdsJson: nextLinkedItemIdsJson,
      updatedAt: now,
    }).where(eq(chapterSegments.id, segment.id)).run()
  })

  db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all().forEach((item) => {
    if (item.parentItemId !== itemId) return
    db.update(storyItems).set({
      parentItemId: null,
      updatedAt: now,
    }).where(eq(storyItems.id, item.id)).run()
  })
}

export function cleanupMapSoftReferences(novelId: number, mapId: number): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.select().from(factions).where(eq(factions.novelId, novelId)).all().forEach((faction) => {
    const nextTerritoryMapNodeIdsJson = removeNumberFromArray(faction.territoryMapNodeIdsJson, mapId)
    if (nextTerritoryMapNodeIdsJson === (faction.territoryMapNodeIdsJson || '[]')) return
    db.update(factions).set({
      territoryMapNodeIdsJson: nextTerritoryMapNodeIdsJson,
      updatedAt: now,
    }).where(eq(factions.id, faction.id)).run()
  })

  db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all().forEach((item) => {
    if (item.locationMapId !== mapId) return
    db.update(storyItems).set({
      locationMapId: null,
      updatedAt: now,
    }).where(eq(storyItems.id, item.id)).run()
  })

  db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all().forEach((event) => {
    if (event.locationMapId !== mapId) return
    db.update(timelineEvents).set({
      locationMapId: null,
      updatedAt: now,
    }).where(eq(timelineEvents.id, event.id)).run()
  })
}

export function deleteChapterSegmentsCascade(chapterId: number): void {
  const db = getDb()

  db.select().from(chapterSegments).where(eq(chapterSegments.chapterId, chapterId)).all().forEach((segment) => {
    markTimelineEventsSegmentAnchorInvalid(segment.id)
    db.delete(chapterSegments).where(eq(chapterSegments.id, segment.id)).run()
  })
}

export { remapChapterNumberReferences } from './chapter-number-remap.service'
