import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, storyItems, timelineEvents } from '../database/schema'

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

function stringifyNumberArray(values: number[]): string {
  return JSON.stringify([...new Set(values.filter((value) => Number.isFinite(value)))])
}

export function syncTimelineEventItemLinks(eventId: number) {
  const db = getDb()
  const event = db.select().from(timelineEvents).where(eq(timelineEvents.id, eventId)).all()[0]
  if (!event) return

  const linkedIds = new Set(parseNumberArray(event.linkedItemIdsJson))
  const items = db.select().from(storyItems).where(eq(storyItems.novelId, event.novelId)).all()

  items.forEach((item) => {
    const current = new Set(parseNumberArray(item.linkedTimelineEventIdsJson))
    const shouldInclude = linkedIds.has(item.id)
    const hasEvent = current.has(eventId)

    if (shouldInclude === hasEvent) return

    if (shouldInclude) {
      current.add(eventId)
    } else {
      current.delete(eventId)
    }

    db.update(storyItems).set({
      linkedTimelineEventIdsJson: stringifyNumberArray([...current]),
      updatedAt: new Date().toISOString(),
    }).where(eq(storyItems.id, item.id)).run()
  })
}

export function syncStoryItemTimelineLinks(itemId: number) {
  const db = getDb()
  const item = db.select().from(storyItems).where(eq(storyItems.id, itemId)).all()[0]
  if (!item) return

  const linkedEventIds = new Set(parseNumberArray(item.linkedTimelineEventIdsJson))
  const events = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, item.novelId)).all()

  events.forEach((event) => {
    const current = new Set(parseNumberArray(event.linkedItemIdsJson))
    const shouldInclude = linkedEventIds.has(event.id)
    const hasItem = current.has(itemId)

    if (shouldInclude === hasItem) return

    if (shouldInclude) {
      current.add(itemId)
    } else {
      current.delete(itemId)
    }

    db.update(timelineEvents).set({
      linkedItemIdsJson: stringifyNumberArray([...current]),
      updatedAt: new Date().toISOString(),
    }).where(eq(timelineEvents.id, event.id)).run()
  })
}

export function removeTimelineEventFromItems(eventId: number) {
  const db = getDb()
  const items = db.select().from(storyItems).all()
  items.forEach((item) => {
    const current = new Set(parseNumberArray(item.linkedTimelineEventIdsJson))
    if (!current.has(eventId)) return
    current.delete(eventId)
    db.update(storyItems).set({
      linkedTimelineEventIdsJson: stringifyNumberArray([...current]),
      updatedAt: new Date().toISOString(),
    }).where(eq(storyItems.id, item.id)).run()
  })
}

export function removeStoryItemFromEvents(itemId: number) {
  const db = getDb()
  const events = db.select().from(timelineEvents).all()
  events.forEach((event) => {
    const current = new Set(parseNumberArray(event.linkedItemIdsJson))
    if (!current.has(itemId)) return
    current.delete(itemId)
    db.update(timelineEvents).set({
      linkedItemIdsJson: stringifyNumberArray([...current]),
      updatedAt: new Date().toISOString(),
    }).where(eq(timelineEvents.id, event.id)).run()
  })
}

export function syncChapterTimelineStatuses(novelId: number, chapterNum: number) {
  const db = getDb()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const chapterNumMap = new Map(chapterRows.map((row) => [row.id, row.chapterNum]))
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()

  eventRows.forEach((event) => {
    const startNum = event.chapterStartId ? chapterNumMap.get(event.chapterStartId) : undefined
    const endNum = event.chapterEndId ? chapterNumMap.get(event.chapterEndId) : undefined

    let nextStatus = event.status
    if (typeof endNum === 'number' && chapterNum >= endNum) {
      nextStatus = 'resolved'
    } else if (typeof startNum === 'number' && chapterNum >= startNum) {
      nextStatus = 'written'
    }

    if (nextStatus === event.status) return

    db.update(timelineEvents).set({
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    }).where(eq(timelineEvents.id, event.id)).run()
  })
}

export function listLinkedTimelineEventIds(raw?: string | null): number[] {
  return parseNumberArray(raw)
}

export function listLinkedItemIds(raw?: string | null): number[] {
  return parseNumberArray(raw)
}
