import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, novels } from '../database/schema'

export type NovelLifecycleStatus = 'draft' | 'writing' | 'completed' | 'archived'
export type NovelLifecycleMode = 'automatic' | 'manual'

export interface NovelLifecycleChapterSnapshot {
  status?: string | null
  wordCount?: number | null
}

export interface NovelLifecycleSnapshot {
  status: NovelLifecycleStatus
  label: string
  automatic: boolean
  reason: string
}

export function getNovelLifecycleLabel(status: NovelLifecycleStatus | string): string {
  if (status === 'writing') return '写作中'
  if (status === 'completed') return '已完成'
  if (status === 'archived') return '已归档'
  return '草稿'
}

export function describeNovelLifecycle(
  currentStatus: string | null | undefined,
  chapterRows: NovelLifecycleChapterSnapshot[],
  lifecycleMode: NovelLifecycleMode | string | null | undefined = 'automatic',
): NovelLifecycleSnapshot {
  if (lifecycleMode === 'manual' && isNovelLifecycleStatus(currentStatus)) {
    return {
      status: currentStatus,
      label: getNovelLifecycleLabel(currentStatus),
      automatic: false,
      reason: currentStatus === 'archived' ? '归档是作者明确设置的项目状态。' : '作者手动设置了项目状态。',
    }
  }

  const status = deriveNovelLifecycleStatus(currentStatus, chapterRows)
  if (status === 'archived') {
    return { status, label: getNovelLifecycleLabel(status), automatic: false, reason: '归档是作者明确设置的项目状态。' }
  }
  if (status === 'completed') {
    return { status, label: getNovelLifecycleLabel(status), automatic: true, reason: '所有章节均已定稿。' }
  }
  if (status === 'writing') {
    return { status, label: getNovelLifecycleLabel(status), automatic: true, reason: '已有章节进入正文生产或包含正文内容。' }
  }
  return { status, label: getNovelLifecycleLabel(status), automatic: true, reason: '尚未检测到正文生产内容。' }
}

function isNovelLifecycleStatus(value: string | null | undefined): value is NovelLifecycleStatus {
  return value === 'draft' || value === 'writing' || value === 'completed' || value === 'archived'
}

/**
 * Derive the project-level lifecycle from the durable chapter state.
 * Archived is an explicit user decision and is therefore never overwritten by
 * an automatic chapter transition.
 */
export function deriveNovelLifecycleStatus(
  currentStatus: string | null | undefined,
  chapterRows: NovelLifecycleChapterSnapshot[],
): NovelLifecycleStatus {
  if (currentStatus === 'archived') return 'archived'

  // Keep legacy/internal status values such as `serializing` stable in the
  // database. They are still rendered as an active writing lifecycle, but
  // must not be rewritten because other governance services use the original
  // value to distinguish work-state policy.
  if (currentStatus && !isNovelLifecycleStatus(currentStatus)) return 'writing'

  if (chapterRows.length > 0 && chapterRows.every((chapter) => chapter.status === 'final')) {
    return 'completed'
  }

  const hasProductionChapter = chapterRows.some((chapter) => (
    Number(chapter.wordCount || 0) > 0
    || chapter.status === 'writing'
    || chapter.status === 'draft'
    || chapter.status === 'reviewing'
    || chapter.status === 'final'
  ))

  return hasProductionChapter ? 'writing' : 'draft'
}

export function syncNovelLifecycleStatus(novelId: number): {
  previousStatus: NovelLifecycleStatus | string
  status: NovelLifecycleStatus
  changed: boolean
} | null {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) return null

  const chapterRows = db.select({ status: chapters.status, wordCount: chapters.wordCount })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
  if (novel.status && !isNovelLifecycleStatus(novel.status)) {
    return {
      previousStatus: novel.status,
      status: 'writing',
      changed: false,
    }
  }

  if (novel.lifecycleMode === 'manual') {
    return {
      previousStatus: novel.status || 'draft',
      status: isNovelLifecycleStatus(novel.status) ? novel.status : 'draft',
      changed: false,
    }
  }

  const status = describeNovelLifecycle(novel.status, chapterRows, novel.lifecycleMode).status
  const changed = status !== novel.status

  if (changed) {
    db.update(novels).set({
      status,
      updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, novelId)).run()
  }

  return {
    previousStatus: novel.status || 'draft',
    status,
    changed,
  }
}

export function syncNovelLifecycleStatuses(): number {
  const db = getDb()
  const novelIds = db.select({ id: novels.id }).from(novels).all().map((row) => row.id)
  return novelIds.reduce((changed, novelId) => changed + (syncNovelLifecycleStatus(novelId)?.changed ? 1 : 0), 0)
}
