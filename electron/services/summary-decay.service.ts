import { asc, eq } from 'drizzle-orm'
import type { SummaryHealthReport } from '../../src/types'
import { getDb } from '../database/db'
import { chapters, characters } from '../database/schema'

type ChapterRow = typeof chapters.$inferSelect

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
