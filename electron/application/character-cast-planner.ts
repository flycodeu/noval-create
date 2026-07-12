import { randomUUID } from 'node:crypto'
import type {
  CharacterCastDeterministicCheck,
  CharacterCastDimensionScores,
  CharacterCastExistingAction,
  CharacterCastMergeGroup,
  CharacterCastPlanReview,
  CharacterCastRecommendation,
  CharacterNeedsAnalysisInput,
  CharacterNeedsAnalysisResult,
  CharacterNeedRoleSlot,
  CharacterRoleAction,
  CharacterRoleCoverage,
} from '../../src/shared/character-cast-planning'
import type { AiExecutionMode } from '../../src/shared/ai-execution'
import { normalizeAiExecutionMode } from '../../src/shared/ai-execution'
import { safeParseJson } from '../utils/json'

const CORE_FUNCTION_KEYS = [
  'pov_anchor',
  'desire_driver',
  'primary_resistance',
  'value_mirror',
  'information_gatekeeper',
  'resource_interface',
  'emotional_pivot',
  'foreshadow_payoff',
  'world_rule_expositor',
  'endgame_witness',
] as const

export interface CharacterCastContextCharacter {
  id: number
  name: string
  roleType: string
  recordStatus: string
  species: string
  occupation: string
  goals: string
  dramaticEngine: string
  characterArc: string
  relationshipTension: string
  appearChapter: number | null
}

export interface CharacterCastContextEvidence {
  ref: string
  kind: 'novel' | 'volume' | 'chapter' | 'thread' | 'faction' | 'resistance' | 'item'
  title: string
  summary: string
}

export interface CharacterCastCoveragePrior {
  functionKey: string
  function: string
  initialCoverage: 'covered' | 'partial' | 'unknown'
  candidateCharacterIds: number[]
  reason: string
}

export interface CharacterCastPlanningContext {
  novelId: number
  novelTitle: string
  genre: string
  operatingMode: string
  targetWords: number
  contextVersion: number
  modelConfigId?: number
  scopeSummary: string
  profile: {
    premise: string
    storyDesign: string
    endgame: string
    worldRules: string
    storyThreads: string
    writingRules: string
  }
  existingCharacters: CharacterCastContextCharacter[]
  existingCount: number
  priorRange: {
    min: number
    suggested: number
    max: number
    rationale: string
  }
  coveragePrior: CharacterCastCoveragePrior[]
  evidence: CharacterCastContextEvidence[]
}

export interface CharacterCastModelRequest {
  phase: 'plan' | 'review'
  novelId: number
  modelConfigId?: number
  executionMode: AiExecutionMode
  prompt: string
}

export interface CharacterCastModelResult {
  taskId: number
  output: string
}

export interface CharacterCastPlannerDependencies {
  loadContext: (input: CharacterNeedsAnalysisInput) => Promise<CharacterCastPlanningContext>
  runModel: (request: CharacterCastModelRequest) => Promise<CharacterCastModelResult>
  createPlanId?: () => string
}

export class CharacterCastPlanningError extends Error {
  readonly code: string
  readonly detail?: string

  constructor(code: string, message: string, detail?: string) {
    super(message)
    this.name = 'CharacterCastPlanningError'
    this.code = code
    this.detail = detail
  }
}

interface NormalizedConstraints {
  maxNewCharacters: number
  allowMergeExisting: boolean
  allowArchiveExisting: boolean
  requiredRoleTypes: string[]
}

interface NormalizedPlannerInput extends CharacterNeedsAnalysisInput {
  scope: NonNullable<CharacterNeedsAnalysisInput['scope']>
  goals: string[]
  constraints: NormalizedConstraints
  executionMode: AiExecutionMode
}

interface NormalizedPlan {
  scopeSummary: string
  existingActions: CharacterCastExistingAction[]
  mergeGroups: CharacterCastMergeGroup[]
  roleSlots: CharacterNeedRoleSlot[]
  recommended: CharacterCastRecommendation
  risks: string[]
  assumptions: string[]
}

const EMPTY_DIMENSION_SCORES: CharacterCastDimensionScores = {
  necessity: 0,
  causality: 0,
  worldFit: 0,
  tension: 0,
  differentiation: 0,
  writability: 0,
  growthSpace: 0,
  entranceFeasibility: 0,
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clamp(asFiniteNumber(value, fallback), min, max))
}

function uniqueStrings(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  const seen = new Set<string>()
  value.forEach((item) => {
    const normalized = asString(item)
    if (!normalized || seen.has(normalized) || result.length >= limit) return
    seen.add(normalized)
    result.push(normalized)
  })
  return result
}

function uniquePositiveIds(value: unknown, allowed?: Set<number>, limit = 80): number[] {
  if (!Array.isArray(value)) return []
  const result: number[] = []
  const seen = new Set<number>()
  value.forEach((item) => {
    const candidate = typeof item === 'number' ? item : Number(item)
    if (!Number.isInteger(candidate) || candidate <= 0 || seen.has(candidate)) return
    if (allowed && !allowed.has(candidate)) return
    seen.add(candidate)
    if (result.length < limit) result.push(candidate)
  })
  return result
}

function normalizeCoverage(value: unknown): CharacterRoleCoverage {
  return value === 'covered'
    || value === 'partial'
    || value === 'missing'
    || value === 'overloaded'
    || value === 'redundant'
    ? value
    : 'missing'
}

function normalizeAction(value: unknown, fallback: CharacterRoleAction): CharacterRoleAction {
  return value === 'keep'
    || value === 'update'
    || value === 'merge'
    || value === 'create'
    || value === 'archive'
    ? value
    : fallback
}

function normalizeInput(input: CharacterNeedsAnalysisInput): NormalizedPlannerInput {
  if (!Number.isInteger(input?.novelId) || input.novelId <= 0) {
    throw new CharacterCastPlanningError('VALIDATION_FAILED', 'novelId 必须是正整数。')
  }

  const scopeType = input.scope?.type === 'volume' ? 'volume' : 'novel'
  const volumeId = input.scope?.volumeId
  if (scopeType === 'volume' && (!Number.isInteger(volumeId) || Number(volumeId) <= 0)) {
    throw new CharacterCastPlanningError('VALIDATION_FAILED', 'volume scope 必须提供有效的 volumeId。')
  }

  const goals = uniqueStrings(input.goals, 10)
  const requiredRoleTypes = uniqueStrings(input.constraints?.requiredRoleTypes, 16)
  const executionMode = normalizeAiExecutionMode(input.executionMode) || 'balanced'

  return {
    ...input,
    scope: {
      type: scopeType,
      ...(scopeType === 'volume' ? { volumeId: Number(volumeId) } : {}),
      ...(typeof input.scope?.lookaheadChapters === 'number'
        ? { lookaheadChapters: clampInt(input.scope.lookaheadChapters, 1, 100, 20) }
        : {}),
    },
    goals,
    constraints: {
      maxNewCharacters: clampInt(input.constraints?.maxNewCharacters, 0, 30, 8),
      allowMergeExisting: input.constraints?.allowMergeExisting !== false,
      allowArchiveExisting: input.constraints?.allowArchiveExisting === true,
      requiredRoleTypes,
    },
    executionMode,
    ...(typeof input.modelConfigId === 'number' && Number.isInteger(input.modelConfigId) && input.modelConfigId > 0
      ? { modelConfigId: input.modelConfigId }
      : {}),
  }
}

function buildPlanningPrompt(input: NormalizedPlannerInput, context: CharacterCastPlanningContext): string {
  const promptContext = {
    project: {
      novelId: context.novelId,
      title: context.novelTitle,
      genre: context.genre,
      operatingMode: context.operatingMode,
      targetWords: context.targetWords,
      contextVersion: context.contextVersion,
    },
    scope: context.scopeSummary,
    goals: input.goals,
    constraints: input.constraints,
    priorRange: context.priorRange,
    profile: context.profile,
    existingCharacters: context.existingCharacters,
    existingCount: context.existingCount,
    deterministicCoveragePrior: context.coveragePrior,
    evidence: context.evidence,
  }

  return [
    '你是 NovelForge 的人物生态规划器。你的任务不是按固定配额凑人数，而是逐个验证叙事功能位。',
    '先判断功能能否由现有人物承担；只有不可兼任且有上下文证据时才建议新增人物。',
    '',
    '【上下文快照】',
    JSON.stringify(promptContext, null, 2),
    '',
    '【必须分析的核心功能】',
    CORE_FUNCTION_KEYS.join(', '),
    '',
    '【决策规则】',
    '1. existingActions 必须覆盖上下文中列出的每位现有人物；未变化者也写 keep。',
    '2. create 只能用于 coverage=missing/partial 且不能合理兼任的功能位，并给出具体 independenceReason。',
    '3. evidenceRefs 只能引用上下文 evidence.ref；禁止虚构章节、线程或角色 ID。',
    `4. create 功能位总数不得超过 ${input.constraints.maxNewCharacters}。`,
    `5. 合并现有人物：${input.constraints.allowMergeExisting ? '允许，但需说明保留谁以及合并损失' : '不允许'}。`,
    `6. 归档现有人物：${input.constraints.allowArchiveExisting ? '允许，但必须证明后续无不可替代功能' : '不允许'}。`,
    '7. priorRange 只是题材与篇幅先验，不是目标配额；可低于或高于 suggested，但必须解释风险。',
    '8. 不写完整人物卡，不新增小说事实，只输出人物生态计划。',
    '',
    '【输出 JSON】',
    '{',
    '  "scopeSummary": "字符串",',
    '  "existingActions": [{"characterId": 1, "action": "keep|update|merge|archive", "rationale": "字符串", "targetedChanges": ["字符串"]}],',
    '  "mergeGroups": [{"characterIds": [1,2], "survivorCharacterId": 1, "rationale": "字符串"}],',
    '  "roleSlots": [{',
    '    "slotId": "稳定短标识", "functionKey": "功能键", "function": "具体叙事职责",',
    '    "coverage": "covered|partial|missing|overloaded|redundant", "coveredByCharacterIds": [1],',
    '    "mustBeIndependent": false, "independenceReason": "字符串", "evidenceRefs": ["thread:3"],',
    '    "proposedAction": "keep|update|merge|create|archive", "proposedRoleType": "protagonist|major|antagonist|supporting|minor",',
    '    "firstAppearanceWindow": "字符串", "priority": 1',
    '  }],',
    '  "confidence": 0.0, "risks": ["字符串"], "assumptions": ["字符串"]',
    '}',
    '只输出合法 JSON 对象，不要 Markdown，不要解释。',
  ].join('\n')
}

function normalizeExistingActions(
  raw: unknown,
  context: CharacterCastPlanningContext,
  constraints: NormalizedConstraints,
): CharacterCastExistingAction[] {
  const byId = new Map(context.existingCharacters.map((character) => [character.id, character]))
  const provided = new Map<number, CharacterCastExistingAction>()

  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      const record = asRecord(item)
      const characterId = asFiniteNumber(record.characterId)
      const character = byId.get(characterId)
      if (!character || provided.has(characterId)) return
      let action = normalizeAction(record.action, 'keep')
      if (action === 'create') action = 'keep'
      if (action === 'archive' && !constraints.allowArchiveExisting) action = 'keep'
      if (action === 'merge' && !constraints.allowMergeExisting) action = 'update'
      provided.set(characterId, {
        characterId,
        characterName: character.name,
        action,
        rationale: asString(record.rationale, action === 'keep' ? '当前功能继续保留。' : '模型未提供充分理由。'),
        targetedChanges: uniqueStrings(record.targetedChanges, 8),
      })
    })
  }

  return context.existingCharacters.map((character) => provided.get(character.id) || {
    characterId: character.id,
    characterName: character.name,
    action: 'keep',
    rationale: '模型未提出变更，按保守策略保留。',
    targetedChanges: [],
  })
}

function normalizeMergeGroups(
  raw: unknown,
  context: CharacterCastPlanningContext,
  constraints: NormalizedConstraints,
): CharacterCastMergeGroup[] {
  if (!constraints.allowMergeExisting || !Array.isArray(raw)) return []
  const byId = new Map(context.existingCharacters.map((character) => [character.id, character]))
  const allowedIds = new Set(byId.keys())
  const alreadyMerged = new Set<number>()
  const groups: CharacterCastMergeGroup[] = []

  raw.forEach((item) => {
    const record = asRecord(item)
    const characterIds = uniquePositiveIds(record.characterIds, allowedIds, 8)
      .filter((id) => !alreadyMerged.has(id))
    if (characterIds.length < 2) return
    const requestedSurvivor = asFiniteNumber(record.survivorCharacterId)
    const survivorCharacterId = characterIds.includes(requestedSurvivor) ? requestedSurvivor : characterIds[0]
    characterIds.forEach((id) => alreadyMerged.add(id))
    groups.push({
      characterIds,
      characterNames: characterIds.map((id) => byId.get(id)?.name || `#${id}`),
      rationale: asString(record.rationale, '功能重叠，建议人工复核后合并。'),
      survivorCharacterId,
    })
  })

  return groups.slice(0, 10)
}

function normalizeRoleSlots(
  raw: unknown,
  context: CharacterCastPlanningContext,
  constraints: NormalizedConstraints,
): CharacterNeedRoleSlot[] {
  if (!Array.isArray(raw)) return []
  const existingIds = new Set(context.existingCharacters.map((character) => character.id))
  const allowedEvidence = new Set(context.evidence.map((item) => item.ref))
  const fallbackEvidence = `novel:${context.novelId}`
  const seenSlotIds = new Set<string>()

  return raw.slice(0, 50).map((item, index) => {
    const record = asRecord(item)
    const functionKey = asString(record.functionKey, `custom_${index + 1}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gu, '_')
      .replace(/^_+|_+$/gu, '') || `custom_${index + 1}`
    let slotId = asString(record.slotId, `${functionKey}-${index + 1}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || `slot-${index + 1}`
    if (seenSlotIds.has(slotId)) slotId = `${slotId}-${index + 1}`
    seenSlotIds.add(slotId)

    const coverage = normalizeCoverage(record.coverage)
    const coveredByCharacterIds = uniquePositiveIds(record.coveredByCharacterIds, existingIds)
    let proposedAction = normalizeAction(record.proposedAction, coverage === 'missing' ? 'create' : 'keep')
    if (proposedAction === 'archive' && !constraints.allowArchiveExisting) proposedAction = 'keep'
    if (proposedAction === 'merge' && !constraints.allowMergeExisting) proposedAction = 'update'
    const evidenceRefs = uniqueStrings(record.evidenceRefs, 12).filter((ref) => allowedEvidence.has(ref))

    return {
      slotId,
      functionKey,
      function: asString(record.function, functionKey),
      coverage,
      coveredByCharacterIds,
      mustBeIndependent: asBoolean(record.mustBeIndependent, proposedAction === 'create'),
      independenceReason: asString(record.independenceReason),
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : [fallbackEvidence],
      proposedAction,
      proposedRoleType: asString(record.proposedRoleType, 'supporting'),
      firstAppearanceWindow: asString(record.firstAppearanceWindow, '由后续卷章计划确定'),
      priority: clampInt(record.priority, 1, 100, 50),
    }
  })
}

function buildRecommendation(
  rawPlan: Record<string, unknown>,
  existingActions: CharacterCastExistingAction[],
  mergeGroups: CharacterCastMergeGroup[],
  roleSlots: CharacterNeedRoleSlot[],
  existingCount: number,
): CharacterCastRecommendation {
  const archived = new Set(existingActions.filter((item) => item.action === 'archive').map((item) => item.characterId))
  const mergedAway = new Set<number>()
  mergeGroups.forEach((group) => group.characterIds.forEach((id) => {
    if (id !== group.survivorCharacterId) mergedAway.add(id)
  }))
  const create = roleSlots.filter((slot) => slot.proposedAction === 'create').length
  const activeCastAfterCommit = Math.max(0, existingCount - new Set([...archived, ...mergedAway]).size + create)

  return {
    keep: existingActions.filter((item) => item.action === 'keep').length,
    update: existingActions.filter((item) => item.action === 'update').length,
    mergeGroups: mergeGroups.length,
    create,
    archive: archived.size,
    activeCastAfterCommit,
    confidence: Math.round(clamp(asFiniteNumber(rawPlan.confidence, 0.5), 0, 1) * 100) / 100,
  }
}

function parsePlan(
  raw: string,
  context: CharacterCastPlanningContext,
  constraints: NormalizedConstraints,
): NormalizedPlan {
  let parsed: Record<string, unknown>
  try {
    parsed = asRecord(safeParseJson<unknown>(raw))
  } catch (error) {
    throw new CharacterCastPlanningError(
      'MODEL_OUTPUT_INVALID',
      '人物需求分析模型没有返回可解析的 JSON。',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (Object.keys(parsed).length === 0) {
    throw new CharacterCastPlanningError('MODEL_OUTPUT_INVALID', '人物需求分析模型返回了空对象。')
  }

  const existingActions = normalizeExistingActions(parsed.existingActions, context, constraints)
  const mergeGroups = normalizeMergeGroups(parsed.mergeGroups, context, constraints)
  const mergeIds = new Set(mergeGroups.flatMap((group) => group.characterIds))
  existingActions.forEach((action) => {
    if (mergeIds.has(action.characterId)) action.action = 'merge'
  })
  const roleSlots = normalizeRoleSlots(parsed.roleSlots, context, constraints)

  return {
    scopeSummary: asString(parsed.scopeSummary, context.scopeSummary),
    existingActions,
    mergeGroups,
    roleSlots,
    recommended: buildRecommendation(parsed, existingActions, mergeGroups, roleSlots, context.existingCount),
    risks: uniqueStrings(parsed.risks, 16),
    assumptions: uniqueStrings(parsed.assumptions, 16),
  }
}

function runDeterministicChecks(
  plan: NormalizedPlan,
  input: NormalizedPlannerInput,
  context: CharacterCastPlanningContext,
): CharacterCastDeterministicCheck[] {
  const checks: CharacterCastDeterministicCheck[] = []
  const push = (code: string, status: CharacterCastDeterministicCheck['status'], message: string) => {
    checks.push({ code, status, message })
  }

  push(
    'existing_action_coverage',
    plan.existingActions.length === context.existingCount ? 'pass' : 'fail',
    plan.existingActions.length === context.existingCount
      ? `已覆盖全部 ${context.existingCount} 位现有人物。`
      : `现有人物决策覆盖 ${plan.existingActions.length}/${context.existingCount}。`,
  )
  push(
    'new_character_cap',
    plan.recommended.create <= input.constraints.maxNewCharacters ? 'pass' : 'fail',
    `建议新增 ${plan.recommended.create} 位；本次上限 ${input.constraints.maxNewCharacters} 位。`,
  )
  push(
    'role_slot_presence',
    plan.roleSlots.length > 0 ? 'pass' : 'fail',
    plan.roleSlots.length > 0 ? `已分析 ${plan.roleSlots.length} 个功能位。` : '没有返回任何功能位分析。',
  )

  const analyzedCore = new Set(plan.roleSlots.map((slot) => slot.functionKey))
  const missingCore = CORE_FUNCTION_KEYS.filter((key) => !analyzedCore.has(key))
  push(
    'core_function_coverage',
    missingCore.length <= 2 ? 'pass' : 'warn',
    missingCore.length === 0
      ? '十类核心叙事功能均已分析。'
      : `尚未显式分析：${missingCore.join('、')}。`,
  )

  const missingRequired = input.constraints.requiredRoleTypes.filter((required) => {
    const normalized = required.toLowerCase()
    return !plan.roleSlots.some((slot) => (
      slot.functionKey.toLowerCase() === normalized
      || slot.proposedRoleType.toLowerCase() === normalized
      || slot.function.toLowerCase().includes(normalized)
    ))
  })
  push(
    'required_role_types',
    missingRequired.length === 0 ? 'pass' : 'fail',
    missingRequired.length === 0 ? '用户指定功能位均已覆盖。' : `缺少用户指定功能位：${missingRequired.join('、')}。`,
  )

  const invalidMissing = plan.roleSlots.filter((slot) => (
    slot.coverage === 'missing'
    && slot.proposedAction !== 'create'
    && slot.proposedAction !== 'archive'
  ))
  push(
    'missing_slot_resolution',
    invalidMissing.length === 0 ? 'pass' : 'fail',
    invalidMissing.length === 0
      ? '所有缺失功能位都有可执行处理。'
      : `缺失功能位未得到有效处理：${invalidMissing.map((slot) => slot.slotId).join('、')}。`,
  )

  const unjustifiedCreates = plan.roleSlots.filter((slot) => (
    slot.proposedAction === 'create'
    && (!slot.mustBeIndependent || !slot.independenceReason.trim())
  ))
  push(
    'create_necessity',
    unjustifiedCreates.length === 0 ? 'pass' : 'fail',
    unjustifiedCreates.length === 0
      ? '每个新增人物功能位都说明了独立成角必要性。'
      : `新增必要性不足：${unjustifiedCreates.map((slot) => slot.slotId).join('、')}。`,
  )

  const hasExistingProtagonist = context.existingCharacters.some((character) => character.roleType === 'protagonist')
  const proposesProtagonist = plan.roleSlots.some((slot) => (
    slot.proposedRoleType === 'protagonist'
    && (slot.proposedAction === 'create' || slot.coveredByCharacterIds.length > 0)
  ))
  push(
    'pov_anchor',
    hasExistingProtagonist || proposesProtagonist ? 'pass' : 'fail',
    hasExistingProtagonist || proposesProtagonist ? '存在明确的主角/POV 锚点。' : '没有现有或建议的主角/POV 锚点。',
  )

  const outOfPrior = plan.recommended.activeCastAfterCommit < context.priorRange.min
    || plan.recommended.activeCastAfterCommit > context.priorRange.max
  push(
    'prior_range',
    outOfPrior ? 'warn' : 'pass',
    outOfPrior
      ? `提交后活跃人物 ${plan.recommended.activeCastAfterCommit} 位，超出先验范围 ${context.priorRange.min}-${context.priorRange.max}；需以功能证据解释。`
      : `提交后活跃人物 ${plan.recommended.activeCastAfterCommit} 位，位于先验范围内。`,
  )

  const weakEvidence = plan.roleSlots.filter((slot) => (
    slot.proposedAction === 'create'
    && slot.evidenceRefs.every((ref) => ref === `novel:${context.novelId}`)
  ))
  push(
    'create_evidence',
    weakEvidence.length === 0 ? 'pass' : 'warn',
    weakEvidence.length === 0
      ? '新增功能位均有细粒度上下文证据。'
      : `这些新增功能位只有项目级证据：${weakEvidence.map((slot) => slot.slotId).join('、')}。`,
  )

  return checks
}

function buildDeterministicReview(checks: CharacterCastDeterministicCheck[]): CharacterCastPlanReview {
  const hardBlockers = checks.filter((check) => check.status === 'fail').map((check) => check.message)
  const warnings = checks.filter((check) => check.status === 'warn').map((check) => check.message)
  const score = clamp(100 - hardBlockers.length * 18 - warnings.length * 6, 0, 100)
  return {
    mode: 'deterministic',
    status: hardBlockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'needs_revision' : 'passed',
    score,
    summary: hardBlockers.length > 0
      ? `规则审校发现 ${hardBlockers.length} 个硬阻塞。`
      : warnings.length > 0
        ? `规则审校通过硬门，但有 ${warnings.length} 项需复核。`
        : '规则审校通过。',
    hardBlockers,
    warnings,
    revisionSuggestions: [...hardBlockers, ...warnings].slice(0, 10),
    dimensionScores: { ...EMPTY_DIMENSION_SCORES },
  }
}

function buildReviewPrompt(
  input: NormalizedPlannerInput,
  context: CharacterCastPlanningContext,
  plan: NormalizedPlan,
  checks: CharacterCastDeterministicCheck[],
): string {
  return [
    '你是独立的人物生态审校员。请审查人物计划，不要替规划器辩护，也不要生成完整人物卡。',
    '',
    '【项目摘要】',
    JSON.stringify({
      novelId: context.novelId,
      genre: context.genre,
      scope: context.scopeSummary,
      goals: input.goals,
      constraints: input.constraints,
      priorRange: context.priorRange,
      profile: context.profile,
      existingCharacters: context.existingCharacters,
      evidence: context.evidence,
    }, null, 2),
    '',
    '【待审计划】',
    JSON.stringify(plan, null, 2),
    '',
    '【确定性检查】',
    JSON.stringify(checks, null, 2),
    '',
    '【量表】',
    '分别从 necessity、causality、worldFit、tension、differentiation、writability、growthSpace、entranceFeasibility 八项按 0-100 评分。',
    '删除后没有不可替代损失、动机链断裂、违反世界规则、关系只有标签、与现有人物同构、无法落到场景、弧线与终局冲突、没有合理出场窗口，均可构成硬阻塞。',
    '任何确定性 fail 必须保留为 hardBlocker；不能用主观高分覆盖规则硬门。',
    '',
    '【输出 JSON】',
    '{"score":0,"summary":"字符串","hardBlockers":["字符串"],"warnings":["字符串"],"revisionSuggestions":["字符串"],"dimensionScores":{"necessity":0,"causality":0,"worldFit":0,"tension":0,"differentiation":0,"writability":0,"growthSpace":0,"entranceFeasibility":0}}',
    '只输出合法 JSON 对象，不要 Markdown，不要解释。',
  ].join('\n')
}

function normalizeDimensionScores(value: unknown): CharacterCastDimensionScores {
  const record = asRecord(value)
  return {
    necessity: clampInt(record.necessity, 0, 100, 0),
    causality: clampInt(record.causality, 0, 100, 0),
    worldFit: clampInt(record.worldFit, 0, 100, 0),
    tension: clampInt(record.tension, 0, 100, 0),
    differentiation: clampInt(record.differentiation, 0, 100, 0),
    writability: clampInt(record.writability, 0, 100, 0),
    growthSpace: clampInt(record.growthSpace, 0, 100, 0),
    entranceFeasibility: clampInt(record.entranceFeasibility, 0, 100, 0),
  }
}

function mergeUnique(left: string[], right: string[], limit = 20): string[] {
  return uniqueStrings([...left, ...right], limit)
}

function parseModelReview(raw: string, deterministic: CharacterCastPlanReview): CharacterCastPlanReview {
  let parsed: Record<string, unknown>
  try {
    parsed = asRecord(safeParseJson<unknown>(raw))
  } catch (error) {
    return {
      ...deterministic,
      warnings: mergeUnique(deterministic.warnings, [
        `模型审校输出不可解析，已退回确定性审校：${error instanceof Error ? error.message : String(error)}`,
      ]),
      revisionSuggestions: mergeUnique(deterministic.revisionSuggestions, ['重新运行模型审校。']),
    }
  }

  const score = clampInt(parsed.score, 0, 100, deterministic.score)
  const hardBlockers = mergeUnique(deterministic.hardBlockers, uniqueStrings(parsed.hardBlockers, 16))
  const warnings = mergeUnique(deterministic.warnings, uniqueStrings(parsed.warnings, 16))
  const revisionSuggestions = mergeUnique(
    deterministic.revisionSuggestions,
    uniqueStrings(parsed.revisionSuggestions, 16),
  )
  const status = hardBlockers.length > 0
    ? 'blocked'
    : score < 75 || warnings.length > 0
      ? 'needs_revision'
      : 'passed'

  return {
    mode: 'model',
    status,
    score,
    summary: asString(parsed.summary, deterministic.summary),
    hardBlockers,
    warnings,
    revisionSuggestions,
    dimensionScores: normalizeDimensionScores(parsed.dimensionScores),
  }
}

export async function analyzeCharacterNeeds(
  input: CharacterNeedsAnalysisInput,
  dependencies: CharacterCastPlannerDependencies,
): Promise<CharacterNeedsAnalysisResult> {
  const normalizedInput = normalizeInput(input)
  const context = await dependencies.loadContext(normalizedInput)
  if (context.novelId !== normalizedInput.novelId) {
    throw new CharacterCastPlanningError('CONTEXT_MISMATCH', '人物规划上下文与请求项目不一致。')
  }

  const planRun = await dependencies.runModel({
    phase: 'plan',
    novelId: normalizedInput.novelId,
    modelConfigId: normalizedInput.modelConfigId || context.modelConfigId,
    executionMode: normalizedInput.executionMode,
    prompt: buildPlanningPrompt(normalizedInput, context),
  })
  const plan = parsePlan(planRun.output, context, normalizedInput.constraints)
  const deterministicChecks = runDeterministicChecks(plan, normalizedInput, context)
  const deterministicReview = buildDeterministicReview(deterministicChecks)

  let reviewTaskId: number | null = null
  let review = deterministicReview
  if (normalizedInput.executionMode !== 'fast' && normalizedInput.executionMode !== 'cost_saver') {
    const reviewRun = await dependencies.runModel({
      phase: 'review',
      novelId: normalizedInput.novelId,
      modelConfigId: normalizedInput.modelConfigId || context.modelConfigId,
      executionMode: normalizedInput.executionMode,
      prompt: buildReviewPrompt(normalizedInput, context, plan, deterministicChecks),
    })
    reviewTaskId = reviewRun.taskId
    review = parseModelReview(reviewRun.output, deterministicReview)
  }

  return {
    planId: (dependencies.createPlanId || (() => `castplan_${randomUUID()}`))(),
    taskId: planRun.taskId,
    reviewTaskId,
    scopeSummary: plan.scopeSummary,
    existingCount: context.existingCount,
    priorRange: { ...context.priorRange },
    recommended: plan.recommended,
    existingActions: plan.existingActions,
    mergeGroups: plan.mergeGroups,
    roleSlots: plan.roleSlots,
    review,
    deterministicChecks,
    risks: plan.risks,
    assumptions: plan.assumptions,
    contextVersion: context.contextVersion,
  }
}

