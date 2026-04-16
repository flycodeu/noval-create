import type {
  ChapterGateDimensionDelta,
  ChapterGateDriftAlert,
  ChapterGateDriftSummary,
  ChapterGateHistoryEntry,
  ChapterGateLevel,
  ChapterGateScoreBand,
  ChapterPublishCheckScoreBreakdown,
} from '../../src/types'

const SCORE_DRIFT_THRESHOLD = 8
const DIMENSION_DRIFT_THRESHOLD = 10

const PRIMARY_DIMENSIONS = [
  { key: 'continuityScore', label: '连续性' },
  { key: 'coherenceScore', label: '结构连贯' },
  { key: 'dialogueVoiceScore', label: '对白辨识' },
  { key: 'hookStrengthScore', label: '钩子强度' },
  { key: 'storyDynamicsScore', label: '主角与节奏' },
  { key: 'languageNaturalnessScore', label: '语言自然度' },
  { key: 'styleComplianceScore', label: '风格硬约束' },
] as const

type PrimaryDimensionKey = typeof PRIMARY_DIMENSIONS[number]['key']

type ChapterGateSnapshotLike = Pick<
  ChapterGateHistoryEntry,
  'chapterId' | 'chapterNum' | 'gateLevel' | 'scoreBreakdown' | 'createdAt'
>

function asFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

export function clampChapterGateScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function getChapterGateLevelRank(level: ChapterGateLevel): number {
  if (level === 'rewrite') return 3
  if (level === 'blocker') return 2
  if (level === 'warning') return 1
  return 0
}

export function getChapterGateScoreBand(score: number): ChapterGateScoreBand {
  if (score >= 80) return 'stable'
  if (score >= 60) return 'attention'
  if (score >= 40) return 'risky'
  return 'unstable'
}

export function getChapterGateScoreBandLabel(band: ChapterGateScoreBand): string {
  if (band === 'stable') return '稳定'
  if (band === 'attention') return '关注'
  if (band === 'risky') return '风险'
  return '失稳'
}

export function getChapterGateLevelLabel(level: ChapterGateLevel): string {
  if (level === 'rewrite') return '退回重写'
  if (level === 'blocker') return '阻塞'
  if (level === 'warning') return '预警'
  return '通过'
}

function averageScores(values: number[], fallback = 70): number {
  if (values.length === 0) return fallback
  return clampChapterGateScore(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function normalizeChapterGateScoreBreakdown(
  raw?: Partial<ChapterPublishCheckScoreBreakdown> | null,
): ChapterPublishCheckScoreBreakdown {
  const contractScore = clampChapterGateScore(asFiniteNumber(raw?.contractScore, 70))
  const hookScore = clampChapterGateScore(asFiniteNumber(raw?.hookScore, raw?.hookStrengthScore ?? 70))
  const povPurityScore = clampChapterGateScore(asFiniteNumber(raw?.povPurityScore, 70))
  const threadProgressScore = clampChapterGateScore(asFiniteNumber(raw?.threadProgressScore, 70))
  const volumeAlignmentScore = clampChapterGateScore(asFiniteNumber(raw?.volumeAlignmentScore, 70))
  const continuityScore = clampChapterGateScore(asFiniteNumber(
    raw?.continuityScore,
    averageScores([contractScore, povPurityScore, threadProgressScore]),
  ))
  const coherenceScore = clampChapterGateScore(asFiniteNumber(
    raw?.coherenceScore,
    averageScores([contractScore, threadProgressScore, volumeAlignmentScore]),
  ))
  const dialogueVoiceScore = clampChapterGateScore(asFiniteNumber(raw?.dialogueVoiceScore, 70))
  const hookStrengthScore = clampChapterGateScore(asFiniteNumber(raw?.hookStrengthScore, hookScore))
  const storyDynamicsScore = clampChapterGateScore(asFiniteNumber(raw?.storyDynamicsScore, averageScores([threadProgressScore, volumeAlignmentScore])))
  const languageNaturalnessScore = clampChapterGateScore(asFiniteNumber(raw?.languageNaturalnessScore, averageScores([dialogueVoiceScore, coherenceScore])))
  const styleComplianceScore = clampChapterGateScore(asFiniteNumber(raw?.styleComplianceScore, averageScores([languageNaturalnessScore, dialogueVoiceScore])))
  const totalScore = clampChapterGateScore(asFiniteNumber(raw?.totalScore, averageScores([
    continuityScore,
    coherenceScore,
    dialogueVoiceScore,
    hookStrengthScore,
    storyDynamicsScore,
    languageNaturalnessScore,
    styleComplianceScore,
  ])))

  return {
    totalScore,
    continuityScore,
    coherenceScore,
    dialogueVoiceScore,
    hookStrengthScore,
    storyDynamicsScore,
    languageNaturalnessScore,
    styleComplianceScore,
    contractScore,
    hookScore,
    povPurityScore,
    threadProgressScore,
    volumeAlignmentScore,
  }
}

export function safeParseChapterGateScoreBreakdown(raw?: string | null): ChapterPublishCheckScoreBreakdown | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ChapterPublishCheckScoreBreakdown>
    return normalizeChapterGateScoreBreakdown(parsed)
  } catch {
    return null
  }
}

export function safeParseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

export function getChapterGatePrimaryDimensions(scoreBreakdown: ChapterPublishCheckScoreBreakdown): Array<{
  key: PrimaryDimensionKey
  label: string
  score: number
}> {
  return PRIMARY_DIMENSIONS.map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    score: scoreBreakdown[dimension.key],
  }))
}

export function getChapterGateDimensionDeltas(
  current: ChapterPublishCheckScoreBreakdown,
  previous: ChapterPublishCheckScoreBreakdown,
): ChapterGateDimensionDelta[] {
  return getChapterGatePrimaryDimensions(current)
    .map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      score: dimension.score,
      previousScore: previous[dimension.key],
      delta: clampChapterGateScore(dimension.score) - clampChapterGateScore(previous[dimension.key]),
    }))
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta) || left.label.localeCompare(right.label, 'zh-CN'))
}

function joinTopDimensionText(dimensions: ChapterGateDimensionDelta[]): string {
  const filtered = dimensions.filter((item) => item.delta !== 0).slice(0, 2)
  if (filtered.length === 0) return '主要维度无明显波动'
  return filtered.map((item) => `${item.label}${item.delta > 0 ? '+' : ''}${item.delta}`).join('，')
}

export function buildChapterGateDriftSummary(
  current: ChapterGateSnapshotLike,
  previous?: ChapterGateSnapshotLike,
): ChapterGateDriftSummary {
  const currentScore = clampChapterGateScore(current.scoreBreakdown.totalScore)
  const scoreBand = getChapterGateScoreBand(currentScore)

  if (!previous) {
    return {
      status: 'stable',
      scoreBand,
      currentScore,
      scoreDelta: 0,
      currentGateLevel: current.gateLevel,
      topDimensions: [],
      summary: `首次记录章节验收门快照，当前总分 ${currentScore}，处于${getChapterGateScoreBandLabel(scoreBand)}区。`,
      createdAt: current.createdAt,
    }
  }

  const previousScore = clampChapterGateScore(previous.scoreBreakdown.totalScore)
  const scoreDelta = currentScore - previousScore
  const gateRankDelta = getChapterGateLevelRank(current.gateLevel) - getChapterGateLevelRank(previous.gateLevel)
  const topDimensions = getChapterGateDimensionDeltas(current.scoreBreakdown, previous.scoreBreakdown)
  const strongestDelta = topDimensions[0]?.delta || 0
  const status = gateRankDelta > 0
    || scoreDelta <= -SCORE_DRIFT_THRESHOLD
    || strongestDelta <= -DIMENSION_DRIFT_THRESHOLD
    ? 'worsening'
    : gateRankDelta < 0
      || scoreDelta >= SCORE_DRIFT_THRESHOLD
      || strongestDelta >= DIMENSION_DRIFT_THRESHOLD
      ? 'improving'
      : 'stable'

  const gateChangeText = gateRankDelta > 0
    ? `门级别从${getChapterGateLevelLabel(previous.gateLevel)}恶化为${getChapterGateLevelLabel(current.gateLevel)}`
    : gateRankDelta < 0
      ? `门级别从${getChapterGateLevelLabel(previous.gateLevel)}改善为${getChapterGateLevelLabel(current.gateLevel)}`
      : `门级别维持${getChapterGateLevelLabel(current.gateLevel)}`

  const deltaText = scoreDelta === 0
    ? '总分持平'
    : `总分${scoreDelta > 0 ? '+' : ''}${scoreDelta}`

  return {
    status,
    scoreBand,
    currentScore,
    previousScore,
    scoreDelta,
    currentGateLevel: current.gateLevel,
    previousGateLevel: previous.gateLevel,
    topDimensions,
    summary: `${gateChangeText}，${deltaText}。${joinTopDimensionText(topDimensions)}。`,
    createdAt: current.createdAt,
  }
}

export function buildChapterGateDriftAlert(
  current: ChapterGateSnapshotLike,
  previous?: ChapterGateSnapshotLike,
): ChapterGateDriftAlert {
  const drift = buildChapterGateDriftSummary(current, previous)
  return {
    chapterId: current.chapterId,
    chapterNum: current.chapterNum,
    title: `第${current.chapterNum}章验收门${drift.status === 'worsening' ? '恶化' : drift.status === 'improving' ? '改善' : '回看'}`,
    detail: drift.summary,
    ...drift,
  }
}

export function compareChapterGateSnapshots(
  current: ChapterGateHistoryEntry,
  previous: ChapterGateHistoryEntry,
): boolean {
  return current.gateLevel === previous.gateLevel
    && current.ready === previous.ready
    && current.rewriteCount === previous.rewriteCount
    && current.blockerCount === previous.blockerCount
    && current.warningCount === previous.warningCount
    && JSON.stringify(normalizeChapterGateScoreBreakdown(current.scoreBreakdown))
      === JSON.stringify(normalizeChapterGateScoreBreakdown(previous.scoreBreakdown))
    && JSON.stringify(current.topIssueKeys) === JSON.stringify(previous.topIssueKeys)
}
