import type Database from 'better-sqlite3'

const ACTIVE_THREAD_CARD_LIMIT = 3
const STALE_FORESHADOW_LIMIT = 2

interface IdRow {
  id?: number | null
}

interface ForeshadowIdRow extends IdRow {
  linkedThreadId?: number | null
}

interface PressureCountRow {
  pressureCount?: number | null
}

export interface ChapterThreadContextProjection {
  activeThreadIds: number[]
  dueThreadIds: number[]
  foreshadowLinkedThreadIds: number[]
  dueForeshadowIds: number[]
  staleForeshadowIds: number[]
  pressureCount: number
}

interface ChapterThreadContextProjectionOptions {
  novelId: number
  chapterNum: number
  dueLimit: number
  currentArc?: {
    chapterStart?: number | null
    chapterEnd?: number | null
  } | null
}

function normalizeIds(rows: IdRow[]): number[] {
  const ids = rows.flatMap((row) => {
    const id = Number(row.id)
    return Number.isInteger(id) && id > 0 ? [id] : []
  })
  return [...new Set(ids)]
}

function normalizeLinkedThreadIds(rows: ForeshadowIdRow[]): number[] {
  const ids = rows.flatMap((row) => {
    const id = Number(row.linkedThreadId)
    return Number.isInteger(id) && id > 0 ? [id] : []
  })
  return [...new Set(ids)]
}

function buildArcPriorityExpression(alias: string, currentArc: ChapterThreadContextProjectionOptions['currentArc']) {
  if (
    typeof currentArc?.chapterStart !== 'number'
    || typeof currentArc.chapterEnd !== 'number'
  ) {
    return {
      sql: '1',
      params: [] as number[],
    }
  }

  return {
    sql: `
      CASE WHEN
        COALESCE(
          NULLIF(${alias}.start_chapter, 0),
          NULLIF(${alias}.planted_chapter, 0),
          NULLIF(${alias}.last_referenced_chapter, 0),
          0
        ) <= ?
        AND COALESCE(
          NULLIF(${alias}.target_payoff_chapter, 0),
          NULLIF(${alias}.last_referenced_chapter, 0),
          NULLIF(${alias}.planted_chapter, 0),
          NULLIF(${alias}.start_chapter, 0),
          0
        ) >= ?
        AND (
          COALESCE(
            NULLIF(${alias}.start_chapter, 0),
            NULLIF(${alias}.planted_chapter, 0),
            NULLIF(${alias}.last_referenced_chapter, 0),
            0
          ) <> 0
          OR COALESCE(
            NULLIF(${alias}.target_payoff_chapter, 0),
            NULLIF(${alias}.last_referenced_chapter, 0),
            NULLIF(${alias}.planted_chapter, 0),
            NULLIF(${alias}.start_chapter, 0),
            0
          ) <> 0
        )
      THEN 0 ELSE 1 END
    `,
    params: [currentArc.chapterEnd, currentArc.chapterStart],
  }
}

function loadActiveThreadIds(
  sqlite: Database.Database,
  options: ChapterThreadContextProjectionOptions,
): number[] {
  const arcPriority = buildArcPriorityExpression('thread', options.currentArc)
  const orderSql = `
    ORDER BY
      ${arcPriority.sql} ASC,
      CASE
        WHEN thread.target_payoff_chapter IS NOT NULL
        THEN ABS(thread.target_payoff_chapter - ?)
        ELSE 9223372036854775807
      END ASC,
      COALESCE(thread.sort_order, 0) ASC,
      thread.id ASC
  `
  const baseParams = [
    options.novelId,
    ...arcPriority.params,
    options.chapterNum,
  ]
  const orderedRows = sqlite.prepare(`
    SELECT thread.id
    FROM story_threads AS thread
    WHERE thread.novel_id = ?
      AND thread.status = 'active'
    ${orderSql}
    LIMIT ${ACTIVE_THREAD_CARD_LIMIT}
  `).all(...baseParams) as IdRow[]
  const mainRows = sqlite.prepare(`
    SELECT thread.id
    FROM story_threads AS thread
    WHERE thread.novel_id = ?
      AND thread.status = 'active'
      AND thread.thread_type = 'main'
    ${orderSql}
    LIMIT 1
  `).all(...baseParams) as IdRow[]

  return normalizeIds([...orderedRows, ...mainRows])
}

function loadPressureCount(
  sqlite: Database.Database,
  novelId: number,
  chapterNum: number,
): number {
  const row = sqlite.prepare(`
    WITH active_threads AS (
      SELECT
        thread.target_payoff_chapter AS targetPayoffChapter,
        COALESCE(
          NULLIF(thread.last_referenced_chapter, 0),
          NULLIF(thread.planted_chapter, 0),
          NULLIF(thread.start_chapter, 0),
          0
        ) AS anchorChapter,
        COALESCE(
          NULLIF(thread.last_referenced_chapter, 0),
          NULLIF(thread.planted_chapter, 0),
          NULLIF(thread.start_chapter, 0),
          ?
        ) AS baseChapter,
        CASE
          WHEN thread.reminder_interval IS NULL OR thread.reminder_interval = 0 THEN 20
          ELSE MAX(3, thread.reminder_interval)
        END AS baseInterval
      FROM story_threads AS thread
      WHERE thread.novel_id = ?
        AND thread.status = 'active'
    ),
    scored AS (
      SELECT
        *,
        CASE
          WHEN targetPayoffChapter IS NOT NULL AND targetPayoffChapter > 0
          THEN MAX(1, targetPayoffChapter - baseChapter)
          ELSE MAX(1, ? - baseChapter + 6)
        END AS threadSpan,
        CASE
          WHEN targetPayoffChapter >= ?
            AND targetPayoffChapter - ? <= 5
          THEN 1
          ELSE 0
        END AS urgent
      FROM active_threads
    ),
    pressure AS (
      SELECT
        *,
        MAX(
          3,
          MIN(baseInterval, CAST((threadSpan + 2) / 3 AS INTEGER))
        ) AS effectiveInterval
      FROM scored
    )
    SELECT COUNT(*) AS pressureCount
    FROM pressure
    WHERE urgent = 1
      OR (
        urgent = 0
        AND anchorChapter > 0
        AND ? - anchorChapter >= effectiveInterval
      )
  `).get(
    chapterNum,
    novelId,
    chapterNum,
    chapterNum,
    chapterNum,
    chapterNum,
  ) as PressureCountRow | undefined

  return Math.max(0, Number(row?.pressureCount || 0))
}

function loadDueForeshadowRows(
  sqlite: Database.Database,
  options: ChapterThreadContextProjectionOptions,
): ForeshadowIdRow[] {
  const arcPriority = buildArcPriorityExpression('thread', options.currentArc)
  return sqlite.prepare(`
    SELECT
      ledger.id,
      ledger.linked_thread_id AS linkedThreadId
    FROM foreshadow_ledger AS ledger
    LEFT JOIN story_threads AS thread
      ON thread.id = ledger.linked_thread_id
     AND thread.novel_id = ledger.novel_id
    WHERE ledger.novel_id = ?
      AND ledger.status NOT IN ('resolved', 'archived')
      AND ledger.target_payoff_chapter > 0
      AND ledger.target_payoff_chapter <= ?
    ORDER BY
      CASE WHEN ledger.target_payoff_chapter < ? THEN 0 ELSE 1 END ASC,
      ${arcPriority.sql} ASC,
      ABS(ledger.target_payoff_chapter - ?) ASC,
      CASE thread.priority
        WHEN 'high' THEN 0
        WHEN 'medium' THEN 1
        ELSE 2
      END ASC,
      ledger.id ASC
    LIMIT ?
  `).all(
    options.novelId,
    options.chapterNum + 3,
    options.chapterNum,
    ...arcPriority.params,
    options.chapterNum,
    options.dueLimit,
  ) as ForeshadowIdRow[]
}

function loadStaleForeshadowIds(
  sqlite: Database.Database,
  novelId: number,
  chapterNum: number,
): number[] {
  const rows = sqlite.prepare(`
    SELECT ledger.id
    FROM foreshadow_ledger AS ledger
    INNER JOIN chapters AS source_chapter
      ON source_chapter.id = ledger.source_chapter_id
     AND source_chapter.novel_id = ledger.novel_id
    WHERE ledger.novel_id = ?
      AND ledger.status NOT IN ('resolved', 'archived')
      AND (
        ledger.target_payoff_chapter IS NULL
        OR ledger.target_payoff_chapter <= 0
      )
      AND source_chapter.chapter_num > 0
      AND source_chapter.chapter_num <= ?
    ORDER BY
      source_chapter.chapter_num ASC,
      ledger.target_payoff_chapter ASC,
      ledger.id ASC
    LIMIT ${STALE_FORESHADOW_LIMIT}
  `).all(novelId, chapterNum - 40) as IdRow[]
  return normalizeIds(rows)
}

function loadDueThreadIds(
  sqlite: Database.Database,
  options: ChapterThreadContextProjectionOptions,
): number[] {
  const arcPriority = buildArcPriorityExpression('thread', options.currentArc)
  const rows = sqlite.prepare(`
    SELECT thread.id
    FROM story_threads AS thread
    WHERE thread.novel_id = ?
      AND (
        thread.status IS NULL
        OR thread.status NOT IN ('resolved', 'abandoned')
      )
      AND thread.target_payoff_chapter > 0
      AND thread.target_payoff_chapter <= ?
      AND NOT EXISTS (
        SELECT 1
        FROM foreshadow_ledger AS ledger
        WHERE ledger.novel_id = thread.novel_id
          AND ledger.linked_thread_id = thread.id
      )
    ORDER BY
      CASE WHEN thread.target_payoff_chapter < ? THEN 0 ELSE 1 END ASC,
      ${arcPriority.sql} ASC,
      ABS(thread.target_payoff_chapter - ?) ASC,
      CASE thread.priority
        WHEN 'high' THEN 0
        WHEN 'medium' THEN 1
        ELSE 2
      END ASC,
      COALESCE(thread.sort_order, 0) ASC,
      thread.id ASC
    LIMIT ?
  `).all(
    options.novelId,
    options.chapterNum + 3,
    options.chapterNum,
    ...arcPriority.params,
    options.chapterNum,
    options.dueLimit,
  ) as IdRow[]
  return normalizeIds(rows)
}

export function loadChapterThreadContextProjection(
  sqlite: Database.Database,
  rawOptions: ChapterThreadContextProjectionOptions,
): ChapterThreadContextProjection {
  const options = {
    ...rawOptions,
    novelId: Math.max(1, Math.floor(rawOptions.novelId)),
    chapterNum: Math.max(1, Math.floor(rawOptions.chapterNum)),
    dueLimit: Math.max(1, Math.floor(rawOptions.dueLimit)),
  }
  const activeThreadIds = loadActiveThreadIds(sqlite, options)
  const dueForeshadowRows = loadDueForeshadowRows(sqlite, options)
  const dueThreadIds = loadDueThreadIds(sqlite, options)
  const staleForeshadowIds = loadStaleForeshadowIds(sqlite, options.novelId, options.chapterNum)
  const pressureCount = loadPressureCount(sqlite, options.novelId, options.chapterNum)

  return {
    activeThreadIds,
    dueThreadIds,
    foreshadowLinkedThreadIds: normalizeLinkedThreadIds(dueForeshadowRows),
    dueForeshadowIds: normalizeIds(dueForeshadowRows),
    staleForeshadowIds,
    pressureCount,
  }
}
