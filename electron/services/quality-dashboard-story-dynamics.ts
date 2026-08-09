import type {
  ChapterPacingMarker,
  ChapterStoryDynamics,
  CostDurationEntry,
  CostPersistenceSummary,
  CostResolutionState,
  ProtagonistSetbackLevel,
  ProtagonistSetbackSummary,
  ReversalDistributionSummary,
  ReversalSupportState,
  RewardState,
  StoryDynamicsAlert,
} from '../../src/types'

const STORY_DYNAMICS_KEYS = [
  'protagonist_setback',
  'setback_summary',
  'cost_present',
  'cost_summary',
  'cost_resolution_state',
  'reversal_marker',
  'reversal_summary',
  'reversal_support_state',
  'pace_marker',
  'reward_state',
  'protagonist_pressure',
] as const

export const STORY_ALERT_WINDOW = 20
export const SMOOTH_RUN_THRESHOLD = 4
export const PRESSURE_RUN_THRESHOLD = 4
export const CLIMAX_GAP_THRESHOLD = 12

export interface TimelineStoryHint {
  hasConflict: boolean
  hasReversal: boolean
  hasClimax: boolean
  hasPayoff: boolean
  hasBreather: boolean
  protagonistPresent: boolean
}

export interface TimelineStoryEventRow {
  eventType: string | null
  eventTitle: string
  eventSummary: string | null
  eventResult: string | null
  chapterStartId: number | null
  chapterEndId: number | null
  protagonistPresent: number | null
  protagonistAction: string | null
}

export interface StoryDynamicsParseResult {
  dynamics: ChapterStoryDynamics
  explicit: boolean
}

export interface StoryDynamicsChapterRecord {
  chapterId: number
  chapterNum: number
  title: string
  volumeId?: number
  dynamics: ChapterStoryDynamics
}

export type StoryCostPersistenceState = CostPersistenceSummary & {
  allEntries: CostDurationEntry[]
}

interface MutableCostRecord {
  startChapterNum: number
  summary: string
  seenContinuation: boolean
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

function normalizeProtagonistSetback(value: unknown): ProtagonistSetbackLevel {
  return value === 'minor' || value === 'major' || value === 'none' ? value : 'none'
}

function normalizeCostResolutionState(value: unknown): CostResolutionState | undefined {
  return value === 'new' || value === 'ongoing' || value === 'resolved' || value === 'evaporated'
    ? value
    : undefined
}

function normalizeReversalSupportState(value: unknown): ReversalSupportState | undefined {
  return value === 'supported' || value === 'weak' || value === 'forced' ? value : undefined
}

function normalizePaceMarker(value: unknown): ChapterPacingMarker | undefined {
  return value === 'setup'
    || value === 'conflict'
    || value === 'reversal'
    || value === 'climax'
    || value === 'payoff'
    || value === 'breather'
    ? value
    : undefined
}

function normalizeRewardState(value: unknown): RewardState {
  return value === 'partial' || value === 'major' || value === 'none' ? value : 'none'
}

function emptyStoryDynamics(): ChapterStoryDynamics {
  return {
    protagonistSetback: 'none',
    setbackSummary: '',
    costPresent: false,
    costSummary: '',
    costResolutionState: undefined,
    reversalMarker: false,
    reversalSummary: '',
    reversalSupportState: undefined,
    paceMarker: undefined,
    rewardState: 'none',
    protagonistPressure: 0,
  }
}

function emptyTimelineStoryHint(): TimelineStoryHint {
  return {
    hasConflict: false,
    hasReversal: false,
    hasClimax: false,
    hasPayoff: false,
    hasBreather: false,
    protagonistPresent: false,
  }
}

function emptyProtagonistSetbackSummary(): ProtagonistSetbackSummary {
  return {
    chapterCount: 0,
    protagonistSetbackRate: 0,
    majorSetbackRate: 0,
    averagePressure: 0,
    longestSmoothRun: 0,
    longestPressureRun: 0,
  }
}

function emptyCostPersistenceSummary(): CostPersistenceSummary {
  return {
    averageCostDuration: 0,
    evaporatedCostCount: 0,
    unresolvedCostCount: 0,
    activeCosts: [],
  }
}

function emptyPaceMarkerCounts(): Record<ChapterPacingMarker, number> {
  return { setup: 0, conflict: 0, reversal: 0, climax: 0, payoff: 0, breather: 0 }
}

function emptyReversalDistributionSummary(): ReversalDistributionSummary {
  return {
    reversalChapterNums: [],
    climaxChapterNums: [],
    breatherChapterNums: [],
    payoffChapterNums: [],
    forcedReversalCount: 0,
    weakReversalCount: 0,
    climaxSpacing: [],
    paceMarkerCounts: emptyPaceMarkerCounts(),
  }
}

function mergeTimelineHint(current: TimelineStoryHint, incoming: TimelineStoryHint): TimelineStoryHint {
  return {
    hasConflict: current.hasConflict || incoming.hasConflict,
    hasReversal: current.hasReversal || incoming.hasReversal,
    hasClimax: current.hasClimax || incoming.hasClimax,
    hasPayoff: current.hasPayoff || incoming.hasPayoff,
    hasBreather: current.hasBreather || incoming.hasBreather,
    protagonistPresent: current.protagonistPresent || incoming.protagonistPresent,
  }
}

function lowerBound(values: number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (values[middle] < target) low = middle + 1
    else high = middle
  }
  return low
}

function orderedStoryChapters(chaptersList: StoryDynamicsChapterRecord[]): StoryDynamicsChapterRecord[] {
  return [...chaptersList].sort((left, right) => left.chapterNum - right.chapterNum || left.chapterId - right.chapterId)
}

function isSmoothChapter(chapter: StoryDynamicsChapterRecord): boolean {
  return chapter.dynamics.protagonistSetback === 'none'
    && (chapter.dynamics.rewardState === 'partial' || chapter.dynamics.rewardState === 'major')
    && !chapter.dynamics.costPresent
}

function isPressureChapter(chapter: StoryDynamicsChapterRecord): boolean {
  return (chapter.dynamics.protagonistSetback !== 'none' || chapter.dynamics.protagonistPressure >= 60)
    && chapter.dynamics.rewardState === 'none'
}

function collectRunChapterNums(
  chaptersList: StoryDynamicsChapterRecord[],
  predicate: (chapter: StoryDynamicsChapterRecord) => boolean,
  minLength: number,
): number[][] {
  const runs: number[][] = []
  let current: number[] = []
  let lastChapterNum: number | null = null
  for (const chapter of chaptersList) {
    const matches = predicate(chapter)
    const contiguous = lastChapterNum !== null && chapter.chapterNum === lastChapterNum + 1
    if (!matches) {
      if (current.length >= minLength) runs.push(current)
      current = []
      lastChapterNum = chapter.chapterNum
      continue
    }
    if (current.length === 0 || contiguous) current.push(chapter.chapterNum)
    else {
      if (current.length >= minLength) runs.push(current)
      current = [chapter.chapterNum]
    }
    lastChapterNum = chapter.chapterNum
  }
  if (current.length >= minLength) runs.push(current)
  return runs
}

function longestRunLength(
  chaptersList: StoryDynamicsChapterRecord[],
  predicate: (chapter: StoryDynamicsChapterRecord) => boolean,
): number {
  return collectRunChapterNums(chaptersList, predicate, 1).reduce((max, run) => Math.max(max, run.length), 0)
}

function dedupeChapterNums(chapterNums: number[]): number[] {
  return [...new Set(chapterNums)].sort((left, right) => left - right)
}

function sortStoryAlerts(left: StoryDynamicsAlert, right: StoryDynamicsAlert): number {
  const rank = (value: StoryDynamicsAlert['severity']) => (value === 'blocker' ? 2 : 1)
  const leftMax = left.chapterNums[left.chapterNums.length - 1] || 0
  const rightMax = right.chapterNums[right.chapterNums.length - 1] || 0
  return rank(right.severity) - rank(left.severity)
    || rightMax - leftMax
    || left.title.localeCompare(right.title)
}

export function parseStoryDynamics(raw?: string | null): StoryDynamicsParseResult {
  if (!raw?.trim()) return { dynamics: emptyStoryDynamics(), explicit: false }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { dynamics: emptyStoryDynamics(), explicit: false }
    }
    const record = parsed as Record<string, unknown>
    const explicit = STORY_DYNAMICS_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key))
    const costPresent = normalizeBoolean(record.cost_present)
    const reversalMarker = normalizeBoolean(record.reversal_marker)
    return {
      explicit,
      dynamics: {
        protagonistSetback: normalizeProtagonistSetback(record.protagonist_setback),
        setbackSummary: asText(record.setback_summary),
        costPresent,
        costSummary: asText(record.cost_summary),
        costResolutionState: costPresent ? normalizeCostResolutionState(record.cost_resolution_state) : undefined,
        reversalMarker,
        reversalSummary: asText(record.reversal_summary),
        reversalSupportState: reversalMarker ? normalizeReversalSupportState(record.reversal_support_state) : undefined,
        paceMarker: normalizePaceMarker(record.pace_marker),
        rewardState: normalizeRewardState(record.reward_state),
        protagonistPressure: clampNumber(record.protagonist_pressure, 0, 100, 0),
      },
    }
  } catch {
    return { dynamics: emptyStoryDynamics(), explicit: false }
  }
}

export function hasTimelineHint(hint?: TimelineStoryHint | null): boolean {
  return Boolean(hint && (
    hint.hasConflict
    || hint.hasReversal
    || hint.hasClimax
    || hint.hasPayoff
    || hint.hasBreather
    || hint.protagonistPresent
  ))
}

export function enhanceStoryDynamics(
  base: ChapterStoryDynamics,
  hint?: TimelineStoryHint | null,
): ChapterStoryDynamics {
  if (!hint) return base
  const next: ChapterStoryDynamics = {
    ...base,
    setbackSummary: base.setbackSummary || '',
    costSummary: base.costSummary || '',
    reversalSummary: base.reversalSummary || '',
  }
  if (!next.paceMarker) {
    if (hint.hasClimax) next.paceMarker = 'climax'
    else if (hint.hasReversal) next.paceMarker = 'reversal'
    else if (hint.hasPayoff) next.paceMarker = 'payoff'
    else if (hint.hasBreather) next.paceMarker = 'breather'
    else if (hint.hasConflict) next.paceMarker = 'conflict'
  }
  if (!next.reversalMarker && hint.hasReversal) {
    next.reversalMarker = true
    next.reversalSummary = next.reversalSummary || '时间轴标记存在反转事件。'
  }
  if (next.rewardState === 'none' && hint.hasPayoff) next.rewardState = 'partial'
  if (
    next.protagonistSetback === 'none'
    && hint.protagonistPresent
    && (hint.hasConflict || hint.hasClimax || hint.hasReversal)
  ) {
    next.protagonistSetback = hint.hasClimax ? 'major' : 'minor'
    next.setbackSummary = next.setbackSummary || '时间轴显示主角在本章承受了明显冲突压力。'
  }
  if (next.protagonistPressure === 0 && hint.protagonistPresent) {
    next.protagonistPressure = hint.hasClimax
      ? 85
      : hint.hasReversal
        ? 75
        : hint.hasConflict
          ? 60
          : hint.hasPayoff
            ? 35
            : 20
  }
  return next
}

export function buildTimelineStoryHints(
  rows: TimelineStoryEventRow[],
  chapterNumById: Map<number, number>,
): Map<number, TimelineStoryHint> {
  const map = new Map<number, TimelineStoryHint>()
  const knownChapterNums = [...new Set(chapterNumById.values())].sort((left, right) => left - right)
  for (const row of rows) {
    const startNum = row.chapterStartId ? chapterNumById.get(row.chapterStartId) : undefined
    const endNum = row.chapterEndId ? chapterNumById.get(row.chapterEndId) : undefined
    const chapterNums: number[] = []
    if (typeof startNum === 'number' && typeof endNum === 'number') {
      const minNum = Math.min(startNum, endNum)
      const maxNum = Math.max(startNum, endNum)
      const startIndex = lowerBound(knownChapterNums, minNum)
      for (let index = startIndex; index < knownChapterNums.length && knownChapterNums[index] <= maxNum; index += 1) {
        chapterNums.push(knownChapterNums[index])
      }
    } else if (typeof startNum === 'number') {
      chapterNums.push(startNum)
    } else if (typeof endNum === 'number') {
      chapterNums.push(endNum)
    }
    if (chapterNums.length === 0) continue
    const haystack = [
      row.eventType || '',
      row.eventTitle || '',
      row.eventSummary || '',
      row.eventResult || '',
      row.protagonistAction || '',
    ].join(' ')
    const incoming: TimelineStoryHint = {
      hasConflict: /冲突|对抗|危机|追击|受挫|围攻/.test(haystack),
      hasReversal: /反转|逆转|翻盘/.test(haystack),
      hasClimax: /高潮|决战|爆发|终局|决胜/.test(haystack),
      hasPayoff: /回收|兑现|回报|收获/.test(haystack),
      hasBreather: /喘息|缓冲|休整|整备|平复/.test(haystack),
      protagonistPresent: row.protagonistPresent === 1 || Boolean(asText(row.protagonistAction)),
    }
    for (const chapterNum of chapterNums) {
      map.set(chapterNum, mergeTimelineHint(map.get(chapterNum) || emptyTimelineStoryHint(), incoming))
    }
  }
  return map
}

export function toSetbackLevel(value: ProtagonistSetbackLevel): 0 | 1 | 2 {
  return value === 'major' ? 2 : value === 'minor' ? 1 : 0
}

export function toRewardLevel(value: RewardState): 0 | 1 | 2 {
  return value === 'major' ? 2 : value === 'partial' ? 1 : 0
}

export function computeProtagonistSetbackSummary(
  chaptersList: StoryDynamicsChapterRecord[],
): ProtagonistSetbackSummary {
  if (chaptersList.length === 0) return emptyProtagonistSetbackSummary()
  const orderedChapters = orderedStoryChapters(chaptersList)
  const setbackCount = orderedChapters.filter((chapter) => chapter.dynamics.protagonistSetback !== 'none').length
  const majorSetbackCount = orderedChapters.filter((chapter) => chapter.dynamics.protagonistSetback === 'major').length
  const totalPressure = orderedChapters.reduce((sum, chapter) => sum + chapter.dynamics.protagonistPressure, 0)
  return {
    chapterCount: orderedChapters.length,
    protagonistSetbackRate: roundMetric((setbackCount / orderedChapters.length) * 100),
    majorSetbackRate: roundMetric((majorSetbackCount / orderedChapters.length) * 100),
    averagePressure: roundMetric(totalPressure / orderedChapters.length),
    longestSmoothRun: longestRunLength(orderedChapters, isSmoothChapter),
    longestPressureRun: longestRunLength(orderedChapters, isPressureChapter),
  }
}

export function computeCostPersistence(
  chaptersList: StoryDynamicsChapterRecord[],
): StoryCostPersistenceState {
  if (chaptersList.length === 0) return { ...emptyCostPersistenceSummary(), allEntries: [] }
  const orderedChapters = orderedStoryChapters(chaptersList)
  const completed: CostDurationEntry[] = []
  const activeQueue: MutableCostRecord[] = []
  for (const chapter of orderedChapters) {
    if (!chapter.dynamics.costPresent) continue
    const state = chapter.dynamics.costResolutionState || 'new'
    const summary = chapter.dynamics.costSummary || `第${chapter.chapterNum}章代价`
    if (state === 'new') {
      activeQueue.push({ startChapterNum: chapter.chapterNum, summary, seenContinuation: false })
      continue
    }
    if (state === 'ongoing') {
      if (activeQueue.length === 0) {
        activeQueue.push({ startChapterNum: chapter.chapterNum, summary, seenContinuation: false })
      } else {
        activeQueue[0].seenContinuation = activeQueue[0].seenContinuation
          || chapter.chapterNum > activeQueue[0].startChapterNum
        if (!activeQueue[0].summary) activeQueue[0].summary = summary
      }
      continue
    }
    const target = activeQueue.length > 0
      ? activeQueue.shift()!
      : { startChapterNum: chapter.chapterNum, summary, seenContinuation: false }
    const duration = Math.max(1, chapter.chapterNum - target.startChapterNum + 1)
    const status: CostDurationEntry['status'] = state === 'evaporated'
      ? 'evaporated'
      : duration <= 2 && !target.seenContinuation
        ? 'evaporated'
        : 'resolved'
    completed.push({
      startChapterNum: target.startChapterNum,
      endChapterNum: chapter.chapterNum,
      duration,
      status,
      summary: target.summary || summary,
    })
  }
  const lastChapterNum = orderedChapters[orderedChapters.length - 1]?.chapterNum || 0
  const activeCosts = activeQueue
    .map((entry) => ({
      startChapterNum: entry.startChapterNum,
      duration: Math.max(1, lastChapterNum - entry.startChapterNum + 1),
      status: 'ongoing' as const,
      summary: entry.summary || `第${entry.startChapterNum}章代价`,
    }))
    .sort((left, right) => right.duration - left.duration || left.startChapterNum - right.startChapterNum)
  const allEntries = [...completed, ...activeCosts]
  return {
    averageCostDuration: allEntries.length > 0
      ? roundMetric(allEntries.reduce((sum, entry) => sum + entry.duration, 0) / allEntries.length)
      : 0,
    evaporatedCostCount: completed.filter((entry) => entry.status === 'evaporated').length,
    unresolvedCostCount: activeCosts.length,
    activeCosts: activeCosts.slice(0, 3),
    allEntries,
  }
}

export function computeReversalDistribution(
  chaptersList: StoryDynamicsChapterRecord[],
): ReversalDistributionSummary {
  if (chaptersList.length === 0) return emptyReversalDistributionSummary()
  const paceMarkerCounts = emptyPaceMarkerCounts()
  const reversalChapterNums: number[] = []
  const climaxChapterNums: number[] = []
  const breatherChapterNums: number[] = []
  const payoffChapterNums: number[] = []
  let forcedReversalCount = 0
  let weakReversalCount = 0
  for (const chapter of orderedStoryChapters(chaptersList)) {
    const { dynamics } = chapter
    if (dynamics.paceMarker) {
      paceMarkerCounts[dynamics.paceMarker] += 1
      if (dynamics.paceMarker === 'climax') climaxChapterNums.push(chapter.chapterNum)
      if (dynamics.paceMarker === 'breather') breatherChapterNums.push(chapter.chapterNum)
      if (dynamics.paceMarker === 'payoff') payoffChapterNums.push(chapter.chapterNum)
    }
    if (dynamics.reversalMarker || dynamics.paceMarker === 'reversal') {
      reversalChapterNums.push(chapter.chapterNum)
      if (dynamics.reversalSupportState === 'forced') forcedReversalCount += 1
      if (dynamics.reversalSupportState === 'weak') weakReversalCount += 1
    }
  }
  return {
    reversalChapterNums,
    climaxChapterNums,
    breatherChapterNums,
    payoffChapterNums,
    forcedReversalCount,
    weakReversalCount,
    climaxSpacing: climaxChapterNums.slice(1).map((chapterNum, index) => chapterNum - climaxChapterNums[index]),
    paceMarkerCounts,
  }
}

export function buildStoryPacingAlerts(
  chaptersList: StoryDynamicsChapterRecord[],
  costSummary?: StoryCostPersistenceState,
): StoryDynamicsAlert[] {
  if (chaptersList.length === 0) return []
  const orderedChapters = orderedStoryChapters(chaptersList)
  const recentChapters = orderedChapters.slice(-STORY_ALERT_WINDOW)
  const recentChapterNums = recentChapters.map((chapter) => chapter.chapterNum)
  const costState = costSummary || computeCostPersistence(orderedChapters)
  const alerts: StoryDynamicsAlert[] = []
  collectRunChapterNums(recentChapters, isSmoothChapter, SMOOTH_RUN_THRESHOLD).forEach((run) => alerts.push({
    code: 'too_smooth',
    severity: 'warning',
    title: '主角近期顺推过多',
    detail: `最近连续 ${run.length} 章几乎没有真正受挫或代价，建议补出失败、损失或现实阻力。`,
    chapterNums: run,
  }))
  collectRunChapterNums(recentChapters, isPressureChapter, PRESSURE_RUN_THRESHOLD).forEach((run) => alerts.push({
    code: 'long_oppression_without_reward',
    severity: 'blocker',
    title: '长期压抑无回报',
    detail: `最近连续 ${run.length} 章主角都在承压却没有阶段性回报，建议插入喘息、收获或反击兑现。`,
    chapterNums: run,
  }))
  const forcedReversalNums = recentChapters
    .filter((chapter) => chapter.dynamics.reversalMarker && chapter.dynamics.reversalSupportState === 'forced')
    .map((chapter) => chapter.chapterNum)
  if (forcedReversalNums.length > 0) {
    alerts.push({
      code: 'forced_reversal',
      severity: 'warning',
      title: '近期存在强行反转',
      detail: '这些章节出现了支撑不足的反转，建议补齐触发原因、铺垫回收和角色选择链。',
      chapterNums: forcedReversalNums,
    })
  }
  const evaporatedCosts = costState.allEntries.filter((entry) => (
    entry.status === 'evaporated'
    && recentChapterNums.includes(entry.endChapterNum || entry.startChapterNum)
  ))
  if (evaporatedCosts.length > 0) {
    alerts.push({
      code: 'cost_evaporation',
      severity: 'warning',
      title: '代价疑似蒸发',
      detail: `最近有 ${evaporatedCosts.length} 处重大代价在 1-2 章内被快速抹平，建议延续伤势、资源损耗或关系后果。`,
      chapterNums: dedupeChapterNums(evaporatedCosts.flatMap((entry) => [
        entry.startChapterNum,
        entry.endChapterNum || entry.startChapterNum,
      ])),
    })
  }
  const recentClimaxNums = recentChapters
    .filter((chapter) => chapter.dynamics.paceMarker === 'climax')
    .map((chapter) => chapter.chapterNum)
  const overcrowdedChapterNums = new Set<number>()
  for (let index = 1; index < recentClimaxNums.length; index += 1) {
    if (recentClimaxNums[index] - recentClimaxNums[index - 1] <= 2) {
      overcrowdedChapterNums.add(recentClimaxNums[index - 1])
      overcrowdedChapterNums.add(recentClimaxNums[index])
    }
  }
  if (overcrowdedChapterNums.size >= 2) {
    alerts.push({
      code: 'climax_overcrowded',
      severity: 'warning',
      title: '高潮分布过密',
      detail: '最近 3 章内重复堆叠高潮，容易让后续失去爬升空间，建议留出缓冲或收尾段。',
      chapterNums: Array.from(overcrowdedChapterNums).sort((left, right) => left - right),
    })
  }
  const allClimaxNums = orderedChapters
    .filter((chapter) => chapter.dynamics.paceMarker === 'climax')
    .map((chapter) => chapter.chapterNum)
  const latestChapterNum = orderedChapters[orderedChapters.length - 1]?.chapterNum || 0
  const latestClimaxNum = allClimaxNums[allClimaxNums.length - 1] || 0
  if (latestChapterNum > 0 && latestChapterNum - latestClimaxNum > CLIMAX_GAP_THRESHOLD) {
    alerts.push({
      code: 'climax_gap_too_long',
      severity: 'warning',
      title: '高潮间隔过长',
      detail: `已经连续 ${latestChapterNum - latestClimaxNum} 章没有高潮节点，建议尽快安排冲突兑现或阶段性爆发。`,
      chapterNums: latestClimaxNum > 0 ? [latestClimaxNum, latestChapterNum] : [latestChapterNum],
    })
  }
  return alerts.sort(sortStoryAlerts)
}
