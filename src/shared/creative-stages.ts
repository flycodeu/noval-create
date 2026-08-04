import type { AgentArtifact, AgentArtifactStatus } from './agent-artifacts'

export type CreativeStageKind =
  | 'foundation'
  | 'volume'
  | 'arc'
  | 'chapter-window'
  | 'expansion'

export type CreativeStageStatus =
  | 'planned'
  | 'active'
  | 'locked'
  | 'completed'
  | 'archived'

export type CreativeStageAssetType =
  | 'character'
  | 'world'
  | 'map'
  | 'faction'
  | 'item'
  | 'thread'
  | 'timeline'
  | 'outline'

export type CreativeStageAssetRole = 'core' | 'supporting' | 'latent' | 'handoff'
export type CreativeStageAssetDetail = 'placeholder' | 'outline' | 'working' | 'canonical'
export type CreativeStageAssetStatus = 'planned' | 'draft' | 'active' | 'deferred' | 'retired'
export type CreativeStageContextHealthStatus = 'ready' | 'needs_setup' | 'stale'
export type CreativeStageHandoffStatus = AgentArtifactStatus | 'missing' | 'legacy' | 'stale'
export type CreativeStageGateLevel = 'pass' | 'warning' | 'blocker' | 'rewrite'
export type CreativeStageQualityTrendStatus = 'insufficient' | 'stable' | 'improving' | 'worsening'

export interface CreativeStage {
  id: number
  novelId: number
  sequence: number
  name: string
  kind: CreativeStageKind
  status: CreativeStageStatus
  chapterStart?: number
  chapterEnd?: number
  volumeId?: number
  partId?: number
  objective: string
  storySummary: string
  handoffSummary: string
  constraintsJson?: string
  contextVersion: number
  activeAssetCount: number
  plannedAssetCount: number
  coreAssetCount: number
  createdAt: string
  updatedAt: string
}

export interface CreativeStageCreateInput {
  name: string
  kind?: CreativeStageKind
  status?: CreativeStageStatus
  chapterStart?: number
  chapterEnd?: number
  volumeId?: number
  partId?: number
  objective?: string
  storySummary?: string
  handoffSummary?: string
  constraintsJson?: string
}

export interface CreativeStageUpdateInput extends Partial<CreativeStageCreateInput> {
  id: number
}

export interface CreativeStageAssetBinding {
  id: number
  novelId: number
  stageId: number
  assetType: CreativeStageAssetType
  assetId?: number
  placeholderName?: string
  role: CreativeStageAssetRole
  detailLevel: CreativeStageAssetDetail
  status: CreativeStageAssetStatus
  requestedFieldsJson?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface CreativeStageAssetInput {
  id?: number
  stageId: number
  assetType: CreativeStageAssetType
  assetId?: number
  placeholderName?: string
  role?: CreativeStageAssetRole
  detailLevel?: CreativeStageAssetDetail
  status?: CreativeStageAssetStatus
  requestedFieldsJson?: string
  notes?: string
}

/**
 * A compact, retrieval-time projection of a canonical asset.
 * It is intentionally not the asset record: the writer receives only the
 * fields needed by this stage and chapter window.
 */
export interface CreativeStageAssetBrief {
  assetType: CreativeStageAssetType
  assetId?: number
  name: string
  detail: string
}

export interface CreativeStageHandoffAssetContinuity {
  assetType: CreativeStageAssetType
  name: string
  change: 'introduced' | 'changed' | 'retired' | 'unchanged'
  note: string
}

export interface CreativeStageHandoffContent {
  schemaVersion: 'creative-stage-handoff-v1'
  stageId: number
  stageName: string
  chapterRange: string
  changes: string[]
  costs: string[]
  openQuestions: string[]
  nextPressure: string
  assetContinuity: CreativeStageHandoffAssetContinuity[]
}

export interface CreativeStageHandoffReviewContent {
  schemaVersion: 'creative-stage-handoff-review-v1'
  sourceArtifactId: string
  status: 'pass' | 'blocked'
  hardBlockers: string[]
  warnings: string[]
  checkedAt: string
}

export type CreativeStageHandoffArtifact = AgentArtifact<CreativeStageHandoffContent>

export interface CreativeStageHandoffInput {
  stageId: number
  parentArtifactId?: string | null
  /** Optional retry-safe key for system-generated seeds. */
  idempotencyKey?: string | null
  producerType?: AgentArtifact['producerType']
  producerId?: string
  producerClient?: string
  modelConfigId?: number | null
  taskId?: number | null
  changes: string[]
  costs: string[]
  openQuestions: string[]
  nextPressure: string
  assetContinuity?: CreativeStageHandoffAssetContinuity[]
}

export interface CreativeStageHandoffPacket {
  artifactId: string
  status: Extract<AgentArtifactStatus, 'approved'>
  version: number
  contextVersion: number
  content: CreativeStageHandoffContent
}

export interface CreativeStageContextHealth {
  status: CreativeStageContextHealthStatus
  warnings: string[]
  hardBlockers: string[]
}

export type CreativeStageQualityStatus = 'not_started' | 'needs_attention' | 'healthy'

export interface CreativeStageChapterQualityInput {
  chapterNum: number
  hasContent: boolean
  hasSummary: boolean
  hasContinuity: boolean
  gateLevel?: CreativeStageGateLevel
  gateReady?: boolean
  gateScore?: number
  gateBlockerCount?: number
  gateWarningCount?: number
  gateIssueKeys?: string[]
}

export interface CreativeStageQualityTrendPoint {
  chapterNum: number
  contentReady: boolean
  summaryReady: boolean
  continuityReady: boolean
  gateLevel?: CreativeStageGateLevel
  gateReady?: boolean
  gateScore?: number
  gateBlockerCount?: number
  gateWarningCount?: number
}

export interface CreativeStageQualityTrend {
  status: CreativeStageQualityTrendStatus
  points: CreativeStageQualityTrendPoint[]
  gateCoveredChapterCount: number
  averageGateScore?: number
  firstGateScore?: number
  latestGateScore?: number
  scoreDelta?: number
  readyRate?: number
  blockerChapterCount: number
  repeatedIssueKeys: Array<{ key: string; count: number }>
  summary: string
}

export interface CreativeStageQualitySnapshot {
  status: CreativeStageQualityStatus
  chapterCount: number
  completedChapterCount: number
  contentCoverageRate: number
  summaryCoverageRate: number
  continuityCoverageRate: number
  handoffRequired: boolean
  handoffStatus: CreativeStageHandoffStatus
  handoffCompleteness: {
    changes: boolean
    costs: boolean
    openQuestions: boolean
    nextPressure: boolean
  }
  trend: CreativeStageQualityTrend
  warnings: string[]
}

/**
 * This is the compact, inspectable packet sent to generation and review.
 * It deliberately contains stage boundaries and handoff state rather than a
 * second copy of the novel bible.
 */
export interface CreativeStageContextPacket {
  stageId: number
  projectContextVersion: number
  stageContextVersion: number
  chapterRange: string
  objective: string
  storyBoundary: string
  handoff: string
  handoffStatus: CreativeStageHandoffStatus
  approvedHandoff?: CreativeStageHandoffPacket
  focusAssets: Array<{
    type: CreativeStageAssetType
    name: string
    role: CreativeStageAssetRole
    detailLevel: CreativeStageAssetDetail
    status: CreativeStageAssetStatus
    brief?: string
  }>
}

export interface CreativeStageContext {
  stage: CreativeStage
  assets: CreativeStageAssetBinding[]
  activeCharacterIds: number[]
  activeMapIds: number[]
  promptSummary: string
  health: CreativeStageContextHealth
  quality: CreativeStageQualitySnapshot
  packet: CreativeStageContextPacket
}

export const CREATIVE_STAGE_KIND_OPTIONS: Array<{ value: CreativeStageKind; label: string; description: string }> = [
  { value: 'foundation', label: '全书底盘', description: '只锁定不可轻易推翻的核心设定与终局方向。' },
  { value: 'volume', label: '卷级阶段', description: '围绕一卷的主要冲突、人物弧和地点范围展开。' },
  { value: 'arc', label: '故事弧阶段', description: '围绕一条主线、支线或关系弧集中推进。' },
  { value: 'chapter-window', label: '章节窗口', description: '只为指定章节区间补齐当前真正会出场的资产。' },
  { value: 'expansion', label: '增量扩展', description: '在正文推进后补充新人物、地点或世界分支。' },
]

export const CREATIVE_STAGE_STATUS_OPTIONS: Array<{ value: CreativeStageStatus; label: string }> = [
  { value: 'planned', label: '待规划' },
  { value: 'active', label: '当前工作段' },
  { value: 'locked', label: '已锁定' },
  { value: 'completed', label: '已完成' },
  { value: 'archived', label: '已归档' },
]

export const CREATIVE_STAGE_ASSET_TYPE_OPTIONS: Array<{ value: CreativeStageAssetType; label: string }> = [
  { value: 'character', label: '人物' },
  { value: 'world', label: '世界规则' },
  { value: 'map', label: '地点' },
  { value: 'faction', label: '势力' },
  { value: 'item', label: '物品' },
  { value: 'thread', label: '剧情线程' },
  { value: 'timeline', label: '时间轴事件' },
  { value: 'outline', label: '大纲节点' },
]

export const CREATIVE_STAGE_ASSET_ROLE_OPTIONS: Array<{ value: CreativeStageAssetRole; label: string }> = [
  { value: 'core', label: '核心' },
  { value: 'supporting', label: '支撑' },
  { value: 'latent', label: '潜伏' },
  { value: 'handoff', label: '交接' },
]

export const CREATIVE_STAGE_CONTEXT_HEALTH_OPTIONS: Array<{ value: CreativeStageContextHealthStatus; label: string }> = [
  { value: 'ready', label: '可用于生成' },
  { value: 'needs_setup', label: '需要补齐' },
  { value: 'stale', label: '上下文过期' },
]

export function clampChapterRange(start?: number, end?: number): { chapterStart?: number; chapterEnd?: number } {
  const normalizedStart = Number.isFinite(start) && Number(start) > 0 ? Math.round(Number(start)) : undefined
  const normalizedEnd = Number.isFinite(end) && Number(end) > 0 ? Math.round(Number(end)) : undefined
  if (!normalizedStart && !normalizedEnd) return {}
  if (!normalizedStart) return { chapterEnd: normalizedEnd }
  if (!normalizedEnd) return { chapterStart: normalizedStart }
  return normalizedStart <= normalizedEnd
    ? { chapterStart: normalizedStart, chapterEnd: normalizedEnd }
    : { chapterStart: normalizedEnd, chapterEnd: normalizedStart }
}

export function formatCreativeStageRange(stage: Pick<CreativeStage, 'chapterStart' | 'chapterEnd'>): string {
  if (stage.chapterStart && stage.chapterEnd) return `第 ${stage.chapterStart}–${stage.chapterEnd} 章`
  if (stage.chapterStart) return `第 ${stage.chapterStart} 章起`
  if (stage.chapterEnd) return `截至第 ${stage.chapterEnd} 章`
  return '全书范围'
}

export function assessCreativeStageContext(
  stage: Pick<CreativeStage, 'kind' | 'objective' | 'storySummary' | 'handoffSummary' | 'contextVersion'>,
  assetCount: number,
  projectContextVersion: number,
  handoffContextVersion?: number,
): CreativeStageContextHealth {
  const hardBlockers: string[] = []
  const warnings: string[] = []
  const isFoundation = stage.kind === 'foundation'

  if (!stage.objective?.trim() && !isFoundation) hardBlockers.push('没有阶段目标，正文无法判断本段必须推进什么。')
  if (!stage.storySummary?.trim() && !isFoundation) hardBlockers.push('没有剧情边界，生成器可能提前展开后续阶段。')
  if (!stage.handoffSummary?.trim() && !isFoundation) warnings.push('尚未填写交接条件，阶段结束后容易丢失代价、关系和未决问题。')
  if (assetCount === 0 && !isFoundation) warnings.push('当前没有阶段资产焦点，建议先登记本窗口真正会出场的最小资产集。')
  if (handoffContextVersion !== undefined && handoffContextVersion !== projectContextVersion) {
    warnings.push(`阶段交接基于上下文 v${handoffContextVersion}，项目当前为 v${projectContextVersion}；请重新确认交接状态。`)
  }
  if (stage.contextVersion !== projectContextVersion) {
    warnings.push(`阶段基于上下文 v${stage.contextVersion}，项目当前为 v${projectContextVersion}；请重新确认阶段边界。`)
  }

  return {
    status: stage.contextVersion !== projectContextVersion
      || (handoffContextVersion !== undefined && handoffContextVersion !== projectContextVersion)
      ? 'stale'
      : hardBlockers.length > 0
        ? 'needs_setup'
        : 'ready',
    warnings,
    hardBlockers,
  }
}

export function getCreativeStageContextGenerationBlockers(
  health: CreativeStageContextHealth,
): string[] {
  if (health.status === 'ready') return []
  return [...health.hardBlockers, ...health.warnings].filter(Boolean)
}

export function buildCreativeStageContextPacket(
  stage: CreativeStage,
  assets: CreativeStageAssetBinding[],
  projectContextVersion: number,
  approvedHandoff?: CreativeStageHandoffPacket,
  handoffStatus?: CreativeStageHandoffStatus,
  assetBriefs: CreativeStageAssetBrief[] = [],
): CreativeStageContextPacket {
  const briefByKey = new Map(assetBriefs.map((brief) => [creativeStageAssetKey(brief), brief]))
  return {
    stageId: stage.id,
    projectContextVersion,
    stageContextVersion: stage.contextVersion,
    chapterRange: formatCreativeStageRange(stage),
    objective: stage.objective || '',
    storyBoundary: stage.storySummary || '',
    handoff: approvedHandoff
      ? formatCreativeStageHandoff(approvedHandoff.content)
      : stage.handoffSummary || '',
    handoffStatus: handoffStatus || (stage.handoffSummary ? 'legacy' : 'missing'),
    approvedHandoff,
    focusAssets: assets.map((asset) => {
      const brief = briefByKey.get(creativeStageAssetKey(asset))
      return {
        type: asset.assetType,
        name: brief?.name || asset.placeholderName?.trim() || `${asset.assetType}#${asset.assetId ?? '待建'}`,
        role: asset.role,
        detailLevel: asset.detailLevel,
        status: asset.status,
        brief: brief?.detail || undefined,
      }
    }),
  }
}

export function creativeStageAssetKey(asset: {
  assetType: CreativeStageAssetType
  assetId?: number
  placeholderName?: string
  name?: string
}): string {
  return `${asset.assetType}:${asset.assetId ?? `name:${asset.placeholderName?.trim() || asset.name?.trim() || '待建'}`}`
}

export function formatCreativeStageHandoff(content: CreativeStageHandoffContent): string {
  return [
    `变化：${content.changes.join('；') || '未填写'}`,
    `代价：${content.costs.join('；') || '未填写'}`,
    `未决问题：${content.openQuestions.join('；') || '无'}`,
    `下一压力：${content.nextPressure || '未填写'}`,
  ].join('\n')
}

export function assessCreativeStageHandoff(content: Pick<CreativeStageHandoffContent, 'changes' | 'costs' | 'openQuestions' | 'nextPressure'>): { hardBlockers: string[]; warnings: string[] } {
  const hardBlockers: string[] = []
  const warnings: string[] = []
  if (content.changes.length === 0) hardBlockers.push('交接缺少本阶段已发生的状态变化。')
  if (!content.nextPressure.trim()) hardBlockers.push('交接缺少下一阶段压力，正文无法形成明确承接。')
  if (content.costs.length === 0) warnings.push('交接没有记录代价，容易出现胜利后代价蒸发。')
  if (content.openQuestions.length === 0) warnings.push('交接没有记录未决问题，下一阶段可能失去悬念抓手。')
  return { hardBlockers, warnings }
}

export function buildCreativeStageQualitySnapshot(
  chapters: CreativeStageChapterQualityInput[],
  options: {
    handoffRequired?: boolean
    handoffStatus: CreativeStageHandoffStatus
    approvedHandoff?: Pick<CreativeStageHandoffContent, 'changes' | 'costs' | 'openQuestions' | 'nextPressure'>
  },
): CreativeStageQualitySnapshot {
  const chapterCount = chapters.length
  const completedChapterCount = chapters.filter((chapter) => chapter.hasContent).length
  const rate = (count: number) => chapterCount > 0 ? Math.round((count / chapterCount) * 100) : 0
  const handoff = options.approvedHandoff
  const handoffCompleteness = {
    changes: Boolean(handoff?.changes.length),
    costs: Boolean(handoff?.costs.length),
    openQuestions: Boolean(handoff?.openQuestions.length),
    nextPressure: Boolean(handoff?.nextPressure.trim()),
  }
  const warnings: string[] = []
  const trendPoints: CreativeStageQualityTrendPoint[] = chapters
    .slice()
    .sort((left, right) => left.chapterNum - right.chapterNum)
    .map((chapter) => ({
      chapterNum: chapter.chapterNum,
      contentReady: chapter.hasContent,
      summaryReady: chapter.hasSummary,
      continuityReady: chapter.hasContinuity,
      ...(chapter.gateLevel ? { gateLevel: chapter.gateLevel } : {}),
      ...(typeof chapter.gateReady === 'boolean' ? { gateReady: chapter.gateReady } : {}),
      ...(typeof chapter.gateScore === 'number' && Number.isFinite(chapter.gateScore) ? { gateScore: Math.max(0, Math.min(100, Math.round(chapter.gateScore))) } : {}),
      ...(typeof chapter.gateBlockerCount === 'number' ? { gateBlockerCount: Math.max(0, Math.round(chapter.gateBlockerCount)) } : {}),
      ...(typeof chapter.gateWarningCount === 'number' ? { gateWarningCount: Math.max(0, Math.round(chapter.gateWarningCount)) } : {}),
    }))
  const gatePoints = chapters
    .filter((chapter) => (
      chapter.gateLevel !== undefined
      || typeof chapter.gateReady === 'boolean'
      || (typeof chapter.gateScore === 'number' && Number.isFinite(chapter.gateScore))
      || typeof chapter.gateBlockerCount === 'number'
      || typeof chapter.gateWarningCount === 'number'
      || Boolean(chapter.gateIssueKeys?.length)
    ))
    .sort((left, right) => left.chapterNum - right.chapterNum)
  const scoredGatePoints = gatePoints
    .filter((chapter) => typeof chapter.gateScore === 'number' && Number.isFinite(chapter.gateScore))
  const gateScores = scoredGatePoints.map((chapter) => Math.max(0, Math.min(100, Math.round(chapter.gateScore as number))))
  const firstGateScore = gateScores[0]
  const latestGateScore = gateScores[gateScores.length - 1]
  const scoreDelta = firstGateScore !== undefined && latestGateScore !== undefined
    ? latestGateScore - firstGateScore
    : undefined
  const readyCount = gatePoints.filter((chapter) => chapter.gateReady === true).length
  const notReadyCount = gatePoints.length - readyCount
  const repeatedIssueKeys = [...gatePoints.reduce((counts, chapter) => {
    ;(chapter.gateIssueKeys || []).forEach((key) => {
      const normalized = key.trim()
      if (normalized) counts.set(normalized, (counts.get(normalized) || 0) + 1)
    })
    return counts
  }, new Map<string, number>())]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, 'zh-CN'))
    .slice(0, 5)
  const blockerChapterCount = chapters.filter((chapter) => chapter.gateLevel === 'blocker' || chapter.gateLevel === 'rewrite').length
  const trendStatus: CreativeStageQualityTrendStatus = gateScores.length < 2
    ? 'insufficient'
    : (scoreDelta || 0) >= 8
      ? 'improving'
      : (scoreDelta || 0) <= -8
        ? 'worsening'
        : 'stable'
  const trendSummary = gatePoints.length === 0
    ? '当前阶段还没有章节验收门快照，不能用摘要覆盖率替代 20/100 章质量证据。'
    : gateScores.length === 0
      ? `已覆盖 ${gatePoints.length}/${chapterCount} 个章节验收门，但这些快照缺少可用门分，不能计算趋势。`
      : `已覆盖 ${gatePoints.length}/${chapterCount} 个章节验收门，${gateScores.length} 个含可用门分，平均门分 ${Math.round(gateScores.reduce((sum, score) => sum + score, 0) / gateScores.length)}；${scoreDelta === undefined ? '暂无趋势基线' : `相对首个快照${scoreDelta >= 0 ? '+' : ''}${scoreDelta}分`}。`
  const trend: CreativeStageQualityTrend = {
    status: trendStatus,
    points: trendPoints,
    gateCoveredChapterCount: gatePoints.length,
    ...(gateScores.length > 0 ? {
      averageGateScore: Math.round(gateScores.reduce((sum, score) => sum + score, 0) / gateScores.length),
      firstGateScore,
      latestGateScore,
    } : {}),
    ...(scoreDelta !== undefined ? { scoreDelta } : {}),
    ...(gatePoints.length > 0 ? { readyRate: Math.round((readyCount / gatePoints.length) * 100) } : {}),
    blockerChapterCount,
    repeatedIssueKeys,
    summary: trendSummary,
  }
  if (chapterCount === 0) warnings.push('当前阶段还没有可评估的章节。')
  if (chapterCount > 0 && completedChapterCount < chapterCount) warnings.push(`${chapterCount - completedChapterCount} 个章节还没有正文。`)
  if (completedChapterCount > 0 && gatePoints.length < completedChapterCount) warnings.push(`${completedChapterCount - gatePoints.length} 个已完成章节尚未有验收门快照，不能把摘要覆盖当作质量通过。`)
  if (gatePoints.length > gateScores.length) warnings.push(`${gatePoints.length - gateScores.length} 个章节验收门缺少可用门分，阶段趋势证据不完整。`)
  if (notReadyCount > 0) warnings.push(`${notReadyCount} 个章节验收门尚未就绪（gateReady=false 或缺少就绪证据），阶段不能标记为健康。`)
  if (blockerChapterCount > 0) warnings.push(`${blockerChapterCount} 个章节验收门处于阻塞或重写状态，阶段不应直接扩展。`)
  if (chapterCount > 0 && rate(chapters.filter((chapter) => chapter.hasSummary).length) < 100) warnings.push('部分章节缺少章后摘要，长篇召回会变薄。')
  if (chapterCount > 0 && rate(chapters.filter((chapter) => chapter.hasContinuity).length) < 100) warnings.push('部分章节缺少连续性状态，人物和线程交接不完整。')
  if (options.handoffRequired && options.handoffStatus !== 'approved') warnings.push('阶段已到交接窗口，但还没有作者确认的 handoff。')
  if (options.handoffRequired && options.approvedHandoff) {
    const assessment = assessCreativeStageHandoff(options.approvedHandoff)
    warnings.push(...assessment.hardBlockers, ...assessment.warnings)
  }
  return {
    status: chapterCount === 0 ? 'not_started' : warnings.length > 0 ? 'needs_attention' : 'healthy',
    chapterCount,
    completedChapterCount,
    contentCoverageRate: rate(completedChapterCount),
    summaryCoverageRate: rate(chapters.filter((chapter) => chapter.hasSummary).length),
    continuityCoverageRate: rate(chapters.filter((chapter) => chapter.hasContinuity).length),
    handoffRequired: Boolean(options.handoffRequired),
    handoffStatus: options.handoffStatus,
    handoffCompleteness,
    trend,
    warnings: [...new Set(warnings)],
  }
}

export function normalizeCreativeStageHandoffList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/u) : []
  return [...new Set(values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))].slice(0, 20)
}

export function buildCreativeStagePromptSummary(context: Pick<CreativeStageContext, 'stage' | 'assets'> & {
  handoff?: CreativeStageHandoffPacket
  assetBriefs?: CreativeStageAssetBrief[]
}): string {
  const { stage, assets, handoff, assetBriefs = [] } = context
  const briefByKey = new Map(assetBriefs.map((brief) => [creativeStageAssetKey(brief), brief]))
  const grouped = new Map<string, string[]>()
  assets.forEach((asset) => {
    const key = asset.assetType
    const brief = briefByKey.get(creativeStageAssetKey(asset))
    const name = brief?.name || asset.placeholderName?.trim() || `${asset.assetType}#${asset.assetId ?? '待建'}`
    grouped.set(key, [...(grouped.get(key) || []), `${name}（${asset.role} / ${asset.detailLevel}）${brief?.detail ? `：${brief.detail}` : ''}`])
  })
  const assetLines = [...grouped.entries()].map(([type, names]) => `- ${type}: ${names.join('、')}`)
  return [
    `当前创作阶段：${stage.name}（${formatCreativeStageRange(stage)}）`,
    stage.objective ? `阶段目标：${stage.objective}` : '',
    stage.storySummary ? `本段剧情：${stage.storySummary}` : '',
    handoff ? `已确认阶段交接：\n${formatCreativeStageHandoff(handoff.content)}` : stage.handoffSummary ? `交接条件：${stage.handoffSummary}` : '',
    assetLines.length > 0 ? `阶段资产清单：\n${assetLines.join('\n')}` : '阶段资产清单：尚未登记，生成器只能补充当前窗口所需的最小资产。',
  ].filter(Boolean).join('\n')
}
