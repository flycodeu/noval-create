import type { UpstreamRuntimeArtifacts } from '../../src/types'
import {
  compileContextPack,
  type ContextPackCompileResult,
  type ContextPackStage,
  type ContextPackSource,
} from '../../src/shared/context-pack'
import type { ChapterContext, ChapterContextRawData } from './context.service'
import {
  getRecallSourceKey,
  isAcceptedRecallSource,
  isDeterministicRecallSource,
} from './context-recall-core'

export type ContextCompilerMode = 'legacy' | 'shadow' | 'active'

export class ContextCompilerStaleError extends Error {
  readonly code = 'NF_CONTEXT_STALE' as const

  constructor(message: string) {
    super(`NF_CONTEXT_STALE: ${message}`)
    this.name = 'ContextCompilerStaleError'
  }
}

export function resolveContextCompilerMode(value = process.env.NOVELFORGE_CONTEXT_COMPILER_MODE): ContextCompilerMode {
  if (value === undefined) return 'legacy'
  return value === 'shadow' || value === 'active' ? value : 'legacy'
}

const STAGE_VISIBILITY: Record<ContextPackStage, 'canon' | 'draft' | 'plan'> = {
  scenePlan: 'plan',
  draft: 'draft',
  review: 'draft',
  rewrite: 'draft',
  planning: 'plan',
}

const STRUCTURED_FIELDS = [
  'storyCore', 'currentArc', 'worldRules', 'characterStates', 'worldStates', 'mapSummary', 'itemSummary',
  'previousSummaries', 'previousChapterContext', 'lastChapterEnding', 'chapterBridgePlan', 'styleTemplate',
  'chapterGoal', 'continuitySummary', 'openLoops', 'dueForeshadows', 'continuityNotes', 'timelineSummary',
  'timelineOpenThreads', 'longTermMemory', 'activeThreads', 'writingContractSummary', 'relationSummary',
  'dialogueVoiceLocks', 'recalledMemory', 'scenePlanSummary', 'draftTextSummary', 'contractVersionSummary',
  'reviewRiskSummary', 'reviewProofSummary', 'rewriteDeltaSummary', 'publishGateRiskSummary', 'stepMemorySummary',
] as const

function addSource(sources: ContextPackSource[], source: Partial<ContextPackSource> & Pick<ContextPackSource, 'text'>): void {
  if (!source.text?.trim()) return
  sources.push({
    key: source.key || `legacy:${sources.length}`,
    sourceKind: source.sourceKind || 'legacy',
    sourceId: source.sourceId || source.key || `legacy:${sources.length}`,
    sourceVersion: source.sourceVersion || 'legacy',
    visibility: source.visibility || 'canon',
    text: source.text.trim(),
    required: source.required === true,
    included: source.included !== false,
    reason: source.reason || 'candidate',
    estimatedTokens: typeof source.estimatedTokens === 'number' && Number.isFinite(source.estimatedTokens) && source.estimatedTokens >= 0
      ? source.estimatedTokens
      : Math.max(1, Math.ceil(source.text.trim().length / 2)),
    ...(source.artifactHash ? { artifactHash: source.artifactHash } : {}),
  })
}

export function buildChapterContextSources(input: {
  rawContext: ChapterContextRawData
  context: ChapterContext
  stage: ContextPackStage
  upstreamArtifacts?: UpstreamRuntimeArtifacts
}): ContextPackSource[] {
  const { rawContext, context, stage, upstreamArtifacts = {} } = input
  const sourceVersion = `${rawContext.novel.contextVersion || 1}:${context.contractVersionSummary || ''}`
  const visibility = STAGE_VISIBILITY[stage]
  const sources: ContextPackSource[] = []
  const selectedRecallSources = (context.visibilityReport
    ? context.recalledMemorySources || []
    : rawContext.recalledMemorySources || [])
    .filter((source) => isAcceptedRecallSource(source))
    .filter((source) => (
      isDeterministicRecallSource(source) && source.required
    ) || Boolean(context.recalledMemory && context.recalledMemory.includes(source.summary)))
  const useGranularRecallSources = selectedRecallSources.some(isDeterministicRecallSource)
  context.hardConstraintEntries.forEach((entry) => addSource(sources, {
    key: `hard:${entry.label}`,
    sourceKind: 'hard_constraint',
    sourceId: entry.label,
    sourceVersion,
    visibility: 'canon',
    text: entry.content,
    required: true,
    reason: 'required_nf06',
    estimatedTokens: entry.allocatedTokens,
  }))
  context.softContextDecisions.forEach((decision) => {
    const field = STRUCTURED_FIELDS.find((candidate) => candidate === decision.label)
    const text = field ? context[field] : ''
    if (!text) return
    if (decision.label === 'recalledMemory' && useGranularRecallSources) return
    addSource(sources, {
      key: `part:${decision.label}`,
      sourceKind: decision.sourceKind || 'legacy',
      sourceId: decision.label,
      sourceVersion,
      visibility,
      text,
      required: decision.priority === 'hard',
      reason: decision.reason,
      estimatedTokens: decision.allocatedTokens || decision.originalTokens,
    })
  })
  if (useGranularRecallSources) {
    selectedRecallSources.forEach((source) => addSource(sources, {
      key: getRecallSourceKey(source),
      sourceKind: isDeterministicRecallSource(source) ? 'relation_recall' : 'recall_memory',
      sourceId: source.sourceKind === 'chapter'
        ? String(source.chapterId || source.sourceLabel)
        : `${source.semanticSourceType || 'semantic'}:${source.semanticSourceId || source.sourceLabel}`,
      sourceVersion: isDeterministicRecallSource(source)
        ? source.sourceVersion
        : `${sourceVersion}:${source.sourceKind === 'chapter' ? source.chapterNum || 0 : 'semantic'}`,
      visibility,
      text: source.summary,
      required: isDeterministicRecallSource(source) && source.required,
      reason: isDeterministicRecallSource(source) ? source.reason : 'recall_selected',
    }))
  }
  for (const [key, value] of Object.entries(upstreamArtifacts)) {
    if (typeof value !== 'string' || !value.trim()) continue
    const filteredValue = context.visibilityReport ? context[key as keyof ChapterContext] : value
    if (typeof filteredValue !== 'string' || !filteredValue.trim()) continue
    addSource(sources, {
      key: `artifact:${key}`,
      sourceKind: 'artifact',
      sourceId: key,
      sourceVersion,
      visibility,
      text: filteredValue,
      required: false,
      reason: 'upstream_artifact',
    })
  }
  const authorStyle = context.visibilityReport ? context.authorStyleMaterials : rawContext.authorStyleMaterials
  if (authorStyle?.targetWorkSampleGuide?.trim()) addSource(sources, {
    key: 'authorStyle:guide',
    sourceKind: 'author_style_material',
    sourceId: 'targetWorkSampleGuide',
    sourceVersion,
    visibility: 'canon',
    text: authorStyle.targetWorkSampleGuide,
    required: false,
    reason: 'author_supplied',
  })
  if (authorStyle?.humanStyleSampleLock?.trim()) addSource(sources, {
    key: 'authorStyle:sampleLock',
    sourceKind: 'author_style_material',
    sourceId: 'humanStyleSampleLock',
    sourceVersion,
    visibility: 'canon',
    text: authorStyle.humanStyleSampleLock,
    required: false,
    reason: 'author_supplied',
  })
  context.visibilityReport?.sources.forEach((source) => addSource(sources, source))
  return sources
}

export async function compileChapterContextPack(input: {
  rawContext: ChapterContextRawData
  context: ChapterContext
  stage: ContextPackStage
  modelProfile?: string
  contractVersion?: string
  templateVersion?: string
  upstreamArtifacts?: UpstreamRuntimeArtifacts
  mode?: ContextCompilerMode
  restoredPack?: import('../../src/shared/context-pack').ContextPackV1
}): Promise<ContextPackCompileResult> {
  const mode = input.mode || resolveContextCompilerMode()
  const novelId = input.rawContext.novel.id
  const chapterId = input.stage === 'planning' ? null : input.rawContext.currentChapter?.id || null
  const chapterNum = input.stage === 'planning' ? null : input.rawContext.currentChapter?.chapterNum || null
  const contextVersion = input.rawContext.novel.contextVersion || 1
  const contractVersion = input.contractVersion || input.context.contractVersionSummary || ''
  const modelProfile = input.modelProfile || input.stage
  const restored = input.restoredPack
  if (restored) {
    const sameIdentity = restored.schemaVersion === 1
      && restored.novelId === novelId
      && restored.chapterId === chapterId
      && restored.chapterNum === chapterNum
      && restored.stage === input.stage
      && restored.contextVersion === contextVersion
      && restored.contractVersion === contractVersion
      && restored.modelProfile === modelProfile
    if (sameIdentity) {
      return {
        pack: restored,
        rendered: restored.sources.filter((source) => source.included).map((source) => `[${source.visibility}] ${source.key}: ${source.text}`).join('\n'),
        diagnostics: {
          droppedOptional: restored.sources.filter((source) => !source.included && source.reason === 'budget_insufficient').map((source) => source.key),
          deduped: restored.sources.filter((source) => !source.included && source.reason === 'deduped_same_source').map((source) => source.key),
          requiredOverflow: false,
          requiredTokens: restored.sources.filter((source) => source.required).reduce((sum, source) => sum + source.estimatedTokens, 0),
          budget: input.context.contextBudgetReport.availableContextBudget,
        },
      }
    }
    if (mode === 'active') {
      throw new ContextCompilerStaleError('saved pack no longer matches the current chapter, contract, model profile, or context version')
    }
  }
  const sources = buildChapterContextSources(input)
  const report = input.context.contextBudgetReport
  return compileContextPack({
    novelId,
    chapterId,
    chapterNum,
    stage: input.stage,
    contextVersion,
    contractVersion,
    modelProfile,
    templateVersion: input.templateVersion,
    sources,
    budget: report.availableContextBudget,
    outputReserve: report.reservedForOutput,
  })
}
