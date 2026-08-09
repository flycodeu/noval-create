import type {
  ChapterFunctionAlert,
  ChapterFunctionRun,
  ChapterFunctionSummary,
  ChapterFunctionTag,
  ChapterPacingMarker,
} from '../../src/types'

const CHAPTER_FUNCTION_TAGS: ChapterFunctionTag[] = [
  'setup',
  'progression',
  'reversal',
  'payoff',
  'breather',
  'climax',
  'exposition',
  'closure',
]
const CHAPTER_FUNCTION_WEAK_TAGS: ChapterFunctionTag[] = ['setup', 'exposition', 'breather']

export const REPEATED_FUNCTION_RUN_THRESHOLD = 3
export const FUNCTION_DOMINANCE_WARNING_SHARE = 55
export const FUNCTION_DOMINANCE_BLOCKER_SHARE = 70

export interface ChapterFunctionParseResult {
  primaryTag?: ChapterFunctionTag
  tags: ChapterFunctionTag[]
}

export interface ChapterFunctionChapterRecord {
  chapterId: number
  chapterNum: number
  title: string
  volumeId?: number
  primaryTag?: ChapterFunctionTag
  tags: ChapterFunctionTag[]
  paceMarker?: ChapterPacingMarker
  reversalMarker: boolean
}

export interface ChapterFunctionDiagnostics {
  summary: ChapterFunctionSummary
  repeatedRuns: ChapterFunctionRun[]
  weakKeyAlerts: ChapterFunctionAlert[]
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeChapterFunctionTag(value: unknown): ChapterFunctionTag | undefined {
  return value === 'setup'
    || value === 'progression'
    || value === 'reversal'
    || value === 'payoff'
    || value === 'breather'
    || value === 'climax'
    || value === 'exposition'
    || value === 'closure'
    ? value
    : undefined
}

function normalizeChapterFunctionTags(value: unknown): ChapterFunctionTag[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => normalizeChapterFunctionTag(item)).filter(Boolean))] as ChapterFunctionTag[]
}

function emptyChapterFunctionTagCounts(): Record<ChapterFunctionTag, number> {
  return {
    setup: 0,
    progression: 0,
    reversal: 0,
    payoff: 0,
    breather: 0,
    climax: 0,
    exposition: 0,
    closure: 0,
  }
}

function orderedChapterFunctions(chaptersList: ChapterFunctionChapterRecord[]): ChapterFunctionChapterRecord[] {
  return [...chaptersList].sort((left, right) => left.chapterNum - right.chapterNum || left.chapterId - right.chapterId)
}

function isKeyFunctionChapter(chapter: ChapterFunctionChapterRecord): boolean {
  return chapter.paceMarker === 'climax'
    || chapter.paceMarker === 'reversal'
    || chapter.paceMarker === 'payoff'
    || chapter.reversalMarker
}

function chapterFunctionRunLengthPenalty(run: ChapterFunctionRun): number {
  return Math.max(0, run.length - REPEATED_FUNCTION_RUN_THRESHOLD + 1) * 10
}

function dominantTagPenalty(share: number): number {
  return Math.max(0, share - 40) * 0.9
}

function coveragePenalty(coverage: number): number {
  return Math.max(0, 100 - coverage) * 0.35
}

function buildChapterFunctionTagCounts(
  chaptersList: ChapterFunctionChapterRecord[],
): Record<ChapterFunctionTag, number> {
  const counts = emptyChapterFunctionTagCounts()
  for (const chapter of chaptersList) {
    const tags = chapter.tags.length > 0
      ? chapter.tags
      : chapter.primaryTag
        ? [chapter.primaryTag]
        : []
    for (const tag of new Set(tags)) counts[tag] += 1
  }
  return counts
}

function buildPrimaryChapterFunctionCounts(
  chaptersList: ChapterFunctionChapterRecord[],
): Record<ChapterFunctionTag, number> {
  const counts = emptyChapterFunctionTagCounts()
  for (const chapter of chaptersList) {
    if (chapter.primaryTag) counts[chapter.primaryTag] += 1
  }
  return counts
}

function getDominantPrimaryTag(
  counts: Record<ChapterFunctionTag, number>,
  trackedChapterCount: number,
): { dominantTag?: ChapterFunctionTag; dominantTagShare: number } {
  if (trackedChapterCount === 0) return { dominantTag: undefined, dominantTagShare: 0 }
  const dominantEntry = CHAPTER_FUNCTION_TAGS
    .map((tag) => ({ tag, count: counts[tag] }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))[0]
  if (!dominantEntry || dominantEntry.count === 0) return { dominantTag: undefined, dominantTagShare: 0 }
  return {
    dominantTag: dominantEntry.tag,
    dominantTagShare: roundMetric((dominantEntry.count / trackedChapterCount) * 100),
  }
}

function buildChapterFunctionRhythmBalanceScore(params: {
  totalChapterCount: number
  trackedChapterCount: number
  repeatedRuns: ChapterFunctionRun[]
  dominantTagShare: number
  weakKeyChapterCount: number
}): number {
  if (params.totalChapterCount === 0 || params.trackedChapterCount === 0) return 0
  const coverage = roundMetric((params.trackedChapterCount / params.totalChapterCount) * 100)
  const repeatedPenalty = params.repeatedRuns.reduce(
    (sum, run) => sum + chapterFunctionRunLengthPenalty(run),
    0,
  )
  const score = 100
    - coveragePenalty(coverage)
    - repeatedPenalty
    - dominantTagPenalty(params.dominantTagShare)
    - (params.weakKeyChapterCount * 12)
  return clampNumber(score, 0, 100, 0)
}

function buildSummary(
  chaptersList: ChapterFunctionChapterRecord[],
  totalChapterCount: number,
  repeatedRuns: ChapterFunctionRun[],
  weakKeyChapterCount: number,
): ChapterFunctionSummary {
  const trackedChapterCount = chaptersList.filter((chapter) => chapter.primaryTag || chapter.tags.length > 0).length
  const tagCounts = buildChapterFunctionTagCounts(chaptersList)
  const primaryCounts = buildPrimaryChapterFunctionCounts(chaptersList)
  const { dominantTag, dominantTagShare } = getDominantPrimaryTag(primaryCounts, trackedChapterCount)
  return {
    trackedChapterCount,
    chapterPurposeCoverage: totalChapterCount > 0
      ? roundMetric((trackedChapterCount / totalChapterCount) * 100)
      : 0,
    rhythmBalanceScore: buildChapterFunctionRhythmBalanceScore({
      totalChapterCount,
      trackedChapterCount,
      repeatedRuns,
      dominantTagShare,
      weakKeyChapterCount,
    }),
    repeatedFunctionRunCount: repeatedRuns.length,
    longestRepeatedFunctionRun: repeatedRuns.reduce((max, run) => Math.max(max, run.length), 0),
    dominantTag,
    dominantTagShare,
    tagCounts,
  }
}

export function chapterFunctionLabel(tag?: ChapterFunctionTag): string {
  if (tag === 'setup') return '铺垫'
  if (tag === 'progression') return '推进'
  if (tag === 'reversal') return '反转'
  if (tag === 'payoff') return '回收'
  if (tag === 'breather') return '喘息'
  if (tag === 'climax') return '爆发'
  if (tag === 'exposition') return '解释'
  if (tag === 'closure') return '收束'
  return '未标注'
}

export function parseChapterFunction(raw?: string | null): ChapterFunctionParseResult {
  if (!raw?.trim()) return { primaryTag: undefined, tags: [] }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { primaryTag: undefined, tags: [] }
    }
    const record = parsed as Record<string, unknown>
    const normalizedPrimaryTag = normalizeChapterFunctionTag(record.chapter_function_primary)
    const tags = normalizeChapterFunctionTags(record.chapter_function_tags)
    const primaryTag = normalizedPrimaryTag || tags[0]
    if (primaryTag && !tags.includes(primaryTag)) tags.unshift(primaryTag)
    return { primaryTag, tags }
  } catch {
    return { primaryTag: undefined, tags: [] }
  }
}

export function collectChapterFunctionRuns(
  chaptersList: ChapterFunctionChapterRecord[],
  minLength = REPEATED_FUNCTION_RUN_THRESHOLD,
): ChapterFunctionRun[] {
  const sorted = orderedChapterFunctions(chaptersList)
  const runs: ChapterFunctionRun[] = []
  let currentTag: ChapterFunctionTag | undefined
  let currentChapterNums: number[] = []
  let lastChapterNum: number | null = null

  const flush = () => {
    if (currentTag && currentChapterNums.length >= minLength) {
      runs.push({
        primaryTag: currentTag,
        startChapterNum: currentChapterNums[0],
        endChapterNum: currentChapterNums[currentChapterNums.length - 1],
        length: currentChapterNums.length,
        chapterNums: [...currentChapterNums],
      })
    }
  }

  for (const chapter of sorted) {
    const primaryTag = chapter.primaryTag
    const contiguous = lastChapterNum !== null && chapter.chapterNum === lastChapterNum + 1
    if (!primaryTag) {
      flush()
      currentTag = undefined
      currentChapterNums = []
      lastChapterNum = chapter.chapterNum
      continue
    }
    if (currentTag === primaryTag && (currentChapterNums.length === 0 || contiguous)) {
      currentChapterNums.push(chapter.chapterNum)
    } else {
      flush()
      currentTag = primaryTag
      currentChapterNums = [chapter.chapterNum]
    }
    lastChapterNum = chapter.chapterNum
  }
  flush()
  return runs
}

export function buildRepeatedFunctionAlerts(runs: ChapterFunctionRun[]): ChapterFunctionAlert[] {
  return runs.map((run) => ({
    code: 'repeated_function_run',
    severity: run.length >= 5 ? 'blocker' : 'warning',
    title: `连续 ${run.length} 章重复承担${chapterFunctionLabel(run.primaryTag)}`,
    detail: `第 ${run.startChapterNum} 到 ${run.endChapterNum} 章的主功能都偏向${chapterFunctionLabel(run.primaryTag)}，建议插入推进、回收、爆发或结构转向。`,
    chapterNums: run.chapterNums,
    primaryTag: run.primaryTag,
  }))
}

export function buildWeakKeyFunctionAlerts(
  chaptersList: ChapterFunctionChapterRecord[],
): ChapterFunctionAlert[] {
  return orderedChapterFunctions(chaptersList)
    .filter((chapter) => (
      isKeyFunctionChapter(chapter)
      && (!chapter.primaryTag || CHAPTER_FUNCTION_WEAK_TAGS.includes(chapter.primaryTag))
    ))
    .map((chapter) => ({
      code: 'weak_key_chapter_function' as const,
      severity: 'warning' as const,
      title: `第${chapter.chapterNum}章关键功能偏弱`,
      detail: chapter.primaryTag
        ? `该章已被标记为关键节奏节点，但主功能仍然只是${chapterFunctionLabel(chapter.primaryTag)}，建议补出推进、回收、反转或爆发。`
        : '该章已被标记为关键节奏节点，但没有明确主功能标签，建议补出主功能并校正章节任务。',
      chapterNums: [chapter.chapterNum],
      volumeId: chapter.volumeId,
      primaryTag: chapter.primaryTag,
    }))
}

export function buildChapterFunctionDiagnostics(
  chaptersList: ChapterFunctionChapterRecord[],
  totalChapterCount: number,
): ChapterFunctionDiagnostics {
  const orderedChapters = orderedChapterFunctions(chaptersList)
  const repeatedRuns = collectChapterFunctionRuns(orderedChapters)
  const weakKeyAlerts = buildWeakKeyFunctionAlerts(orderedChapters)
  return {
    summary: buildSummary(
      orderedChapters,
      totalChapterCount,
      repeatedRuns,
      weakKeyAlerts.length,
    ),
    repeatedRuns,
    weakKeyAlerts,
  }
}

export function buildChapterFunctionSummary(
  chaptersList: ChapterFunctionChapterRecord[],
  totalChapterCount: number,
): ChapterFunctionSummary {
  return buildChapterFunctionDiagnostics(chaptersList, totalChapterCount).summary
}

export function buildVolumeFunctionSkewAlert(volume: {
  volumeId: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  dominantTag?: ChapterFunctionTag
  dominantTagShare: number
}): ChapterFunctionAlert[] {
  if (!volume.dominantTag || volume.dominantTagShare < FUNCTION_DOMINANCE_WARNING_SHARE) return []
  return [{
    code: 'volume_function_skew',
    severity: volume.dominantTagShare >= FUNCTION_DOMINANCE_BLOCKER_SHARE ? 'blocker' : 'warning',
    title: `${volume.volumeName} 功能分布偏科`,
    detail: `${volume.volumeName} 的主功能有 ${volume.dominantTagShare}% 都落在${chapterFunctionLabel(volume.dominantTag)}，容易出现同质推进或空转。`,
    chapterNums: [volume.chapterStart, volume.chapterEnd],
    volumeId: volume.volumeId,
    primaryTag: volume.dominantTag,
  }]
}

export function buildBookFunctionSkewAlert(
  summary: ChapterFunctionSummary,
  chapterNums: number[],
): ChapterFunctionAlert[] {
  if (!summary.dominantTag || summary.dominantTagShare < FUNCTION_DOMINANCE_WARNING_SHARE) return []
  const sortedChapterNums = [...new Set(chapterNums)].sort((left, right) => left - right)
  return [{
    code: 'volume_function_skew',
    severity: summary.dominantTagShare >= FUNCTION_DOMINANCE_BLOCKER_SHARE ? 'blocker' : 'warning',
    title: '全书功能分布偏科',
    detail: `当前主功能有 ${summary.dominantTagShare}% 都落在${chapterFunctionLabel(summary.dominantTag)}，建议补出推进层次和章节任务差异。`,
    chapterNums: sortedChapterNums.length > 0
      ? [sortedChapterNums[0], sortedChapterNums[sortedChapterNums.length - 1]]
      : [],
    primaryTag: summary.dominantTag,
  }]
}

export function sortChapterFunctionAlerts(
  left: ChapterFunctionAlert,
  right: ChapterFunctionAlert,
): number {
  const rank = (value: ChapterFunctionAlert['severity']) => (value === 'blocker' ? 2 : 1)
  const leftMax = left.chapterNums[left.chapterNums.length - 1] || 0
  const rightMax = right.chapterNums[right.chapterNums.length - 1] || 0
  return rank(right.severity) - rank(left.severity)
    || rightMax - leftMax
    || left.title.localeCompare(right.title)
}
