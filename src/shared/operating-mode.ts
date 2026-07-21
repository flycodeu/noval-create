import type { NovelLaunchMode } from '../types'

export type NovelOperatingMode = 'shortform' | 'standard_longform' | 'epic_longform' | 'million_longform'

export interface OperatingModePolicy {
  mode: NovelOperatingMode
  label: string
  chapterWords: {
    /** 编辑参考范围，不是正文生成的硬性上下限。 */
    min: number
    max: number
    /** 用于估算章节数、场景密度和上下文预算的参考值。 */
    recommended: number
  }
  defaultSceneCountRange: [number, number]
  recentContextWindow: number
  checkpointScopes: Array<'novel' | 'volume' | 'part'>
  modeSummary: string
}

export interface OperatingModeRuntimePolicy {
  operatingMode: NovelOperatingMode
  label: string
  strategySummary: string
  chapterGenerationMode: 'serial_only'
  serialOnly: true
  backgroundPrecomputeEnabled: boolean
  requireWritebackReady: boolean
  recallPauseThreshold: number
  checkpointGapWarningThreshold: number
  mainThreadPressureStrategy: 'latency_first' | 'balanced' | 'stability_first'
}

export interface OperatingModeInput {
  launchMode?: NovelLaunchMode | string | null
  operatingMode?: NovelOperatingMode | string | null
  targetWords?: number | null
  chapterCount?: number | null
  manualLock?: boolean | null
  settingsJson?: string | null
}

const OPERATING_MODE_POLICIES: Record<NovelOperatingMode, OperatingModePolicy> = {
  shortform: {
    mode: 'shortform',
    label: '短篇',
    chapterWords: { min: 1000, max: 5000, recommended: 2400 },
    defaultSceneCountRange: [2, 4],
    recentContextWindow: 8,
    checkpointScopes: ['novel'],
    modeSummary: '低摩擦起稿，优先少步骤、少资产和快速进入正文。',
  },
  standard_longform: {
    mode: 'standard_longform',
    label: '标准长篇',
    chapterWords: { min: 1200, max: 7000, recommended: 3200 },
    defaultSceneCountRange: [4, 6],
    recentContextWindow: 10,
    checkpointScopes: ['novel', 'volume'],
    modeSummary: '保留完整长篇底盘，适合标准卷章式推进。',
  },
  epic_longform: {
    mode: 'epic_longform',
    label: '史诗长篇',
    chapterWords: { min: 1200, max: 8000, recommended: 3500 },
    defaultSceneCountRange: [3, 5],
    recentContextWindow: 22,
    checkpointScopes: ['novel', 'volume', 'part'],
    modeSummary: '阶段规划与长期记忆优先级提升，适合多卷长线推进。',
  },
  million_longform: {
    mode: 'million_longform',
    label: '百万字长篇',
    chapterWords: { min: 1000, max: 8000, recommended: 3200 },
    defaultSceneCountRange: [3, 5],
    recentContextWindow: 35,
    checkpointScopes: ['novel', 'volume', 'part'],
    modeSummary: '正文串行、预计算并行，强调长周期稳定与阶段检查点。',
  },
}

function normalizePositiveNumber(value?: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function asOperatingMode(value?: string | null): NovelOperatingMode | undefined {
  if (value === 'shortform' || value === 'standard_longform' || value === 'epic_longform' || value === 'million_longform') {
    return value
  }
  return undefined
}

function safeParseSettings(raw?: string | null): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function normalizeOperatingMode(value?: string | null): NovelOperatingMode | undefined {
  return asOperatingMode(value)
}

export function readOperatingModeLock(settingsJson?: string | null): { mode: NovelOperatingMode; locked: boolean } | null {
  const settings = safeParseSettings(settingsJson)
  const operatingMode = settings.operatingMode
  if (!operatingMode || typeof operatingMode !== 'object' || Array.isArray(operatingMode)) return null
  const record = operatingMode as Record<string, unknown>
  const mode = normalizeOperatingMode(typeof record.mode === 'string' ? record.mode : undefined)
  if (!mode) return null
  return {
    mode,
    locked: record.locked === true,
  }
}

export function writeOperatingModeSettings(
  settingsJson: string | undefined | null,
  mode: NovelOperatingMode,
  locked: boolean,
): string {
  const settings = safeParseSettings(settingsJson)
  settings.operatingMode = { mode, locked }
  return JSON.stringify(settings)
}

export function deriveOperatingMode(input: OperatingModeInput): NovelOperatingMode {
  const lock = readOperatingModeLock(input.settingsJson)
  if (lock?.locked) return lock.mode
  const explicit = asOperatingMode(input.operatingMode)
  if (explicit) return explicit

  const targetWords = normalizePositiveNumber(input.targetWords)
  const chapterCount = normalizePositiveNumber(input.chapterCount)
  const manualLock = input.manualLock === true
  const launchMode = input.launchMode || undefined

  if (targetWords >= 800000 || chapterCount >= 180) return 'million_longform'
  if (targetWords >= 350000 || chapterCount >= 80 || manualLock) return 'epic_longform'
  if (targetWords >= 120000 || launchMode === 'professional_longform') return 'standard_longform'
  return 'shortform'
}

export function getOperatingModePolicy(input: OperatingModeInput): OperatingModePolicy {
  return OPERATING_MODE_POLICIES[deriveOperatingMode(input)]
}

export function getOperatingModeRuntimePolicy(input: OperatingModeInput): OperatingModeRuntimePolicy {
  const policy = getOperatingModePolicy(input)
  if (policy.mode === 'shortform') {
    return {
      operatingMode: policy.mode,
      label: policy.label,
      strategySummary: policy.modeSummary,
      chapterGenerationMode: 'serial_only',
      serialOnly: true,
      backgroundPrecomputeEnabled: false,
      requireWritebackReady: true,
      recallPauseThreshold: 4,
      checkpointGapWarningThreshold: 12,
      mainThreadPressureStrategy: 'latency_first',
    }
  }
  if (policy.mode === 'standard_longform') {
    return {
      operatingMode: policy.mode,
      label: policy.label,
      strategySummary: policy.modeSummary,
      chapterGenerationMode: 'serial_only',
      serialOnly: true,
      backgroundPrecomputeEnabled: false,
      requireWritebackReady: true,
      recallPauseThreshold: 3,
      checkpointGapWarningThreshold: 10,
      mainThreadPressureStrategy: 'balanced',
    }
  }
  if (policy.mode === 'epic_longform') {
    return {
      operatingMode: policy.mode,
      label: policy.label,
      strategySummary: policy.modeSummary,
      chapterGenerationMode: 'serial_only',
      serialOnly: true,
      backgroundPrecomputeEnabled: true,
      requireWritebackReady: true,
      recallPauseThreshold: 3,
      checkpointGapWarningThreshold: 8,
      mainThreadPressureStrategy: 'stability_first',
    }
  }
  return {
    operatingMode: policy.mode,
    label: policy.label,
    strategySummary: policy.modeSummary,
    chapterGenerationMode: 'serial_only',
    serialOnly: true,
    backgroundPrecomputeEnabled: true,
    requireWritebackReady: true,
    recallPauseThreshold: 3,
    checkpointGapWarningThreshold: 6,
    mainThreadPressureStrategy: 'stability_first',
  }
}

export function estimateChapterCountFromOperatingMode(input: OperatingModeInput): number {
  const targetWords = normalizePositiveNumber(input.targetWords)
  const policy = getOperatingModePolicy(input)
  const estimated = targetWords > 0 ? Math.round(targetWords / policy.chapterWords.recommended) : 0
  const minimum = policy.mode === 'shortform' ? 12 : policy.mode === 'standard_longform' ? 24 : policy.mode === 'epic_longform' ? 80 : 180
  return Math.max(estimated, minimum)
}

export function getRecommendedChapterWordsForOperatingMode(input: OperatingModeInput): number {
  return getOperatingModePolicy(input).chapterWords.recommended
}

export function getRecentContextWindowForOperatingMode(input: OperatingModeInput): number {
  return getOperatingModePolicy(input).recentContextWindow
}

export function resolveOperatingMode(input: OperatingModeInput): NovelOperatingMode {
  return deriveOperatingMode(input)
}

export function getWorkspaceViewModeForNovel(
  novel: {
    launchMode?: NovelLaunchMode | string | null
    operatingMode?: NovelOperatingMode | string | null
    targetWords?: number | null
    settingsJson?: string | null
  } | null | undefined,
): 'quick' | 'professional' {
  const mode = deriveOperatingMode({
    launchMode: novel?.launchMode,
    operatingMode: novel?.operatingMode,
    targetWords: novel?.targetWords,
    settingsJson: novel?.settingsJson,
  })
  if (novel?.launchMode === 'fast_launch' && mode === 'shortform') return 'quick'
  return 'professional'
}

export function isHistoricalGenreUsingGenericFallback(genreName?: string | null, resolvedKey?: string | null): boolean {
  const genre = (genreName || '').trim()
  if (!genre) return false
  const looksHistorical = /历史|王朝|朝堂|宫廷|侯爵|帝国旧制|架空历史|史诗历史|类历史/u.test(genre)
  if (!looksHistorical) return false
  return (resolvedKey || '').trim() === 'generic'
}

export function getOperatingModeOptionsSummary(novel: {
  launchMode?: NovelLaunchMode | string | null
  operatingMode?: NovelOperatingMode | string | null
  targetWords?: number | null
  settingsJson?: string | null
} | null | undefined): string {
  const policy = getOperatingModePolicy({
    launchMode: novel?.launchMode,
    operatingMode: novel?.operatingMode,
    targetWords: novel?.targetWords,
    settingsJson: novel?.settingsJson,
  })
  return `${policy.label} · 参考 ${policy.chapterWords.recommended} 字/章（弹性） · 近期窗口 ${policy.recentContextWindow} 章`
}
