import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, storyArcs, storyItems, timelineEvents } from '../database/schema'

export interface StoryMemorySnapshot {
  generatedAt: string
  chapterCount: number
  lastChapterNum: number
  plotMilestones: string[]
  arcSignals: string[]
  characterLedger: string[]
  worldLedger: string[]
  activeThreads: string[]
  continuityDirectives: string[]
  timelineAnchors: string[]
  itemLedger: string[]
}

interface ContinuityStateLike {
  plotProgress: string[]
  characterStateChanges: string[]
  worldStateChanges: string[]
  openLoops: string[]
  continuityNotes: string[]
  arcProgress: string
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    return toStringArray(JSON.parse(raw))
  } catch {
    return []
  }
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value)))
      .filter((value) => Number.isFinite(value))
  } catch {
    return []
  }
}

function parseContinuityState(raw?: string | null): ContinuityStateLike {
  if (!raw) {
    return {
      plotProgress: [],
      characterStateChanges: [],
      worldStateChanges: [],
      openLoops: [],
      continuityNotes: [],
      arcProgress: '',
    }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      plotProgress: toStringArray(parsed.plot_progress),
      characterStateChanges: toStringArray(parsed.character_state_changes),
      worldStateChanges: toStringArray(parsed.world_state_changes),
      openLoops: toStringArray(parsed.open_loops),
      continuityNotes: toStringArray(parsed.continuity_notes),
      arcProgress: asText(parsed.arc_progress),
    }
  } catch {
    return {
      plotProgress: [],
      characterStateChanges: [],
      worldStateChanges: [],
      openLoops: [],
      continuityNotes: [],
      arcProgress: '',
    }
  }
}

function dedupe(values: string[], limit?: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function takeDistributed(values: string[], limit: number): string[] {
  if (values.length <= limit) return values
  if (limit <= 3) return values.slice(-limit)

  const head = Math.min(2, Math.floor(limit / 3))
  const tail = Math.max(limit - head, 1)
  return dedupe([...values.slice(0, head), ...values.slice(-tail)], limit)
}

function formatTimelineAnchor(
  event: typeof timelineEvents.$inferSelect,
  itemNameMap: Map<number, string>,
): string {
  const linkedItems = parseNumberArray(event.linkedItemIdsJson)
    .map((id) => itemNameMap.get(id))
    .filter((item): item is string => Boolean(item))

  return [
    `${event.timeLabel || '时间未定'}｜${event.eventTitle}`,
    event.eventResult || event.eventSummary || '',
    linkedItems.length > 0 ? `物品=${linkedItems.join('、')}` : '',
  ].filter(Boolean).join('｜')
}

function formatItemLedgerLine(
  item: typeof storyItems.$inferSelect,
  eventNameMap: Map<number, string>,
): string {
  const eventNames = parseNumberArray(item.linkedTimelineEventIdsJson)
    .map((id) => eventNameMap.get(id))
    .filter((value): value is string => Boolean(value))

  const parts = [
    item.itemName,
    item.status || '',
    item.ownerCharacterId ? `已绑定角色#${item.ownerCharacterId}` : '',
    item.locationMapId ? `已绑定地点#${item.locationMapId}` : '',
    eventNames.length > 0 ? `牵涉事件=${eventNames.join('、')}` : '',
    item.plotFunction || '',
  ].filter(Boolean)

  return parts.join('｜')
}

export function buildStoryMemorySnapshot(novelId: number): StoryMemorySnapshot {
  const db = getDb()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const arcRows = db.select().from(storyArcs)
    .where(eq(storyArcs.novelId, novelId))
    .orderBy(asc(storyArcs.arcOrder))
    .all()
  const itemRows = db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
  const eventRows = db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()

  const continuityRows = chapterRows.map((chapter) => ({
    chapterNum: chapter.chapterNum,
    summary: asText(chapter.summary),
    continuity: parseContinuityState(chapter.continuityStateJson),
  }))

  const itemNameMap = new Map(itemRows.map((item) => [item.id, item.itemName]))
  const eventNameMap = new Map(eventRows.map((event) => [event.id, event.eventTitle]))

  const plotMilestones = takeDistributed(dedupe([
    ...continuityRows
      .filter((row) => row.summary)
      .map((row) => `第${row.chapterNum}章：${row.summary}`),
    ...continuityRows.flatMap((row) =>
      row.continuity.plotProgress.map((entry) => `第${row.chapterNum}章推进：${entry}`)),
  ]), 12)

  const arcSignals = dedupe([
    ...arcRows.map((arc) => `${arc.arcName}：${arc.arcGoal || arc.arcSummary || '待补充'}`),
    ...continuityRows
      .filter((row) => row.continuity.arcProgress)
      .map((row) => `第${row.chapterNum}章弧线进度：${row.continuity.arcProgress}`),
  ], 10)

  const characterLedger = dedupe(
    continuityRows.flatMap((row) =>
      row.continuity.characterStateChanges.map((entry) => `第${row.chapterNum}章：${entry}`)),
    12,
  )

  const worldLedger = dedupe(
    continuityRows.flatMap((row) =>
      row.continuity.worldStateChanges.map((entry) => `第${row.chapterNum}章：${entry}`)),
    10,
  )

  const activeThreads = dedupe([
    ...continuityRows.flatMap((row) => row.continuity.openLoops),
    ...eventRows
      .filter((event) => event.status !== 'resolved')
      .flatMap((event) => parseStringArray(event.openThreadsJson)),
  ], 14)

  const continuityDirectives = dedupe(
    continuityRows.flatMap((row) => row.continuity.continuityNotes),
    12,
  )

  const timelineAnchors = takeDistributed(
    eventRows
      .filter((event) => event.isMajorEvent !== 0 || event.status === 'resolved' || event.status === 'written')
      .map((event) => formatTimelineAnchor(event, itemNameMap)),
    10,
  )

  const itemLedger = dedupe(
    itemRows
      .filter((item) => item.itemKind === 'instance')
      .map((item) => formatItemLedgerLine(item, eventNameMap)),
    10,
  )

  return {
    generatedAt: new Date().toISOString(),
    chapterCount: chapterRows.length,
    lastChapterNum: chapterRows[chapterRows.length - 1]?.chapterNum || 0,
    plotMilestones,
    arcSignals,
    characterLedger,
    worldLedger,
    activeThreads,
    continuityDirectives,
    timelineAnchors,
    itemLedger,
  }
}

export function buildStoryMemoryPromptSummary(novelId: number): string {
  const snapshot = buildStoryMemorySnapshot(novelId)
  const sections = [
    snapshot.plotMilestones.length > 0
      ? `长期剧情里程碑：\n- ${snapshot.plotMilestones.join('\n- ')}`
      : '',
    snapshot.arcSignals.length > 0
      ? `故事弧与阶段推进：\n- ${snapshot.arcSignals.join('\n- ')}`
      : '',
    snapshot.characterLedger.length > 0
      ? `长期人物变化：\n- ${snapshot.characterLedger.join('\n- ')}`
      : '',
    snapshot.worldLedger.length > 0
      ? `长期世界变化：\n- ${snapshot.worldLedger.join('\n- ')}`
      : '',
    snapshot.activeThreads.length > 0
      ? `仍在延续的线索：\n- ${snapshot.activeThreads.join('\n- ')}`
      : '',
    snapshot.continuityDirectives.length > 0
      ? `后文不能忘的承接事项：\n- ${snapshot.continuityDirectives.join('\n- ')}`
      : '',
    snapshot.timelineAnchors.length > 0
      ? `关键时间轴锚点：\n- ${snapshot.timelineAnchors.join('\n- ')}`
      : '',
    snapshot.itemLedger.length > 0
      ? `关键物品去向：\n- ${snapshot.itemLedger.join('\n- ')}`
      : '',
  ].filter(Boolean)

  return sections.join('\n\n')
}
