import type { CharacterNeedsAnalysisResult } from '../../src/shared/character-cast-planning'
import type {
  CharacterCommitDiffContent,
  CharacterDraftCard,
  CharacterDraftContent,
  CharacterDraftReviewCheck,
  CharacterDraftReviewContent,
  CommitCharacterDraftInput,
  CommitCharacterDraftResult,
  GenerateCharacterDraftInput,
  GenerateCharacterDraftResult,
  ReviewCharacterDraftInput,
} from '../../src/shared/character-draft-workflow'
import { getSqlite } from '../database/db'
import {
  createArtifact,
  findArtifactByIdempotency,
  requireArtifact,
  updateArtifactLifecycle,
  ArtifactServiceError,
} from './artifact.service'
import * as characterService from './character.service'
import type { GeneratedCharacterRole } from './character.service'
import { markNovelContextChanged } from './context-impact.service'
import { getNovel } from './novel.service'
import { refreshWorldStateVersionsForNovel } from './world-state.service'
import { recordAssetChangeEvent } from './asset-impact.service'
import { CharacterDraftWorkflowError } from '../application/character-draft-workflow-error'

export { CharacterDraftWorkflowError }

function mapArtifactError(error: unknown): never {
  if (error instanceof ArtifactServiceError) {
    if (error.code === 'IDEMPOTENCY_KEY_CONFLICT') {
      throw new CharacterDraftWorkflowError('IDEMPOTENCY_KEY_CONFLICT', error.message)
    }
    throw new CharacterDraftWorkflowError('ARTIFACT_NOT_FOUND', error.message)
  }
  throw error
}

function normalizeRole(value: string): GeneratedCharacterRole {
  return value === 'protagonist'
    || value === 'major'
    || value === 'antagonist'
    || value === 'supporting'
    || value === 'minor'
    ? value
    : 'supporting'
}

function roleCounts(roles: GeneratedCharacterRole[]) {
  return {
    majorCount: roles.filter((role) => role === 'major' || role === 'protagonist').length,
    antagonistCount: roles.filter((role) => role === 'antagonist').length,
    supportingCount: roles.filter((role) => role === 'supporting').length,
    minorCount: roles.filter((role) => role === 'minor').length,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function modelReviewFromDraft(draft: CharacterDraftContent): Record<string, unknown> {
  return asRecord(draft.qualityReview)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function reviewDraftContent(
  draftArtifactId: string,
  draftContentHash: string,
  draft: CharacterDraftContent,
  currentNames: string[],
  currentContextVersion: number,
): CharacterDraftReviewContent {
  const names = draft.characters.map((character) => character.fullName.trim())
  const normalizedCurrent = new Set(currentNames.map((name) => name.replace(/\s+/gu, '').toLowerCase()))
  const seen = new Set<string>()
  const duplicateNames: string[] = []
  const existingConflicts: string[] = []
  const missingCore: string[] = []
  const weakDramaticEngine: string[] = []
  const invalidRole: string[] = []
  draft.characters.forEach((character) => {
    const key = character.fullName.replace(/\s+/gu, '').toLowerCase()
    if (!key || seen.has(key)) duplicateNames.push(character.fullName || '(未命名)')
    seen.add(key)
    if (normalizedCurrent.has(key)) existingConflicts.push(character.fullName)
    if (!text(character.goals) || (!text(character.surfaceDesire) && !text(character.deepNeed))) {
      missingCore.push(character.fullName)
    }
    if (!text(character.dramaticEngine) && !text(character.innerConflict)) {
      weakDramaticEngine.push(character.fullName)
    }
    if (!['protagonist', 'major', 'antagonist', 'supporting', 'minor'].includes(character.roleType)) {
      invalidRole.push(character.fullName)
    }
  })

  const planCreateCount = draft.plan.roleSlots.filter((slot) => slot.proposedAction === 'create').length
  const countMatches = planCreateCount === draft.characters.length
  const modelReview = modelReviewFromDraft(draft)
  const modelStage = text(modelReview.stage)
  const modelReviewDetail = asRecord(modelReview.review)
  const modelReject = modelStage === 'rejected' || modelReviewDetail.rejectRequired === true
  const modelRewrite = modelStage === 'rewritten'
    || modelReviewDetail.rewriteRequired === true
    || (Array.isArray(modelReview.warnings) && modelReview.warnings.length > 0)

  const checks: CharacterDraftReviewCheck[] = [
    {
      code: 'character_count_matches_plan',
      status: countMatches ? 'pass' : 'fail',
      message: countMatches ? `草稿人物数与计划新增数一致（${planCreateCount}）。` : `计划新增 ${planCreateCount} 人，但草稿包含 ${draft.characters.length} 人。`,
      characterNames: [],
    },
    {
      code: 'unique_names',
      status: duplicateNames.length === 0 ? 'pass' : 'fail',
      message: duplicateNames.length === 0 ? '草稿内姓名唯一。' : '草稿内存在重名或空姓名。',
      characterNames: duplicateNames,
    },
    {
      code: 'no_existing_name_conflict',
      status: existingConflicts.length === 0 ? 'pass' : 'fail',
      message: existingConflicts.length === 0 ? '未与正式人物重名。' : '草稿姓名与正式人物冲突。',
      characterNames: existingConflicts,
    },
    {
      code: 'motivation_chain',
      status: missingCore.length === 0 ? 'pass' : 'fail',
      message: missingCore.length === 0 ? '每个人物都具备目标与欲望/需要。' : '部分人物缺少目标与欲望/需要的因果链。',
      characterNames: missingCore,
    },
    {
      code: 'dramatic_engine',
      status: weakDramaticEngine.length === 0 ? 'pass' : 'warn',
      message: weakDramaticEngine.length === 0 ? '每个人物都有戏剧引擎或内在冲突。' : '部分人物的戏剧引擎仍偏弱。',
      characterNames: weakDramaticEngine,
    },
    {
      code: 'role_type',
      status: invalidRole.length === 0 ? 'pass' : 'fail',
      message: invalidRole.length === 0 ? '角色类型均有效。' : '存在无效角色类型。',
      characterNames: invalidRole,
    },
    {
      code: 'independent_model_review',
      status: modelReject ? 'fail' : modelRewrite ? 'warn' : 'pass',
      message: text(modelReviewDetail.summary) || '已记录生成阶段独立模型审校。',
      characterNames: [],
    },
  ]
  const hardBlockers = checks.filter((check) => check.status === 'fail').map((check) => check.message)
  const warnings = checks.filter((check) => check.status === 'warn').map((check) => check.message)
  if (draft.characters.length === 0) hardBlockers.push('草稿中没有可提交的人物。')
  if (currentContextVersion !== draft.plan.contextVersion) {
    warnings.push(`当前上下文版本 ${currentContextVersion} 与草稿基线 ${draft.plan.contextVersion} 不同；提交前必须重新生成。`)
  }
  const status = hardBlockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'needs_revision' : 'passed'
  const score = Math.max(0, 100 - (hardBlockers.length * 25) - (warnings.length * 8))
  return {
    schemaVersion: 'character-draft-review-v1',
    draftArtifactId,
    draftContentHash,
    status,
    score,
    committable: hardBlockers.length === 0,
    summary: hardBlockers.length > 0
      ? `人物草稿存在 ${hardBlockers.length} 个硬阻塞。`
      : warnings.length > 0
        ? `人物草稿可提交，但建议先处理 ${warnings.length} 个警告。`
        : '人物草稿通过确定性检查与独立模型审校。',
    hardBlockers,
    warnings,
    checks,
    modelReview,
    reviewedContextVersion: currentContextVersion,
    createdAt: new Date().toISOString(),
  }
}

function requireNovel(novelId: number) {
  const novel = getNovel(novelId)
  if (!novel) throw new CharacterDraftWorkflowError('PROJECT_NOT_FOUND', `项目 ${novelId} 不存在。`)
  return novel
}

export async function generateCharacterDraft(input: GenerateCharacterDraftInput): Promise<GenerateCharacterDraftResult> {
  const novel = requireNovel(input.novelId)
  const replay = findArtifactByIdempotency<CharacterDraftContent>(input.novelId, 'character_draft', input.idempotencyKey)
  if (replay) {
    if (replay.content.planId !== input.planId) {
      throw new CharacterDraftWorkflowError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于另一个人物计划。')
    }
    if (!replay.reviewArtifactId) {
      throw new CharacterDraftWorkflowError('QUALITY_GATE_BLOCKED', '幂等重放命中的草稿缺少审校工件。')
    }
    const replayReview = requireArtifact<CharacterDraftReviewContent>(replay.reviewArtifactId)
    return {
      draftArtifact: replay,
      reviewArtifact: replayReview,
      taskId: replay.content.taskId,
      characterCount: replay.content.characters.length,
      characterNames: replay.content.characters.map((character) => character.fullName),
      diffSummary: {
        createCount: replay.content.characters.length,
        updateSuggestionCount: replay.content.plan.existingActions.filter((action) => action.action === 'update').length,
        mergeSuggestionCount: replay.content.plan.mergeGroups.length,
        archiveSuggestionCount: replay.content.plan.existingActions.filter((action) => action.action === 'archive').length,
      },
      review: replayReview.content,
      idempotentReplay: true,
    }
  }
  let planArtifact
  try {
    planArtifact = requireArtifact<CharacterNeedsAnalysisResult>(input.planId)
  } catch (error) {
    return mapArtifactError(error)
  }
  if (planArtifact.novelId !== input.novelId || planArtifact.kind !== 'character_cast_plan') {
    throw new CharacterDraftWorkflowError('PLAN_NOT_FOUND', '指定工件不是当前项目的人物计划。')
  }
  if (planArtifact.status === 'rejected' || planArtifact.content.review.status === 'blocked') {
    throw new CharacterDraftWorkflowError('PLAN_REJECTED', '人物计划未通过审校，不能生成草稿。')
  }
  if ((novel.contextVersion || 1) !== planArtifact.contextVersion) {
    throw new CharacterDraftWorkflowError('CONTEXT_VERSION_CONFLICT', '人物计划生成后项目上下文已变化，请重新分析。')
  }

  const slots = planArtifact.content.roleSlots.filter((slot) => slot.proposedAction === 'create')
  if (slots.length === 0) {
    throw new CharacterDraftWorkflowError('PLAN_HAS_NO_CREATE_ACTIONS', '人物计划没有需要新增的角色功能位。')
  }
  if (typeof input.maxCharacters === 'number' && slots.length > input.maxCharacters) {
    throw new CharacterDraftWorkflowError('QUALITY_GATE_BLOCKED', `计划需要新增 ${slots.length} 人，超过调用方上限 ${input.maxCharacters}。`)
  }
  const roles = slots.map((slot) => normalizeRole(slot.proposedRoleType))
  const counts = roleCounts(roles)
  const slotRequirements = slots.map((slot, index) => [
    `${index + 1}. ${slot.function}（role_type=${roles[index]}）`,
    `证据：${slot.evidenceRefs.join('、') || '未提供'}`,
    slot.independenceReason ? `独立成角原因：${slot.independenceReason}` : '',
    `首次出场窗口：${slot.firstAppearanceWindow}`,
  ].filter(Boolean).join('；')).join('\n')
  const generated = await characterService.generateCharacterBatchChunk(input.novelId, {
    ...counts,
    genderRatio: '不限',
    batchSize: slots.length,
    specialRequirements: [
      '本次生成来自已审校的人物功能位计划，只生成下列缺口，不得额外凑人数。',
      slotRequirements,
      input.specialRequirements?.trim() || '',
    ].filter(Boolean).join('\n'),
    helperRoles: slots.map((slot) => slot.function),
    diversityConstraints: [
      '姓名、职业、行动策略、价值观与语言习惯必须可区分。',
      '每个角色必须有不可替代的叙事动作，不得只写标签。',
    ],
  }, {
    commit: false,
    roleQueue: roles,
  })
  const draftCharacters = (generated.draftCharacters || []) as CharacterDraftCard[]
  if (draftCharacters.length === 0 || !generated.taskId) {
    throw new CharacterDraftWorkflowError('MODEL_OUTPUT_INVALID', generated.warning || '模型未生成可用的人物草稿。')
  }
  const content: CharacterDraftContent = {
    schemaVersion: 'character-draft-v1',
    planId: planArtifact.id,
    planContentHash: planArtifact.contentHash,
    plan: planArtifact.content,
    characters: draftCharacters,
    taskId: generated.taskId,
    qualityReview: generated.qualityReview || {},
    generatedAt: new Date().toISOString(),
  }

  let draftArtifact
  try {
    draftArtifact = createArtifact({
      novelId: input.novelId,
      kind: 'character_draft',
      status: 'draft',
      parentArtifactId: planArtifact.id,
      content,
      contextVersion: planArtifact.contextVersion,
      producerType: 'novelforge_model',
      producerId: `task:${generated.taskId}`,
      producerClient: 'novelforge-character-draft-workflow',
      modelConfigId: novel.modelConfigId || null,
      taskId: generated.taskId,
      idempotencyKey: input.idempotencyKey,
    })
  } catch (error) {
    return mapArtifactError(error)
  }
  const review = reviewDraftContent(
    draftArtifact.id,
    draftArtifact.contentHash,
    draftArtifact.content,
    characterService.listCharacters(input.novelId).map((character) => character.fullName),
    novel.contextVersion || 1,
  )
  const reviewArtifact = createArtifact({
    novelId: input.novelId,
    kind: 'character_review',
    status: review.status === 'blocked' ? 'rejected' : 'reviewed',
    parentArtifactId: draftArtifact.id,
    content: review,
    contextVersion: draftArtifact.contextVersion,
    producerType: 'system',
    producerId: 'character-draft-reviewer-v1',
    producerClient: 'novelforge-character-draft-workflow',
    taskId: generated.taskId,
    idempotencyKey: `${input.idempotencyKey}:review`,
  })
  updateArtifactLifecycle(draftArtifact.id, {
    status: review.status === 'blocked' ? 'rejected' : 'reviewed',
    reviewArtifactId: reviewArtifact.id,
  })
  const refreshedDraft = requireArtifact<CharacterDraftContent>(draftArtifact.id)
  return {
    draftArtifact: refreshedDraft,
    reviewArtifact,
    taskId: generated.taskId,
    characterCount: draftCharacters.length,
    characterNames: draftCharacters.map((character) => character.fullName),
    diffSummary: {
      createCount: draftCharacters.length,
      updateSuggestionCount: planArtifact.content.existingActions.filter((action) => action.action === 'update').length,
      mergeSuggestionCount: planArtifact.content.mergeGroups.length,
      archiveSuggestionCount: planArtifact.content.existingActions.filter((action) => action.action === 'archive').length,
    },
    review,
    idempotentReplay: false,
  }
}

export function reviewCharacterDraft(input: ReviewCharacterDraftInput) {
  const novel = requireNovel(input.novelId)
  let draftArtifact
  try {
    draftArtifact = requireArtifact<CharacterDraftContent>(input.draftArtifactId)
  } catch (error) {
    return mapArtifactError(error)
  }
  if (draftArtifact.novelId !== input.novelId || draftArtifact.kind !== 'character_draft') {
    throw new CharacterDraftWorkflowError('ARTIFACT_KIND_MISMATCH', '指定工件不是当前项目的人物草稿。')
  }
  const review = reviewDraftContent(
    draftArtifact.id,
    draftArtifact.contentHash,
    draftArtifact.content,
    characterService.listCharacters(input.novelId).map((character) => character.fullName),
    novel.contextVersion || 1,
  )
  const artifact = createArtifact({
    novelId: input.novelId,
    kind: 'character_review',
    status: review.status === 'blocked' ? 'rejected' : 'reviewed',
    parentArtifactId: draftArtifact.id,
    content: review,
    contextVersion: novel.contextVersion || 1,
    producerType: 'system',
    producerId: 'character-draft-reviewer-v1',
    producerClient: 'novelforge-character-draft-workflow',
    taskId: draftArtifact.taskId,
  })
  updateArtifactLifecycle(draftArtifact.id, {
    status: review.status === 'blocked' ? 'rejected' : 'reviewed',
    reviewArtifactId: artifact.id,
  })
  return { reviewArtifact: artifact, review }
}

export function commitCharacterDraft(input: CommitCharacterDraftInput): CommitCharacterDraftResult {
  const novel = requireNovel(input.novelId)
  const replay = findArtifactByIdempotency<CharacterCommitDiffContent>(input.novelId, 'character_commit_diff', input.idempotencyKey)
  if (replay) {
    if (replay.content.draftArtifactId !== input.draftArtifactId
      || replay.content.draftContentHash !== input.expectedContentHash
      || replay.content.contextVersionBefore !== input.expectedContextVersion) {
      throw new CharacterDraftWorkflowError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于不同的人物提交参数。')
    }
    return {
      draftArtifactId: input.draftArtifactId,
      commitArtifact: replay,
      createdCharacterIds: replay.content.createdCharacterIds,
      createdCharacterNames: replay.content.createdCharacterNames,
      contextVersionBefore: replay.content.contextVersionBefore,
      contextVersionAfter: replay.content.contextVersionAfter,
      idempotentReplay: true,
      warnings: replay.content.skippedPlanActions.length > 0 ? ['人物更新、合并或归档建议尚未自动提交。'] : [],
    }
  }

  let draftArtifact
  try {
    draftArtifact = requireArtifact<CharacterDraftContent>(input.draftArtifactId)
  } catch (error) {
    return mapArtifactError(error)
  }
  if (draftArtifact.novelId !== input.novelId || draftArtifact.kind !== 'character_draft') {
    throw new CharacterDraftWorkflowError('ARTIFACT_KIND_MISMATCH', '指定工件不是当前项目的人物草稿。')
  }
  if (draftArtifact.contentHash !== input.expectedContentHash) {
    throw new CharacterDraftWorkflowError('DRAFT_HASH_CONFLICT', '人物草稿哈希与批准时看到的版本不一致。')
  }
  const currentVersion = novel.contextVersion || 1
  if (input.expectedContextVersion !== draftArtifact.contextVersion || currentVersion !== draftArtifact.contextVersion) {
    throw new CharacterDraftWorkflowError('CONTEXT_VERSION_CONFLICT', '项目上下文已变化，不能覆盖提交；请重新分析并生成草稿。')
  }
  if (!draftArtifact.reviewArtifactId) {
    throw new CharacterDraftWorkflowError('QUALITY_GATE_BLOCKED', '人物草稿没有独立审校记录。')
  }
  const reviewArtifact = requireArtifact<CharacterDraftReviewContent>(draftArtifact.reviewArtifactId)
  if (!reviewArtifact.content.committable || reviewArtifact.content.status === 'blocked') {
    throw new CharacterDraftWorkflowError('QUALITY_GATE_BLOCKED', reviewArtifact.content.summary)
  }
  const currentNames = new Set(characterService.listCharacters(input.novelId).map((character) => character.fullName.replace(/\s+/gu, '').toLowerCase()))
  const conflict = draftArtifact.content.characters.find((character) => currentNames.has(character.fullName.replace(/\s+/gu, '').toLowerCase()))
  if (conflict) {
    throw new CharacterDraftWorkflowError('CONTEXT_VERSION_CONFLICT', `正式人物库中已存在同名人物「${conflict.fullName}」。`)
  }

  const createdCharacterIds: number[] = []
  const createdCharacterNames: string[] = []
  const skippedPlanActions = draftArtifact.content.plan.existingActions
    .filter((action) => action.action !== 'keep')
    .map((action) => ({ action: action.action, characterId: action.characterId, characterName: action.characterName }))
  const committedAt = new Date().toISOString()
  let commitArtifact
  let contextVersionAfter = currentVersion
  getSqlite().transaction(() => {
    draftArtifact.content.characters.forEach((character) => {
      const id = characterService.createCharacter(input.novelId, {
        ...character,
        recordStatus: 'confirmed',
        sourceContextJson: JSON.stringify({
          source: 'agent_artifact',
          artifactId: draftArtifact.id,
          planId: draftArtifact.content.planId,
        }),
      }, { skipContextTracking: true })
      createdCharacterIds.push(id)
      createdCharacterNames.push(character.fullName)
    })
    const diff: CharacterCommitDiffContent = {
      schemaVersion: 'character-commit-diff-v1',
      draftArtifactId: draftArtifact.id,
      draftContentHash: draftArtifact.contentHash,
      reviewArtifactId: reviewArtifact.id,
      createdCharacterIds,
      createdCharacterNames,
      skippedPlanActions,
      contextVersionBefore: currentVersion,
      contextVersionAfter: currentVersion + 1,
      committedAt,
    }
    commitArtifact = createArtifact({
      novelId: input.novelId,
      kind: 'character_commit_diff',
      status: 'committed',
      parentArtifactId: draftArtifact.id,
      content: diff,
      contextVersion: currentVersion,
      producerType: 'system',
      producerId: 'character-draft-committer-v1',
      producerClient: 'novelforge-character-draft-workflow',
      taskId: draftArtifact.taskId,
      idempotencyKey: input.idempotencyKey,
    })
    updateArtifactLifecycle(draftArtifact.id, { status: 'committed', committedEntityIds: createdCharacterIds })
    contextVersionAfter = markNovelContextChanged(input.novelId, 'Character draft artifact committed')
    if (contextVersionAfter !== currentVersion + 1) {
      throw new CharacterDraftWorkflowError('CONTEXT_VERSION_CONFLICT', '人物提交未能获得预期的下一上下文版本。')
    }
    draftArtifact.content.characters.forEach((character, index) => {
      recordAssetChangeEvent({
        novelId: input.novelId,
        assetType: 'character',
        assetId: createdCharacterIds[index],
        assetLabel: character.fullName,
        operation: 'create',
        changeReason: `Committed from artifact ${draftArtifact.id}`,
        impactLevel: 'medium',
        triggeredBy: 'character-draft-workflow',
        payload: character,
      })
    })
  })()

  refreshWorldStateVersionsForNovel(input.novelId)

  return {
    draftArtifactId: draftArtifact.id,
    commitArtifact: commitArtifact as NonNullable<typeof commitArtifact>,
    createdCharacterIds,
    createdCharacterNames,
    contextVersionBefore: currentVersion,
    contextVersionAfter,
    idempotentReplay: false,
    warnings: skippedPlanActions.length > 0 ? ['本次只提交新增人物；计划中的更新、合并或归档建议仍需单独处理。'] : [],
  }
}
