import type {
  ChapterContractValidationResult,
  ChapterRewriteScope,
  RewritePlan,
} from '../../src/types'
import {
  dedupeTextList,
  type ChapterPublishCheckItem,
  type ChapterRewriteTarget,
  type ReviewStateSnapshot,
} from './chapter-publish-types'

const CHAPTER_GATE_NON_REWRITEABLE_KEYS = new Set([
  'content',
  'summary',
  'continuity',
  'context',
  'scene_plan',
  'outline',
  'medium_issues',
  'hook_strength',
  'story_dynamics',
  'recall',
])

export function buildRewriteTarget(
  chapterId: number,
  items: ChapterPublishCheckItem[],
  rewritePlan?: RewritePlan,
): ChapterRewriteTarget | undefined {
  if (rewritePlan) {
    if (typeof rewritePlan.targetSegmentId === 'number') {
      const matchedItem = items.find((item) => item.segmentId === rewritePlan.targetSegmentId)
      return {
        kind: 'segment',
        chapterId,
        segmentId: rewritePlan.targetSegmentId,
        segmentTitle: matchedItem?.segmentTitle,
        reason: rewritePlan.goals[0] || rewritePlan.targetExcerpt || matchedItem?.detail || '需要重写对应场景。',
        relatedPage: matchedItem?.relatedPage || 'structure',
      }
    }
    return {
      kind: rewritePlan.scope === 'paragraph_patch' ? 'selection' : 'chapter',
      chapterId,
      reason: rewritePlan.goals[0] || rewritePlan.targetExcerpt || '需要按章节验收计划重写。',
      relatedPage: rewritePlan.scope === 'contract_replan' ? 'contracts' : 'writing',
    }
  }
  const rewriteItem = items.find((item) => item.status === 'rewrite')
  if (!rewriteItem) return undefined
  if (typeof rewriteItem.segmentId === 'number') {
    return {
      kind: 'segment',
      chapterId,
      segmentId: rewriteItem.segmentId,
      segmentTitle: rewriteItem.segmentTitle,
      reason: rewriteItem.detail,
      relatedPage: rewriteItem.relatedPage || 'structure',
    }
  }
  return {
    kind: rewriteItem.relatedPage === 'writing' ? 'selection' : 'chapter',
    chapterId,
    reason: rewriteItem.detail,
    relatedPage: rewriteItem.relatedPage || 'writing',
  }
}

function buildRewriteGoals(
  item: ChapterPublishCheckItem,
  reviewState: ReviewStateSnapshot,
  contractValidation?: ChapterContractValidationResult | null,
): string[] {
  const contractFocus = (contractValidation?.itemResults || [])
    .filter((entry) =>
      entry.verdict === 'missing'
      || entry.verdict === 'contradicted'
      || entry.verdict === 'weak')
    .slice(0, 2)

  return dedupeTextList([
    item.fixHint,
    item.detail,
    reviewState.revisionBrief,
    ...contractFocus.map((entry) => entry.rewriteHint),
    reviewState.criticalFixes[0],
    reviewState.missingPayoffs[0],
  ]).slice(0, 5)
}

function buildRewritePreserve(scope: ChapterRewriteScope, item: ChapterPublishCheckItem): string[] {
  return dedupeTextList([
    '作者锁定段落必须逐字保留。',
    '章节目标、世界规则和已确定关系状态不得被改写成另一条线。',
    '已经成立且无问题的段落只做最小衔接性改动。',
    scope === 'scene_rewrite' && typeof item.segmentId === 'number'
      ? '非目标场景优先保持不动，只修与目标场景衔接的过渡。'
      : '',
    scope === 'contract_replan'
      ? '若合同本身冲突，先重排合同，再决定正文如何改写。'
      : '',
  ])
}

function buildRewriteRecheckItems(
  item: ChapterPublishCheckItem,
  checklist: ChapterPublishCheckItem[],
  contractValidation?: ChapterContractValidationResult | null,
): string[] {
  const activeRewriteKeys = checklist
    .filter((entry) => (entry.status === 'rewrite' || entry.status === 'blocker') && !CHAPTER_GATE_NON_REWRITEABLE_KEYS.has(entry.key))
    .map((entry) => entry.key)

  if (item.key === 'rewrite_path') {
    return dedupeTextList([
      ...activeRewriteKeys,
      contractValidation?.status === 'blocker' ? 'contract_delivery' : '',
    ])
  }

  switch (item.key) {
    case 'contract_delivery':
      return dedupeTextList([
        'contract_delivery',
        'thread_progress',
        'line_progress',
        'volume_alignment',
      ])
    case 'pov_purity':
    case 'pov_boundary':
      return ['pov_purity', 'pov_boundary']
    case 'dialogue_voice':
      return ['dialogue_voice', 'review']
    case 'style_compliance':
      return ['style_compliance', 'review', 'ai_score']
    case 'ai_score':
    case 'review':
      return ['ai_score', 'review']
    case 'step_memory_handoff':
      return ['step_memory_handoff', 'review', 'contract_delivery']
    case 'opening_hook':
      return ['opening_hook', 'review', 'ai_score']
    case 'title_and_hallucination':
      return ['title_and_hallucination', 'review']
    case 'sensory_coverage':
      return ['sensory_coverage', 'review']
    case 'narrative_ratio':
      return ['narrative_ratio', 'review', 'ai_score']
    case 'thread_progress':
    case 'line_progress':
      return ['thread_progress', 'line_progress', 'contract_delivery']
    case 'volume_alignment':
      return ['volume_alignment', 'contract_delivery', 'line_progress']
    case 'consistency':
      return dedupeTextList([...activeRewriteKeys, 'contract_delivery'])
    default:
      return dedupeTextList(activeRewriteKeys.length > 0 ? activeRewriteKeys : [item.key])
  }
}

function getRewriteScopeForItem(
  item: ChapterPublishCheckItem,
  contractValidation?: ChapterContractValidationResult | null,
): ChapterRewriteScope {
  if (item.key === 'contract_delivery') {
    const blockingItems = (contractValidation?.itemResults || [])
      .filter((entry) => entry.verdict === 'missing' || entry.verdict === 'contradicted')
    if (blockingItems.some((entry) => entry.verdict === 'contradicted')) return 'contract_replan'
    if (blockingItems.some((entry) => typeof entry.segmentId === 'number')) return 'scene_rewrite'
    return 'chapter_rewrite'
  }

  if (
    item.key === 'pov_purity'
    || item.key === 'thread_progress'
    || item.key === 'line_progress'
    || item.key === 'volume_alignment'
    || item.key === 'consistency'
    || item.key === 'rewrite_path'
  ) {
    return typeof item.segmentId === 'number' ? 'scene_rewrite' : 'chapter_rewrite'
  }

  if (item.key === 'pov_boundary') {
    return typeof item.segmentId === 'number' ? 'scene_rewrite' : 'paragraph_patch'
  }

  if (
    item.key === 'dialogue_voice'
    || item.key === 'style_compliance'
    || item.key === 'review'
    || item.key === 'ai_score'
    || item.key === 'step_memory_handoff'
    || item.key === 'opening_hook'
    || item.key === 'title_and_hallucination'
    || item.key === 'sensory_coverage'
    || item.key === 'narrative_ratio'
  ) {
    return 'paragraph_patch'
  }

  return item.status === 'rewrite' && typeof item.segmentId === 'number'
    ? 'scene_rewrite'
    : 'chapter_rewrite'
}

function buildRewriteTargetExcerpt(
  item: ChapterPublishCheckItem,
  reviewState: ReviewStateSnapshot,
  contractValidation?: ChapterContractValidationResult | null,
): string | undefined {
  const contractEvidence = (contractValidation?.itemResults || [])
    .find((entry) =>
      (entry.verdict === 'missing' || entry.verdict === 'contradicted' || entry.verdict === 'weak')
      && (item.key === 'contract_delivery' || entry.segmentId === item.segmentId))

  return dedupeTextList([
    contractEvidence?.evidenceExcerpt,
    contractEvidence?.rewriteHint,
    item.segmentTitle ? `${item.segmentTitle}：${item.detail}` : '',
    item.detail,
    reviewState.dialogueDriftAlerts[0],
    reviewState.crossCharacterSimilarity[0],
    reviewState.languageRisks[0],
  ])[0]
}

export function buildRewritePlanForItem(params: {
  item: ChapterPublishCheckItem
  checklist: ChapterPublishCheckItem[]
  reviewState: ReviewStateSnapshot
  contractValidation?: ChapterContractValidationResult | null
}): RewritePlan | undefined {
  const { item, checklist, reviewState, contractValidation } = params
  if (CHAPTER_GATE_NON_REWRITEABLE_KEYS.has(item.key)) return undefined
  if (item.status !== 'rewrite' && item.status !== 'blocker') return undefined

  const scope = getRewriteScopeForItem(item, contractValidation)
  const recheckItems = buildRewriteRecheckItems(item, checklist, contractValidation)
  if (recheckItems.length === 0) return undefined
  const contractTargetSegmentId = (contractValidation?.itemResults || [])
    .find((entry) =>
      typeof entry.segmentId === 'number'
      && (entry.verdict === 'missing' || entry.verdict === 'contradicted' || entry.verdict === 'weak'))
    ?.segmentId

  return {
    scope,
    targetSegmentId: typeof item.segmentId === 'number'
      ? item.segmentId
      : item.key === 'contract_delivery'
        ? contractTargetSegmentId
        : undefined,
    targetExcerpt: buildRewriteTargetExcerpt(item, reviewState, contractValidation),
    goals: buildRewriteGoals(item, reviewState, contractValidation),
    preserve: buildRewritePreserve(scope, item),
    recheckItems,
  }
}

function getRewritePlanPriority(plan: RewritePlan | undefined, item: ChapterPublishCheckItem): number {
  if (!plan) return 0
  if (item.key === 'rewrite_path') return 20
  if (plan.scope === 'contract_replan') return 400
  if (item.key === 'title_and_hallucination') return 360
  if (item.key === 'step_memory_handoff') return 340
  if (item.key === 'opening_hook') return 320
  if (item.key === 'contract_delivery') return 160
  if (item.key === 'narrative_ratio') return 280
  if (plan.scope === 'scene_rewrite') return 300
  if (plan.scope === 'paragraph_patch') return 240
  if (plan.scope === 'chapter_rewrite') return 180
  return 100
}

export function buildChapterRewritePlan(params: {
  checklist: ChapterPublishCheckItem[]
  reviewState: ReviewStateSnapshot
  contractValidation?: ChapterContractValidationResult | null
}): RewritePlan | undefined {
  let selected: { item: ChapterPublishCheckItem; plan: RewritePlan } | null = null
  const hasSpecificRewrite = params.checklist.some((item) => item.status === 'rewrite' && item.key !== 'rewrite_path')

  for (const item of params.checklist) {
    if (hasSpecificRewrite && (item.key === 'rewrite_path' || item.key === 'contract_delivery')) continue
    const plan = buildRewritePlanForItem({
      item,
      checklist: params.checklist,
      reviewState: params.reviewState,
      contractValidation: params.contractValidation,
    })
    if (!plan) continue
    if (!selected || getRewritePlanPriority(plan, item) > getRewritePlanPriority(selected.plan, selected.item)) {
      selected = { item, plan }
    }
  }

  return selected ? selected.plan : undefined
}
