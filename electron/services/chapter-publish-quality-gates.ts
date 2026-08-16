import { eq } from 'drizzle-orm'
import type {
  ChapterContractValidationResult,
  RecallDiagnostics,
  RecallFallbackReason,
  RecallSnapshot,
  StoryDynamicsAlert,
} from '../../src/types'
import { getDb } from '../database/db'
import {
  chapters,
  novels,
  storyItems,
  storyThreads,
  storyVolumes,
  timelineEvents,
} from '../database/schema'
import { formatStaleReasonsSummary } from '../../src/shared/context-change-reasons'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import { buildNovelConsistencyReport, type ConsistencyIssue } from './consistency.service'
import { analyzeNarrativeControls } from './narrative-control.service'
import { getSceneSnapshotLabel } from './chapter-publish-contract-gate'
import {
  parseNumberArray,
  type ChapterContractAudit,
  type ChapterContractAuditContext,
  type ChapterContractAuditSceneSnapshot,
  type ChapterGateLevel,
  type ChapterPublishCheckItem,
  type ChapterPublishCheckSource,
  type ReviewStateSnapshot,
} from './chapter-publish-types'

/** enforce 模式下被语义门接管的启发式门项，其 blocker/rewrite 降级为 warning 时追加的后缀。 */
const HEURISTIC_TAKEOVER_SUFFIX = '（启发式，已由语义门接管）'

function formatRecallFallbackReason(reason?: RecallFallbackReason): string {
  switch (reason) {
    case 'embedding_service_failed':
      return '嵌入服务失败'
    case 'query_embedding_failed':
      return '查询向量失败'
    case 'embedding_profile_mismatch':
      return '向量模型空间不匹配'
    case 'disabled_by_config':
      return '向量能力未启用'
    case 'budget_trimmed':
      return '召回被预算裁剪'
    case 'only_stale_hits':
      return '仅命中过期片段'
    case 'no_hits':
      return '没有命中历史片段'
    default:
      return '未记录原因'
  }
}

function makePublishCheckItem(
  item: Omit<ChapterPublishCheckItem, 'source'> & { source?: ChapterPublishCheckSource },
): ChapterPublishCheckItem {
  return {
    source: item.source || 'chapter',
    ...item,
  }
}

export function collectChapterRelatedIssues(
  novelId: number,
  chapterId: number,
  chapterNum: number,
): ConsistencyIssue[] {
  const db = getDb()
  const report = buildNovelConsistencyReport(novelId)
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const currentChapter = chapterRows.find((item) => item.id === chapterId)
  const chapterIdToNum = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const relatedEvents = eventRows.filter((event) => {
    if (currentChapter?.partId && event.partId === currentChapter.partId) return true
    if (currentChapter?.volumeId && event.volumeId === currentChapter.volumeId) return true
    if (event.chapterStartId === chapterId || event.chapterEndId === chapterId) return true
    const startNum = event.chapterStartId ? chapterIdToNum.get(event.chapterStartId) : undefined
    const endNum = event.chapterEndId ? chapterIdToNum.get(event.chapterEndId) : undefined
    return typeof startNum === 'number' && typeof endNum === 'number'
      ? chapterNum >= startNum && chapterNum <= endNum
      : typeof startNum === 'number'
        ? chapterNum === startNum
        : typeof endNum === 'number'
          ? chapterNum === endNum
          : false
  })
  const relatedEventIds = new Set(relatedEvents.map((event) => event.id))
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const relatedItems = itemRows.filter((item) =>
    parseNumberArray(item.linkedTimelineEventIdsJson).some((id) => relatedEventIds.has(id)))
  const relatedItemIds = new Set(relatedItems.map((item) => item.id))

  return report.issues.filter((issue) =>
    ((issue.entityType === 'chapter' || issue.category === 'continuity') && issue.entityId === chapterId)
    || (issue.entityType === 'timeline' && issue.entityId ? relatedEventIds.has(issue.entityId) : false)
    || (issue.entityType === 'item' && issue.entityId ? relatedItemIds.has(issue.entityId) : false))
}

export interface PublishReadinessChecklistInput {
  chapter: typeof chapters.$inferSelect
  novel: typeof novels.$inferSelect
  staleReasons: string[]
  semanticGateStatus: ChapterGateLevel | null
  semanticGateDetail: string
  highIssues: ReturnType<typeof collectChapterRelatedIssues>
  aiScore: number | null
  reviewState: ReviewStateSnapshot
  openingHookIssues: string[]
  titleAlignmentIssues: string[]
}

function makeAvailabilityPublishCheckItem(input: {
  key: string
  label: string
  available: boolean
  availableDetail: string
  missingDetail: string
  fixHint: string
}): ChapterPublishCheckItem {
  return makePublishCheckItem({
    key: input.key,
    label: input.label,
    status: input.available ? 'pass' : 'blocker',
    detail: input.available ? input.availableDetail : input.missingDetail,
    relatedPage: 'writing',
    fixHint: input.fixHint,
  })
}

function buildPublishCoreReadinessChecklist(input: PublishReadinessChecklistInput): ChapterPublishCheckItem[] {
  const { chapter, novel, staleReasons, semanticGateStatus, semanticGateDetail } = input
  const { highIssues, aiScore } = input
  return [
    makeAvailabilityPublishCheckItem({
      key: 'content', label: '正文已完成', available: Boolean(chapter.content?.trim()),
      availableDetail: '当前章节已有正文。', missingDetail: '当前章节还没有正文内容。',
      fixHint: '先补完正文，再执行章节验收。',
    }),
    makeAvailabilityPublishCheckItem({
      key: 'summary', label: '摘要已刷新', available: Boolean(chapter.summary?.trim()),
      availableDetail: '章节摘要已经生成。', missingDetail: '需要先刷新摘要和后续承接信息。',
      fixHint: '先刷新摘要与后续承接，再重新验收。',
    }),
    makeAvailabilityPublishCheckItem({
      key: 'continuity', label: '连续性记忆已更新', available: Boolean(chapter.continuityStateJson?.trim()),
      availableDetail: '连续性记忆可用于后文承接。', missingDetail: '需要先补齐连续性记忆。',
      fixHint: '先执行摘要/记忆更新，再验收章节。',
    }),
    makePublishCheckItem({
      key: 'context', label: '上下文未过期',
      status: staleReasons.length === 0 && (chapter.contextVersion || 1) === (novel.contextVersion || 1) ? 'pass' : 'blocker',
      detail: staleReasons.length === 0 && (chapter.contextVersion || 1) === (novel.contextVersion || 1)
        ? '章节上下文与当前全书版本一致。'
        : `上下文已过期：${formatStaleReasonsSummary(staleReasons)}`,
      relatedPage: 'writing', fixHint: '回到正文页先刷新摘要、连续性记忆和相关上下文。',
    }),
    ...(semanticGateStatus ? [makePublishCheckItem({
      key: 'semantic_gate', label: '语义质量门已完成', status: semanticGateStatus,
      detail: semanticGateDetail, source: 'review', relatedPage: 'writing',
      fixHint: '请通过章节流水线完成当前正文版本的 enforce 语义评审。',
    })] : []),
    makePublishCheckItem({
      key: 'consistency', label: '无高优先级结构风险', status: highIssues.length === 0 ? 'pass' : 'blocker',
      detail: highIssues.length === 0 ? '没有命中当前章节的高优先级结构问题。' : highIssues.slice(0, 3).map((issue) => issue.title).join('；'),
      relatedPage: 'revision', fixHint: '先处理高优先级结构风险，再尝试标记完成。',
    }),
    makePublishCheckItem({
      key: 'ai_score', label: 'AI 体检已完成',
      status: typeof aiScore === 'number' ? (aiScore >= 60 ? 'pass' : 'warning') : 'warning',
      detail: typeof aiScore === 'number' ? `当前 AI 体检分数为 ${aiScore}。` : '还没有执行 AI 体检，建议在发布前跑一次。',
      source: 'review', relatedPage: 'writing', fixHint: '补跑 AI 检测，确认表达与结构风险。',
    }),
  ]
}

function buildPublishReviewReadinessChecklist(input: PublishReadinessChecklistInput): ChapterPublishCheckItem[] {
  const { chapter, reviewState, openingHookIssues, titleAlignmentIssues } = input
  return [
    makePublishCheckItem({
      key: 'review', label: '审校意见已收敛',
      status: reviewState.rewriteRequired || reviewState.severity === 'high' ? 'warning' : 'pass',
      detail: reviewState.rewriteRequired || reviewState.severity === 'high'
        ? reviewState.revisionBrief || '当前审校结果仍建议重写或存在高风险意见。'
        : '当前没有需要强制处理的审校意见。',
      source: 'review', relatedPage: 'writing', fixHint: '先消化审校结论，再决定是否进入完成态。',
    }),
    makePublishCheckItem({
      key: 'step_memory_handoff', label: '步骤接力未断链',
      status: reviewState.stepMemoryRisks.length >= 2 ? 'blocker' : reviewState.stepMemoryRisks.length > 0 ? 'warning' : 'pass',
      detail: reviewState.stepMemoryRisks.length > 0
        ? reviewState.stepMemoryRisks.slice(0, 3).join('；')
        : '当前没有识别到 Planner、Writer、Critic、Rewriter 之间的接力断链。',
      source: 'review', relatedPage: 'writing',
      fixHint: '回到正文页按章节衔接桥、场景计划和运行时接力断言重写断链段落。',
    }),
    makePublishCheckItem({
      key: 'opening_hook', label: '开篇追读力',
      status: openingHookIssues.length > 0 && chapter.chapterNum <= 3 ? 'rewrite' : openingHookIssues.length > 0 ? 'warning' : 'pass',
      detail: openingHookIssues.length > 0
        ? openingHookIssues.slice(0, 3).join('；')
        : chapter.chapterNum <= 3 ? '黄金三章当前没有识别到明显的章首吸引力问题。' : '当前章节没有识别到明显的章首吸引力问题。',
      source: 'review', relatedPage: 'writing',
      fixHint: '优先重排章首 800 字：具体现场、主角动作、可感压力、追问点和章尾递进必须落地。',
    }),
    makePublishCheckItem({
      key: 'title_and_hallucination', label: '标题贴合 / 无幻觉新增',
      status: reviewState.hallucinationRisks.length > 0 ? 'blocker' : titleAlignmentIssues.length > 0 ? 'warning' : 'pass',
      detail: reviewState.hallucinationRisks.length > 0 || titleAlignmentIssues.length > 0
        ? [...reviewState.hallucinationRisks, ...titleAlignmentIssues].slice(0, 3).join('；')
        : '当前没有识别到无来源新增设定或标题偏离本章核心事件的问题。',
      source: 'review', relatedPage: 'writing',
      fixHint: '删除无来源新增，或把标题改回本章核心事件、场景物件、选择压力或反转点。',
    }),
    makePublishCheckItem({
      key: 'style_compliance', label: '文风硬约束符合度',
      status: !reviewState.styleComplianceChecked ? 'pass' : reviewState.styleComplianceStatus,
      detail: !reviewState.styleComplianceChecked
        ? '当前小说未配置可用的文风指纹，本章暂不执行风格硬约束校验。'
        : reviewState.styleComplianceStatus === 'pass'
          ? reviewState.styleComplianceSummary || '当前章节未命中文风硬约束偏离。'
          : [
              reviewState.styleComplianceSummary,
              ...reviewState.styleComplianceDeviations,
              ...(reviewState.styleComplianceForbiddenPatterns.length > 0
                ? [`命中禁用表达：${reviewState.styleComplianceForbiddenPatterns.join('、')}`]
                : []),
            ].filter(Boolean).slice(0, 3).join('；'),
      source: 'review', relatedPage: 'revision', fixHint: '按文风指纹回调句长、段长、对白密度，并删除禁用表达后再验收。',
    }),
  ]
}

function buildPublishPolicyChecklist(input: PublishReadinessChecklistInput): ChapterPublishCheckItem[] {
  const { reviewState } = input
  return [
    makePublishCheckItem({
      key: 'typed_ref_coverage', label: 'Typed Ref 覆盖',
      status: reviewState.typedRefRisks.length >= 3 ? 'blocker' : reviewState.typedRefRisks.length > 0 ? 'warning' : 'pass',
      detail: reviewState.typedRefRisks.length > 0 ? reviewState.typedRefRisks.slice(0, 3).join('；') : '当前没有识别到明显的 typed ref 覆盖缺口。',
      source: 'review', relatedPage: 'revision', fixHint: '先补齐 thread / timeline / item 的 typed ref 绑定，再继续依赖这些资产做连续性判断。',
    }),
    makePublishCheckItem({
      key: 'source_grounding', label: '来源 / Grounding',
      status: reviewState.sourceGroundingRisks.some((item) => item.includes('历史正剧') || item.includes('conservative fallback'))
        ? 'blocker' : reviewState.sourceGroundingRisks.length > 0 ? 'warning' : 'pass',
      detail: reviewState.sourceGroundingRisks.length > 0 ? reviewState.sourceGroundingRisks.slice(0, 3).join('；') : '当前没有识别到需要阻断的来源/grounding 缺口。',
      source: 'review', relatedPage: 'revision', fixHint: '补充来源/grounding 依据，或把高承诺细节改写为保守表述后再发布。',
    }),
    makePublishCheckItem({
      key: 'operating_mode_policy', label: 'OperatingMode 策略',
      status: reviewState.operatingModeRisks.some((item) => item.includes('百万字模式'))
        ? 'blocker' : reviewState.operatingModeRisks.length > 0 ? 'warning' : 'pass',
      detail: reviewState.operatingModeRisks.length > 0 ? reviewState.operatingModeRisks.slice(0, 3).join('；') : '当前没有识别到 operatingMode 策略违规。',
      source: 'review', relatedPage: 'revision', fixHint: '先修正 checkpoint / 结构复杂度与 operatingMode 策略的不匹配，再继续发布。',
    }),
  ]
}

export function buildPublishReadinessChecklist(input: PublishReadinessChecklistInput): ChapterPublishCheckItem[] {
  return [
    ...buildPublishCoreReadinessChecklist(input),
    ...buildPublishReviewReadinessChecklist(input),
    ...buildPublishPolicyChecklist(input),
  ]
}

export function buildPublishLanguageAndDynamicsChecklist(input: {
  reviewState: ReviewStateSnapshot
  storyAlerts: StoryDynamicsAlert[]
}): ChapterPublishCheckItem[] {
  const { reviewState, storyAlerts } = input
  const expositionRisks = reviewState.longWindowHumanizationRisks
    .filter((item) => item.includes('解释密度') || item.includes('世界观说明文') || item.includes('过渡句'))
  const templateRisks = reviewState.longWindowHumanizationRisks
    .filter((item) => item.includes('长窗模板复现') || item.includes('反 AI 高风险复现'))
  return [
    makePublishCheckItem({
      key: 'genre_register_drift', label: '题材语域漂移',
      status: reviewState.genreRegisterRisks.length > 0 && reviewState.sourceGroundingRisks.some((item) => item.includes('历史正剧'))
        ? 'blocker' : reviewState.genreRegisterRisks.length > 0 ? 'warning' : 'pass',
      detail: reviewState.genreRegisterRisks.length > 0 ? reviewState.genreRegisterRisks.slice(0, 3).join('；') : '当前没有识别到明显的题材语域漂移。',
      source: 'review', relatedPage: 'revision',
      fixHint: '收回抽象升华、说明腔和空泛辞藻，让题材语感重新落回动作、制度、生态和人物立场。',
    }),
    makePublishCheckItem({
      key: 'exposition_density', label: '解释密度 / 说明文',
      status: expositionRisks.length >= 2 ? 'blocker' : expositionRisks.length > 0 ? 'warning' : 'pass',
      detail: expositionRisks.slice(0, 3).join('；') || '当前没有识别到明显的解释密度问题。',
      source: 'review', relatedPage: 'writing',
      fixHint: '删掉替作者总结的说明句，把世界观与过渡信息改为角色行动、结果状态和场景细节。',
    }),
    makePublishCheckItem({
      key: 'long_window_homogenization', label: '累积同质化 / 模板重复',
      status: templateRisks.length > 0 ? 'warning' : 'pass',
      detail: templateRisks.slice(0, 3).join('；') || '当前没有识别到明显的累积模板化重复。',
      source: 'review', relatedPage: 'revision',
      fixHint: '优先处理最近窗口里复现频率最高的模板连接、模板情绪和高频重复句式。',
    }),
    makePublishCheckItem({
      key: 'dialogue_separability', label: '角色对白可分离度',
      status: reviewState.dialogueSeparabilityRisks.length >= 2 ? 'blocker' : reviewState.dialogueSeparabilityRisks.length > 0 ? 'warning' : 'pass',
      detail: reviewState.dialogueSeparabilityRisks.length > 0
        ? reviewState.dialogueSeparabilityRisks.slice(0, 3).join('；')
        : '当前没有识别到明显的长窗对白可分离度风险。',
      source: 'review', relatedPage: 'revision',
      fixHint: '为高相似/漂移角色补 voice lock，并重写关键对白段落拉开语气、句长和反应差异。',
    }),
    makePublishCheckItem({
      key: 'story_dynamics', label: '主角与节奏风险可控',
      status: reviewState.costEvaporation || reviewState.forcedReversal || reviewState.tooSmooth
        || reviewState.highPressureNoReward || storyAlerts.length > 0 ? 'warning' : 'pass',
      detail: reviewState.costEvaporation
        ? '当前章节存在代价蒸发迹象，建议把损失或后果延续写实。'
        : reviewState.forcedReversal ? '当前章节出现支撑不足的反转，建议补齐触发原因和前文铺垫。'
          : reviewState.tooSmooth ? '当前章节主角几乎无成本顺推，建议补出真实阻力、失误或损失。'
            : reviewState.highPressureNoReward ? '当前章节持续施压却没有阶段回报，建议补入喘息、收获或反击兑现。'
              : storyAlerts.length > 0 ? storyAlerts.map((alert) => alert.title).join('；') : '当前没有命中明显的主角与节奏结构告警。',
      source: 'review', relatedPage: 'writing', fixHint: '回到正文处理节奏、代价或回报问题。',
    }),
  ]
}

export interface PublishStructureChecklistInput {
  chapter: typeof chapters.$inferSelect
  recallFallbackIsHardFailure: boolean
  recallFallbackStreak: number
  recallDiagnostics: RecallDiagnostics
  recallSnapshot?: RecallSnapshot
  mediumIssues: ConsistencyIssue[]
  contractDeliveryStatus: ChapterGateLevel
  publishContractValidation: ChapterContractValidationResult | null
  contractAudit: ChapterContractAudit
  dialogueVoiceStatus: ChapterGateLevel
  reviewState: ReviewStateSnapshot
}

function buildPublishEvidenceChecklist(input: PublishStructureChecklistInput): ChapterPublishCheckItem[] {
  const { chapter, recallFallbackIsHardFailure, recallFallbackStreak, recallDiagnostics } = input
  const { recallSnapshot, mediumIssues } = input
  return [
    makePublishCheckItem({
      key: 'scene_plan', label: '场景计划可追溯',
      status: chapter.scenePlanJson?.trim() ? 'pass' : 'warning',
      detail: chapter.scenePlanJson?.trim() ? '可以追溯到当前章节的场景拆解。' : '当前缺少场景计划，后续排查承接问题会更难。',
      source: 'scene', relatedPage: 'structure', fixHint: '先补齐场景计划或结构拆解，再做验收。',
    }),
    makePublishCheckItem({
      key: 'recall', label: '召回补充未依赖过期片段',
      status: recallFallbackIsHardFailure
        ? 'blocker'
        : recallDiagnostics.staleRecallCount > 0 || recallSnapshot?.degraded ? 'warning' : 'pass',
      detail: recallFallbackIsHardFailure
        ? `最近已连续 ${recallFallbackStreak} 章发生召回降级，本章继续生成会放大连续性风险。当前原因：${formatRecallFallbackReason(recallSnapshot?.fallbackReason)}。`
        : recallSnapshot?.degraded
          ? `本章召回已降级：${formatRecallFallbackReason(recallSnapshot.fallbackReason)}。${recallSnapshot.retrievalUsed ? '当前仅保留降级后的背景补充。' : '当前 prompt 未实际使用召回补充。'}`
          : recallDiagnostics.staleRecallCount > 0
            ? `识别到 ${recallDiagnostics.staleRecallCount} 条疑似过期召回片段。召回只应作为背景补充，建议优先以硬约束和结构化状态回查。`
            : '当前未识别到疑似过期的召回背景片段。',
      relatedPage: 'writing', fixHint: '回查结构化状态和硬约束，避免继续依赖旧召回片段。',
    }),
    makePublishCheckItem({
      key: 'outline', label: '章节大纲存在', status: chapter.outline?.trim() ? 'pass' : 'warning',
      detail: chapter.outline?.trim() ? '章节大纲已保留。' : '当前章节缺少明确大纲，建议补齐后再标记完成。',
      relatedPage: 'writing', fixHint: '补齐本章大纲或明确推进目标。',
    }),
    makePublishCheckItem({
      key: 'medium_issues', label: '中优先级风险可控', status: mediumIssues.length <= 2 ? 'pass' : 'warning',
      detail: mediumIssues.length <= 2 ? '没有堆积过多中优先级结构问题。' : mediumIssues.slice(0, 3).map((issue) => issue.title).join('；'),
      relatedPage: 'revision', fixHint: '优先清掉当前章节堆积的中风险问题。',
    }),
  ]
}

function buildPublishContractAndDialogueChecklist(input: PublishStructureChecklistInput): ChapterPublishCheckItem[] {
  const { contractDeliveryStatus, publishContractValidation, contractAudit } = input
  const { dialogueVoiceStatus, reviewState } = input
  return [
    makePublishCheckItem({
      key: 'contract_delivery', label: '合同兑现率', status: contractDeliveryStatus,
      detail: contractDeliveryStatus === 'pass'
        ? publishContractValidation?.summary || '章节合同与场景合同当前已对齐。'
        : publishContractValidation?.summary || contractAudit.summary,
      source: 'contract',
      relatedPage: publishContractValidation?.itemResults.some((item) => typeof item.segmentId === 'number') ? 'structure' : 'contracts',
      fixHint: publishContractValidation?.rewriteHints[0] || '回到章节合同与场景合同页补齐绑定、推进记录和结果状态。',
    }),
    makePublishCheckItem({
      key: 'dialogue_voice', label: '角色口吻一致性', status: dialogueVoiceStatus,
      detail: dialogueVoiceStatus === 'pass'
        ? '当前没有命中明显的对白漂移或角色同声化风险。'
        : [
            ...reviewState.dialogueHomogenizationRisks,
            ...reviewState.dialogueFillerRisks,
            ...reviewState.dialogueInfoDensityRisks,
            ...reviewState.dialogueDriftAlerts,
            ...reviewState.crossCharacterSimilarity,
            reviewState.dialogueVoiceLockSummary,
          ].slice(0, 3).join('；'),
      source: 'review', relatedPage: 'revision',
      fixHint: '回看对白指纹、voice lock 与审校提示，分别修句长/停顿差异、空转对白和信息推进密度。',
    }),
  ]
}

export function buildPublishStructureChecklist(input: PublishStructureChecklistInput): ChapterPublishCheckItem[] {
  return [
    ...buildPublishEvidenceChecklist(input),
    ...buildPublishContractAndDialogueChecklist(input),
  ]
}

export interface PublishNarrativeChecklistInput {
  themeVoice: ReturnType<typeof parseThemeVoiceDocument>
  uniqueScenePovs: string[]
  missingScenePovs: ChapterContractAuditSceneSnapshot[]
  fixedNovelPov: boolean
  rewriteTargetSource: ChapterContractAuditSceneSnapshot | null
  narrativeControlReport: ReturnType<typeof analyzeNarrativeControls>
  povPurityStatus: ChapterGateLevel
  povBoundaryStatus: ChapterGateLevel
  sensoryCoverageStatus: ChapterGateLevel
  narrativeRatioStatus: ChapterGateLevel
  transitionDensityStatus: ChapterGateLevel
  emotionFocusStatus: ChapterGateLevel
  expositionStatus: ChapterGateLevel
  hookStrengthStatus: ChapterGateLevel
  chapterContract: ChapterContractAuditContext['chapterContract']
  sceneHookCount: number
  reviewState: ReviewStateSnapshot
  threadProgressStatus: ChapterGateLevel
  missingRequiredThreads: number[]
  untouchedRequiredThreads: Array<typeof storyThreads.$inferSelect>
  overdueThreads: Array<typeof storyThreads.$inferSelect>
  volumeAlignmentStatus: ChapterGateLevel
  currentVolume: typeof storyVolumes.$inferSelect | null
  volumeSignals: string[]
  lineProgressStatus: ChapterGateLevel
  arcWarnings: string[]
  structuralRewriteReasons: string[]
}

function buildPublishPerspectiveChecklist(input: PublishNarrativeChecklistInput): ChapterPublishCheckItem[] {
  const { themeVoice, uniqueScenePovs, missingScenePovs, fixedNovelPov } = input
  const { rewriteTargetSource, narrativeControlReport } = input
  const { povPurityStatus, povBoundaryStatus, sensoryCoverageStatus, narrativeRatioStatus } = input
  const { transitionDensityStatus, emotionFocusStatus, expositionStatus } = input
  return [
    makePublishCheckItem({
      key: 'pov_purity', label: 'POV 纯度', status: povPurityStatus,
      detail: povPurityStatus === 'rewrite'
        ? `当前作品已固定为 ${themeVoice.pov || '单一视角'}，但本章场景 POV 混用了 ${uniqueScenePovs.join('、')}。`
        : missingScenePovs.length > 0
          ? `仍有 ${missingScenePovs.length} 个场景缺少 POV 标注，当前无法确认视角纯度。`
          : uniqueScenePovs.length > 1
            ? `当前章节涉及 ${uniqueScenePovs.length} 个场景 POV，建议确认是否真的需要多视角切换。`
            : fixedNovelPov && uniqueScenePovs.length === 1
              ? `当前章节已维持固定视角口径：${uniqueScenePovs[0]}。`
              : '当前没有识别到明显的 POV 纯度问题。',
      source: rewriteTargetSource?.segmentId ? 'scene' : 'contract',
      segmentId: rewriteTargetSource?.segmentId,
      segmentTitle: rewriteTargetSource ? getSceneSnapshotLabel(rewriteTargetSource) : undefined,
      relatedPage: rewriteTargetSource?.segmentId ? 'structure' : 'contracts',
      fixHint: povPurityStatus === 'rewrite' ? '退回对应场景，统一 POV 后再重新验收。' : '补齐场景 POV 标注，并确认章节没有不必要的视角切换。',
    }),
    makePublishCheckItem({
      key: 'pov_boundary', label: 'POV 可知边界', status: povBoundaryStatus,
      detail: narrativeControlReport.pov.status === 'warning' || narrativeControlReport.pov.status === 'rewrite'
        ? [
            narrativeControlReport.pov.summary,
            narrativeControlReport.pov.directMindReadingHits.length > 0 ? `越界心理描写：${narrativeControlReport.pov.directMindReadingHits.join('；')}` : '',
            narrativeControlReport.pov.impossibleKnowledgeHits.length > 0 ? `全知泄露信号：${narrativeControlReport.pov.impossibleKnowledgeHits.join('；')}` : '',
          ].filter(Boolean).join('；')
        : narrativeControlReport.pov.summary,
      source: 'review', relatedPage: 'writing', fixHint: narrativeControlReport.pov.fixHint,
    }),
    makePublishCheckItem({
      key: 'sensory_coverage', label: '五感覆盖', status: sensoryCoverageStatus,
      detail: [
        narrativeControlReport.sensory.summary,
        `当前覆盖：${narrativeControlReport.sensory.coveredSenses.map((key) => narrativeControlReport.sensory.breakdown.find((entry) => entry.key === key)?.label || key).join('、') || '无'}`,
        narrativeControlReport.sensory.missingSenses.length > 0
          ? `当前缺口：${narrativeControlReport.sensory.missingSenses.map((key) => narrativeControlReport.sensory.breakdown.find((entry) => entry.key === key)?.label || key).join('、')}`
          : '',
        narrativeControlReport.sensory.focusSummary,
      ].filter(Boolean).join('；'),
      source: 'review', relatedPage: 'writing', fixHint: narrativeControlReport.sensory.fixHint,
    }),
    makePublishCheckItem({
      key: 'narrative_ratio', label: '动作 / 对话 / 内心 / 环境 / 解释比例', status: narrativeRatioStatus,
      detail: [narrativeControlReport.narrativeRatio.summary, ...narrativeControlReport.narrativeRatio.deviationReasons.slice(0, 3)].filter(Boolean).join('；'),
      source: 'review', relatedPage: 'writing', fixHint: narrativeControlReport.narrativeRatio.fixHint,
    }),
    makePublishCheckItem({
      key: 'transition_density', label: '过渡段疏密', status: transitionDensityStatus,
      detail: narrativeControlReport.transitionDensity.summary,
      source: 'review', relatedPage: 'writing', fixHint: narrativeControlReport.transitionDensity.fixHint,
    }),
    makePublishCheckItem({
      key: 'emotion_focus', label: '情绪主基调', status: emotionFocusStatus,
      detail: narrativeControlReport.emotionFocus.summary,
      source: 'review', relatedPage: 'writing', fixHint: narrativeControlReport.emotionFocus.fixHint,
    }),
    makePublishCheckItem({
      key: 'world_exposition', label: '世界观说明文', status: expositionStatus,
      detail: narrativeControlReport.exposition.summary,
      source: 'review', relatedPage: 'writing', fixHint: narrativeControlReport.exposition.fixHint,
    }),
  ]
}

function buildPublishHookAndThreadChecklist(input: PublishNarrativeChecklistInput): ChapterPublishCheckItem[] {
  const { hookStrengthStatus, chapterContract, sceneHookCount, reviewState } = input
  const { threadProgressStatus, missingRequiredThreads, untouchedRequiredThreads, overdueThreads } = input
  return [
    makePublishCheckItem({
      key: 'hook_strength', label: '钩子强度', status: hookStrengthStatus,
      detail: hookStrengthStatus === 'pass'
        ? `已配置章节钩子${chapterContract.hookType ? `（${chapterContract.hookType}）` : ''}，且当前没有明显追读流失风险。`
        : !chapterContract.hookType && sceneHookCount === 0
          ? '章节合同没有钩子定义，场景计划也没有明确 exit hook，当前章尾承接力不足。'
          : reviewState.readerHookRisks.slice(0, 2).join('；') || '当前章节的追读钩子仍偏弱，建议补强章尾承接。',
      source: 'review', relatedPage: 'contracts',
      fixHint: '补齐章节钩子定义，并回看场景 exit hook 是否真的把读者推进下一章。',
    }),
    makePublishCheckItem({
      key: 'thread_progress', label: '线索 / 线程推进度', status: threadProgressStatus,
      detail: threadProgressStatus === 'blocker'
        ? missingRequiredThreads.length > 0
          ? `章节合同绑定的故事线程缺失：${missingRequiredThreads.join('、')}。`
          : `章节合同要求服务的线程，本章还没有留下推进痕迹：${untouchedRequiredThreads.slice(0, 3).map((item) => item.title).join('、')}。`
        : threadProgressStatus === 'warning'
          ? `当前存在到期或超期未推进的线程：${overdueThreads.slice(0, 3).map((item) => item.title).join('、')}。`
          : chapterContract.servedThreadIds.length > 0
            ? `本章已触达 ${chapterContract.servedThreadIds.length} 条合同绑定线程。`
            : '当前没有命中明显的线程推进缺口。',
      source: 'thread', relatedPage: 'threads',
      fixHint: '回到故事线程或伏笔账本，确认本章真的推进、埋设或回收了对应条目。',
    }),
  ]
}

function buildPublishProgressAndRewriteChecklist(input: PublishNarrativeChecklistInput): ChapterPublishCheckItem[] {
  const { volumeAlignmentStatus, currentVolume, volumeSignals, lineProgressStatus } = input
  const { arcWarnings, reviewState, structuralRewriteReasons, rewriteTargetSource } = input
  return [
    makePublishCheckItem({
      key: 'volume_alignment', label: '卷目标一致性', status: volumeAlignmentStatus,
      detail: volumeAlignmentStatus === 'pass'
        ? currentVolume && volumeSignals.length > 0
          ? `${currentVolume.title || `第${currentVolume.volumeNumber}卷`} 的目标当前已有章节绑定承接。`
          : '当前章节未绑定明确卷目标，或卷设计尚未形成约束。'
        : `${currentVolume?.title || `第${currentVolume?.volumeNumber || '?'}卷`} 已设有卷目标，但本章没有形成有效承接。`,
      source: 'volume', relatedPage: 'volume-design',
      fixHint: '回到卷级设计确认本章该服务的承诺、冲突或线索，并把绑定落到章节合同。',
    }),
    makePublishCheckItem({
      key: 'line_progress', label: '本章是否真的推进了某条线', status: lineProgressStatus,
      detail: lineProgressStatus === 'blocker'
        ? [...arcWarnings, ...reviewState.arcProgressRisks].slice(0, 3).join('；') || '本章合同要求推进，但当前没有足够的推进证据。'
        : lineProgressStatus === 'warning'
          ? [...arcWarnings, ...reviewState.arcProgressRisks].slice(0, 3).join('；') || '当前没有识别到明确的主线推进痕迹。'
          : '当前章节具备可识别的弧线或线程推进。',
      source: 'thread', relatedPage: 'contracts',
      fixHint: '先确认本章要推进哪条弧线/线程，再补上清晰的推进记录或正文兑现。',
    }),
    makePublishCheckItem({
      key: 'rewrite_path', label: '润色可解 / 必须重写',
      status: structuralRewriteReasons.length > 0 ? 'rewrite' : reviewState.rewriteRequired || reviewState.severity === 'high' ? 'warning' : 'pass',
      detail: structuralRewriteReasons.length > 0
        ? structuralRewriteReasons.join('；')
        : reviewState.rewriteRequired || reviewState.severity === 'high'
          ? '当前更适合先做定向重写或局部返工，再决定是否标记完成。'
          : '当前问题仍可通过局部修订、润色和补记录解决。',
      source: 'review',
      segmentId: rewriteTargetSource?.segmentId,
      segmentTitle: rewriteTargetSource ? getSceneSnapshotLabel(rewriteTargetSource) : undefined,
      relatedPage: rewriteTargetSource?.segmentId ? 'structure' : 'writing',
      fixHint: structuralRewriteReasons.length > 0 ? '优先退回对应场景或章节重写，不要只做表层润色。' : '先在正文页做局部修订，再复检章节验收门。',
    }),
  ]
}

export function buildPublishNarrativeChecklist(input: PublishNarrativeChecklistInput): ChapterPublishCheckItem[] {
  return [
    ...buildPublishPerspectiveChecklist(input),
    ...buildPublishHookAndThreadChecklist(input),
    ...buildPublishProgressAndRewriteChecklist(input),
  ]
}

function annotateSemanticGateTakeover(
  checklist: ChapterPublishCheckItem[],
  degradedGateKeys: Set<string>,
): ChapterPublishCheckItem[] {
  if (degradedGateKeys.size === 0) return checklist
  return checklist.map((item) => degradedGateKeys.has(item.key)
    ? { ...item, detail: `${item.detail}${HEURISTIC_TAKEOVER_SUFFIX}` }
    : item)
}

function downgradePipelinePublishItem(
  item: ChapterPublishCheckItem,
  reviewState: ReviewStateSnapshot,
): ChapterPublishCheckItem {
  const usesUncheckedDraftEvidence = item.key === 'step_memory_handoff'
    || item.key === 'opening_hook'
    || item.key === 'title_and_hallucination'
  if (
    usesUncheckedDraftEvidence
    && !reviewState.rewriteRecheckPerformed
    && (item.status === 'blocker' || item.status === 'rewrite')
  ) {
    return {
      ...item,
      status: 'warning',
      detail: `${item.detail}（审校证据来自重写前初稿且未复检，已转修订任务复核）`,
    }
  }
  if (item.status !== 'blocker') return item
  if (item.key === 'summary' || item.key === 'continuity') {
    return {
      ...item,
      status: 'warning',
      detail: `${item.detail}（流水线入稿阶段将自动刷新，不阻断本次验收）`,
    }
  }
  if (item.key !== 'context') return item
  return {
    ...item,
    status: 'warning',
    detail: `${item.detail}（流水线入稿阶段已构建当前上下文，过期标记将由随后 finalize 的记忆刷新解除）`,
  }
}

export function prepareChapterPublishChecklist(input: {
  checklist: ChapterPublishCheckItem[]
  phase: 'pipeline' | 'final'
  reviewState: ReviewStateSnapshot
  degradedGateKeys: Set<string>
}): ChapterPublishCheckItem[] {
  const annotated = annotateSemanticGateTakeover(input.checklist, input.degradedGateKeys)
  return input.phase === 'pipeline'
    ? annotated.map((item) => downgradePipelinePublishItem(item, input.reviewState))
    : annotated
}
