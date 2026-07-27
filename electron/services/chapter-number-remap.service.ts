import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  characterDialogueFingerprints,
  characters,
  glossary,
  storyArcs,
  storyMemoryCheckpoints,
  storyThreads,
} from '../database/schema'

export interface ChapterNumberReferenceSnapshot {
  storyArcs: Array<{ id: number; chapterStart: number | null; chapterEnd: number | null; lastProgressChapterNum: number | null }>
  storyThreads: Array<{ id: number; startChapter: number | null; targetPayoffChapter: number | null; plantedChapter: number | null; lastReferencedChapter: number | null; resolvedChapter: number | null }>
  characters: Array<{ id: number; appearChapter: number | null }>
  glossary: Array<{ id: number; firstAppearChapter: number | null }>
  storyMemoryCheckpoints: Array<{ id: number; sourceRangeStart: number | null; sourceRangeEnd: number | null; lastRefreshedChapterNum: number | null; stale: number | null }>
  characterDialogueFingerprints: Array<{ id: number; sampleChapterStart: number | null; sampleChapterEnd: number | null }>
}

export function captureChapterNumberReferenceSnapshot(novelId: number): ChapterNumberReferenceSnapshot {
  const db = getDb()
  return {
    storyArcs: db.select({
      id: storyArcs.id,
      chapterStart: storyArcs.chapterStart,
      chapterEnd: storyArcs.chapterEnd,
      lastProgressChapterNum: storyArcs.lastProgressChapterNum,
    }).from(storyArcs).where(eq(storyArcs.novelId, novelId)).all(),
    storyThreads: db.select({
      id: storyThreads.id,
      startChapter: storyThreads.startChapter,
      targetPayoffChapter: storyThreads.targetPayoffChapter,
      plantedChapter: storyThreads.plantedChapter,
      lastReferencedChapter: storyThreads.lastReferencedChapter,
      resolvedChapter: storyThreads.resolvedChapter,
    }).from(storyThreads).where(eq(storyThreads.novelId, novelId)).all(),
    characters: db.select({ id: characters.id, appearChapter: characters.appearChapter })
      .from(characters).where(eq(characters.novelId, novelId)).all(),
    glossary: db.select({ id: glossary.id, firstAppearChapter: glossary.firstAppearChapter })
      .from(glossary).where(eq(glossary.novelId, novelId)).all(),
    storyMemoryCheckpoints: db.select({
      id: storyMemoryCheckpoints.id,
      sourceRangeStart: storyMemoryCheckpoints.sourceRangeStart,
      sourceRangeEnd: storyMemoryCheckpoints.sourceRangeEnd,
      lastRefreshedChapterNum: storyMemoryCheckpoints.lastRefreshedChapterNum,
      stale: storyMemoryCheckpoints.stale,
    }).from(storyMemoryCheckpoints).where(eq(storyMemoryCheckpoints.novelId, novelId)).all(),
    characterDialogueFingerprints: db.select({
      id: characterDialogueFingerprints.id,
      sampleChapterStart: characterDialogueFingerprints.sampleChapterStart,
      sampleChapterEnd: characterDialogueFingerprints.sampleChapterEnd,
    }).from(characterDialogueFingerprints).where(eq(characterDialogueFingerprints.novelId, novelId)).all(),
  }
}

export function restoreChapterNumberReferenceSnapshot(
  snapshot: ChapterNumberReferenceSnapshot,
): void {
  const db = getDb()
  const now = new Date().toISOString()
  snapshot.storyArcs.forEach((item) => {
    db.update(storyArcs).set({
      chapterStart: item.chapterStart,
      chapterEnd: item.chapterEnd,
      lastProgressChapterNum: item.lastProgressChapterNum,
    }).where(eq(storyArcs.id, item.id)).run()
  })
  snapshot.storyThreads.forEach((item) => {
    db.update(storyThreads).set({
      startChapter: item.startChapter,
      targetPayoffChapter: item.targetPayoffChapter,
      plantedChapter: item.plantedChapter,
      lastReferencedChapter: item.lastReferencedChapter,
      resolvedChapter: item.resolvedChapter,
      updatedAt: now,
    }).where(eq(storyThreads.id, item.id)).run()
  })
  snapshot.characters.forEach((item) => {
    db.update(characters).set({ appearChapter: item.appearChapter, updatedAt: now }).where(eq(characters.id, item.id)).run()
  })
  snapshot.glossary.forEach((item) => {
    db.update(glossary).set({ firstAppearChapter: item.firstAppearChapter, updatedAt: now }).where(eq(glossary.id, item.id)).run()
  })
  snapshot.storyMemoryCheckpoints.forEach((item) => {
    db.update(storyMemoryCheckpoints).set({
      sourceRangeStart: item.sourceRangeStart,
      sourceRangeEnd: item.sourceRangeEnd,
      lastRefreshedChapterNum: item.lastRefreshedChapterNum ?? 0,
      stale: item.stale ?? 0,
      updatedAt: now,
    }).where(eq(storyMemoryCheckpoints.id, item.id)).run()
  })
  snapshot.characterDialogueFingerprints.forEach((item) => {
    db.update(characterDialogueFingerprints).set({
      sampleChapterStart: item.sampleChapterStart,
      sampleChapterEnd: item.sampleChapterEnd,
      updatedAt: now,
    }).where(eq(characterDialogueFingerprints.id, item.id)).run()
  })
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

  if (mappedValues.length === 0) return { start: null, end: null }

  return {
    start: mappedValues[0],
    end: mappedValues[mappedValues.length - 1],
  }
}

export function remapChapterNumberReferences(
  novelId: number,
  chapterNumberRemap: Map<number, number | null>,
): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all().forEach((arc) => {
    const mappedChapterStart = remapChapterNumber(arc.chapterStart, chapterNumberRemap)
    const mappedChapterEnd = remapChapterNumber(arc.chapterEnd, chapterNumberRemap)
    const nextChapterStart = typeof mappedChapterStart === 'number' && typeof mappedChapterEnd === 'number'
      ? Math.min(mappedChapterStart, mappedChapterEnd)
      : mappedChapterStart
    const nextChapterEnd = typeof mappedChapterStart === 'number' && typeof mappedChapterEnd === 'number'
      ? Math.max(mappedChapterStart, mappedChapterEnd)
      : mappedChapterEnd
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
    db.update(characters).set({ appearChapter: nextAppearChapter, updatedAt: now }).where(eq(characters.id, character.id)).run()
  })

  db.select().from(glossary).where(eq(glossary.novelId, novelId)).all().forEach((entry) => {
    const nextFirstAppearChapter = remapChapterNumber(entry.firstAppearChapter, chapterNumberRemap)
    if (nextFirstAppearChapter === entry.firstAppearChapter) return
    db.update(glossary).set({ firstAppearChapter: nextFirstAppearChapter, updatedAt: now }).where(eq(glossary.id, entry.id)).run()
  })

  db.select().from(storyMemoryCheckpoints).where(eq(storyMemoryCheckpoints.novelId, novelId)).all().forEach((checkpoint) => {
    const nextSourceRange = remapChapterRange(checkpoint.sourceRangeStart, checkpoint.sourceRangeEnd, chapterNumberRemap)
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
    const nextSampleRange = remapChapterRange(fingerprint.sampleChapterStart, fingerprint.sampleChapterEnd, chapterNumberRemap)
    if (
      nextSampleRange.start === fingerprint.sampleChapterStart
      && nextSampleRange.end === fingerprint.sampleChapterEnd
    ) return
    db.update(characterDialogueFingerprints).set({
      sampleChapterStart: nextSampleRange.start,
      sampleChapterEnd: nextSampleRange.end,
      updatedAt: now,
    }).where(eq(characterDialogueFingerprints.id, fingerprint.id)).run()
  })
}
