import type {
  Chapter,
  ChapterBridgePlan,
  ChapterContextPreview,
  ChapterContractAudit,
  ChapterPublishCheck,
  ChapterSegment,
  ChapterVersion,
  Character,
  ConsistencyIssue,
  ForeshadowLedgerEntry,
  HardConstraintSourceLabel,
  NovelConsistencyReport,
  QualityDashboardData,
  ExpressionDedupReport,
  HookContinuitySnapshot,
  SummaryHealthReport,
  StoryFact,
  StoryItem,
  StoryMemorySnapshot,
  StoryVolume,
  TimelineEvent,
} from '../../../types'
import type { AiCheckPayload, ContinuityPayload, ReviewNotes, ScenePlanStep, WritingPipelineRoleState, WritingPipelineSnapshot } from './parsers'
import type { VolumeTruthRevealStats } from './components/InsightPanel/insight-utils'

export interface ChapterInspectorViewModel {
  chapter: Chapter | null
  focus: {
    summary?: string
    nextChapterSeed?: string
    continuityItems: string[]
    bridgeItems: string[]
    qualityItems: string[]
  }
  scenes: ScenePlanStep[]
  pipelineSnapshot: WritingPipelineSnapshot | null
  pipelineRoles: WritingPipelineRoleState[]
  pipelineExecutionModeLabel?: string
  contextPreview: ChapterContextPreview | null
  contextPreviewError: string | null
  preserveConstraintLabels: HardConstraintSourceLabel[]
  effectiveAiModeLabel: string
  productionBriefItems: string[]
  relatedInsightItems: string[]
  facts: StoryFact[]
  volumes: StoryVolume[]
  characters: Character[]
  allowedRevealFactIds: number[]
  revealedFactIds: number[]
  truthStats: VolumeTruthRevealStats
  revealConstraintsSaving: boolean
  chapterSegments: ChapterSegment[]
  foreshadowLedger: ForeshadowLedgerEntry[]
  foreshadowWritebackSaving: boolean
  dueForeshadowEyebrow: string
  dueForeshadowItems: string[]
  reviewInsightItems: string[]
  worldRulesSummary: string[]
  hasWorldRules: boolean
}

export interface ChapterInspectorActions {
  onOpenContracts(): void
  onPreserveConstraintChange(labels: HardConstraintSourceLabel[]): void
  onUpdateRevealConstraints(nextAllowedIds: number[], nextRevealedIds: number[]): Promise<void>
  onOpenInfoGapBoard(): void
  onCreateForeshadow(data: Partial<ForeshadowLedgerEntry>): Promise<void>
  onPatchForeshadow(id: number, data: Partial<ForeshadowLedgerEntry>): Promise<void>
  onDeleteForeshadow(entry: ForeshadowLedgerEntry): void
  onOpenForeshadowLedger(): void
}

export interface MemoryInspectorViewModel {
  storyMemory: StoryMemorySnapshot | null
  coverageSummary: string
  phaseDigest: string[]
  plotMilestones: string[]
  activeThreads: string[]
  timelineAnchors: string[]
  itemLedger: string[]
}

export interface PublishCheckSectionViewModel {
  key: string
  title: string
  items: ChapterPublishCheck['checklist']
}

export interface ReviewInspectorViewModel {
  consistencyReport: NovelConsistencyReport | null
  chapterIssues: ConsistencyIssue[]
  reviewNotes: ReviewNotes | null
  publishCheck: ChapterPublishCheck | null
  gateReportExpanded: boolean
  publishCheckDriftHighlights: string[]
  publishCheckHistoryItems: Array<{ id: number; text: string }>
  publishCheckScores: Array<{ label: string; value: number }>
  publishCheckSections: PublishCheckSectionViewModel[]
  contractAudit: ChapterContractAudit | null
  qualityDashboard: QualityDashboardData | null
  chapter: Chapter | null
  aiResult: AiCheckPayload | null
  aiScore: {
    genreContext: string
    novelBackground: string
    modelConfigId?: number
    novelId: number
    disabled: boolean
  }
  focusAreas: string[]
}

export interface ReviewInspectorActions {
  onOpenGateIssue(item: ChapterPublishCheck['checklist'][number]): void
  onToggleGateReport(): void
  onOpenQualityDashboard(): void
  onOpenWriteback(): void
  getEditorContent(): string
  onRegenerate(content: string): void
}

export interface HistoryVersionViewModel {
  id: number
  sourceLabel: string
  meta: string
  content: string
}

export interface HistoryInspectorViewModel {
  chapterSelected: boolean
  eyebrow: string
  loading: boolean
  versions: HistoryVersionViewModel[]
  selectedVersionId: number | null
  selectedContent: string
  canRestore: boolean
}

export interface HistoryInspectorActions {
  onSelectVersion(id: number): void
  onReturnToEditor(): void
  onRestoreVersion(): void
}

export interface WritingInspectorViewModels {
  editor: ChapterInspectorViewModel
  context: MemoryInspectorViewModel
  review: ReviewInspectorViewModel
  history: HistoryInspectorViewModel
}

export interface WritingInspectorActions {
  editor: ChapterInspectorActions
  review: ReviewInspectorActions
  history: HistoryInspectorActions
}

function compact(items: Array<string | false | null | undefined>): string[] {
  return items.filter((item): item is string => Boolean(item))
}

export function buildContinuityItems(continuity: ContinuityPayload | null): string[] {
  return compact([
    ...(continuity?.plot_progress || []).map((item) => `剧情推进：${item}`),
    ...(continuity?.character_state_changes || []).map((item) => `人物变化：${item}`),
    ...(continuity?.world_state_changes || []).map((item) => `世界变化：${item}`),
    ...(continuity?.open_loops || []).map((item) => `未回收线索：${item}`),
    ...(continuity?.continuity_notes || []).map((item) => `承接提示：${item}`),
    continuity?.arc_progress ? `故事弧推进：${continuity.arc_progress}` : '',
  ])
}

export function buildBridgeItems(bridgePlan: ChapterBridgePlan | null): string[] {
  return compact([
    bridgePlan?.locationTransition ? `地点承接：${bridgePlan.locationTransition}` : '',
    bridgePlan?.timeJump ? `时间承接：${bridgePlan.timeJump}` : '',
    bridgePlan?.emotionCarry ? `情绪承接：${bridgePlan.emotionCarry}` : '',
    bridgePlan?.firstSceneConstraint ? `首场景约束：${bridgePlan.firstSceneConstraint}` : '',
  ])
}

interface QualityFocusInput {
  summaryHealth: SummaryHealthReport | null
  expressionDedup: ExpressionDedupReport | null
  hookContinuity: HookContinuitySnapshot | null
  reviewNotes: ReviewNotes | null
  publishSummary?: string
  nextChapterSeed?: string
  voiceEvolutionSummary?: string
}

function buildSummaryHealthItems(summaryHealth: SummaryHealthReport | null): string[] {
  return compact([
    summaryHealth ? `摘要健康：${summaryHealth.status} · 密度 ${summaryHealth.densityScore} / 实体 ${summaryHealth.entityCoverageScore} / 事件 ${summaryHealth.eventCoverageScore}` : '',
    summaryHealth?.warnings?.[0] ? `摘要提醒：${summaryHealth.warnings[0]}` : '',
  ])
}

function buildExpressionDedupItems(expressionDedup: ExpressionDedupReport | null): string[] {
  return compact([
    expressionDedup?.mode
      ? `表达去重：${expressionDedup.mode === 'longform' ? '长篇' : '短篇'}窗口 · 近章 ${expressionDedup.recentWindowSize || 0} / 当前卷 ${expressionDedup.volumeWindowSize || 0} / 全书采样 ${expressionDedup.globalSampleWindowSize || 0}`
      : '',
    expressionDedup?.summary ? `跨章复用：${expressionDedup.summary}` : '',
    expressionDedup?.repeatedClimaxPatterns?.length ? `高潮复用：${expressionDedup.repeatedClimaxPatterns.slice(0, 3).join('、')}` : '',
    expressionDedup?.repeatedOpenings?.length ? `章首同质：${expressionDedup.repeatedOpenings.slice(0, 2).join('、')}` : '',
    expressionDedup?.repeatedClosings?.length ? `章尾同质：${expressionDedup.repeatedClosings.slice(0, 2).join('、')}` : '',
  ])
}

function buildQualityMetaItems(input: QualityFocusInput): string[] {
  return compact([
    input.hookContinuity?.warning ? `钩子连续性：${input.hookContinuity.warning}` : input.hookContinuity ? `钩子强度：${input.hookContinuity.hookStrengthScore}` : '',
    input.reviewNotes?.dialogue_fingerprint_summary ? `章节指纹：${input.reviewNotes.dialogue_fingerprint_summary}` : '',
    input.publishSummary ? `一致性快检：${input.publishSummary}` : '',
    input.nextChapterSeed ? `下一章开场建议：${input.nextChapterSeed}` : '',
    input.voiceEvolutionSummary || '',
  ])
}

export function buildQualityFocusItems(input: QualityFocusInput): string[] {
  return [
    ...buildSummaryHealthItems(input.summaryHealth),
    ...buildExpressionDedupItems(input.expressionDedup),
    ...buildQualityMetaItems(input),
  ]
}

export function buildRelatedInsightItems(events: TimelineEvent[], items: StoryItem[]): string[] {
  return [
    ...events.map((event) => `${event.timeLabel || '时间未标注'} · ${event.eventTitle}`),
    ...items.map((item) => `道具 / 线索：${item.itemName}${item.plotFunction ? ` · ${item.plotFunction}` : ''}`),
  ]
}

function buildReviewCoreItems(reviewNotes: ReviewNotes | null): string[] {
  return compact([
    reviewNotes?.summary ? `摘要回看：${reviewNotes.summary}` : '',
    reviewNotes?.revision_brief ? `修订摘要：${reviewNotes.revision_brief}` : '',
    reviewNotes?.contract_validation?.summary ? `合同兑现：${reviewNotes.contract_validation.summary}` : '',
    ...(reviewNotes?.critical_fixes || []).map((item) => `关键修订：${item}`),
    ...(reviewNotes?.continuity_risks || []).map((item) => `连续性风险：${item}`),
    ...(reviewNotes?.arc_progress_risks || []).map((item) => `弧推进风险：${item}`),
    ...(reviewNotes?.context_drift_risks || []).map((item) => `上下文漂移：${item}`),
  ])
}

function buildReviewQualityItems(reviewNotes: ReviewNotes | null): string[] {
  return compact([
    ...(reviewNotes?.realism_risks || []).map((item) => `真实度风险：${item}`),
    ...(reviewNotes?.coherence_risks || []).map((item) => `连贯性风险：${item}`),
    ...(reviewNotes?.reader_hook_risks || []).map((item) => `追读风险：${item}`),
    ...(reviewNotes?.language_risks || []).map((item) => `语言提示：${item}`),
    ...(reviewNotes?.human_language_repairs || []).map((item) => `语言替换：${item}`),
    ...(reviewNotes?.genre_hollowing_risks || []).map((item) => `体裁空心化：${item}`),
    reviewNotes?.dialogue_fingerprint_summary ? `对白辨识度：${reviewNotes.dialogue_fingerprint_summary}` : '',
    ...(reviewNotes?.dialogue_homogenization_risks || []).map((item) => `对白同质化：${item}`),
  ])
}

function buildReviewContractItems(reviewNotes: ReviewNotes | null): string[] {
  return (reviewNotes?.contract_validation?.itemResults || [])
    .filter((item) => item.verdict !== 'pass')
    .slice(0, 3)
    .map((item) => `合同缺口：${item.segmentTitle ? `${item.segmentTitle} · ` : ''}${item.expected}`)
}

function buildReviewDynamicsItems(reviewNotes: ReviewNotes | null): string[] {
  return compact([
    reviewNotes?.protagonist_setback && reviewNotes.protagonist_setback !== 'none'
      ? `主角受挫：${reviewNotes.protagonist_setback}${reviewNotes.setback_summary ? ` · ${reviewNotes.setback_summary}` : ''}`
      : '',
    reviewNotes?.cost_present ? `代价状态：${reviewNotes.cost_resolution_state || 'new'}${reviewNotes.cost_summary ? ` · ${reviewNotes.cost_summary}` : ''}` : '',
    reviewNotes?.reversal_marker ? `反转判断：${reviewNotes.reversal_support_state || 'weak'}${reviewNotes.reversal_summary ? ` · ${reviewNotes.reversal_summary}` : ''}` : '',
    reviewNotes?.pace_marker ? `节奏标签：${reviewNotes.pace_marker}` : '',
    reviewNotes?.reward_state && reviewNotes.reward_state !== 'none' ? `阶段回报：${reviewNotes.reward_state}` : '',
    typeof reviewNotes?.protagonist_pressure === 'number' && reviewNotes.protagonist_pressure > 0 ? `主角压力：${reviewNotes.protagonist_pressure}` : '',
  ])
}

export function buildReviewInsightItems(reviewNotes: ReviewNotes | null): string[] {
  return [
    ...buildReviewCoreItems(reviewNotes),
    ...buildReviewQualityItems(reviewNotes),
    ...buildReviewContractItems(reviewNotes),
    ...buildReviewDynamicsItems(reviewNotes),
  ]
}

function buildProductionRevisionItems(reviewNotes: ReviewNotes | null): string[] {
  return compact([
    reviewNotes?.revision_brief ? `定稿方向：${reviewNotes.revision_brief}` : '',
    ...(reviewNotes?.contract_validation?.rewriteHints || []).slice(0, 2).map((item) => `合同修补：${item}`),
    ...(reviewNotes?.critical_fixes || []).slice(0, 2).map((item) => `先改：${item}`),
    ...(reviewNotes?.arc_progress_risks || []).slice(0, 2).map((item) => `弧推进：${item}`),
    ...(reviewNotes?.coherence_risks || []).slice(0, 2).map((item) => `读者易乱：${item}`),
    ...(reviewNotes?.reader_hook_risks || []).slice(0, 2).map((item) => `追读流失点：${item}`),
    ...(reviewNotes?.human_language_repairs || []).slice(0, 2).map((item) => `语言替换：${item}`),
    ...(reviewNotes?.dialogue_homogenization_risks || []).slice(0, 2).map((item) => `对白区分：${item}`),
  ])
}

function buildProductionDynamicsItems(reviewNotes: ReviewNotes | null): string[] {
  return compact([
    reviewNotes?.cost_resolution_state === 'evaporated' ? '代价延续：当前章节不能把重大损失快速抹平。' : '',
    reviewNotes?.reversal_marker && reviewNotes?.reversal_support_state === 'forced' ? '反转支撑：补齐前文铺垫与触发链，再保留这次反转。' : '',
    reviewNotes?.protagonist_setback === 'none' && (reviewNotes?.reward_state === 'partial' || reviewNotes?.reward_state === 'major') && !reviewNotes?.cost_present
      ? '主角阻力：当前章偏顺推，建议补出真实失败、失误或代价。'
      : '',
  ])
}

export function buildProductionBriefItems(reviewNotes: ReviewNotes | null, aiIssues: AiCheckPayload['issues']): string[] {
  return [
    ...buildProductionRevisionItems(reviewNotes),
    ...buildProductionDynamicsItems(reviewNotes),
    ...aiIssues.slice(0, 2).map((issue) => `AI体检：${issue.suggestion}`),
  ]
}

function chapterVersionSourceLabel(source: ChapterVersion['versionSource']): string {
  if (source === 'ai-rewrite') return 'AI 重写'
  if (source === 'pipeline-generate') return '流水线生成'
  if (source === 'version-restore') return '历史恢复'
  return '手动保存'
}

export function buildMemoryInspectorViewModel(storyMemory: StoryMemorySnapshot | null): MemoryInspectorViewModel {
  return {
    storyMemory,
    coverageSummary: storyMemory?.coverageSummary || '长篇覆盖',
    phaseDigest: storyMemory?.phaseDigest || [],
    plotMilestones: storyMemory?.plotMilestones.slice(0, 12) || [],
    activeThreads: storyMemory?.activeThreads.slice(0, 12) || [],
    timelineAnchors: storyMemory?.timelineAnchors.slice(0, 10) || [],
    itemLedger: storyMemory?.itemLedger.slice(0, 10) || [],
  }
}

export function buildHistoryInspectorViewModel(input: {
  chapter: Chapter | null
  versions: ChapterVersion[]
  selectedVersion: ChapterVersion | null
  loading: boolean
}): HistoryInspectorViewModel {
  return {
    chapterSelected: Boolean(input.chapter),
    eyebrow: input.chapter ? `第${input.chapter.chapterNum}章 · 可恢复版本` : '选择章节后可查看',
    loading: input.loading,
    versions: input.versions.map((version) => ({
      id: version.id,
      sourceLabel: chapterVersionSourceLabel(version.versionSource),
      meta: `${version.wordCount || 0} 字 · ${new Date(version.createdAt).toLocaleString()}`,
      content: version.content,
    })),
    selectedVersionId: input.selectedVersion?.id || null,
    selectedContent: input.selectedVersion?.content || '先从左侧选择版本，再比较正文差异。',
    canRestore: Boolean(input.selectedVersion),
  }
}
