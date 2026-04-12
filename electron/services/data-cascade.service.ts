import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapterSegments,
  characterDialogueFingerprints,
  characters,
  factions,
  glossary,
  storyArcs,
  storyItems,
  storyMemoryCheckpoints,
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

function remapChapterNumber(
  value: number | null | undefined,
  chapterNumberRemap: Map<number, number | null>,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value ?? null
  if (!chapterNumberRemap.has(value)) return value
  return chapterNumberRemap.get(value) ?? null
}

function remapChapterRange(
  start: number | null | undefined,
  end: number | null | undefined,
  chapterNumberRemap: Map<number, number | null>,
): { start: number | null; end: number | null } {
  if (typeof start !== 'number' || !Number.isFinite(start) || typeof end !== 'number' || !Number.isFinite(end)) {
    return {
      start: remapChapterNumber(start, chapterNumberRemap),
      end: remapChapterNumber(end, chapterNumberRemap),
    }
  }

  const min = Math.min(start, end)
  const max = Math.max(start, end)
  const mappedValues = [...chapterNumberRemap.entries()]
    .filter(([oldChapterNum, newChapterNum]) => (
      oldChapterNum >= min
      && oldChapterNum <= max
      && typeof newChapterNum === 'number'
      && Number.isFinite(newChapterNum)
    ))
    .map(([, newChapterNum]) => Number(newChapterNum))
    .sort((left, right) => left - right)

  if (mappedValues.length === 0) {
    return { start: null, end: null }
  }

  return {
    start: mappedValues[0],
    end: mappedValues[mappedValues.length - 1],
  }
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

export function remapChapterNumberReferences(
  novelId: number,
  chapterNumberRemap: Map<number, number | null>,
): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all().forEach((arc) => {
    const nextChapterStart = remapChapterNumber(arc.chapterStart, chapterNumberRemap)
    const nextChapterEnd = remapChapterNumber(arc.chapterEnd, chapterNumberRemap)
    const nextLastProgressChapterNum = remapChapterNumber(arc.lastProgressChapterNum, chapterNumberRemap)
    if (
      nextChapterStart === arc.chapterStart
      && nextChapterEnd === arc.chapterEnd
      && nextLastProgressChapterNum === arc.lastProgressChapterNum
    ) return
    db.update(storyArcs).set({
      chapterStart: nextChapterStart,
      chapterEnd: nextChapterEnd,
      lastProgressChapterNum: nextLastProgressChapterNum,
    }).where(eq(storyArcs.id, arc.id)).run()
  })

  db.select().from(storyThreads).where(eq(storyThreads.novelId, novelId)).all().forEach((thread) => {
    const nextStartChapter = remapChapterNumber(thread.startChapter, chapterNumberRemap)
    const nextTargetPayoffChapter = remapChapterNumber(thread.targetPayoffChapter, chapterNumberRemap)
    const nextPlantedChapter = remapChapterNumber(thread.plantedChapter, chapterNumberRemap)
    const nextLastReferencedChapter = remapChapterNumber(thread.lastReferencedChapter, chapterNumberRemap)
    const nextResolvedChapter = remapChapterNumber(thread.resolvedChapter, chapterNumberRemap)
    if (
      nextStartChapter === thread.startChapter
      && nextTargetPayoffChapter === thread.targetPayoffChapter
      && nextPlantedChapter === thread.plantedChapter
      && nextLastReferencedChapter === thread.lastReferencedChapter
      && nextResolvedChapter === thread.resolvedChapter
    ) return
    db.update(storyThreads).set({
      startChapter: nextStartChapter,
      targetPayoffChapter: nextTargetPayoffChapter,
      plantedChapter: nextPlantedChapter,
      lastReferencedChapter: nextLastReferencedChapter,
      resolvedChapter: nextResolvedChapter,
      updatedAt: now,
    }).where(eq(storyThreads.id, thread.id)).run()
  })

  db.select().from(characters).where(eq(characters.novelId, novelId)).all().forEach((character) => {
    const nextAppearChapter = remapChapterNumber(character.appearChapter, chapterNumberRemap)
    if (nextAppearChapter === character.appearChapter) return
    db.update(characters).set({
      appearChapter: nextAppearChapter,
      updatedAt: now,
    }).where(eq(characters.id, character.id)).run()
  })

  db.select().from(glossary).where(eq(glossary.novelId, novelId)).all().forEach((entry) => {
    const nextFirstAppearChapter = remapChapterNumber(entry.firstAppearChapter, chapterNumberRemap)
    if (nextFirstAppearChapter === entry.firstAppearChapter) return
    db.update(glossary).set({
      firstAppearChapter: nextFirstAppearChapter,
      updatedAt: now,
    }).where(eq(glossary.id, entry.id)).run()
  })

  db.select().from(storyMemoryCheckpoints).where(eq(storyMemoryCheckpoints.novelId, novelId)).all().forEach((checkpoint) => {
    const nextSourceRange = remapChapterRange(
      checkpoint.sourceRangeStart,
      checkpoint.sourceRangeEnd,
      chapterNumberRemap,
    )
    const nextLastRefreshedChapterNum = remapChapterNumber(checkpoint.lastRefreshedChapterNum, chapterNumberRemap)
    if (
      nextSourceRange.start === checkpoint.sourceRangeStart
      && nextSourceRange.end === checkpoint.sourceRangeEnd
      && nextLastRefreshedChapterNum === checkpoint.lastRefreshedChapterNum
    ) return
    db.update(storyMemoryCheckpoints).set({
      sourceRangeStart: nextSourceRange.start,
      sourceRangeEnd: nextSourceRange.end,
      lastRefreshedChapterNum: nextLastRefreshedChapterNum ?? 0,
      stale: 1,
      updatedAt: now,
    }).where(eq(storyMemoryCheckpoints.id, checkpoint.id)).run()
  })

  db.select().from(characterDialogueFingerprints).where(eq(characterDialogueFingerprints.novelId, novelId)).all().forEach((fingerprint) => {
    const nextSampleRange = remapChapterRange(
      fingerprint.sampleChapterStart,
      fingerprint.sampleChapterEnd,
      chapterNumberRemap,
    )
    const nextSampleChapterStart = nextSampleRange.start
    const nextSampleChapterEnd = nextSampleRange.end
    if (
      nextSampleChapterStart === fingerprint.sampleChapterStart
      && nextSampleChapterEnd === fingerprint.sampleChapterEnd
    ) return
    db.update(characterDialogueFingerprints).set({
      sampleChapterStart: nextSampleChapterStart,
      sampleChapterEnd: nextSampleChapterEnd,
      updatedAt: now,
    }).where(eq(characterDialogueFingerprints.id, fingerprint.id)).run()
  })
}
