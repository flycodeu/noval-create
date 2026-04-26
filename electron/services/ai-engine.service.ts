import type { ChatOptions } from '../adapters/base.adapter'
import {
  getAiExecutionModeLabel,
  normalizeAiExecutionMode,
  type AiExecutionMode,
  type AiTaskKind,
} from '../../src/shared/ai-execution'
import { parseStorySettingsDocument } from '../../src/shared/story-settings'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import type {
  AiContextAssemblyReport,
  AiExplainabilityReport,
  AiInferenceFact,
  AiModelRouteReport,
  AiStageExecutionReport,
  AuthorStyleLockSummary,
  WritingContextUsageSnapshot,
} from '../../src/types'
import {
  getDefaultModelConfigRecord,
  getModelConfigRecord,
  getProviderTokenSafetyMarginPct,
} from './model.service'
import { getLatestStyleFingerprintForNovel } from './style-analysis.service'

type AiModeResolutionSource = 'request_override' | 'global_default' | 'fallback_default'

interface AiExecutionModeResolution {
  mode: AiExecutionMode
  source: AiModeResolutionSource
}

const MODE_RUNTIME_PROFILES: Record<AiExecutionMode, {
  temperatureDelta: number
  maxTokensFactor: number
  contextStrategy: AiModelRouteReport['contextStrategy']
  reviewDepth: AiModelRouteReport['reviewDepth']
  reasons: string[]
}> = {
  fast: {
    temperatureDelta: -0.05,
    maxTokensFactor: 0.72,
    contextStrategy: 'trimmed',
    reviewDepth: 'lite',
    reasons: ['优先降低等待时间，压缩输出预算与审校深度。'],
  },
  balanced: {
    temperatureDelta: 0,
    maxTokensFactor: 1,
    contextStrategy: 'balanced',
    reviewDepth: 'standard',
    reasons: ['默认平衡模式，维持常规上下文覆盖与多轮检查。'],
  },
  premium: {
    temperatureDelta: -0.03,
    maxTokensFactor: 1.18,
    contextStrategy: 'max_coverage',
    reviewDepth: 'deep',
    reasons: ['优先关键章节质量，放宽输出预算并保留深度审校链。'],
  },
  review_first: {
    temperatureDelta: -0.12,
    maxTokensFactor: 1.05,
    contextStrategy: 'max_coverage',
    reviewDepth: 'deep',
    reasons: ['优先一致性和复检，主动压低采样波动。'],
  },
  cost_saver: {
    temperatureDelta: -0.08,
    maxTokensFactor: 0.58,
    contextStrategy: 'trimmed',
    reviewDepth: 'lite',
    reasons: ['优先控制成本，减少输出长度与链路深度。'],
  },
}

const TASK_MAX_TOKEN_FACTORS: Partial<Record<AiTaskKind, number>> = {
  chapter_planning: 0.62,
  chapter_generation: 1,
  chapter_review: 0.72,
  chapter_rewrite: 1.08,
  chapter_finalize: 0.4,
  outline_generation: 0.88,
  timeline_generation: 0.75,
  thread_generation: 0.75,
  revision_planning: 0.72,
  paragraph_rewrite: 0.38,
  workspace_repair: 0.82,
  generic_prompt: 0.8,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function dedupeStrings(values: Array<string | null | undefined>, limit = 12): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  values.forEach((value) => {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    if (result.length < limit) result.push(normalized)
  })
  return result
}

function splitTextHints(value?: string | null, limit = 6): string[] {
  if (!value) return []
  return dedupeStrings(
    value
      .split(/[\n；;、,，]/)
      .map((item) => item.trim())
      .filter(Boolean),
    limit,
  )
}

export function resolveAiExecutionMode(options: {
  explicitMode?: AiExecutionMode | null
  settingsJson?: string | null
  fallbackMode?: AiExecutionMode
}): AiExecutionModeResolution {
  const explicitMode = normalizeAiExecutionMode(options.explicitMode)
  if (explicitMode) {
    return {
      mode: explicitMode,
      source: 'request_override',
    }
  }

  const settingsMode = normalizeAiExecutionMode(parseStorySettingsDocument(options.settingsJson).aiEngine.defaultMode)
  if (settingsMode) {
    return {
      mode: settingsMode,
      source: 'global_default',
    }
  }

  return {
    mode: options.fallbackMode || 'balanced',
    source: 'fallback_default',
  }
}

export function buildAiModelRouteReport(options: {
  taskKind: AiTaskKind
  stageLabel: string
  executionMode: AiExecutionMode
  resolutionSource: AiModeResolutionSource
  modelConfigId?: number | null
  temperatureCap?: number
  contextStrategy?: AiModelRouteReport['contextStrategy']
  reviewDepth?: AiModelRouteReport['reviewDepth']
  maxTokensFactor?: number
  extraReasons?: string[]
}): AiModelRouteReport {
  const modeProfile = MODE_RUNTIME_PROFILES[options.executionMode]
  const config = typeof options.modelConfigId === 'number'
    ? getModelConfigRecord(options.modelConfigId)
    : getDefaultModelConfigRecord()
  const taskTokenFactor = TASK_MAX_TOKEN_FACTORS[options.taskKind] ?? 0.8
  const baseTemperature = typeof config.temperature === 'number' ? config.temperature : 0.8
  const taskTemperatureCap = typeof options.temperatureCap === 'number'
    ? options.temperatureCap
    : options.taskKind === 'chapter_review'
    ? 0.35
    : options.taskKind === 'chapter_rewrite' || options.taskKind === 'paragraph_rewrite'
      ? 0.55
      : 0.85
  const temperature = clamp(baseTemperature + modeProfile.temperatureDelta, 0, taskTemperatureCap)
  const baseMaxTokens = typeof config.maxTokens === 'number' && config.maxTokens > 0 ? Math.round(config.maxTokens) : 4096
  const tokenSafetyMarginPct = getProviderTokenSafetyMarginPct(config.provider)
  const routeMaxTokensFactor = typeof options.maxTokensFactor === 'number'
    ? options.maxTokensFactor
    : 1
  const maxTokens = Math.max(
    256,
    Math.round(baseMaxTokens * modeProfile.maxTokensFactor * taskTokenFactor * routeMaxTokensFactor * (1 - tokenSafetyMarginPct / 100)),
  )

  return {
    taskKind: options.taskKind,
    stageLabel: options.stageLabel,
    executionMode: options.executionMode,
    resolutionSource: options.resolutionSource,
    modelConfigId: config.id,
    modelLabel: `${config.provider}:${config.modelId}`,
    provider: config.provider,
    temperature,
    maxTokens,
    tokenSafetyMarginPct,
    contextStrategy: options.contextStrategy || modeProfile.contextStrategy,
    reviewDepth: options.reviewDepth || modeProfile.reviewDepth,
    reasons: dedupeStrings([
      ...modeProfile.reasons,
      options.resolutionSource === 'request_override' ? '本次调用采用局部覆盖模式。' : '',
      options.resolutionSource === 'global_default' ? '当前使用项目级默认 AI 模式。' : '',
      options.taskKind === 'chapter_review' ? '审校阶段主动限制采样波动，优先稳定诊断。' : '',
      options.taskKind === 'chapter_rewrite' ? '重写阶段保留较长输出预算，避免局部修复截断。' : '',
      `按 ${config.provider} 预留 ${tokenSafetyMarginPct}% token 安全余量。`,
      ...(options.extraReasons || []),
    ]),
  }
}

export function buildChatOptionsFromRoute(route: AiModelRouteReport): Partial<ChatOptions> {
  return {
    temperature: route.temperature,
    maxTokens: route.maxTokens,
  }
}

export function buildAiStageExecutionReport(options: {
  stageKey: string
  stageLabel: string
  taskKind: AiTaskKind
  executionMode: AiExecutionMode
  outputShape: AiStageExecutionReport['outputShape']
  summary: string
  route: AiModelRouteReport
}): AiStageExecutionReport {
  return {
    stageKey: options.stageKey,
    stageLabel: options.stageLabel,
    taskKind: options.taskKind,
    executionMode: options.executionMode,
    outputShape: options.outputShape,
    summary: options.summary,
    route: options.route,
  }
}

export function buildAuthorStyleLockSummary(novelId: number, themeVoiceJson?: string | null): AuthorStyleLockSummary {
  const latestFingerprint = getLatestStyleFingerprintForNovel(novelId)
  const themeVoice = parseThemeVoiceDocument(themeVoiceJson)
  const fingerprint = latestFingerprint?.fingerprint
  const hardRules = dedupeStrings([
    ...(fingerprint?.styleHardGuard?.hardRules || []),
    ...splitTextHints(themeVoice.styleRules, 4),
    ...splitTextHints(themeVoice.dialogueRules, 4),
    ...splitTextHints(themeVoice.descriptionRules, 4),
  ], 8)
  const preferredLexicon = dedupeStrings(
    Object.values(fingerprint?.wordFrequencyProfile || {})
      .flat()
      .slice(0, 12),
    6,
  )
  const forbiddenPatterns = dedupeStrings([
    ...(fingerprint?.forbiddenPatterns || []),
    ...splitTextHints(themeVoice.forbiddenPhrases, 6),
  ], 8)
  const toneKeywords = dedupeStrings([
    ...(fingerprint?.toneKeywords || []),
    ...splitTextHints(themeVoice.voiceKeywords, 6),
  ], 8)
  const enabled = Boolean(latestFingerprint || themeVoice.styleRules || themeVoice.dialogueRules || themeVoice.descriptionRules || themeVoice.forbiddenPhrases)

  return {
    enabled,
    sourceLabel: latestFingerprint?.record?.name || '主题与文风护栏',
    sentenceLengthHint: fingerprint?.avgSentenceLength ? `均句约 ${fingerprint.avgSentenceLength} 字` : undefined,
    dialogueRhythmHint: fingerprint?.dialogueLineRate ? `对白占比 ${fingerprint.dialogueLineRate}%` : themeVoice.dialogueRules || undefined,
    narrativeDensityHint: fingerprint?.descriptionDensity || (fingerprint?.abstractTokenDensity ? `抽象词密度上限 ${fingerprint.abstractTokenDensity}%` : undefined),
    paceHint: fingerprint?.paceProfile || themeVoice.styleRules || undefined,
    toneKeywords,
    preferredLexicon,
    forbiddenPatterns,
    hardRules,
  }
}

export function buildAiExplainabilityReport(options: {
  taskKind: AiTaskKind
  executionMode: AiExecutionMode
  usageSnapshot: WritingContextUsageSnapshot
  stageReports: AiStageExecutionReport[]
  contextAssemblyReport?: AiContextAssemblyReport
  authorStyleLock?: AuthorStyleLockSummary
  structuredOutputs?: string[]
  activePromptOverrideKeys?: string[]
}): AiExplainabilityReport {
  const inferredFacts: AiInferenceFact[] = [
    ...options.usageSnapshot.recentStateChanges.slice(0, 4).map((detail) => ({
      label: '近期状态变化',
      detail,
      confidence: 'medium' as const,
      source: 'state_writeback' as const,
      needsConfirmation: false,
    })),
    ...options.usageSnapshot.linkedImpacts.slice(0, 4).map((impact) => ({
      label: impact.targetLabel,
      detail: impact.impactReason,
      confidence: impact.resolutionStatus === 'pending' ? 'medium' as const : 'high' as const,
      source: 'impact_sync' as const,
      needsConfirmation: impact.resolutionStatus === 'pending',
    })),
  ]
  const lowConfidenceFacts: AiInferenceFact[] = options.usageSnapshot.ignoredConstraints.slice(0, 6).map((detail) => ({
    label: '被忽略或压缩的约束',
    detail,
    confidence: 'low' as const,
    source: 'constraint_gap' as const,
    needsConfirmation: true,
  }))

  return {
    taskKind: options.taskKind,
    executionMode: options.executionMode,
    routeSummary: options.stageReports.map((stage) => {
      const route = stage.route
      return `${stage.stageLabel}=${getAiExecutionModeLabel(route.executionMode)} / ${route.modelLabel} / ${route.reviewDepth}`
    }).concat(
      options.activePromptOverrideKeys && options.activePromptOverrideKeys.length > 0
        ? [`Prompt Override ${options.activePromptOverrideKeys.length} 项`]
        : [],
    ).join(' · '),
    structuredOutputs: dedupeStrings([
      ...(options.structuredOutputs || []),
      ...options.stageReports
        .filter((stage) => stage.outputShape !== 'text')
        .map((stage) => `${stage.stageLabel} 使用 ${stage.outputShape.toUpperCase()} 输出`),
    ], 8),
    activePromptOverrideKeys: dedupeStrings(options.activePromptOverrideKeys || [], 8),
    usedAssets: options.usageSnapshot.usedAssets,
    usedContracts: options.usageSnapshot.usedContracts,
    ignoredConstraints: options.usageSnapshot.ignoredConstraints,
    inferredFacts,
    lowConfidenceFacts,
    stageReports: options.stageReports,
    contextAssemblyReport: options.contextAssemblyReport,
    authorStyleLock: options.authorStyleLock,
  }
}
