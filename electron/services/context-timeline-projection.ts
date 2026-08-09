import type Database from 'better-sqlite3'

const MAX_TIMELINE_CONTEXT_EVENTS = 6

interface TimelineContextCandidateRow {
  id?: number | null
  timeSortValue?: number | null
  sortOrder?: number | null
}

interface TimelineContextCandidate {
  id: number
  timeSortValue: number
  sortOrder: number
}

function normalizeCandidates(rows: TimelineContextCandidateRow[]): TimelineContextCandidate[] {
  return rows.flatMap((row) => {
    const id = Number(row.id)
    if (!Number.isInteger(id) || id <= 0) return []
    return [{
      id,
      timeSortValue: Number(row.timeSortValue || 0),
      sortOrder: Number(row.sortOrder || 0),
    }]
  })
}

export function loadTimelineContextEventIds(
  sqlite: Database.Database,
  novelId: number,
  chapterNum: number,
  currentArcId?: number | null,
): number[] {
  const pastRows = sqlite.prepare(`
    SELECT
      event.id,
      COALESCE(event.time_sort_value, 0) AS timeSortValue,
      COALESCE(event.sort_order, 0) AS sortOrder
    FROM timeline_events AS event
    LEFT JOIN chapters AS start_chapter
      ON start_chapter.id = event.chapter_start_id
     AND start_chapter.novel_id = event.novel_id
    LEFT JOIN chapters AS end_chapter
      ON end_chapter.id = event.chapter_end_id
     AND end_chapter.novel_id = event.novel_id
    WHERE event.novel_id = ?
      AND (
        (end_chapter.chapter_num IS NOT NULL AND end_chapter.chapter_num < ?)
        OR (
          end_chapter.chapter_num IS NULL
          AND start_chapter.chapter_num IS NOT NULL
          AND start_chapter.chapter_num < ?
        )
        OR (
          end_chapter.chapter_num IS NULL
          AND start_chapter.chapter_num IS NULL
          AND event.status IN ('written', 'resolved')
        )
      )
    ORDER BY timeSortValue DESC, sortOrder DESC, event.id DESC
    LIMIT 4
  `).all(novelId, chapterNum, chapterNum) as TimelineContextCandidateRow[]

  const arcRows = typeof currentArcId === 'number'
    ? sqlite.prepare(`
        SELECT
          event.id,
          COALESCE(event.time_sort_value, 0) AS timeSortValue,
          COALESCE(event.sort_order, 0) AS sortOrder
        FROM timeline_events AS event
        WHERE event.novel_id = ?
          AND event.arc_id = ?
        ORDER BY timeSortValue DESC, sortOrder DESC, event.id DESC
        LIMIT 3
      `).all(novelId, currentArcId) as TimelineContextCandidateRow[]
    : []

  const futureRows = sqlite.prepare(`
    SELECT
      event.id,
      COALESCE(event.time_sort_value, 0) AS timeSortValue,
      COALESCE(event.sort_order, 0) AS sortOrder
    FROM timeline_events AS event
    LEFT JOIN chapters AS start_chapter
      ON start_chapter.id = event.chapter_start_id
     AND start_chapter.novel_id = event.novel_id
    LEFT JOIN chapters AS end_chapter
      ON end_chapter.id = event.chapter_end_id
     AND end_chapter.novel_id = event.novel_id
    WHERE event.novel_id = ?
      AND (
        (
          start_chapter.chapter_num IS NOT NULL
          AND start_chapter.chapter_num BETWEEN ? AND ?
        )
        OR (
          start_chapter.chapter_num IS NULL
          AND end_chapter.chapter_num IS NULL
          AND event.status IN ('planned', 'seeded')
        )
      )
    ORDER BY timeSortValue ASC, sortOrder ASC, event.id ASC
    LIMIT 3
  `).all(novelId, chapterNum, chapterNum + 3) as TimelineContextCandidateRow[]

  const candidateById = new Map<number, TimelineContextCandidate>()
  normalizeCandidates([...pastRows, ...arcRows, ...futureRows]).forEach((candidate) => {
    candidateById.set(candidate.id, candidate)
  })

  return [...candidateById.values()]
    .sort((left, right) =>
      left.timeSortValue - right.timeSortValue
      || left.sortOrder - right.sortOrder
      || left.id - right.id)
    .slice(-MAX_TIMELINE_CONTEXT_EVENTS)
    .map((candidate) => candidate.id)
}
