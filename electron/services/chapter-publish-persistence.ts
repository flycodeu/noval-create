import { eq } from 'drizzle-orm'
import type {
  ChapterContractValidationResult,
  ChapterRewriteScope,
} from '../../src/types'
import { getDb } from '../database/db'
import { chapterGateRuns, revisionTasks } from '../database/schema'
import {
  buildChapterGateDriftSummary,
  compareChapterGateSnapshots,
  normalizeChapterGateScoreBreakdown,
  safeParseChapterGateScoreBreakdown,
  safeParseStringArray,
} from './chapter-gate-utils'
import { buildRewritePlanForItem } from './chapter-publish-rewrite-plan'
import {
  dedupeTextList,
  normalizeText,
  type ChapterContractAudit,
  type ChapterGateDriftSummary,
  type ChapterGateHistoryEntry,
  type ChapterGateLevel,
  type ChapterGateTaskDraft,
  type ChapterPublishCheckItem,
  type ChapterPublishCheckScoreBreakdown,
  type ChapterPublishRelatedPage,
  type ReviewStateSnapshot,
} from './chapter-publish-types'

function sortChapterGateHistory(left: ChapterGateHistoryEntry, right: ChapterGateHistoryEntry): number {
  const leftTime = Date.parse(left.createdAt || '')
  const rightTime = Date.parse(right.createdAt || '')
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime
  }
  return right.id - left.id
}

function mapChapterGateRunRow(row: typeof chapterGateRuns.$inferSelect): ChapterGateHistoryEntry {
  return {
    id: row.id,
    novelId: row.novelId,
    chapterId: row.chapterId,
    chapterNum: row.chapterNum || 0,
    gateLevel: (normalizeText(row.gateLevel) || 'warning') as ChapterGateLevel,
    ready: row.ready === 1,
    summary: row.summary || '',
    rewriteCount: row.rewriteCount || 0,
    blockerCount: row.blockerCount || 0,
    warningCount: row.warningCount || 0,
    generatedTaskCount: row.generatedTaskCount || 0,
    topIssueKeys: safeParseStringArray(row.topIssueKeysJson),
    scoreBreakdown: safeParseChapterGateScoreBreakdown(row.scoreBreakdownJson) || normalizeChapterGateScoreBreakdown(),
    createdAt: row.createdAt || new Date(0).toISOString(),
  }
}

export function listChapterGateHistory(
  novelId: number,
  options: { chapterId?: number; limit?: number } = {},
): ChapterGateHistoryEntry[] {
  const db = getDb()
  const rows = db.select().from(chapterGateRuns)
    .where(eq(chapterGateRuns.novelId, novelId))
    .all()
    .filter((row) => options.chapterId == null || row.chapterId === options.chapterId)
    .map(mapChapterGateRunRow)
    .sort(sortChapterGateHistory)

  return typeof options.limit === 'number' ? rows.slice(0, options.limit) : rows
}

export function persistChapterGateRun(params: {
  novelId: number
  chapterId: number
  chapterNum: number
  gateLevel: ChapterGateLevel
  ready: boolean
  summary: string
  rewriteCount: number
  blockerCount: number
  warningCount: number
  generatedTaskCount: number
  scoreBreakdown: ChapterPublishCheckScoreBreakdown
  topIssueKeys: string[]
}): { history: ChapterGateHistoryEntry[]; drift?: ChapterGateDriftSummary } {
  const db = getDb()
  const latestHistory = listChapterGateHistory(params.novelId, { chapterId: params.chapterId, limit: 6 })
  const latest = latestHistory[0]
  const snapshot: ChapterGateHistoryEntry = {
    id: 0,
    novelId: params.novelId,
    chapterId: params.chapterId,
    chapterNum: params.chapterNum,
    gateLevel: params.gateLevel,
    ready: params.ready,
    summary: params.summary,
    rewriteCount: params.rewriteCount,
    blockerCount: params.blockerCount,
    warningCount: params.warningCount,
    generatedTaskCount: params.generatedTaskCount,
    topIssueKeys: [...params.topIssueKeys],
    scoreBreakdown: normalizeChapterGateScoreBreakdown(params.scoreBreakdown),
    createdAt: new Date().toISOString(),
  }

  if (latest && compareChapterGateSnapshots(snapshot as ChapterGateHistoryEntry, latest)) {
    return {
      history: latestHistory,
      drift: latestHistory.length > 1 ? buildChapterGateDriftSummary(latestHistory[0], latestHistory[1]) : undefined,
    }
  }

  const createdAt = new Date().toISOString()
  const result = db.insert(chapterGateRuns).values({
    novelId: params.novelId,
    chapterId: params.chapterId,
    chapterNum: params.chapterNum,
    gateLevel: params.gateLevel,
    ready: params.ready ? 1 : 0,
    summary: params.summary,
    rewriteCount: params.rewriteCount,
    blockerCount: params.blockerCount,
    warningCount: params.warningCount,
    scoreBreakdownJson: JSON.stringify(normalizeChapterGateScoreBreakdown(params.scoreBreakdown)),
    topIssueKeysJson: JSON.stringify(params.topIssueKeys),
    generatedTaskCount: params.generatedTaskCount,
    createdAt,
  }).run()

  const currentEntry: ChapterGateHistoryEntry = {
    ...snapshot,
    id: Number(result.lastInsertRowid),
    createdAt,
  }
  const history = [currentEntry, ...latestHistory].sort(sortChapterGateHistory).slice(0, 6)
  return {
    history,
    drift: history.length > 1 ? buildChapterGateDriftSummary(history[0], history[1]) : undefined,
  }
}

function normalizeTaskStatus(value: unknown): 'open' | 'in_progress' | 'resolved' | 'ignored' {
  const status = normalizeText(typeof value === 'string' ? value : '')
  if (status === 'in_progress' || status === 'resolved' || status === 'ignored') return status
  return 'open'
}

function parseOriginMetaJson(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function serializeOriginMetaJson(meta: Record<string, unknown>): string {
  return JSON.stringify(meta)
}

export function syncChapterGateRevisionTasks(
  novelId: number,
  chapterId: number,
  chapterNum: number,
  checklist: ChapterPublishCheckItem[],
  contractAudit: ChapterContractAudit,
  reviewState: ReviewStateSnapshot,
  contractValidation?: ChapterContractValidationResult | null,
): { taskIdByItemKey: Map<string, number>; generatedTaskCount: number } {
  const db = getDb()
  const now = new Date().toISOString()
  const chapterLabel = `第 ${chapterNum} 章`
  const drafts: ChapterGateTaskDraft[] = [
    ...checklist
      .filter((item) => item.status === 'blocker' || item.status === 'rewrite')
      .map((item) => ({
        issueKey: `chapter_gate:${chapterId}:check:${item.key}`,
        severity: item.status === 'rewrite' ? 'high' as const : 'medium' as const,
        title: `[章节验收门][${item.status === 'rewrite' ? '退回重写' : '阻塞'}] ${item.label}`,
        description: item.detail,
        fixBrief: item.fixHint || item.detail,
        relatedPage: (item.relatedPage || (item.segmentId ? 'structure' : 'writing')) as ChapterPublishRelatedPage,
        chapterId,
        itemKey: item.key,
        originMeta: {
          issueCategory: 'chapter_gate',
          autoFixable: buildRewritePlanForItem({
            item,
            checklist,
            reviewState,
            contractValidation,
          })?.scope !== 'contract_replan' ? undefined : false,
          gateLevel: item.status,
          checkKey: item.key,
          source: item.source,
          segmentId: item.segmentId ?? null,
          segmentTitle: item.segmentTitle || '',
          rewriteTarget: item.status === 'rewrite'
            ? (item.segmentId ? 'segment' : item.relatedPage === 'writing' ? 'selection' : 'chapter')
            : '',
          entityLabel: chapterLabel,
          suggestion: item.fixHint || item.detail,
          rewritePlan: buildRewritePlanForItem({
            item,
            checklist,
            reviewState,
            contractValidation,
          }),
        },
      })),
    ...contractAudit.items
      .filter((item) => item.status === 'blocker')
      .map((item) => ({
        issueKey: `chapter_gate:${chapterId}:contract:${item.key}`,
        severity: 'medium' as const,
        title: `[章节验收门][合同阻塞] ${item.label}`,
        description: item.detail,
        fixBrief: item.detail,
        relatedPage: (item.source === 'scene' ? 'structure' : 'contracts') as ChapterPublishRelatedPage,
        chapterId,
        itemKey: `contract:${item.key}`,
        originMeta: {
          issueCategory: 'chapter_gate',
          autoFixable: false,
          gateLevel: 'blocker',
          checkKey: item.key,
          source: item.source,
          segmentId: item.segmentId ?? null,
          segmentTitle: item.segmentTitle || '',
          entityLabel: chapterLabel,
          suggestion: item.detail,
          rewritePlan: {
            scope: 'contract_replan' as ChapterRewriteScope,
            targetSegmentId: item.segmentId ?? undefined,
            targetExcerpt: item.segmentTitle ? `${item.segmentTitle}：${item.detail}` : item.detail,
            goals: dedupeTextList([
              item.detail,
              '先回到章节合同/场景合同修正冲突，再决定正文如何改写。',
            ]),
            preserve: ['正文锁定段落和已成立事件先不动，优先修合同定义。'],
            recheckItems: ['contract_delivery'],
          },
        },
      })),
  ]

  const existingRows = db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .all()
    .filter((row) => normalizeText(row.taskSource) === 'system')
    .filter((row) => normalizeText(row.issueKey).startsWith(`chapter_gate:${chapterId}:`))
  const existingByKey = new Map(existingRows.map((row) => [normalizeText(row.issueKey), row] as const))
  const activeKeys = new Set<string>()
  const taskIdByItemKey = new Map<string, number>()

  drafts.forEach((draft) => {
    activeKeys.add(draft.issueKey)
    const existing = existingByKey.get(draft.issueKey)
    if (!existing) {
      const result = db.insert(revisionTasks).values({
        novelId,
        taskSource: 'system',
        issueKey: draft.issueKey,
        taskType: draft.relatedPage === 'structure' ? 'outline' : 'continuity',
        status: 'open',
        severity: draft.severity,
        title: draft.title,
        description: draft.description,
        fixBrief: draft.fixBrief,
        relatedPage: draft.relatedPage,
        entityType: 'chapter',
        entityId: chapterId,
        chapterId,
        originMetaJson: serializeOriginMetaJson(draft.originMeta),
        lastDetectedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
      taskIdByItemKey.set(draft.itemKey, Number(result.lastInsertRowid))
      return
    }

    const previousStatus = normalizeTaskStatus(existing.status)
    const nextStatus = previousStatus === 'ignored'
      ? 'ignored'
      : previousStatus === 'resolved'
        ? 'open'
        : previousStatus
    db.update(revisionTasks).set({
      taskType: draft.relatedPage === 'structure' ? 'outline' : 'continuity',
      status: nextStatus,
      severity: draft.severity,
      title: draft.title,
      description: draft.description,
      fixBrief: draft.fixBrief,
      relatedPage: draft.relatedPage,
      entityType: 'chapter',
      entityId: chapterId,
      chapterId,
      originMetaJson: serializeOriginMetaJson({
        ...parseOriginMetaJson(existing.originMetaJson),
        ...draft.originMeta,
      }),
      lastDetectedAt: now,
      resolvedAt: null,
      updatedAt: now,
    }).where(eq(revisionTasks.id, existing.id)).run()
    taskIdByItemKey.set(draft.itemKey, existing.id)
  })

  existingRows
    .filter((row) => {
      const issueKey = normalizeText(row.issueKey)
      return issueKey && !activeKeys.has(issueKey)
    })
    .forEach((row) => {
      const previousStatus = normalizeTaskStatus(row.status)
      if (previousStatus === 'ignored' || previousStatus === 'resolved') return
      db.update(revisionTasks).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(revisionTasks.id, row.id)).run()
    })

  return {
    taskIdByItemKey,
    generatedTaskCount: drafts.length,
  }
}
