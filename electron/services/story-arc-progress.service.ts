import { asc, eq } from 'drizzle-orm'
import type {
  StoryArcProgressAlert,
  StoryArcProgressPoint,
  StoryArcProgressSnapshot,
  StoryArcProgressSummary,
  StoryArcPhaseTarget,
  VolumeArcProgressEntry,
} from '../../src/types'
import { getDb } from '../database/db'
import { chapters, storyArcs, storyVolumes } from '../database/schema'

const ARC_PROGRESS_STALL_PATTERNS = [
  /未推进/,
  /没有推进/,
  /无实质推进/,
  /推进不足/,
  /尚未推进/,
  /尚未触及/,
  /仍在铺垫/,
  /空转/,
  /停滞/,
  /原地/,
  /受阻/,
  /搁置/,
  /偏离/,
  /反向/,
  /倒退/,
]

type ArcRow = typeof storyArcs.$inferSelect
type ChapterRow = typeof chapters.$inferSelect

interface ParsedContinuityState {
  arcProgress: string
}

interface ParsedReviewNotes {
  arcProgressRisks: string[]
}

const DEFAULT_PHASES: Array<Pick<StoryArcPhaseTarget, 'key' | 'label' | 'targetRatio'>> = [
  { key: 'phase_25', label: '25%', targetRatio: 0.25 },
  { key: 'phase_50', label: '50%', targetRatio: 0.5 },
  { key: 'phase_75', label: '75%', targetRatio: 0.75 },
  { key: 'phase_closure', label: '收束', targetRatio: 1 },
]

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function dedupeTextList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function parseContinuityState(raw?: string | null): ParsedContinuityState | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      arcProgress: asString(parsed.arc_progress),
    }
  } catch {
    return null
  }
}

function parseReviewNotes(raw?: string | null): ParsedReviewNotes {
  if (!raw?.trim()) {
    return { arcProgressRisks: [] }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      arcProgressRisks: toStringArray(parsed.arc_progress_risks),
    }
  } catch {
    return { arcProgressRisks: [] }
  }
}

function extractArcProgressPercentHint(text: string): number {
  const match = text.match(/(\d{1,3})\s*%/)
  if (!match) return 0
  return roundPercent(Number(match[1]))
}

function indicatesArcProgress(text: string): boolean {
  const normalized = text.trim()
  return Boolean(normalized) && !ARC_PROGRESS_STALL_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isValidArcRange(arc: ArcRow): arc is ArcRow & { chapterStart: number; chapterEnd: number } {
  return typeof arc.chapterStart === 'number'
    && typeof arc.chapterEnd === 'number'
    && arc.chapterEnd >= arc.chapterStart
}

function getArcChapterRangeMetrics(
  arc: ArcRow,
  chapterNum: number,
): { total: number; index: number; percent: number } | null {
  if (!isValidArcRange(arc)) return null

  const total = Math.max(arc.chapterEnd - arc.chapterStart + 1, 1)
  const index = Math.max(1, Math.min(total, chapterNum - arc.chapterStart + 1))
  return {
    total,
    index,
    percent: roundPercent((index / total) * 100),
  }
}

function isChapterCoveredByArc(arc: ArcRow, chapter: ChapterRow): boolean {
  if (chapter.arcId === arc.id) return true
  if (!isValidArcRange(arc)) return false
  return chapter.chapterNum >= arc.chapterStart && chapter.chapterNum <= arc.chapterEnd
}

function parseManualPhaseTargets(raw?: string | null): StoryArcPhaseTarget[] {
  if (!raw?.trim()) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const targets: Array<StoryArcPhaseTarget | null> = parsed
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => {
        const record = item as Record<string, unknown>
        const label = asString(record.label)
        const key = asString(record.key) || label
        const defaultPhase = DEFAULT_PHASES.find((phase) => phase.key === key || phase.label === label)
        const targetRatio = typeof record.targetRatio === 'number'
          ? Math.max(0, Math.min(1, record.targetRatio))
          : defaultPhase?.targetRatio ?? 0
        const targetChapterNum = typeof record.targetChapterNum === 'number'
          ? Math.max(1, Math.round(record.targetChapterNum))
          : undefined
        const expectedBeat = asString(record.expectedBeat)
        if (!key && !label && typeof targetChapterNum !== 'number' && !expectedBeat) return null
        return {
          key: key || defaultPhase?.key || label || `phase_${Math.round(targetRatio * 100)}`,
          label: label || defaultPhase?.label || key || '阶段目标',
          targetRatio,
          targetChapterNum,
          expectedBeat,
          source: 'manual' as const,
        }
      })
    return targets.filter((item): item is StoryArcPhaseTarget => item !== null)
  } catch {
    return []
  }
}

function buildDerivedPhaseTargets(arc: ArcRow): StoryArcPhaseTarget[] {
  if (!isValidArcRange(arc)) return []

  const total = Math.max(arc.chapterEnd - arc.chapterStart + 1, 1)
  return DEFAULT_PHASES.map((phase) => ({
    ...phase,
    targetChapterNum: phase.key === 'phase_closure'
      ? arc.chapterEnd
      : arc.chapterStart + Math.round((total - 1) * phase.targetRatio),
    source: 'derived' as const,
  }))
}

function mergePhaseTargets(arc: ArcRow): StoryArcPhaseTarget[] {
  const derived = buildDerivedPhaseTargets(arc)
  const manualByKey = new Map(parseManualPhaseTargets(arc.phaseTargetsJson).map((target) => [target.key, target] as const))
  const merged = derived.map((target) => {
    const manual = manualByKey.get(target.key)
    return manual
      ? {
          ...target,
          ...manual,
          targetChapterNum: typeof manual.targetChapterNum === 'number' ? manual.targetChapterNum : target.targetChapterNum,
          expectedBeat: manual.expectedBeat || target.expectedBeat,
          source: manual.targetChapterNum || manual.expectedBeat ? 'manual' : target.source,
        }
      : target
  })

  for (const manual of manualByKey.values()) {
    if (!merged.some((target) => target.key === manual.key)) {
      merged.push(manual)
    }
  }

  return merged.sort((left, right) => {
    const leftChapter = typeof left.targetChapterNum === 'number' ? left.targetChapterNum : Number.MAX_SAFE_INTEGER
    const rightChapter = typeof right.targetChapterNum === 'number' ? right.targetChapterNum : Number.MAX_SAFE_INTEGER
    return leftChapter - rightChapter || left.targetRatio - right.targetRatio || left.label.localeCompare(right.label)
  })
}

function buildPhaseMissAlert(arc: ArcRow, phase: StoryArcPhaseTarget): StoryArcProgressAlert {
  return {
    code: 'phase_missed',
    severity: phase.key === 'phase_closure' ? 'critical' : 'warning',
    arcId: arc.id,
    arcName: arc.arcName,
    chapterNum: phase.targetChapterNum,
    title: `${phase.label} 阶段未兑现`,
    detail: `故事弧“${arc.arcName}”在 ${phase.label} 目标附近没有明确推进。${phase.expectedBeat ? `预期：${phase.expectedBeat}` : '需要补上实质变化、回报或冲突升级。'}`,
  }
}

function buildStalledRunAlert(arc: ArcRow, stalledChapterCount: number, chapterNum?: number): StoryArcProgressAlert | null {
  if (stalledChapterCount < 5) return null
  return {
    code: 'stalled_run',
    severity: stalledChapterCount >= 8 ? 'critical' : 'warning',
    arcId: arc.id,
    arcName: arc.arcName,
    chapterNum,
    title: '连续空转章节过长',
    detail: `故事弧“${arc.arcName}”已连续 ${stalledChapterCount} 章没有明确推进，需要让当前章节兑现阶段目标或调整弧设计。`,
  }
}

function buildStatusSummary(
  progressChapterCount: number,
  coveredChapterCount: number,
  stalledChapterCount: number,
  hitPhaseCount: number,
  phaseTargetCount: number,
): string {
  return `推进章 ${progressChapterCount}/${coveredChapterCount || 0} · 连续空转 ${stalledChapterCount} · 阶段命中 ${hitPhaseCount}/${phaseTargetCount}`
}

export function getStoryArcProgressSnapshot(novelId: number): StoryArcProgressSnapshot {
  const db = getDb()
  const arcRows = db.select().from(storyArcs)
    .where(eq(storyArcs.novelId, novelId))
    .orderBy(asc(storyArcs.arcOrder), asc(storyArcs.id))
    .all()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()
  const volumeRows = db.select({
    id: storyVolumes.id,
    volumeNumber: storyVolumes.volumeNumber,
    title: storyVolumes.title,
  }).from(storyVolumes)
    .where(eq(storyVolumes.novelId, novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()
  const allPoints: StoryArcProgressPoint[] = []
  const allAlerts: StoryArcProgressAlert[] = []
  const arcSummaries: StoryArcProgressSummary[] = []

  for (const arc of arcRows) {
    const coveredChapters = chapterRows.filter((chapter) => isChapterCoveredByArc(arc, chapter))
    const phaseTargets = mergePhaseTargets(arc)
    let progressChapterCount = 0
    let hintedPercent = 0
    let lastProgressChapterNum: number | undefined
    let trailingStalledChapterCount = 0
    let currentStalledRun = 0
    let longestStalledRun = 0

    const localPoints: StoryArcProgressPoint[] = []

    for (const chapter of coveredChapters) {
      const continuity = parseContinuityState(chapter.continuityStateJson)
      const reviewNotes = parseReviewNotes(chapter.reviewNotesJson)
      const arcProgressText = continuity?.arcProgress || ''
      hintedPercent = Math.max(hintedPercent, extractArcProgressPercentHint(arcProgressText))
      const progressHit = reviewNotes.arcProgressRisks.length === 0 && indicatesArcProgress(arcProgressText)

      if (progressHit) {
        progressChapterCount += 1
        lastProgressChapterNum = chapter.chapterNum
        currentStalledRun = 0
      } else {
        currentStalledRun += 1
        longestStalledRun = Math.max(longestStalledRun, currentStalledRun)
      }

      const metrics = typeof lastProgressChapterNum === 'number'
        ? getArcChapterRangeMetrics(arc, lastProgressChapterNum)
        : null
      const fallbackPercent = coveredChapters.length > 0
        ? roundPercent((progressChapterCount / coveredChapters.length) * 100)
        : 0

      localPoints.push({
        arcId: arc.id,
        arcName: arc.arcName,
        chapterId: chapter.id,
        chapterNum: chapter.chapterNum,
        title: chapter.title || `第 ${chapter.chapterNum} 章`,
        volumeId: typeof chapter.volumeId === 'number' ? chapter.volumeId : undefined,
        progressPercent: Math.max(hintedPercent, metrics?.percent || fallbackPercent),
        progressHit,
        stalled: !progressHit,
        arcProgressText: arcProgressText || undefined,
        reviewRisks: reviewNotes.arcProgressRisks,
        checkpointPhaseLabels: phaseTargets
          .filter((phase) => typeof phase.targetChapterNum === 'number' && Math.abs(phase.targetChapterNum - chapter.chapterNum) <= 1)
          .map((phase) => phase.label),
        hitPhaseLabels: phaseTargets
          .filter((phase) => typeof phase.targetChapterNum === 'number' && progressHit && Math.abs(phase.targetChapterNum - chapter.chapterNum) <= 1)
          .map((phase) => phase.label),
        alertDetails: [],
      })
    }

    for (let index = localPoints.length - 1; index >= 0; index -= 1) {
      if (localPoints[index].progressHit) break
      trailingStalledChapterCount += 1
    }

    longestStalledRun = Math.max(longestStalledRun, currentStalledRun)

    const latestObservedChapterNum = localPoints[localPoints.length - 1]?.chapterNum || arc.chapterEnd || arc.chapterStart || 0
    const hitPhases = phaseTargets.filter((phase) =>
      typeof phase.targetChapterNum === 'number'
      && localPoints.some((point) => point.progressHit && Math.abs((phase.targetChapterNum || 0) - point.chapterNum) <= 1))
    const missedPhases = phaseTargets.filter((phase) =>
      typeof phase.targetChapterNum === 'number'
      && latestObservedChapterNum >= (phase.targetChapterNum + 1)
      && !hitPhases.some((hit) => hit.key === phase.key))

    const metrics = typeof lastProgressChapterNum === 'number'
      ? getArcChapterRangeMetrics(arc, lastProgressChapterNum)
      : null
    const progressPercent = Math.max(
      hintedPercent,
      metrics?.percent || 0,
      coveredChapters.length > 0 ? roundPercent((progressChapterCount / coveredChapters.length) * 100) : 0,
    )
    const coveredChapterCount = coveredChapters.length
    const totalChapters = isValidArcRange(arc)
      ? Math.max(arc.chapterEnd - arc.chapterStart + 1, 1)
      : coveredChapterCount
    const stallAlert = buildStalledRunAlert(arc, trailingStalledChapterCount, latestObservedChapterNum)
    const alerts = dedupeTextList([
      ...(stallAlert ? [JSON.stringify(stallAlert)] : []),
      ...missedPhases.map((phase) => JSON.stringify(buildPhaseMissAlert(arc, phase))),
    ]).map((item) => JSON.parse(item) as StoryArcProgressAlert)

    const pointAlertMap = new Map<number, string[]>()
    for (const alert of alerts) {
      if (typeof alert.chapterNum !== 'number') continue
      const current = pointAlertMap.get(alert.chapterNum) || []
      current.push(alert.detail)
      pointAlertMap.set(alert.chapterNum, current)
    }

    for (const point of localPoints) {
      point.alertDetails = dedupeTextList(pointAlertMap.get(point.chapterNum) || [])
    }

    const summary: StoryArcProgressSummary = {
      arcId: arc.id,
      arcName: arc.arcName,
      chapterStart: arc.chapterStart ?? undefined,
      chapterEnd: arc.chapterEnd ?? undefined,
      totalChapters,
      coveredChapterCount,
      progressChapterCount,
      stalledChapterCount: trailingStalledChapterCount,
      progressRate: coveredChapterCount > 0 ? roundPercent((progressChapterCount / coveredChapterCount) * 100) : 0,
      stallRate: coveredChapterCount > 0 ? roundPercent(((coveredChapterCount - progressChapterCount) / coveredChapterCount) * 100) : 0,
      progressPercent,
      longestStalledRun,
      lastProgressChapterNum,
      phaseTargets,
      hitPhaseCount: hitPhases.length,
      missedPhaseCount: missedPhases.length,
      alerts,
      statusSummary: buildStatusSummary(progressChapterCount, coveredChapterCount, trailingStalledChapterCount, hitPhases.length, phaseTargets.length),
    }

    arcSummaries.push(summary)
    allPoints.push(...localPoints)
    allAlerts.push(...alerts)
  }

  const volumeEntries: VolumeArcProgressEntry[] = volumeRows
    .map((volume) => {
      const chapterNums = chapterRows
        .filter((chapter) => chapter.volumeId === volume.id)
        .map((chapter) => chapter.chapterNum)
      if (chapterNums.length === 0) return null

      const arcEntries = arcSummaries
        .map((summary) => {
          const points = allPoints.filter((point) => point.arcId === summary.arcId && point.volumeId === volume.id)
          if (points.length === 0) return null
          const progressChapterCount = points.filter((point) => point.progressHit).length
          const stalledChapterCount = points.filter((point) => point.stalled).length
          const hitPhaseLabels = dedupeTextList(points.flatMap((point) => point.hitPhaseLabels))
          const missedPhaseLabels = summary.phaseTargets
            .filter((target) => {
              if (typeof target.targetChapterNum !== 'number') return false
              const isInVolume = target.targetChapterNum >= Math.min(...chapterNums) && target.targetChapterNum <= Math.max(...chapterNums)
              return isInVolume && !hitPhaseLabels.includes(target.label) && summary.alerts.some((alert) => alert.code === 'phase_missed' && alert.title.includes(target.label))
            })
            .map((target) => target.label)

          const progressRate = points.length > 0 ? roundPercent((progressChapterCount / points.length) * 100) : 0
          const stallRate = points.length > 0 ? roundPercent((stalledChapterCount / points.length) * 100) : 0
          if (points.length >= 3 && (progressRate <= 25 || stallRate >= 70)) {
            allAlerts.push({
              code: 'low_volume_progress',
              severity: progressRate <= 10 || stallRate >= 85 ? 'critical' : 'warning',
              arcId: summary.arcId,
              arcName: summary.arcName,
              volumeId: volume.id,
              title: `${volume.title?.trim() || `第${volume.volumeNumber || volume.id}卷`} 推进偏弱`,
              detail: `故事弧“${summary.arcName}”在本卷推进率 ${progressRate}% ，空转率 ${stallRate}% ，需要补足该卷的实质推进与阶段兑现。`,
            })
          }

          return {
            arcId: summary.arcId,
            arcName: summary.arcName,
            coveredChapterCount: points.length,
            progressChapterCount,
            stalledChapterCount,
            progressRate,
            stallRate,
            hitPhaseLabels,
            missedPhaseLabels,
            alertCount: summary.alerts.filter((alert) => !alert.volumeId || alert.volumeId === volume.id).length,
          }
        })
        .filter((item): item is NonNullable<VolumeArcProgressEntry['arcEntries'][number]> => Boolean(item))
        .sort((left, right) => right.alertCount - left.alertCount || left.arcName.localeCompare(right.arcName))

      return {
        volumeId: volume.id,
        volumeNumber: volume.volumeNumber || volume.id,
        volumeName: volume.title?.trim() || `第${volume.volumeNumber || volume.id}卷`,
        chapterStart: Math.min(...chapterNums),
        chapterEnd: Math.max(...chapterNums),
        chapterCount: chapterNums.length,
        arcEntries,
      }
    })
    .filter((item): item is VolumeArcProgressEntry => Boolean(item))
    .sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)

  return {
    arcs: arcSummaries,
    chapterPoints: allPoints.sort((left, right) =>
      left.chapterNum - right.chapterNum || left.arcName.localeCompare(right.arcName) || left.arcId - right.arcId),
    alerts: allAlerts.sort((left, right) => {
      const severityRank = (value: StoryArcProgressAlert['severity']) => (value === 'critical' ? 2 : value === 'warning' ? 1 : 0)
      return severityRank(right.severity) - severityRank(left.severity)
        || (right.chapterNum || 0) - (left.chapterNum || 0)
        || left.arcName.localeCompare(right.arcName)
    }),
    volumeEntries,
  }
}

export function formatStoryArcProgressStatus(
  summary?: StoryArcProgressSummary,
  point?: StoryArcProgressPoint,
): string {
  if (!summary) return ''

  const currentCheckpoint = point?.checkpointPhaseLabels.length
    ? `当前检查点：${point.checkpointPhaseLabels.join('、')}`
    : ''

  return [
    `已记录推进度：${summary.progressPercent}%`,
    `推进章 / 覆盖章：${summary.progressChapterCount}/${summary.coveredChapterCount}`,
    `连续未推进章节：${summary.stalledChapterCount}`,
    typeof summary.lastProgressChapterNum === 'number'
      ? `最近明确推进章节：第${summary.lastProgressChapterNum}章`
      : '最近明确推进章节：暂无记录',
    currentCheckpoint,
  ].filter(Boolean).join('\n')
}

export function formatStoryArcCheckpointReminder(
  summary?: StoryArcProgressSummary,
  point?: StoryArcProgressPoint,
): string {
  if (!summary || !point || point.checkpointPhaseLabels.length === 0) return ''

  return point.progressHit
    ? `当前位于本弧 ${point.checkpointPhaseLabels.join('、')} 检查点，本章已经给出阶段推进，后续章节要继续兑现变化与后果。`
    : `当前位于本弧 ${point.checkpointPhaseLabels.join('、')} 检查点，本章必须明确兑现本弧目标，不能只重复铺垫或转移注意力。`
}

export function getStoryArcWarningsForChapter(
  snapshot: StoryArcProgressSnapshot,
  arcId: number,
  chapterNum: number,
): string[] {
  const summary = snapshot.arcs.find((item) => item.arcId === arcId)
  const point = snapshot.chapterPoints.find((item) => item.arcId === arcId && item.chapterNum === chapterNum)
  if (!summary || !point) return []

  const warnings: string[] = []
  const arcPointNums = snapshot.chapterPoints
    .filter((item) => item.arcId === arcId)
    .map((item) => item.chapterNum)
  const latestObservedChapterNum = arcPointNums.length > 0 ? Math.max(...arcPointNums) : chapterNum

  if (summary.stalledChapterCount >= 5 && chapterNum === latestObservedChapterNum) {
    const stalledAlert = summary.alerts.find((alert) => alert.code === 'stalled_run')
    if (stalledAlert) warnings.push(stalledAlert.detail)
  }

  if (point.checkpointPhaseLabels.length > 0 && !point.progressHit) {
    warnings.push(`当前位于本弧 ${point.checkpointPhaseLabels.join('、')} 检查点，本章仍未给出足够的弧推进。`)
  }

  return dedupeTextList(warnings)
}

export function getStoryArcPhaseTargetsForEditor(arc: ArcRow): StoryArcPhaseTarget[] {
  return mergePhaseTargets(arc)
}

export function getStoryArcStatusContext(
  snapshot: StoryArcProgressSnapshot,
  arcId?: number | null,
  chapterNum?: number,
): { summary?: StoryArcProgressSummary; point?: StoryArcProgressPoint } {
  if (typeof arcId !== 'number' || typeof chapterNum !== 'number') return {}
  return {
    summary: snapshot.arcs.find((item) => item.arcId === arcId),
    point: snapshot.chapterPoints.find((item) => item.arcId === arcId && item.chapterNum === chapterNum),
  }
}
