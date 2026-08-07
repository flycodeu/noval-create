import { asc, eq } from 'drizzle-orm'
import type { SummaryHealthReport } from '../../src/types'
import { getDb } from '../database/db'
import { chapters, characters, foreshadowLedger, storyThreads } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { runChatTask } from './task.service'

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveRecentWindow(targetWords: number, chapterCount: number): number {
  if (targetWords >= 1500000 || chapterCount >= 600) return 40
  if (targetWords >= 1000000 || chapterCount >= 400) return 35
  if (targetWords >= 800000 || chapterCount >= 280) return 28
  if (targetWords >= 500000 || chapterCount >= 180) return 22
  if (targetWords >= 350000 || chapterCount >= 80) return 15
  if (targetWords >= 150000 || chapterCount >= 40) return 10
  return 8
}

function extractFocusEntities(content: string, characterNames: string[]): string[] {
  const seen = new Set<string>()
  characterNames.forEach((name) => {
    const normalized = asText(name)
    if (!normalized) return
    if (content.includes(normalized)) seen.add(normalized)
  })
  return [...seen].slice(0, 6)
}

function scoreDensity(summary: string): number {
  if (!summary) return 0
  const lengthScore = Math.min(summary.length, 140) / 140 * 50
  const punctuationScore = Math.min((summary.match(/[，。；：]/g) || []).length, 4) / 4 * 20
  const actionScore = /(发现|进入|追|救|杀|夺|逃|问|拿|藏|交|逼|查|赶|断|失去|受伤|暴露|决定|赶到|回到)/u.test(summary) ? 30 : 10
  return Math.round(lengthScore + punctuationScore + actionScore)
}

function scoreEntityCoverage(summary: string, focusEntities: string[]): number {
  if (focusEntities.length === 0) return 100
  const covered = focusEntities.filter((name) => summary.includes(name)).length
  return Math.round((covered / focusEntities.length) * 100)
}

function scoreEventCoverage(summary: string): number {
  if (!summary) return 0
  const actionHits = (summary.match(/发现|进入|追|救|杀|夺|逃|问|拿|藏|交|逼|查|赶|断|失去|受伤|暴露|决定|赶到|回到/gu) || []).length
  const sequenceHits = (summary.match(/随后|接着|之后|最终|同时|先|再/gu) || []).length
  return Math.max(20, Math.min(100, actionHits * 18 + sequenceHits * 10))
}

function buildDeterministicSummary(content: string, focusEntities: string[]): string {
  const clauses = content
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
  const chosen = clauses
    .filter((clause) => focusEntities.length === 0 || focusEntities.some((name) => clause.includes(name)))
    .slice(0, 2)
  const fallback = clauses.slice(0, 2)
  const summary = (chosen.length > 0 ? chosen : fallback).join('；')
  return summary.length > 140 ? `${summary.slice(0, 139).trim()}…` : summary
}

function buildSemanticRecompressionPrompt(input: {
  content: string
  currentSummary: string
  focusEntities: string[]
  activeThreads: string[]
  activeForeshadows: string[]
}): string {
  return [
    '你是长篇小说连续性编辑。请把当前章节重新压缩成语义摘要，避免只截取正文前几句。',
    '只输出 JSON：{"chapterFacts":"","characterStates":"","threadForeshadow":""}',
    '',
    '要求：',
    '- chapterFacts：80-160字，写清本章发生了什么、因果和后果。',
    '- characterStates：40-120字，写关键人物状态、动机、关系或资源变化。',
    '- threadForeshadow：40-120字，写本章推进/搁置/回收的线程、伏笔和后续承接。',
    '- 不新增正文没有的信息，不写修订建议，不解释你如何分析。',
    input.focusEntities.length > 0 ? `重点实体：${input.focusEntities.join('、')}` : '',
    input.activeThreads.length > 0 ? `活跃线程：${input.activeThreads.slice(0, 8).join('；')}` : '',
    input.activeForeshadows.length > 0 ? `伏笔账本：${input.activeForeshadows.slice(0, 8).join('；')}` : '',
    input.currentSummary ? `当前摘要：${input.currentSummary}` : '',
    '',
    '【章节正文】',
    input.content.slice(0, 12000),
  ].filter(Boolean).join('\n')
}

function normalizeSemanticSummary(raw: unknown): NonNullable<SummaryHealthReport['semanticSummary']> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const chapterFacts = asText(record.chapterFacts ?? record.chapter_facts)
  const characterStates = asText(record.characterStates ?? record.character_states)
  const threadForeshadow = asText(record.threadForeshadow ?? record.thread_foreshadow)
  if (!chapterFacts && !characterStates && !threadForeshadow) return null
  return {
    chapterFacts,
    characterStates,
    threadForeshadow,
  }
}

function formatSemanticSummary(summary: NonNullable<SummaryHealthReport['semanticSummary']>): string {
  return [
    summary.chapterFacts ? `章节事实：${summary.chapterFacts}` : '',
    summary.characterStates ? `人物状态：${summary.characterStates}` : '',
    summary.threadForeshadow ? `伏笔线程：${summary.threadForeshadow}` : '',
  ].filter(Boolean).join('\n')
}

function loadSemanticRecompressionContext(novelId: number, chapterNum: number) {
  const db = getDb()
  const activeThreads = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
    .filter((row) => row.status !== 'resolved' && row.status !== 'archived')
    .map((row) => [row.title, row.currentState || row.summary || row.payoffCondition].filter(Boolean).join('：'))
    .filter(Boolean)
  const activeForeshadows = db.select().from(foreshadowLedger)
    .where(eq(foreshadowLedger.novelId, novelId))
    .all()
    .filter((row) => row.status !== 'resolved' && row.status !== 'cancelled')
    .filter((row) => typeof row.targetPayoffChapter !== 'number' || row.targetPayoffChapter <= chapterNum + 20)
    .map((row) => [row.title, row.detail || row.payoffMethod || row.allowedDelayReason].filter(Boolean).join('：'))
    .filter(Boolean)
  return { activeThreads, activeForeshadows }
}

export function analyzeSummaryHealthForChapter(chapterId: number): SummaryHealthReport | null {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return null
  const novelChapters = db.select().from(chapters)
    .where(eq(chapters.novelId, chapter.novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const recentWindowSize = resolveRecentWindow(0, novelChapters.length)
  const recentRows = novelChapters
    .filter((row) => row.chapterNum <= chapter.chapterNum)
    .slice(-recentWindowSize)
  const characterNames = db.select({ fullName: characters.fullName })
    .from(characters)
    .where(eq(characters.novelId, chapter.novelId))
    .all()
    .map((row) => asText(row.fullName))
    .filter(Boolean)
  const focusEntities = extractFocusEntities(asText(chapter.content), characterNames)
  const summaryPreview = asText(chapter.summary)
  const densityScore = scoreDensity(summaryPreview)
  const entityCoverageScore = scoreEntityCoverage(summaryPreview, focusEntities)
  const eventCoverageScore = scoreEventCoverage(summaryPreview)
  const averageRecentSummaryLength = recentRows.length > 0
    ? recentRows.reduce((sum, row) => sum + asText(row.summary).length, 0) / recentRows.length
    : 0
  const warnings = [
    densityScore < 45 ? '当前摘要过短或动作信息不足。' : '',
    entityCoverageScore < 45 ? '当前摘要对关键人物/实体覆盖不足。' : '',
    eventCoverageScore < 45 ? '当前摘要没有把事件链和后果写清。' : '',
    averageRecentSummaryLength < 48 && recentRows.length >= 5 ? '近章摘要整体偏薄，长篇记忆正在衰减。' : '',
  ].filter(Boolean)
  const degraded = densityScore < 45 || entityCoverageScore < 45 || eventCoverageScore < 45
  return {
    status: degraded ? 'degraded' : warnings.length > 0 ? 'warning' : 'healthy',
    densityScore,
    entityCoverageScore,
    eventCoverageScore,
    recentWindowSize,
    warnings,
    triggeredRecompression: false,
    recompressionReason: degraded ? warnings[0] || '摘要信息密度过低' : '',
    focusEntities,
    summaryPreview,
    updatedAt: new Date().toISOString(),
  }
}

export function refreshSummaryHealth(chapterId: number): SummaryHealthReport | null {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return null
  let report = analyzeSummaryHealthForChapter(chapterId)
  if (!report) return null

  if (report.status === 'degraded' && asText(chapter.content)) {
    const recompressed = buildDeterministicSummary(asText(chapter.content), report.focusEntities)
    if (recompressed && recompressed !== asText(chapter.summary)) {
      db.update(chapters).set({
        summary: recompressed,
        updatedAt: new Date().toISOString(),
      }).where(eq(chapters.id, chapterId)).run()
      report = {
        ...report,
        triggeredRecompression: true,
        recompressionMode: 'deterministic',
        recompressionReason: report.recompressionReason || '摘要密度不足，已按正文重压缩',
        summaryPreview: recompressed,
        densityScore: scoreDensity(recompressed),
        entityCoverageScore: scoreEntityCoverage(recompressed, report.focusEntities),
        eventCoverageScore: scoreEventCoverage(recompressed),
        status: 'warning',
        updatedAt: new Date().toISOString(),
      }
    }
  }

  db.update(chapters).set({
    summaryHealthJson: JSON.stringify(report),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()
  return report
}

export async function refreshSummaryHealthSemantic(chapterId: number): Promise<SummaryHealthReport | null> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return null
  const baseReport = analyzeSummaryHealthForChapter(chapterId)
  if (!baseReport) return null
  if (baseReport.status !== 'degraded' || !asText(chapter.content)) {
    db.update(chapters).set({
      summaryHealthJson: JSON.stringify(baseReport),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
    return baseReport
  }

  try {
    const context = loadSemanticRecompressionContext(chapter.novelId, chapter.chapterNum)
    const raw = await runChatTask({
      type: 'summary',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      retryable: true,
      messages: [{
        role: 'user',
        content: buildSemanticRecompressionPrompt({
          content: asText(chapter.content),
          currentSummary: asText(chapter.summary),
          focusEntities: baseReport.focusEntities,
          activeThreads: context.activeThreads,
          activeForeshadows: context.activeForeshadows,
        }),
      }],
    })
    const semanticSummary = normalizeSemanticSummary(safeParseJson(raw))
    if (!semanticSummary) {
      return refreshSummaryHealth(chapterId)
    }
    const summaryText = formatSemanticSummary(semanticSummary)
    const report: SummaryHealthReport = {
      ...baseReport,
      status: 'warning',
      triggeredRecompression: true,
      recompressionMode: 'semantic',
      recompressionReason: baseReport.recompressionReason || '摘要密度不足，已按语义三段式重压缩',
      semanticSummary,
      summaryPreview: summaryText,
      densityScore: scoreDensity(summaryText),
      entityCoverageScore: scoreEntityCoverage(summaryText, baseReport.focusEntities),
      eventCoverageScore: scoreEventCoverage(summaryText),
      updatedAt: new Date().toISOString(),
    }
    db.update(chapters).set({
      summary: summaryText,
      summaryHealthJson: JSON.stringify(report),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
    return report
  } catch {
    return refreshSummaryHealth(chapterId)
  }
}
