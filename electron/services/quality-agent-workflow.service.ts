import type { AgentArtifact } from '../../src/shared/agent-artifacts'
import type {
  AgentQualityRepairDraftContent,
  AgentQualityRepairDraftChapter,
  AgentQualityRepairDraftChapterReview,
  AgentQualityRepairReviewContent,
  AgentQualitySemanticDimension,
  AgentQualityFinding,
  AgentQualityReportContent,
  AgentQualityRunComparison,
  AgentQualityScope,
  AgentRepairPlanContent,
  AgentRepairPlanItem,
  ApplyAgentQualityRepairDraftInput,
  ApplyAgentQualityRepairDraftResult,
  CompareAgentQualityRunsInput,
  ProposeAgentQualityRepairsInput,
  ProposeAgentQualityRepairsResult,
  ReviewAgentQualityRepairDraftInput,
  ReviewAgentQualityRepairDraftResult,
  RunAgentQualitySemanticEvaluationInput,
  RunAgentQualitySemanticEvaluationResult,
  RunAgentQualityEvaluationInput,
  RunAgentQualityEvaluationResult,
} from '../../src/shared/quality-agent-workflow'
import { QualityWorkflowError } from '../application/quality-workflow-error'
import {
  buildQualityRepairReviewPrompt,
  normalizeQualityRepairChapterReview,
} from '../application/quality-repair-review'
import {
  buildSemanticReviewPrompt,
  buildSemanticReviewWindows,
  normalizeSemanticWindowReview,
  type NormalizedSemanticWindowReview,
  type SemanticReviewFinding,
  type SemanticReviewSourceChapter,
} from '../application/quality-semantic-review'
import {
  buildAgentQualityReport,
  type AgentQualityDashboardSource,
} from '../application/quality-evaluation'
import {
  ArtifactServiceError,
  createArtifact,
  findArtifactByIdempotency,
  hashArtifactContent,
  requireArtifact,
  updateArtifactLifecycle,
} from './artifact.service'
import {
  buildAiModelRouteReport,
  buildChatOptionsFromRoute,
  resolveAiExecutionMode,
} from './ai-engine.service'
import { getQualityDashboardData } from './quality-dashboard.service'
import { getNovel } from './novel.service'
import { listChapters, optimizeChapterContent } from './chapter.service'
import { runChatTask } from './task.service'
import { safeParseJson } from '../utils/json'

export { QualityWorkflowError }

const SEVERITY_RANK: Record<AgentQualityFinding['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

const STATUS_RANK: Record<AgentQualityReportContent['status'], number> = {
  blocked: 0,
  needs_revision: 1,
  passed: 2,
}

const DEFAULT_SEMANTIC_DIMENSIONS: AgentQualitySemanticDimension[] = [
  'causality',
  'character_arc',
  'theme_progression',
  'world_consistency',
  'foreshadow_payoff',
  'pacing',
]

function normalizeLines(values: string[] | undefined, limit: number): string[] {
  return [...new Set((values || []).map((value) => value.trim()).filter(Boolean))].slice(0, limit)
}

function mapArtifactError(error: unknown): never {
  if (error instanceof QualityWorkflowError) throw error
  if (error instanceof ArtifactServiceError) {
    if (error.code === 'IDEMPOTENCY_KEY_CONFLICT') {
      throw new QualityWorkflowError('IDEMPOTENCY_KEY_CONFLICT', error.message)
    }
    throw error
  }
  throw error
}

function requireProject(novelId: number) {
  const novel = getNovel(novelId)
  if (!novel) throw new QualityWorkflowError('PROJECT_NOT_FOUND', `项目 ${novelId} 不存在。`)
  return novel
}

function requireQualityReport(
  novelId: number,
  artifactId: string,
): AgentArtifact<AgentQualityReportContent> {
  let artifact: AgentArtifact<AgentQualityReportContent>
  try {
    artifact = requireArtifact<AgentQualityReportContent>(artifactId)
  } catch (error) {
    return mapArtifactError(error)
  }
  if (artifact.novelId !== novelId
    || artifact.kind !== 'quality_report'
    || artifact.content.schemaVersion !== 'agent-quality-report-v1') {
    throw new QualityWorkflowError('QUALITY_REPORT_INVALID', '指定工件不是当前项目的智能体质量评审报告。')
  }
  return artifact
}

function requireRepairPlan(
  novelId: number,
  artifactId: string,
): AgentArtifact<AgentRepairPlanContent> {
  let artifact: AgentArtifact<AgentRepairPlanContent>
  try {
    artifact = requireArtifact<AgentRepairPlanContent>(artifactId)
  } catch (error) {
    return mapArtifactError(error)
  }
  if (artifact.novelId !== novelId
    || artifact.kind !== 'repair_plan'
    || artifact.content.schemaVersion !== 'agent-repair-plan-v1'
    || artifact.content.canonicalWriteAllowed !== false) {
    throw new QualityWorkflowError('REPAIR_PLAN_INVALID', '指定工件不是当前项目的安全质量修复计划。')
  }
  return artifact
}

function requireRepairDraft(
  novelId: number,
  artifactId: string,
): AgentArtifact<AgentQualityRepairDraftContent> {
  let artifact: AgentArtifact<AgentQualityRepairDraftContent>
  try {
    artifact = requireArtifact<AgentQualityRepairDraftContent>(artifactId)
  } catch (error) {
    return mapArtifactError(error)
  }
  if (artifact.novelId !== novelId
    || artifact.kind !== 'quality_repair_draft'
    || artifact.content.schemaVersion !== 'agent-quality-repair-draft-v1'
    || artifact.content.canonicalWriteAllowed !== false) {
    throw new QualityWorkflowError('REPAIR_DRAFT_INVALID', '指定工件不是当前项目的安全质量修订草稿。')
  }
  return artifact
}

function resolveScope(
  input: RunAgentQualityEvaluationInput,
  dashboard: AgentQualityDashboardSource,
): AgentQualityScope {
  const scopeType = input.scopeType || 'novel'
  if (scopeType === 'novel') {
    if (input.volumeId || input.chapterId) {
      throw new QualityWorkflowError('QUALITY_SCOPE_INVALID', '整书评审不能同时指定 volumeId 或 chapterId。')
    }
    return {
      type: 'novel',
      label: '整书',
      chapterNums: dashboard.chapterDetails.map((chapter) => chapter.chapterNum).sort((left, right) => left - right),
    }
  }
  if (scopeType === 'volume') {
    if (!input.volumeId || input.chapterId) {
      throw new QualityWorkflowError('QUALITY_SCOPE_INVALID', '分卷评审必须且只能指定 volumeId。')
    }
    const volume = dashboard.volumeQualityMetrics.find((entry) => entry.volumeId === input.volumeId)
    if (!volume) throw new QualityWorkflowError('QUALITY_SCOPE_INVALID', `找不到分卷 ${input.volumeId}。`)
    return {
      type: 'volume',
      label: `第${volume.volumeNumber}卷「${volume.volumeName}」`,
      volumeId: volume.volumeId,
      chapterNums: dashboard.chapterDetails
        .filter((chapter) => chapter.volumeId === volume.volumeId)
        .map((chapter) => chapter.chapterNum)
        .sort((left, right) => left - right),
    }
  }
  if (!input.chapterId || input.volumeId) {
    throw new QualityWorkflowError('QUALITY_SCOPE_INVALID', '单章评审必须且只能指定 chapterId。')
  }
  const chapter = dashboard.chapterDetails.find((entry) => entry.chapterId === input.chapterId)
  if (!chapter) throw new QualityWorkflowError('QUALITY_SCOPE_INVALID', `找不到章节 ${input.chapterId} 或该章尚无质量快照。`)
  return {
    type: 'chapter',
    label: `第${chapter.chapterNum}章「${chapter.title}」`,
    ...(chapter.volumeId ? { volumeId: chapter.volumeId } : {}),
    chapterId: chapter.chapterId,
    chapterNums: [chapter.chapterNum],
  }
}

function scopeKey(scope: AgentQualityScope): string {
  return `${scope.type}:${scope.volumeId || 0}:${scope.chapterId || 0}`
}

function evaluationFingerprint(input: RunAgentQualityEvaluationInput): string {
  return hashArtifactContent({
    novelId: input.novelId,
    scopeType: input.scopeType || 'novel',
    volumeId: input.volumeId || null,
    chapterId: input.chapterId || null,
    profile: input.profile || 'longform_health_v1',
    maxFindings: Math.max(1, Math.min(input.maxFindings || 24, 50)),
    baselineReportArtifactId: input.baselineReportArtifactId || null,
  })
}

function assertComparableBaseline(
  baseline: AgentArtifact<AgentQualityReportContent>,
  profile: AgentQualityReportContent['profile']['profile'],
  scope: AgentQualityScope,
): void {
  if (baseline.content.profile.profile !== profile || scopeKey(baseline.content.scope) !== scopeKey(scope)) {
    throw new QualityWorkflowError(
      'QUALITY_REPORT_INCOMPATIBLE',
      '基线报告与本次评审的 profile 或 scope 不一致，不能建立同一版本链。',
    )
  }
}

export function runAgentQualityEvaluation(
  input: RunAgentQualityEvaluationInput,
): RunAgentQualityEvaluationResult {
  if (!input.idempotencyKey?.trim()) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '质量评审必须提供幂等键。')
  }
  const novel = requireProject(input.novelId)
  const fingerprint = evaluationFingerprint(input)
  const replay = findArtifactByIdempotency<AgentQualityReportContent>(
    input.novelId,
    'quality_report',
    input.idempotencyKey,
  )
  if (replay) {
    if (replay.content.schemaVersion !== 'agent-quality-report-v1'
      || replay.content.requestFingerprint !== fingerprint) {
      throw new QualityWorkflowError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于另一份质量评审请求。')
    }
    return { reportArtifact: replay, report: replay.content, idempotentReplay: true }
  }

  const dashboard = getQualityDashboardData(input.novelId, { includeDialogueInsights: true })
  const scope = resolveScope(input, dashboard)
  const profile = input.profile || 'longform_health_v1'
  let baseline: AgentArtifact<AgentQualityReportContent> | null = null
  if (input.baselineReportArtifactId) {
    baseline = requireQualityReport(input.novelId, input.baselineReportArtifactId)
    assertComparableBaseline(baseline, profile, scope)
  }
  const contextVersion = novel.contextVersion || 1
  const report = buildAgentQualityReport({
    requestFingerprint: fingerprint,
    profile,
    scope,
    dashboard,
    contextVersion,
    baselineReportArtifactId: baseline?.id || null,
    maxFindings: Math.max(1, Math.min(input.maxFindings || 24, 50)),
  })
  try {
    const reportArtifact = createArtifact({
      novelId: input.novelId,
      kind: 'quality_report',
      status: 'reviewed',
      parentArtifactId: baseline?.id || null,
      content: report,
      contextVersion,
      producerType: 'system',
      producerId: 'agent-quality-evaluator-v1',
      producerClient: 'novelforge-quality-agent-workflow',
      idempotencyKey: input.idempotencyKey,
    })
    return { reportArtifact, report, idempotentReplay: false }
  } catch (error) {
    return mapArtifactError(error)
  }
}

function semanticEvaluationFingerprint(
  input: RunAgentQualitySemanticEvaluationInput,
  sourceReport: AgentArtifact<AgentQualityReportContent>,
  dimensions: AgentQualitySemanticDimension[],
): string {
  return hashArtifactContent({
    novelId: input.novelId,
    sourceReportArtifactId: sourceReport.id,
    sourceReportContentHash: sourceReport.contentHash,
    dimensions,
    maxWindows: Math.max(1, Math.min(Math.floor(input.maxWindows || 12), 20)),
    maxFindings: Math.max(1, Math.min(Math.floor(input.maxFindings || 24), 40)),
    executionMode: input.executionMode || null,
  })
}

function toAgentSemanticFinding(
  finding: SemanticReviewFinding,
  sourceChapters: SemanticReviewSourceChapter[],
  blockCritical: boolean,
): AgentQualityFinding {
  const signature = hashArtifactContent({
    dimension: finding.dimension,
    title: finding.title.toLowerCase(),
    chapterNums: finding.chapterNums,
  })
  const volumeIds = uniqueNumbers(finding.chapterNums
    .map((chapterNum) => sourceChapters.find((chapter) => chapter.chapterNum === chapterNum)?.volumeId || 0)
    .filter((volumeId) => volumeId > 0))
  return {
    id: `semantic_${signature.slice(-16)}`,
    signature,
    code: `semantic_${finding.dimension}`,
    kind: 'semantic',
    severity: finding.severity,
    blocking: blockCritical && finding.severity === 'critical',
    title: finding.title,
    detail: finding.detail,
    whyItHappened: finding.whyItHappened,
    howToFix: finding.howToFix,
    ...(volumeIds.length === 1 ? { volumeId: volumeIds[0] } : {}),
    chapterNums: finding.chapterNums,
    evidenceRefs: finding.evidence.map((evidence) => (
      `chapter:${evidence.chapterNum}:excerpt:${evidence.excerpt}${evidence.explanation ? ` (${evidence.explanation})` : ''}`
    )),
    suggestedActions: [],
  }
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

function dedupeSemanticFindings(findings: AgentQualityFinding[]): AgentQualityFinding[] {
  const bySignature = new Map<string, AgentQualityFinding>()
  findings.forEach((finding) => {
    const existing = bySignature.get(finding.signature)
    if (!existing) {
      bySignature.set(finding.signature, finding)
      return
    }
    existing.chapterNums = uniqueNumbers([...existing.chapterNums, ...finding.chapterNums])
    existing.evidenceRefs = normalizeLines([...existing.evidenceRefs, ...finding.evidenceRefs], 12)
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) {
      existing.severity = finding.severity
      existing.blocking = finding.blocking
    }
  })
  return [...bySignature.values()]
}

export async function runAgentQualitySemanticEvaluation(
  input: RunAgentQualitySemanticEvaluationInput,
): Promise<RunAgentQualitySemanticEvaluationResult> {
  if (!input.idempotencyKey?.trim()) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '跨章语义评审必须提供幂等键。')
  }
  const requestedDimensions = input.dimensions || DEFAULT_SEMANTIC_DIMENSIONS
  const dimensions = [...new Set(requestedDimensions)]
  if (dimensions.length === 0
    || dimensions.some((entry) => !DEFAULT_SEMANTIC_DIMENSIONS.includes(entry))) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '跨章语义评审维度无效或为空。')
  }
  const novel = requireProject(input.novelId)
  const sourceReportArtifact = requireQualityReport(input.novelId, input.reportArtifactId)
  if (sourceReportArtifact.content.semanticReview) {
    throw new QualityWorkflowError('QUALITY_REPORT_INVALID', '请从未增强的确定性质量报告启动跨章语义评审，不能重复嵌套增强。')
  }
  const fingerprint = semanticEvaluationFingerprint(input, sourceReportArtifact, dimensions)
  const replay = findArtifactByIdempotency<AgentQualityReportContent>(
    input.novelId,
    'quality_report',
    input.idempotencyKey,
  )
  if (replay) {
    if (replay.content.schemaVersion !== 'agent-quality-report-v1'
      || replay.content.requestFingerprint !== fingerprint
      || replay.content.semanticReview?.sourceReportArtifactId !== sourceReportArtifact.id) {
      throw new QualityWorkflowError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于另一份跨章语义质量评审。')
    }
    return {
      sourceReportArtifact,
      reportArtifact: replay,
      report: replay.content,
      idempotentReplay: true,
    }
  }
  const currentContextVersion = novel.contextVersion || 1
  if (currentContextVersion !== sourceReportArtifact.contextVersion) {
    throw new QualityWorkflowError(
      'QUALITY_REPORT_STALE',
      `源质量报告基于 Context v${sourceReportArtifact.contextVersion}，当前为 v${currentContextVersion}；请先重新运行确定性评审。`,
    )
  }

  const scopeChapterNums = new Set(sourceReportArtifact.content.scope.chapterNums)
  const sourceChapters: SemanticReviewSourceChapter[] = listChapters(input.novelId)
    .filter((chapter) => scopeChapterNums.has(chapter.chapterNum))
    .map((chapter) => ({
      chapterId: chapter.id,
      chapterNum: chapter.chapterNum,
      title: chapter.title,
      volumeId: chapter.volumeId,
      summary: chapter.summary,
      outline: chapter.outline,
      content: chapter.content,
    }))
  if (sourceChapters.length === 0) {
    throw new QualityWorkflowError('QUALITY_SCOPE_INVALID', '源报告范围内没有可用于跨章语义评审的章节证据。')
  }
  const maxWindows = Math.max(1, Math.min(Math.floor(input.maxWindows || 12), 20))
  const windows = buildSemanticReviewWindows(sourceChapters, maxWindows)
  if (windows.length === 0) {
    throw new QualityWorkflowError('QUALITY_SCOPE_INVALID', '无法为源报告构建跨章语义证据窗口。')
  }
  const mode = resolveAiExecutionMode({
    explicitMode: input.executionMode,
    settingsJson: novel.settingsJson,
  })
  const route = buildAiModelRouteReport({
    taskKind: 'generic_prompt',
    stageLabel: 'Cross-chapter Semantic Quality Review',
    executionMode: mode.mode,
    resolutionSource: mode.source,
    modelConfigId: novel.modelConfigId || undefined,
    temperatureCap: 0.2,
    reviewDepth: 'deep',
    maxTokensFactor: 1.2,
    extraReasons: ['跨章/跨卷评审只接纳能回指输入章节摘要或首尾片段的模型证据。'],
  })
  const taskIds: number[] = []
  const windowReviews: NormalizedSemanticWindowReview[] = []
  for (const window of windows) {
    let rawOutput = ''
    let taskId = 0
    let parseError = ''
    try {
      rawOutput = await runChatTask({
        type: 'review',
        novelId: input.novelId,
        modelConfigId: route.modelConfigId,
        relatedEntityType: 'quality_semantic_window',
        relatedEntityId: input.novelId,
        messages: [{ role: 'user', content: buildSemanticReviewPrompt({ window, dimensions }) }],
        chatOpts: buildChatOptionsFromRoute(route),
        retryable: true,
        onSuccess: (_output, createdTaskId) => { taskId = createdTaskId },
      })
      if (taskId) taskIds.push(taskId)
    } catch (error) {
      parseError = `模型任务失败：${error instanceof Error ? error.message : '未知错误。'}`
    }
    let parsedPayload: unknown
    if (!parseError) {
      try {
        parsedPayload = safeParseJson<Record<string, unknown>>(rawOutput)
      } catch (error) {
        parseError = error instanceof Error ? error.message : '模型 JSON 输出无法解析。'
      }
    }
    windowReviews.push(normalizeSemanticWindowReview({
      window,
      dimensions,
      parsedPayload,
      parseError,
    }))
  }

  const maxSemanticFindings = Math.max(1, Math.min(Math.floor(input.maxFindings || 24), 40))
  const semanticFindings = dedupeSemanticFindings(windowReviews
    .flatMap((review) => review.findings)
    .map((finding) => toAgentSemanticFinding(
      finding,
      sourceChapters,
      sourceReportArtifact.content.profile.blockCriticalRisks,
    )))
    .sort((left, right) => Number(right.blocking) - Number(left.blocking)
      || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      || (left.chapterNums[0] || Number.MAX_SAFE_INTEGER) - (right.chapterNums[0] || Number.MAX_SAFE_INTEGER))
    .slice(0, maxSemanticFindings)
  const combinedFindings = [...sourceReportArtifact.content.findings, ...semanticFindings]
    .sort((left, right) => Number(right.blocking) - Number(left.blocking)
      || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      || (left.chapterNums[0] || Number.MAX_SAFE_INTEGER) - (right.chapterNums[0] || Number.MAX_SAFE_INTEGER))
    .slice(0, 50)
  const coveredChapterNums = uniqueNumbers(windows.flatMap((window) => window.chapters.map((chapter) => chapter.chapterNum)))
  const semanticCoverageRate = Math.round((coveredChapterNums.length / sourceChapters.length) * 100)
  const dimensionEvidenceCount = windowReviews.reduce((total, review) => total + review.coveredDimensions.length, 0)
  const dimensionCoverageRate = Math.round((dimensionEvidenceCount / (windows.length * dimensions.length)) * 100)
  const failedWindowCount = windowReviews.filter((review) => review.failed).length
  const validEvidenceCount = windowReviews.reduce((total, review) => total + review.validEvidenceCount, 0)
  const rejectedEvidenceCount = windowReviews.reduce((total, review) => total + review.rejectedEvidenceCount, 0)
  const semanticScore = Math.round(windowReviews.reduce((total, review) => total + review.score, 0) / windowReviews.length)
  const strict = sourceReportArtifact.content.profile.profile === 'recommendation_ready_v1'
  const semanticBlockers = semanticFindings.filter((finding) => finding.blocking)
  const blockers = normalizeLines([
    ...sourceReportArtifact.content.blockers,
    ...semanticBlockers.map((finding) => `跨章语义阻塞：${finding.title}`),
    strict && failedWindowCount > 0 ? `${failedWindowCount} 个跨章语义窗口评审失败；推荐前严格档案禁止 fail-open。` : '',
    strict && semanticCoverageRate < sourceReportArtifact.content.profile.minimumCoverageRate
      ? `跨章语义章节覆盖率 ${semanticCoverageRate}% 低于严格门槛 ${sourceReportArtifact.content.profile.minimumCoverageRate}%。`
      : '',
    strict && dimensionCoverageRate < 100 ? `跨章语义维度证据覆盖率仅 ${dimensionCoverageRate}%，严格档案要求 100%。` : '',
  ], 50)
  const semanticWarnings = normalizeLines([
    ...windowReviews.flatMap((review) => review.warnings.map((warning) => `${review.windowId}：${warning}`)),
    failedWindowCount > 0 && !strict ? `${failedWindowCount} 个跨章语义窗口失败，报告已降级为需要修订。` : '',
    semanticCoverageRate < 100 ? `窗口上限只覆盖 ${coveredChapterNums.length}/${sourceChapters.length} 章；请提高 maxWindows 或缩小 scope。` : '',
    rejectedEvidenceCount > 0 ? `${rejectedEvidenceCount} 条模型证据无法回指输入文本，未计入 Finding。` : '',
    combinedFindings.length < sourceReportArtifact.content.findings.length + semanticFindings.length
      ? '合并后的 Finding 超过 50 条，已按阻塞、严重度和章节顺序截断。'
      : '',
    '跨章语义 Reviewer 使用章节摘要、纲要和首尾片段，不等同于全文盲测或外部平台审核。',
  ], 80)
  const combinedScore = Math.round((sourceReportArtifact.content.score * 0.65) + (semanticScore * 0.35))
  const confidenceLowerBound = Math.max(0, Math.min(
    sourceReportArtifact.content.confidenceLowerBound,
    combinedScore - (failedWindowCount * 8) - Math.ceil((100 - dimensionCoverageRate) * 0.2),
  ))
  const coverageRate = Math.min(sourceReportArtifact.content.coverageRate, semanticCoverageRate)
  const status: AgentQualityReportContent['status'] = blockers.length > 0
    ? 'blocked'
    : sourceReportArtifact.content.status !== 'passed'
      || semanticFindings.some((finding) => finding.severity !== 'info')
      || semanticWarnings.length > 1
      ? 'needs_revision'
      : 'passed'
  const report: AgentQualityReportContent = {
    ...sourceReportArtifact.content,
    requestFingerprint: fingerprint,
    status,
    score: blockers.length > 0 ? Math.min(combinedScore, 49) : combinedScore,
    confidenceLowerBound,
    coverageRate,
    summary: `确定性评审 + 跨章语义评审：${status === 'blocked' ? '存在硬阻塞' : status === 'needs_revision' ? '仍需修订' : '通过'}；新增 ${semanticFindings.length} 条有效语义 Finding，${rejectedEvidenceCount} 条不可回指证据被拒绝。`,
    blockers,
    warnings: normalizeLines([...sourceReportArtifact.content.warnings, ...semanticWarnings], 100),
    findings: combinedFindings,
    semanticReview: {
      schemaVersion: 'agent-quality-semantic-review-v1',
      sourceReportArtifactId: sourceReportArtifact.id,
      sourceReportContentHash: sourceReportArtifact.contentHash,
      dimensions,
      totalScopeChapterCount: sourceChapters.length,
      coveredChapterCount: coveredChapterNums.length,
      semanticCoverageRate,
      windowCount: windows.length,
      failedWindowCount,
      dimensionCoverageRate,
      validEvidenceCount,
      rejectedEvidenceCount,
      taskIds,
      independentModelReview: true,
    },
    createdAt: new Date().toISOString(),
  }
  try {
    const reportArtifact = createArtifact({
      novelId: input.novelId,
      kind: 'quality_report',
      status: 'reviewed',
      parentArtifactId: sourceReportArtifact.id,
      content: report,
      contextVersion: currentContextVersion,
      producerType: taskIds.length > 0 ? 'novelforge_model' : 'system',
      producerId: taskIds.length > 0 ? `tasks:${taskIds.join(',')}` : 'semantic-review-failed-closed',
      producerClient: 'novelforge-quality-agent-workflow',
      modelConfigId: taskIds.length > 0 ? route.modelConfigId || null : null,
      taskId: taskIds.at(-1) || null,
      idempotencyKey: input.idempotencyKey,
    })
    return {
      sourceReportArtifact,
      reportArtifact,
      report,
      idempotentReplay: false,
    }
  } catch (error) {
    return mapArtifactError(error)
  }
}

function repairFingerprint(
  input: ProposeAgentQualityRepairsInput,
  report: AgentArtifact<AgentQualityReportContent>,
): string {
  return hashArtifactContent({
    novelId: input.novelId,
    reportArtifactId: report.id,
    reportContentHash: report.contentHash,
    goals: normalizeLines(input.goals, 12),
    maxItems: Math.max(1, Math.min(input.maxItems || 12, 30)),
  })
}

function goalMatchScore(finding: AgentQualityFinding, goals: string[]): number {
  if (goals.length === 0) return 0
  const haystack = `${finding.title}\n${finding.detail}\n${finding.howToFix}`.toLowerCase()
  return goals.reduce((score, goal) => score + (haystack.includes(goal.toLowerCase()) ? 1 : 0), 0)
}

function createRepairItems(findings: AgentQualityFinding[], goals: string[], limit: number): AgentRepairPlanItem[] {
  const selected = [...findings]
    .sort((left, right) => Number(right.blocking) - Number(left.blocking)
      || goalMatchScore(right, goals) - goalMatchScore(left, goals)
      || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      || (left.chapterNums[0] || Number.MAX_SAFE_INTEGER) - (right.chapterNums[0] || Number.MAX_SAFE_INTEGER))
    .slice(0, limit)
  const result: AgentRepairPlanItem[] = []
  selected.forEach((finding, index) => {
    const overlappingPrior = [...result].reverse().find((item) => (
      item.targetChapterNums.some((chapterNum) => finding.chapterNums.includes(chapterNum))
    ))
    result.push({
      id: `repair_${index + 1}_${finding.id.slice(-8)}`,
      priority: index + 1,
      severity: finding.severity,
      blocking: finding.blocking,
      findingIds: [finding.id],
      objective: finding.howToFix || `关闭「${finding.title}」Finding。`,
      rationale: `${finding.title}：${finding.detail}`,
      ...(finding.volumeId ? { targetVolumeId: finding.volumeId } : {}),
      targetChapterNums: [...finding.chapterNums],
      actionRefs: finding.suggestedActions,
      acceptanceCriteria: normalizeLines([
        `复评后不再出现 Finding ${finding.id}。`,
        finding.chapterNums.length > 0 ? `第 ${finding.chapterNums.join('、')} 章使用最新上下文重新完成质量检查。` : '受影响范围使用最新上下文重新完成质量检查。',
        finding.blocking ? '对应硬阻塞在新报告中已关闭。' : '对应风险至少下降一个严重度且证据可复核。',
      ], 6),
      regressionGuards: [
        '不得引入新的 critical Finding 或生产就绪硬阻塞。',
        '不得破坏已建立的事实、人物动机、时间线、伏笔和写作合同。',
        '候选报告的综合分、置信下界和覆盖率不得低于基线。',
      ],
      dependencies: overlappingPrior ? [overlappingPrior.id] : [],
      requiresHumanApproval: true,
    })
  })
  return result
}

export function proposeAgentQualityRepairs(
  input: ProposeAgentQualityRepairsInput,
): ProposeAgentQualityRepairsResult {
  if (!input.idempotencyKey?.trim()) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '修复计划必须提供幂等键。')
  }
  const novel = requireProject(input.novelId)
  const sourceReportArtifact = requireQualityReport(input.novelId, input.reportArtifactId)
  const goals = normalizeLines(input.goals, 12)
  const maxItems = Math.max(1, Math.min(input.maxItems || 12, 30))
  const fingerprint = repairFingerprint(input, sourceReportArtifact)
  const replay = findArtifactByIdempotency<AgentRepairPlanContent>(
    input.novelId,
    'repair_plan',
    input.idempotencyKey,
  )
  if (replay) {
    if (replay.content.schemaVersion !== 'agent-repair-plan-v1'
      || replay.content.requestFingerprint !== fingerprint) {
      throw new QualityWorkflowError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于另一份质量修复计划。')
    }
    return {
      sourceReportArtifact,
      repairPlanArtifact: replay,
      plan: replay.content,
      idempotentReplay: true,
    }
  }

  const currentContextVersion = novel.contextVersion || 1
  if (currentContextVersion !== sourceReportArtifact.contextVersion) {
    throw new QualityWorkflowError(
      'QUALITY_REPORT_STALE',
      `质量报告基于 Context v${sourceReportArtifact.contextVersion}，当前为 v${currentContextVersion}；请先用新幂等键重新评审。`,
    )
  }
  const items = createRepairItems(sourceReportArtifact.content.findings, goals, maxItems)
  const hardBlockers = sourceReportArtifact.content.blockers.length > 0 && items.length === 0
    ? ['源报告存在硬阻塞，但没有可转化的证据化 Finding。请扩大 maxFindings 或重新运行评审。']
    : []
  const plan: AgentRepairPlanContent = {
    schemaVersion: 'agent-repair-plan-v1',
    requestFingerprint: fingerprint,
    sourceReportArtifactId: sourceReportArtifact.id,
    sourceReportContentHash: sourceReportArtifact.contentHash,
    sourceContextVersion: sourceReportArtifact.contextVersion,
    status: hardBlockers.length > 0 ? 'blocked' : 'ready',
    summary: items.length > 0
      ? `已把 ${sourceReportArtifact.content.findings.length} 条 Finding 收敛为 ${items.length} 个按依赖排序的修复项。`
      : '源报告没有需要生成修复计划的 Finding。',
    goals,
    hardBlockers,
    warnings: normalizeLines([
      sourceReportArtifact.content.status === 'blocked' ? '源报告包含硬阻塞，应先处理 blocking=true 的修复项。' : '',
      sourceReportArtifact.content.findings.length > items.length ? `本计划只纳入前 ${items.length} 条高优先级 Finding。` : '',
      '本工件只描述修复草案，不会改写正文、创建正式修订任务或消耗外部推荐评估次数。',
    ], 10),
    items,
    requiresFreshEvaluationAfterDraft: true,
    canonicalWriteAllowed: false,
    createdAt: new Date().toISOString(),
  }
  try {
    const repairPlanArtifact = createArtifact({
      novelId: input.novelId,
      kind: 'repair_plan',
      status: 'draft',
      parentArtifactId: sourceReportArtifact.id,
      content: plan,
      contextVersion: currentContextVersion,
      producerType: 'system',
      producerId: 'agent-quality-repair-planner-v1',
      producerClient: 'novelforge-quality-agent-workflow',
      idempotencyKey: input.idempotencyKey,
    })
    return { sourceReportArtifact, repairPlanArtifact, plan, idempotentReplay: false }
  } catch (error) {
    return mapArtifactError(error)
  }
}

function repairDraftFingerprint(
  input: ApplyAgentQualityRepairDraftInput,
  repairPlan: AgentArtifact<AgentRepairPlanContent>,
): string {
  return hashArtifactContent({
    novelId: input.novelId,
    repairPlanArtifactId: repairPlan.id,
    repairPlanContentHash: repairPlan.contentHash,
    repairItemIds: normalizeLines(input.repairItemIds, 30).sort(),
    chapterNums: uniqueNumbers((input.chapterNums || []).filter((chapterNum) => Number.isInteger(chapterNum) && chapterNum > 0)),
    maxChapters: Math.max(1, Math.min(input.maxChapters || 2, 3)),
    executionMode: input.executionMode || null,
    extraRequirements: input.extraRequirements?.trim() || '',
  })
}

function buildRepairRequirements(
  chapterNum: number,
  items: AgentRepairPlanItem[],
  extraRequirements?: string,
): string {
  const objectives = items.map((item) => `- [${item.id}] ${item.objective}`)
  const acceptance = normalizeLines(items.flatMap((item) => item.acceptanceCriteria), 20).map((item) => `- ${item}`)
  const guards = normalizeLines(items.flatMap((item) => item.regressionGuards), 20).map((item) => `- ${item}`)
  return [
    `这是质量修复计划驱动的第 ${chapterNum} 章候选稿。只输出完整修订后正文，不要解释过程，不要改写其他章节。`,
    '必须完成的修复目标：',
    ...objectives,
    '验收条件：',
    ...acceptance,
    '回归保护：',
    ...guards,
    extraRequirements?.trim() ? `补充要求：\n${extraRequirements.trim()}` : '',
  ].filter(Boolean).join('\n')
}

function collectRepairDraftBlockers(chapter: AgentQualityRepairDraftChapter): string[] {
  return normalizeLines([
    !chapter.changed ? `第${chapter.chapterNum}章优化稿与原文没有实质变化。` : '',
    !chapter.factGuard.safeToApply
      ? `第${chapter.chapterNum}章事实差异门未通过：${chapter.factGuard.warnings.join('；') || '存在未确认的事实、数字或实体变化。'}`
      : '',
    !chapter.qualityGate.safeToApply
      ? `第${chapter.chapterNum}章语言质量门未通过：${chapter.qualityGate.warnings.join('；') || '优化稿引入了需要先修复的语言或 AI 痕迹问题。'}`
      : '',
    chapter.factGuard.aiProcessLeakCount > 0
      ? `第${chapter.chapterNum}章仍含 ${chapter.factGuard.aiProcessLeakCount} 处 AI 过程或提示词残留。`
      : '',
    chapter.qualityGate.optimizedHighSeverityCount > chapter.qualityGate.originalHighSeverityCount
      ? `第${chapter.chapterNum}章高严重度语言问题由 ${chapter.qualityGate.originalHighSeverityCount} 增至 ${chapter.qualityGate.optimizedHighSeverityCount}。`
      : '',
    chapter.structuralGate && !chapter.structuralGate.safeToApply
      ? `第${chapter.chapterNum}章结构性修订门未通过：${chapter.structuralGate.warnings.join('；')}`
      : '',
  ], 10)
}

function selectRepairItems(plan: AgentRepairPlanContent, requestedIds: string[]): AgentRepairPlanItem[] {
  if (requestedIds.length === 0) return plan.items.filter((item) => item.targetChapterNums.length > 0)
  const byId = new Map(plan.items.map((item) => [item.id, item]))
  const selected: AgentRepairPlanItem[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (itemId: string) => {
    if (visited.has(itemId)) return
    if (visiting.has(itemId)) {
      throw new QualityWorkflowError('REPAIR_PLAN_INVALID', `修复计划依赖存在循环：${itemId}。`)
    }
    const item = byId.get(itemId)
    if (!item) throw new QualityWorkflowError('REPAIR_PLAN_INVALID', `修复计划中不存在项目 ${itemId}。`)
    visiting.add(itemId)
    item.dependencies.forEach(visit)
    visiting.delete(itemId)
    visited.add(itemId)
    selected.push(item)
  }
  requestedIds.forEach(visit)
  return selected
}

export async function applyAgentQualityRepairDraft(
  input: ApplyAgentQualityRepairDraftInput,
): Promise<ApplyAgentQualityRepairDraftResult> {
  if (!input.idempotencyKey?.trim()) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '质量修订草稿必须提供幂等键。')
  }
  if ((input.extraRequirements?.length || 0) > 6000) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '补充修订要求不能超过 6000 个字符。')
  }
  const novel = requireProject(input.novelId)
  const repairPlanArtifact = requireRepairPlan(input.novelId, input.repairPlanArtifactId)
  const fingerprint = repairDraftFingerprint(input, repairPlanArtifact)
  const replay = findArtifactByIdempotency<AgentQualityRepairDraftContent>(
    input.novelId,
    'quality_repair_draft',
    input.idempotencyKey,
  )
  if (replay) {
    if (replay.content.schemaVersion !== 'agent-quality-repair-draft-v1'
      || replay.content.requestFingerprint !== fingerprint) {
      throw new QualityWorkflowError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于另一份质量修订草稿。')
    }
    return {
      repairPlanArtifact,
      repairDraftArtifact: replay,
      draft: replay.content,
      idempotentReplay: true,
    }
  }

  const currentContextVersion = novel.contextVersion || 1
  if (currentContextVersion !== repairPlanArtifact.contextVersion
    || currentContextVersion !== repairPlanArtifact.content.sourceContextVersion) {
    throw new QualityWorkflowError(
      'REPAIR_PLAN_STALE',
      `修复计划基于 Context v${repairPlanArtifact.content.sourceContextVersion}，当前为 v${currentContextVersion}；请重新评审并生成新计划。`,
    )
  }
  if (repairPlanArtifact.content.status !== 'ready') {
    throw new QualityWorkflowError('REPAIR_PLAN_INVALID', '修复计划仍处于 blocked，不能生成章节修订草稿。')
  }

  const requestedIds = normalizeLines(input.repairItemIds, 30)
  const selectedItems = selectRepairItems(repairPlanArtifact.content, requestedIds)
  const targetChapterNums = [...new Set(selectedItems.flatMap((item) => item.targetChapterNums))]
    .sort((left, right) => left - right)
  if (targetChapterNums.length === 0) {
    throw new QualityWorkflowError(
      'REPAIR_PLAN_NO_CHAPTER_TARGETS',
      '所选修复项没有可定位的章节；请先补充证据范围或使用通用资产草稿工具处理全局设定。',
    )
  }
  const maxChapters = Math.max(1, Math.min(input.maxChapters || 2, 3))
  const requestedChapterNums = uniqueNumbers((input.chapterNums || [])
    .filter((chapterNum) => Number.isInteger(chapterNum) && chapterNum > 0))
  const scopedChapterNums = requestedChapterNums.length > 0
    ? targetChapterNums.filter((chapterNum) => requestedChapterNums.includes(chapterNum))
    : targetChapterNums
  if (requestedChapterNums.length > 0 && scopedChapterNums.length === 0) {
    throw new QualityWorkflowError(
      'REPAIR_PLAN_NO_CHAPTER_TARGETS',
      `指定章节 ${requestedChapterNums.join('、')} 不在所选修复项的目标范围内。`,
    )
  }
  const selectedChapterNums = scopedChapterNums.slice(0, maxChapters)
  const chapterRows = listChapters(input.novelId)
  const chaptersByNum = new Map(chapterRows.map((chapter) => [chapter.chapterNum, chapter]))
  const missingChapterNums = selectedChapterNums.filter((chapterNum) => !chaptersByNum.get(chapterNum)?.content?.trim())
  if (missingChapterNums.length > 0) {
    throw new QualityWorkflowError(
      'REPAIR_PLAN_NO_CHAPTER_TARGETS',
      `第 ${missingChapterNums.join('、')} 章不存在或没有正文，不能生成修订草稿。`,
    )
  }

  const draftedChapters: AgentQualityRepairDraftChapter[] = []
  for (const chapterNum of selectedChapterNums) {
    const chapter = chaptersByNum.get(chapterNum) as NonNullable<ReturnType<typeof listChapters>[number]>
    const chapterItems = selectedItems.filter((item) => item.targetChapterNums.includes(chapterNum))
    const optimized = await optimizeChapterContent(chapter.id, {
      executionMode: input.executionMode,
      repairMode: 'structural',
      extraRequirements: buildRepairRequirements(chapterNum, chapterItems, input.extraRequirements),
    })
    draftedChapters.push({
      chapterId: chapter.id,
      chapterNum,
      title: chapter.title || `第${chapterNum}章`,
      repairItemIds: chapterItems.map((item) => item.id),
      originalContent: optimized.originalContent,
      originalContentHash: hashArtifactContent(optimized.originalContent),
      optimizedContent: optimized.optimizedContent,
      optimizedContentHash: hashArtifactContent(optimized.optimizedContent),
      changed: optimized.changed,
      issueSummary: optimized.issueSummary,
      warnings: optimized.warnings,
      factGuard: optimized.factGuard,
      qualityGate: optimized.qualityGate,
      structuralGate: optimized.structuralGate,
      taskId: optimized.taskId || null,
    })
  }

  const hardBlockers = normalizeLines(draftedChapters.flatMap(collectRepairDraftBlockers), 30)
  const warnings = normalizeLines([
    ...draftedChapters.flatMap((chapter) => chapter.warnings.map((warning) => `第${chapter.chapterNum}章：${warning}`)),
    targetChapterNums.length > selectedChapterNums.length
      ? `本次只处理 ${selectedChapterNums.join('、')} 章，另有 ${targetChapterNums.length - selectedChapterNums.length} 个目标章节未生成；可用 chapterNums 或新幂等键分批处理。`
      : '',
    requestedChapterNums.length > 0 && scopedChapterNums.length < targetChapterNums.length
      ? `本次按 chapterNums=${requestedChapterNums.join('、')} 缩小范围，依赖项仍保留在修复计划中但未在此候选中生成。`
      : '',
    selectedItems.some((item) => item.targetChapterNums.length === 0)
      ? '部分所选修复项没有章节定位，本次未自动处理这些全局项。'
      : '',
    '修订结果是不可变候选草稿；必须人工查看 Diff，应用到正式正文后再运行新一轮质量评审。',
  ], 40)
  const status: AgentQualityRepairDraftContent['status'] = hardBlockers.length > 0
    ? 'blocked'
    : warnings.length > 1
      ? 'needs_revision'
      : 'ready_for_review'
  const draft: AgentQualityRepairDraftContent = {
    schemaVersion: 'agent-quality-repair-draft-v1',
    requestFingerprint: fingerprint,
    repairPlanArtifactId: repairPlanArtifact.id,
    repairPlanContentHash: repairPlanArtifact.contentHash,
    sourceReportArtifactId: repairPlanArtifact.content.sourceReportArtifactId,
    sourceContextVersion: currentContextVersion,
    selectedRepairItemIds: selectedItems.map((item) => item.id),
    status,
    summary: `已为 ${draftedChapters.length} 章生成质量修订候选：${hardBlockers.length} 个硬阻塞，${warnings.length} 条复核提示。`,
    hardBlockers,
    warnings,
    chapters: draftedChapters,
    readyForHumanReview: hardBlockers.length === 0,
    canonicalWriteAllowed: false,
    requiresFreshEvaluationAfterApply: true,
    createdAt: new Date().toISOString(),
  }
  try {
    const taskIds = draftedChapters.map((chapter) => chapter.taskId).filter((taskId): taskId is number => Boolean(taskId))
    const repairDraftArtifact = createArtifact({
      novelId: input.novelId,
      kind: 'quality_repair_draft',
      status: status === 'blocked' ? 'rejected' : 'draft',
      parentArtifactId: repairPlanArtifact.id,
      content: draft,
      contextVersion: currentContextVersion,
      producerType: 'novelforge_model',
      producerId: taskIds.length > 0 ? `tasks:${taskIds.join(',')}` : 'agent-quality-repair-drafter-v1',
      producerClient: 'novelforge-quality-agent-workflow',
      taskId: taskIds.at(-1) || null,
      idempotencyKey: input.idempotencyKey,
    })
    return { repairPlanArtifact, repairDraftArtifact, draft, idempotentReplay: false }
  } catch (error) {
    return mapArtifactError(error)
  }
}

function repairReviewFingerprint(
  input: ReviewAgentQualityRepairDraftInput,
  repairDraft: AgentArtifact<AgentQualityRepairDraftContent>,
): string {
  return hashArtifactContent({
    novelId: input.novelId,
    repairDraftArtifactId: repairDraft.id,
    repairDraftContentHash: repairDraft.contentHash,
    executionMode: input.executionMode || null,
    reviewFocus: normalizeLines(input.reviewFocus, 10),
  })
}

export async function reviewAgentQualityRepairDraft(
  input: ReviewAgentQualityRepairDraftInput,
): Promise<ReviewAgentQualityRepairDraftResult> {
  if (!input.idempotencyKey?.trim()) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '独立语义审校必须提供幂等键。')
  }
  if ((input.reviewFocus || []).some((entry) => entry.length > 800)) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '单条额外审校重点不能超过 800 个字符。')
  }
  const novel = requireProject(input.novelId)
  const repairDraftArtifact = requireRepairDraft(input.novelId, input.repairDraftArtifactId)
  const fingerprint = repairReviewFingerprint(input, repairDraftArtifact)
  const replay = findArtifactByIdempotency<AgentQualityRepairReviewContent>(
    input.novelId,
    'quality_repair_review',
    input.idempotencyKey,
  )
  if (replay) {
    if (replay.content.schemaVersion !== 'agent-quality-repair-review-v1'
      || replay.content.requestFingerprint !== fingerprint
      || replay.content.repairDraftArtifactId !== repairDraftArtifact.id
      || replay.content.repairDraftContentHash !== repairDraftArtifact.contentHash) {
      throw new QualityWorkflowError('IDEMPOTENCY_KEY_CONFLICT', '该幂等键已用于另一份质量修订审校。')
    }
    return {
      repairDraftArtifact,
      reviewArtifact: replay,
      review: replay.content,
      idempotentReplay: true,
    }
  }

  const currentContextVersion = novel.contextVersion || 1
  if (currentContextVersion !== repairDraftArtifact.contextVersion
    || currentContextVersion !== repairDraftArtifact.content.sourceContextVersion) {
    throw new QualityWorkflowError(
      'REPAIR_DRAFT_STALE',
      `质量修订草稿基于 Context v${repairDraftArtifact.content.sourceContextVersion}，当前为 v${currentContextVersion}；请重新评审、规划并生成候选。`,
    )
  }
  if (repairDraftArtifact.content.status === 'blocked'
    || repairDraftArtifact.content.hardBlockers.length > 0
    || repairDraftArtifact.content.chapters.length === 0) {
    throw new QualityWorkflowError('REPAIR_DRAFT_INVALID', '质量修订草稿已被确定性门阻塞或没有章节候选，不能继续消耗模型审校。')
  }
  const unsafeDeterministicChapter = repairDraftArtifact.content.chapters.find((chapter) => (
    !chapter.factGuard.safeToApply
    || !chapter.qualityGate.safeToApply
    || Boolean(chapter.structuralGate && !chapter.structuralGate.safeToApply)
  ))
  if (unsafeDeterministicChapter) {
    throw new QualityWorkflowError(
      'REPAIR_DRAFT_INVALID',
      `第${unsafeDeterministicChapter.chapterNum}章事实、语言质量或结构修订门未通过，不能进入独立语义审校；请先生成新的候选稿。`,
    )
  }
  if (repairDraftArtifact.content.chapters.length > 3) {
    throw new QualityWorkflowError('REPAIR_DRAFT_INVALID', '单份质量修订草稿最多允许三章。')
  }
  const repairPlanArtifact = requireRepairPlan(input.novelId, repairDraftArtifact.content.repairPlanArtifactId)
  if (repairPlanArtifact.contentHash !== repairDraftArtifact.content.repairPlanContentHash) {
    throw new QualityWorkflowError('REPAIR_DRAFT_INVALID', '质量修订草稿引用的修复计划哈希不一致。')
  }
  repairDraftArtifact.content.chapters.forEach((chapter) => {
    if (hashArtifactContent(chapter.originalContent) !== chapter.originalContentHash
      || hashArtifactContent(chapter.optimizedContent) !== chapter.optimizedContentHash) {
      throw new QualityWorkflowError('REPAIR_DRAFT_INVALID', `第${chapter.chapterNum}章候选正文与工件哈希不一致。`)
    }
  })

  const mode = resolveAiExecutionMode({
    explicitMode: input.executionMode,
    settingsJson: novel.settingsJson,
  })
  const route = buildAiModelRouteReport({
    taskKind: 'generic_prompt',
    stageLabel: 'Quality Repair Independent Semantic Review',
    executionMode: mode.mode,
    resolutionSource: mode.source,
    modelConfigId: novel.modelConfigId || undefined,
    temperatureCap: 0.25,
    reviewDepth: 'deep',
    maxTokensFactor: 1.2,
    extraReasons: ['修订候选必须由独立低波动 Task 逐项核对验收条件、回归保护与正文证据。'],
  })
  const reviewFocus = normalizeLines(input.reviewFocus, 10)
  const itemById = new Map(repairPlanArtifact.content.items.map((item) => [item.id, item]))
  const chapterReviews: AgentQualityRepairDraftChapterReview[] = []
  for (const chapter of repairDraftArtifact.content.chapters) {
    const items = chapter.repairItemIds.map((itemId) => itemById.get(itemId))
    if (items.some((item) => !item)) {
      throw new QualityWorkflowError('REPAIR_DRAFT_INVALID', `第${chapter.chapterNum}章引用了修复计划中不存在的项目。`)
    }
    const promptResult = buildQualityRepairReviewPrompt({
      chapter,
      items: items as AgentRepairPlanItem[],
      reviewFocus,
    })
    let reviewTaskId = 0
    let rawOutput = ''
    try {
      rawOutput = await runChatTask({
        type: 'review',
        novelId: input.novelId,
        modelConfigId: route.modelConfigId,
        relatedEntityType: 'chapter',
        relatedEntityId: chapter.chapterId,
        messages: [{ role: 'user', content: promptResult.prompt }],
        chatOpts: buildChatOptionsFromRoute(route),
        retryable: true,
        onSuccess: (_output, taskId) => { reviewTaskId = taskId },
      })
    } catch (error) {
      throw new QualityWorkflowError(
        'MODEL_REVIEW_FAILED',
        `第${chapter.chapterNum}章独立语义审校失败：${error instanceof Error ? error.message : '模型任务失败。'}`,
      )
    }
    if (!reviewTaskId) {
      throw new QualityWorkflowError('MODEL_REVIEW_FAILED', `第${chapter.chapterNum}章独立语义审校没有生成可追踪 Task。`)
    }
    let parsedPayload: unknown
    let parseError = ''
    try {
      parsedPayload = safeParseJson<Record<string, unknown>>(rawOutput)
    } catch (error) {
      parseError = error instanceof Error ? error.message : '模型 JSON 输出无法解析。'
    }
    chapterReviews.push(normalizeQualityRepairChapterReview({
      chapter,
      items: items as AgentRepairPlanItem[],
      reviewTaskId,
      parsedPayload,
      parseError,
      contentTruncated: promptResult.contentTruncated,
    }))
  }

  const blockers = normalizeLines(chapterReviews.flatMap((chapter) => (
    chapter.blockers.map((blocker) => `第${chapter.chapterNum}章：${blocker}`)
  )), 60)
  const semanticWarnings = normalizeLines(chapterReviews.flatMap((chapter) => (
    chapter.warnings.map((warning) => `第${chapter.chapterNum}章：${warning}`)
  )), 80)
  const status: AgentQualityRepairReviewContent['status'] = blockers.length > 0
    || chapterReviews.some((chapter) => chapter.status === 'blocked')
    ? 'blocked'
    : chapterReviews.some((chapter) => chapter.status === 'needs_revision')
      ? 'needs_revision'
      : 'passed'
  const score = Math.round(chapterReviews.reduce((total, chapter) => total + chapter.score, 0) / chapterReviews.length)
  const independentModelReview = chapterReviews.every((chapter) => chapter.separateReviewTask)
  const review: AgentQualityRepairReviewContent = {
    schemaVersion: 'agent-quality-repair-review-v1',
    requestFingerprint: fingerprint,
    repairDraftArtifactId: repairDraftArtifact.id,
    repairDraftContentHash: repairDraftArtifact.contentHash,
    repairPlanArtifactId: repairPlanArtifact.id,
    repairPlanContentHash: repairPlanArtifact.contentHash,
    sourceContextVersion: currentContextVersion,
    status,
    score,
    summary: status === 'passed'
      ? `独立语义审校通过：${chapterReviews.length} 章的验收条件均有证据且未发现阻塞回归。`
      : status === 'blocked'
        ? `独立语义审校阻塞：${chapterReviews.length} 章中共有 ${blockers.length} 个硬阻塞。`
        : `独立语义审校要求继续修订：${semanticWarnings.length} 项证据或回归风险待处理。`,
    blockers,
    warnings: normalizeLines([
      ...semanticWarnings,
      '本审校只决定候选是否可进入人工 Diff；不会应用正文，也不能替代修订后的新一轮质量评审。',
    ], 90),
    chapters: chapterReviews,
    independentModelReview: true,
    readyForHumanDecision: status === 'passed' && independentModelReview,
    canonicalWriteAllowed: false,
    requiresHumanDiff: true,
    createdAt: new Date().toISOString(),
  }
  try {
    const taskIds = chapterReviews.map((chapter) => chapter.reviewTaskId)
    const reviewArtifact = createArtifact({
      novelId: input.novelId,
      kind: 'quality_repair_review',
      status: status === 'blocked' ? 'rejected' : 'reviewed',
      parentArtifactId: repairDraftArtifact.id,
      content: review,
      contextVersion: currentContextVersion,
      producerType: 'novelforge_model',
      producerId: `tasks:${taskIds.join(',')}`,
      producerClient: 'novelforge-quality-agent-workflow',
      modelConfigId: route.modelConfigId || null,
      taskId: taskIds.at(-1) || null,
      idempotencyKey: input.idempotencyKey,
    })
    updateArtifactLifecycle(repairDraftArtifact.id, {
      status: status === 'blocked' ? 'rejected' : 'reviewed',
      reviewArtifactId: reviewArtifact.id,
    })
    return {
      repairDraftArtifact: requireRepairDraft(input.novelId, repairDraftArtifact.id),
      reviewArtifact,
      review,
      idempotentReplay: false,
    }
  } catch (error) {
    return mapArtifactError(error)
  }
}

function reportScopeCompatible(
  baseline: AgentQualityReportContent,
  candidate: AgentQualityReportContent,
): boolean {
  return scopeKey(baseline.scope) === scopeKey(candidate.scope)
}

export function compareAgentQualityRuns(
  input: CompareAgentQualityRunsInput,
): AgentQualityRunComparison {
  requireProject(input.novelId)
  const baseline = requireQualityReport(input.novelId, input.baselineReportArtifactId)
  const candidate = requireQualityReport(input.novelId, input.candidateReportArtifactId)
  if (baseline.id === candidate.id) {
    throw new QualityWorkflowError('VALIDATION_FAILED', '基线报告与候选报告不能是同一工件。')
  }
  const profileCompatible = baseline.content.profile.profile === candidate.content.profile.profile
  const scopeCompatible = reportScopeCompatible(baseline.content, candidate.content)
  const baselineBySignature = new Map(baseline.content.findings.map((finding) => [finding.signature, finding]))
  const candidateBySignature = new Map(candidate.content.findings.map((finding) => [finding.signature, finding]))
  const closedFindings = baseline.content.findings.filter((finding) => !candidateBySignature.has(finding.signature))
  const persistingFindings = candidate.content.findings.filter((finding) => baselineBySignature.has(finding.signature))
  const introducedFindings = candidate.content.findings.filter((finding) => !baselineBySignature.has(finding.signature))
  const introducedBlockerCount = introducedFindings.filter((finding) => finding.blocking).length
  const scoreDelta = candidate.content.score - baseline.content.score
  const confidenceLowerBoundDelta = candidate.content.confidenceLowerBound - baseline.content.confidenceLowerBound
  const coverageRateDelta = candidate.content.coverageRate - baseline.content.coverageRate
  const statusImproved = STATUS_RANK[candidate.content.status] > STATUS_RANK[baseline.content.status]
  const statusRegressed = STATUS_RANK[candidate.content.status] < STATUS_RANK[baseline.content.status]
  const hasImprovement = statusImproved
    || scoreDelta >= 3
    || closedFindings.some((finding) => finding.blocking)
    || closedFindings.length > introducedFindings.length
  const hasRegression = statusRegressed
    || scoreDelta <= -3
    || confidenceLowerBoundDelta <= -3
    || coverageRateDelta < 0
    || introducedBlockerCount > 0
  const status: AgentQualityRunComparison['status'] = hasImprovement && hasRegression
    ? 'mixed'
    : hasRegression
      ? 'regressed'
      : hasImprovement
        ? 'improved'
        : 'unchanged'
  const warnings = normalizeLines([
    !profileCompatible ? '两份报告使用不同 Quality Profile，分数和门禁不能直接等价比较。' : '',
    !scopeCompatible ? '两份报告评审范围不同，Finding 开闭结果只可作为辅助证据。' : '',
    candidate.contextVersion <= baseline.contextVersion ? '候选报告的 Context Version 没有晚于基线，请确认正文或质量快照确实发生了变化。' : '',
  ], 10)
  const readyForHumanReview = profileCompatible
    && scopeCompatible
    && candidate.content.status === 'passed'
    && introducedBlockerCount === 0
    && !hasRegression
  const comparison: AgentQualityRunComparison = {
    schemaVersion: 'agent-quality-comparison-v1',
    baselineReportArtifactId: baseline.id,
    candidateReportArtifactId: candidate.id,
    profileCompatible,
    scopeCompatible,
    status,
    scoreDelta,
    confidenceLowerBoundDelta,
    coverageRateDelta,
    closedFindings,
    persistingFindings,
    introducedFindings,
    introducedBlockerCount,
    candidateStatus: candidate.content.status,
    readyForHumanReview,
    summary: `${status === 'improved' ? '质量改善' : status === 'regressed' ? '出现回归' : status === 'mixed' ? '改善与回归并存' : '未见实质变化'}：关闭 ${closedFindings.length} 条，持续 ${persistingFindings.length} 条，新引入 ${introducedFindings.length} 条，综合分 ${scoreDelta >= 0 ? '+' : ''}${scoreDelta}。`,
    warnings,
  }
  try {
    createArtifact({
      novelId: input.novelId,
      kind: 'quality_comparison',
      status: 'reviewed',
      parentArtifactId: candidate.id,
      content: comparison,
      contextVersion: candidate.content.contextVersion,
      producerType: 'system',
      producerId: 'quality-agent-compare-v1',
      producerClient: 'novelforge-quality-agent-workflow',
      idempotencyKey: `quality-comparison:${hashArtifactContent({ baselineReportArtifactId: baseline.id, candidateReportArtifactId: candidate.id })}`,
    })
  } catch (error) {
    return mapArtifactError(error)
  }
  return comparison
}
