import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, storyArcs, storyThreads, characters } from '../database/schema'
import { getWorldStateContextSnapshot } from './world-state.service'

export interface ParallelSegmentGroup {
  id: string
  label: string
  arcId: number
  arcName: string
  chapterRange: [number, number]
  primaryCharacterIds: number[]
  primaryCharacterNames: string[]
  threadIds: number[]
  isIndependent: boolean
}

export interface ParallelGenerationPlan {
  parallelGroups: ParallelSegmentGroup[][]
  sequentialSegments: ParallelSegmentGroup[]
  convergencePoints: number[]
  estimatedSpeedup: number
}

export interface ParallelMergeConflict {
  characterId: number
  characterName: string
  conflictType: 'state' | 'location' | 'relationship'
  description: string
  sourceSegments: string[]
}

export interface ParallelMergeResult {
  conflicts: ParallelMergeConflict[]
  mergedState: Record<string, unknown>
  success: boolean
}

export function identifyParallelizableSegments(
  novelId: number,
  chapterStart: number,
  chapterEnd: number,
): ParallelGenerationPlan {
  const db = getDb()
  const arcs = db.select().from(storyArcs)
    .where(eq(storyArcs.novelId, novelId))
    .orderBy(asc(storyArcs.arcOrder))
    .all()

  const threads = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, novelId))
    .all()

  const allCharacters = db.select().from(characters)
    .where(eq(characters.novelId, novelId))
    .all()

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((c) => c.chapterNum >= chapterStart && c.chapterNum <= chapterEnd)

  // Build segment groups from arcs that overlap the requested range
  const segments: ParallelSegmentGroup[] = []
  for (const arc of arcs) {
    const arcStart = arc.chapterStart || 0
    const arcEnd = arc.chapterEnd || 0
    if (arcEnd < chapterStart || arcStart > chapterEnd) continue

    const effectiveStart = Math.max(arcStart, chapterStart)
    const effectiveEnd = Math.min(arcEnd, chapterEnd)

    // Find characters mentioned in this arc's chapters
    const arcChapters = chapterRows.filter((c) =>
      c.chapterNum >= effectiveStart && c.chapterNum <= effectiveEnd,
    )
    const mentionedCharIds = new Set<number>()
    for (const ch of arcChapters) {
      const outline = ch.outline || ''
      for (const char of allCharacters) {
        if (char.fullName && outline.includes(char.fullName)) {
          mentionedCharIds.add(char.id)
        }
      }
    }

    // Find threads active in this arc range
    const arcThreadIds = threads
      .filter((t) => {
        const planted = t.plantedChapter || 0
        const payoff = t.targetPayoffChapter || 999999
        return planted <= effectiveEnd && payoff >= effectiveStart
      })
      .map((t) => t.id)

    const charIds = Array.from(mentionedCharIds)
    segments.push({
      id: `arc-${arc.id}-ch${effectiveStart}-${effectiveEnd}`,
      label: `${arc.arcName}（第${effectiveStart}-${effectiveEnd}章）`,
      arcId: arc.id,
      arcName: arc.arcName,
      chapterRange: [effectiveStart, effectiveEnd],
      primaryCharacterIds: charIds,
      primaryCharacterNames: charIds.map((id) =>
        allCharacters.find((c) => c.id === id)?.fullName || '未知',
      ),
      threadIds: arcThreadIds,
      isIndependent: false,
    })
  }

  // Determine independence: segments are independent if they share no characters and no threads
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    let overlaps = false
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue
      const other = segments[j]
      // Check chapter range overlap
      if (seg.chapterRange[0] <= other.chapterRange[1] && seg.chapterRange[1] >= other.chapterRange[0]) {
        // Same time period — check character and thread overlap
        const charOverlap = seg.primaryCharacterIds.some((id) => other.primaryCharacterIds.includes(id))
        const threadOverlap = seg.threadIds.some((id) => other.threadIds.includes(id))
        if (charOverlap || threadOverlap) {
          overlaps = true
          break
        }
      }
    }
    seg.isIndependent = !overlaps
  }

  // Group independent segments that can run in parallel
  const parallelGroups: ParallelSegmentGroup[][] = []
  const sequentialSegments: ParallelSegmentGroup[] = []
  const used = new Set<number>()

  // Find pairs/groups of independent segments in same time range
  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue
    if (!segments[i].isIndependent) {
      sequentialSegments.push(segments[i])
      used.add(i)
      continue
    }

    const group = [segments[i]]
    used.add(i)

    for (let j = i + 1; j < segments.length; j++) {
      if (used.has(j) || !segments[j].isIndependent) continue
      // Check mutual independence with all group members
      const isIndependentFromGroup = group.every((member) => {
        const charOverlap = member.primaryCharacterIds.some((id) =>
          segments[j].primaryCharacterIds.includes(id),
        )
        const threadOverlap = member.threadIds.some((id) =>
          segments[j].threadIds.includes(id),
        )
        return !charOverlap && !threadOverlap
      })

      if (isIndependentFromGroup) {
        group.push(segments[j])
        used.add(j)
      }
    }

    if (group.length > 1) {
      parallelGroups.push(group)
    } else {
      sequentialSegments.push(group[0])
    }
  }

  // Find convergence points: chapters where independent lines merge
  const convergencePoints: number[] = []
  for (const group of parallelGroups) {
    if (group.length === 0) continue
    const maxEnd = Math.max(...group.map((s) => s.chapterRange[1]))
    if (maxEnd + 1 <= chapterEnd) {
      convergencePoints.push(maxEnd + 1)
    }
  }

  const totalChapters = chapterEnd - chapterStart + 1
  const parallelChapters = parallelGroups.reduce(
    (sum, group) => group.length > 0
      ? sum + Math.max(...group.map((s) => s.chapterRange[1] - s.chapterRange[0] + 1))
      : sum,
    0,
  )
  const estimatedSpeedup = totalChapters > 0
    ? Math.round((1 + parallelChapters / totalChapters) * 10) / 10
    : 1

  return {
    parallelGroups,
    sequentialSegments,
    convergencePoints,
    estimatedSpeedup,
  }
}

export function buildSharedWorldState(
  novelId: number,
  atChapterNum: number,
): Record<string, unknown> {
  const snapshot = getWorldStateContextSnapshot(novelId, {
    upToChapterNum: atChapterNum - 1,
    limit: 12,
  })
  return {
    chapterNum: atChapterNum,
    currentStates: snapshot.currentStates,
    alerts: snapshot.alerts,
    text: snapshot.worldStatesText,
  }
}

export function mergeParallelOutputs(
  segments: Array<{
    segmentId: string
    outputState: Record<string, unknown>
    characterStates: Record<string, unknown>
  }>,
): ParallelMergeResult {
  const conflicts: ParallelMergeConflict[] = []
  const mergedState: Record<string, unknown> = {}
  const characterModifications = new Map<string, Array<{ segmentId: string; state: unknown }>>()

  for (const seg of segments) {
    // Merge non-character state (last-writer wins)
    for (const [key, value] of Object.entries(seg.outputState)) {
      if (key !== 'characterStates') {
        mergedState[key] = value
      }
    }

    // Track character modifications
    for (const [charKey, charState] of Object.entries(seg.characterStates)) {
      if (!characterModifications.has(charKey)) {
        characterModifications.set(charKey, [])
      }
      characterModifications.get(charKey)!.push({
        segmentId: seg.segmentId,
        state: charState,
      })
    }
  }

  // Detect conflicts: same character modified by multiple segments
  for (const [charKey, modifications] of characterModifications.entries()) {
    if (modifications.length > 1) {
      conflicts.push({
        characterId: 0, // Would need lookup
        characterName: charKey,
        conflictType: 'state',
        description: `角色"${charKey}"被 ${modifications.length} 个并行段同时修改`,
        sourceSegments: modifications.map((m) => m.segmentId),
      })
    }
    // Use the last modification (can be improved with manual resolution)
    mergedState[`character:${charKey}`] = modifications[modifications.length - 1].state
  }

  return {
    conflicts,
    mergedState,
    success: conflicts.length === 0,
  }
}
