import type {
  ApplyAgentQualityRepairDraftInput,
  ApplyAgentQualityRepairDraftResult,
  AgentQualityReportContent,
  AgentQualityRepairReviewContent,
  AgentQualityRunComparison,
  AgentRepairPlanContent,
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
import type { AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { artifactReferenceSchema, compactArtifact } from './artifact-tools'
import { ArtifactServiceError } from './artifact-error'
import { QualityWorkflowError } from './quality-workflow-error'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'

export interface QualityToolDependencies {
  runEvaluation: (input: RunAgentQualityEvaluationInput) => RunAgentQualityEvaluationResult
  runSemanticEvaluation: (input: RunAgentQualitySemanticEvaluationInput) => Promise<RunAgentQualitySemanticEvaluationResult>
  proposeRepairs: (input: ProposeAgentQualityRepairsInput) => ProposeAgentQualityRepairsResult
  applyRepairDraft: (input: ApplyAgentQualityRepairDraftInput) => Promise<ApplyAgentQualityRepairDraftResult>
  reviewRepairDraft: (input: ReviewAgentQualityRepairDraftInput) => Promise<ReviewAgentQualityRepairDraftResult>
  compareRuns: (input: CompareAgentQualityRunsInput) => AgentQualityRunComparison
}

type RunInput = Record<string, unknown> & RunAgentQualityEvaluationInput
type SemanticRunInput = Record<string, unknown> & RunAgentQualitySemanticEvaluationInput
type RepairInput = Record<string, unknown> & ProposeAgentQualityRepairsInput
type ApplyRepairInput = Record<string, unknown> & ApplyAgentQualityRepairDraftInput
type ReviewRepairInput = Record<string, unknown> & ReviewAgentQualityRepairDraftInput
type CompareInput = Record<string, unknown> & CompareAgentQualityRunsInput

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[],
  additionalProperties = false,
): AgentToolJsonSchema {
  return { type: 'object', properties, required, additionalProperties }
}

const findingSchema: AgentToolJsonSchema = objectSchema({
  id: { type: 'string' },
  signature: { type: 'string' },
  code: { type: 'string' },
  kind: { type: 'string' },
  severity: { enum: ['info', 'warning', 'critical'] },
  blocking: { type: 'boolean' },
  title: { type: 'string' },
  detail: { type: 'string' },
  whyItHappened: { type: 'string' },
  howToFix: { type: 'string' },
  volumeId: { type: 'integer', minimum: 1 },
  chapterNums: { type: 'array', items: { type: 'integer', minimum: 1 } },
  evidenceRefs: { type: 'array', items: { type: 'string' } },
  suggestedActions: { type: 'array', items: { type: 'object', additionalProperties: true } },
}, [
  'id', 'signature', 'code', 'kind', 'severity', 'blocking', 'title', 'detail',
  'whyItHappened', 'howToFix', 'chapterNums', 'evidenceRefs', 'suggestedActions',
])

const scopeSchema: AgentToolJsonSchema = objectSchema({
  type: { enum: ['novel', 'volume', 'chapter'] },
  label: { type: 'string' },
  volumeId: { type: 'integer', minimum: 1 },
  chapterId: { type: 'integer', minimum: 1 },
  chapterNums: { type: 'array', items: { type: 'integer', minimum: 1 } },
}, ['type', 'label', 'chapterNums'])

const compactReportSchema: AgentToolJsonSchema = objectSchema({
  schemaVersion: { const: 'agent-quality-report-v1' },
  profile: { type: 'object', additionalProperties: true },
  scope: scopeSchema,
  status: { enum: ['passed', 'needs_revision', 'blocked'] },
  score: { type: 'integer', minimum: 0, maximum: 100 },
  confidenceLowerBound: { type: 'integer', minimum: 0, maximum: 100 },
  coverageRate: { type: 'integer', minimum: 0, maximum: 100 },
  summary: { type: 'string' },
  blockers: { type: 'array', items: { type: 'string' } },
  warnings: { type: 'array', items: { type: 'string' } },
  findings: { type: 'array', items: findingSchema, maxItems: 50 },
  contextVersion: { type: 'integer', minimum: 1 },
  baselineReportArtifactId: { type: ['string', 'null'] },
  semanticReview: { type: 'object', additionalProperties: true },
}, [
  'schemaVersion', 'profile', 'scope', 'status', 'score', 'confidenceLowerBound',
  'coverageRate', 'summary', 'blockers', 'warnings', 'findings', 'contextVersion',
  'baselineReportArtifactId',
])

function compactReport(report: AgentQualityReportContent) {
  return {
    schemaVersion: report.schemaVersion,
    profile: report.profile,
    scope: report.scope,
    status: report.status,
    score: report.score,
    confidenceLowerBound: report.confidenceLowerBound,
    coverageRate: report.coverageRate,
    summary: report.summary,
    blockers: report.blockers,
    warnings: report.warnings,
    findings: report.findings,
    contextVersion: report.contextVersion,
    baselineReportArtifactId: report.baselineReportArtifactId,
    ...(report.semanticReview ? { semanticReview: report.semanticReview } : {}),
  }
}

function compactPlan(plan: AgentRepairPlanContent) {
  return {
    schemaVersion: plan.schemaVersion,
    sourceReportArtifactId: plan.sourceReportArtifactId,
    sourceReportContentHash: plan.sourceReportContentHash,
    sourceContextVersion: plan.sourceContextVersion,
    status: plan.status,
    summary: plan.summary,
    goals: plan.goals,
    hardBlockers: plan.hardBlockers,
    warnings: plan.warnings,
    items: plan.items,
    requiresFreshEvaluationAfterDraft: plan.requiresFreshEvaluationAfterDraft,
    canonicalWriteAllowed: plan.canonicalWriteAllowed,
  }
}

function compactRepairDraft(draft: ApplyAgentQualityRepairDraftResult['draft']) {
  return {
    schemaVersion: draft.schemaVersion,
    repairPlanArtifactId: draft.repairPlanArtifactId,
    repairPlanContentHash: draft.repairPlanContentHash,
    sourceReportArtifactId: draft.sourceReportArtifactId,
    sourceContextVersion: draft.sourceContextVersion,
    selectedRepairItemIds: draft.selectedRepairItemIds,
    status: draft.status,
    summary: draft.summary,
    hardBlockers: draft.hardBlockers,
    warnings: draft.warnings,
    chapters: draft.chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterNum: chapter.chapterNum,
      title: chapter.title,
      repairItemIds: chapter.repairItemIds,
      originalContentHash: chapter.originalContentHash,
      optimizedContentHash: chapter.optimizedContentHash,
      changed: chapter.changed,
      issueSummary: chapter.issueSummary,
      warnings: chapter.warnings,
      factGuard: chapter.factGuard,
      qualityGate: chapter.qualityGate,
      taskId: chapter.taskId,
    })),
    readyForHumanReview: draft.readyForHumanReview,
    canonicalWriteAllowed: draft.canonicalWriteAllowed,
    requiresFreshEvaluationAfterApply: draft.requiresFreshEvaluationAfterApply,
  }
}

function compactRepairReview(review: AgentQualityRepairReviewContent) {
  return {
    schemaVersion: review.schemaVersion,
    repairDraftArtifactId: review.repairDraftArtifactId,
    repairDraftContentHash: review.repairDraftContentHash,
    repairPlanArtifactId: review.repairPlanArtifactId,
    repairPlanContentHash: review.repairPlanContentHash,
    sourceContextVersion: review.sourceContextVersion,
    status: review.status,
    score: review.score,
    summary: review.summary,
    blockers: review.blockers,
    warnings: review.warnings,
    chapters: review.chapters,
    independentModelReview: review.independentModelReview,
    readyForHumanDecision: review.readyForHumanDecision,
    canonicalWriteAllowed: review.canonicalWriteAllowed,
    requiresHumanDiff: review.requiresHumanDiff,
  }
}

function mapError(error: unknown): never {
  if (error instanceof QualityWorkflowError || error instanceof ArtifactServiceError) {
    throw new AgentToolInvocationError(error.code, error.message)
  }
  throw error
}

export function registerQualityTools(
  registry: AgentToolRegistry,
  dependencies: QualityToolDependencies,
): AgentToolRegistry {
  registry.register<RunInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.quality.run_evaluation',
      version: '1.0.0',
      domain: 'quality',
      title: '运行证据化小说质量评审',
      description: '把现有章节模型评分、长窗口规则、生产门禁与修复指标聚合为不可变质量报告工件。支持整书、分卷、单章和推荐前严格档案；不会改正文，也不会计入真实平台评估次数。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        scopeType: { enum: ['novel', 'volume', 'chapter'] },
        volumeId: { type: 'integer', minimum: 1 },
        chapterId: { type: 'integer', minimum: 1 },
        profile: { enum: ['longform_health_v1', 'recommendation_ready_v1'] },
        maxFindings: { type: 'integer', minimum: 1, maximum: 50 },
        baselineReportArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      }, ['novelId', 'idempotencyKey']),
      outputSchema: objectSchema({
        reportArtifact: artifactReferenceSchema,
        report: compactReportSchema,
        idempotentReplay: { type: 'boolean' },
      }, ['reportArtifact', 'report', 'idempotentReplay']),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.qualityRun,
        AGENT_TOOL_SCOPES.draftCreate,
      ],
      idempotent: true,
      taskMode: 'app_async',
      timeoutClass: 'workflow',
      tags: ['quality', 'evaluation', 'evidence', 'artifact', 'recommendation-preflight'],
    },
    handler: (input) => {
      try {
        const result = dependencies.runEvaluation(input)
        return {
          reportArtifact: compactArtifact(result.reportArtifact),
          report: compactReport(result.report),
          idempotentReplay: result.idempotentReplay,
        }
      } catch (error) {
        return mapError(error)
      }
    },
  })

  registry.register<SemanticRunInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.quality.run_semantic_evaluation',
      version: '1.0.0',
      domain: 'quality',
      title: '运行跨章跨卷证据化语义评审',
      description: '在当前确定性质量报告之上按重叠窗口评审因果、人物弧、主题、世界一致性、伏笔和节奏。只接纳能回指所提供章节摘要/纲要/首尾片段的证据；严格推荐档案对窗口失败或覆盖不足 fail-closed。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        reportArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        dimensions: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: { enum: ['causality', 'character_arc', 'theme_progression', 'world_consistency', 'foreshadow_payoff', 'pacing'] },
        },
        maxWindows: { type: 'integer', minimum: 1, maximum: 20 },
        maxFindings: { type: 'integer', minimum: 1, maximum: 40 },
        executionMode: { enum: ['fast', 'balanced', 'premium', 'review_first', 'cost_saver'] },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      }, ['novelId', 'reportArtifactId', 'idempotencyKey']),
      outputSchema: objectSchema({
        sourceReportArtifact: artifactReferenceSchema,
        reportArtifact: artifactReferenceSchema,
        report: compactReportSchema,
        idempotentReplay: { type: 'boolean' },
      }, ['sourceReportArtifact', 'reportArtifact', 'report', 'idempotentReplay']),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.qualityRun,
        AGENT_TOOL_SCOPES.draftCreate,
        AGENT_TOOL_SCOPES.draftReview,
      ],
      idempotent: true,
      taskMode: 'app_async',
      timeoutClass: 'model',
      tags: ['quality', 'semantic-review', 'cross-chapter', 'cross-volume', 'evidence', 'fail-closed'],
    },
    handler: async (input) => {
      try {
        const result = await dependencies.runSemanticEvaluation(input)
        return {
          sourceReportArtifact: compactArtifact(result.sourceReportArtifact),
          reportArtifact: compactArtifact(result.reportArtifact),
          report: compactReport(result.report),
          idempotentReplay: result.idempotentReplay,
        }
      } catch (error) {
        return mapError(error)
      }
    },
  })

  registry.register<RepairInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.quality.propose_repairs',
      version: '1.0.0',
      domain: 'quality',
      title: '把质量 Finding 编排为修复计划',
      description: '读取同一 Context Version 的质量报告，把硬阻塞与证据 Finding 排成带依赖、验收条件和回归保护的不可变修复计划工件。只生成计划，不创建正式修订、不覆盖正文。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        reportArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        goals: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 800 }, maxItems: 12 },
        maxItems: { type: 'integer', minimum: 1, maximum: 30 },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      }, ['novelId', 'reportArtifactId', 'idempotencyKey']),
      outputSchema: objectSchema({
        sourceReportArtifact: artifactReferenceSchema,
        repairPlanArtifact: artifactReferenceSchema,
        plan: objectSchema({
          schemaVersion: { const: 'agent-repair-plan-v1' },
          sourceReportArtifactId: { type: 'string' },
          sourceReportContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          sourceContextVersion: { type: 'integer', minimum: 1 },
          status: { enum: ['ready', 'blocked'] },
          summary: { type: 'string' },
          goals: { type: 'array', items: { type: 'string' } },
          hardBlockers: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          items: { type: 'array', items: { type: 'object', additionalProperties: true }, maxItems: 30 },
          requiresFreshEvaluationAfterDraft: { type: 'boolean' },
          canonicalWriteAllowed: { const: false },
        }, [
          'schemaVersion', 'sourceReportArtifactId', 'sourceReportContentHash',
          'sourceContextVersion', 'status', 'summary', 'goals', 'hardBlockers',
          'warnings', 'items', 'requiresFreshEvaluationAfterDraft', 'canonicalWriteAllowed',
        ]),
        idempotentReplay: { type: 'boolean' },
      }, ['sourceReportArtifact', 'repairPlanArtifact', 'plan', 'idempotentReplay']),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.qualityRun,
        AGENT_TOOL_SCOPES.qualityRepair,
        AGENT_TOOL_SCOPES.draftCreate,
      ],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['quality', 'repair-plan', 'evidence', 'dependencies', 'regression-guard'],
    },
    handler: (input) => {
      try {
        const result = dependencies.proposeRepairs(input)
        return {
          sourceReportArtifact: compactArtifact(result.sourceReportArtifact),
          repairPlanArtifact: compactArtifact(result.repairPlanArtifact),
          plan: compactPlan(result.plan),
          idempotentReplay: result.idempotentReplay,
        }
      } catch (error) {
        return mapError(error)
      }
    },
  })

  registry.register<ApplyRepairInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.quality.apply_repair_draft',
      version: '1.0.0',
      domain: 'quality',
      title: '按修复计划生成章节候选草稿',
      description: '读取当前 Context Version 的修复计划，按依赖为最多三章调用项目模型生成整章修订候选，并执行事实差异与语言质量门。只保存不可变草稿和哈希，不覆盖正式正文。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        repairPlanArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        repairItemIds: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 160 }, maxItems: 30 },
        chapterNums: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 3 },
        maxChapters: { type: 'integer', minimum: 1, maximum: 3 },
        executionMode: { enum: ['fast', 'balanced', 'premium', 'review_first', 'cost_saver'] },
        extraRequirements: { type: 'string', maxLength: 6000 },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      }, ['novelId', 'repairPlanArtifactId', 'idempotencyKey']),
      outputSchema: objectSchema({
        repairPlanArtifact: artifactReferenceSchema,
        repairDraftArtifact: artifactReferenceSchema,
        draft: objectSchema({
          schemaVersion: { const: 'agent-quality-repair-draft-v1' },
          repairPlanArtifactId: { type: 'string' },
          repairPlanContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          sourceReportArtifactId: { type: 'string' },
          sourceContextVersion: { type: 'integer', minimum: 1 },
          selectedRepairItemIds: { type: 'array', items: { type: 'string' }, maxItems: 30 },
          status: { enum: ['ready_for_review', 'needs_revision', 'blocked'] },
          summary: { type: 'string' },
          hardBlockers: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          chapters: {
            type: 'array',
            maxItems: 3,
            items: objectSchema({
              chapterId: { type: 'integer', minimum: 1 },
              chapterNum: { type: 'integer', minimum: 1 },
              title: { type: 'string' },
              repairItemIds: { type: 'array', items: { type: 'string' } },
              originalContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
              optimizedContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
              changed: { type: 'boolean' },
              issueSummary: { type: 'array', items: { type: 'string' } },
              warnings: { type: 'array', items: { type: 'string' } },
              factGuard: { type: 'object', additionalProperties: true },
              qualityGate: { type: 'object', additionalProperties: true },
              taskId: { type: ['integer', 'null'], minimum: 1 },
            }, [
              'chapterId', 'chapterNum', 'title', 'repairItemIds', 'originalContentHash',
              'optimizedContentHash', 'changed', 'issueSummary', 'warnings', 'factGuard',
              'qualityGate', 'taskId',
            ]),
          },
          readyForHumanReview: { type: 'boolean' },
          canonicalWriteAllowed: { const: false },
          requiresFreshEvaluationAfterApply: { const: true },
        }, [
          'schemaVersion', 'repairPlanArtifactId', 'repairPlanContentHash',
          'sourceReportArtifactId', 'sourceContextVersion', 'selectedRepairItemIds',
          'status', 'summary', 'hardBlockers', 'warnings', 'chapters',
          'readyForHumanReview', 'canonicalWriteAllowed', 'requiresFreshEvaluationAfterApply',
        ]),
        idempotentReplay: { type: 'boolean' },
      }, ['repairPlanArtifact', 'repairDraftArtifact', 'draft', 'idempotentReplay']),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.qualityRun,
        AGENT_TOOL_SCOPES.qualityRepair,
        AGENT_TOOL_SCOPES.draftCreate,
        AGENT_TOOL_SCOPES.draftReview,
      ],
      idempotent: true,
      taskMode: 'app_async',
      timeoutClass: 'model',
      tags: ['quality', 'repair-draft', 'chapter', 'model', 'diff', 'regression-guard'],
    },
    handler: async (input) => {
      try {
        const result = await dependencies.applyRepairDraft(input)
        return {
          repairPlanArtifact: compactArtifact(result.repairPlanArtifact),
          repairDraftArtifact: compactArtifact(result.repairDraftArtifact),
          draft: compactRepairDraft(result.draft),
          idempotentReplay: result.idempotentReplay,
        }
      } catch (error) {
        return mapError(error)
      }
    },
  })

  registry.register<ReviewRepairInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.quality.review_repair_draft',
      version: '1.0.0',
      domain: 'quality',
      title: '独立语义审校质量修订候选',
      description: '为最多三章的质量修订候选启动独立低波动模型 Task，逐项核对验收条件、回归保护和可定位正文证据。证据缺失会降级或阻塞；只写不可变审校工件，不覆盖正文。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        repairDraftArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        executionMode: { enum: ['fast', 'balanced', 'premium', 'review_first', 'cost_saver'] },
        reviewFocus: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 800 }, maxItems: 10 },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      }, ['novelId', 'repairDraftArtifactId', 'idempotencyKey']),
      outputSchema: objectSchema({
        repairDraftArtifact: artifactReferenceSchema,
        reviewArtifact: artifactReferenceSchema,
        review: objectSchema({
          schemaVersion: { const: 'agent-quality-repair-review-v1' },
          repairDraftArtifactId: { type: 'string' },
          repairDraftContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          repairPlanArtifactId: { type: 'string' },
          repairPlanContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          sourceContextVersion: { type: 'integer', minimum: 1 },
          status: { enum: ['passed', 'needs_revision', 'blocked'] },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          summary: { type: 'string' },
          blockers: { type: 'array', items: { type: 'string' } },
          warnings: { type: 'array', items: { type: 'string' } },
          chapters: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: objectSchema({
              chapterId: { type: 'integer', minimum: 1 },
              chapterNum: { type: 'integer', minimum: 1 },
              title: { type: 'string' },
              originalContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
              optimizedContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
              draftTaskId: { type: ['integer', 'null'], minimum: 1 },
              reviewTaskId: { type: 'integer', minimum: 1 },
              separateReviewTask: { type: 'boolean' },
              status: { enum: ['passed', 'needs_revision', 'blocked'] },
              score: { type: 'integer', minimum: 0, maximum: 100 },
              evidenceCoverageRate: { type: 'integer', minimum: 0, maximum: 100 },
              summary: { type: 'string' },
              blockers: { type: 'array', items: { type: 'string' } },
              warnings: { type: 'array', items: { type: 'string' } },
              checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
              regressionRisks: { type: 'array', items: { type: 'object', additionalProperties: true } },
              strengths: { type: 'array', items: { type: 'string' } },
            }, [
              'chapterId', 'chapterNum', 'title', 'originalContentHash', 'optimizedContentHash',
              'draftTaskId', 'reviewTaskId', 'separateReviewTask', 'status', 'score',
              'evidenceCoverageRate', 'summary', 'blockers', 'warnings', 'checks',
              'regressionRisks', 'strengths',
            ]),
          },
          independentModelReview: { const: true },
          readyForHumanDecision: { type: 'boolean' },
          canonicalWriteAllowed: { const: false },
          requiresHumanDiff: { const: true },
        }, [
          'schemaVersion', 'repairDraftArtifactId', 'repairDraftContentHash',
          'repairPlanArtifactId', 'repairPlanContentHash', 'sourceContextVersion',
          'status', 'score', 'summary', 'blockers', 'warnings', 'chapters',
          'independentModelReview', 'readyForHumanDecision', 'canonicalWriteAllowed',
          'requiresHumanDiff',
        ]),
        idempotentReplay: { type: 'boolean' },
      }, ['repairDraftArtifact', 'reviewArtifact', 'review', 'idempotentReplay']),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.qualityRun,
        AGENT_TOOL_SCOPES.qualityRepair,
        AGENT_TOOL_SCOPES.draftCreate,
        AGENT_TOOL_SCOPES.draftReview,
      ],
      idempotent: true,
      taskMode: 'app_async',
      timeoutClass: 'model',
      tags: ['quality', 'repair-review', 'independent-review', 'evidence', 'regression-guard'],
    },
    handler: async (input) => {
      try {
        const result = await dependencies.reviewRepairDraft(input)
        return {
          repairDraftArtifact: compactArtifact(result.repairDraftArtifact),
          reviewArtifact: compactArtifact(result.reviewArtifact),
          review: compactRepairReview(result.review),
          idempotentReplay: result.idempotentReplay,
        }
      } catch (error) {
        return mapError(error)
      }
    },
  })

  registry.register<CompareInput, AgentQualityRunComparison>({
    descriptor: {
      id: 'novelforge.quality.compare_runs',
      version: '1.0.0',
      domain: 'quality',
      title: '比较修复前后质量报告',
      description: '比较两份不可变质量报告的分数、覆盖率、关闭/持续/新增 Finding 与回归，并保存可追溯的比较工件，避免只优化单一指标却引入新的硬阻塞。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        baselineReportArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        candidateReportArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
      }, ['novelId', 'baselineReportArtifactId', 'candidateReportArtifactId']),
      outputSchema: objectSchema({
        schemaVersion: { const: 'agent-quality-comparison-v1' },
        baselineReportArtifactId: { type: 'string' },
        candidateReportArtifactId: { type: 'string' },
        profileCompatible: { type: 'boolean' },
        scopeCompatible: { type: 'boolean' },
        status: { enum: ['improved', 'mixed', 'regressed', 'unchanged'] },
        scoreDelta: { type: 'integer', minimum: -100, maximum: 100 },
        confidenceLowerBoundDelta: { type: 'integer', minimum: -100, maximum: 100 },
        coverageRateDelta: { type: 'integer', minimum: -100, maximum: 100 },
        closedFindings: { type: 'array', items: findingSchema, maxItems: 50 },
        persistingFindings: { type: 'array', items: findingSchema, maxItems: 50 },
        introducedFindings: { type: 'array', items: findingSchema, maxItems: 50 },
        introducedBlockerCount: { type: 'integer', minimum: 0 },
        candidateStatus: { enum: ['passed', 'needs_revision', 'blocked'] },
        readyForHumanReview: { type: 'boolean' },
        summary: { type: 'string' },
        warnings: { type: 'array', items: { type: 'string' } },
      }, [
        'schemaVersion', 'baselineReportArtifactId', 'candidateReportArtifactId',
        'profileCompatible', 'scopeCompatible', 'status', 'scoreDelta',
        'confidenceLowerBoundDelta', 'coverageRateDelta', 'closedFindings',
        'persistingFindings', 'introducedFindings', 'introducedBlockerCount',
        'candidateStatus', 'readyForHumanReview', 'summary', 'warnings',
      ]),
      effect: 'draft_write',
      approval: 'never',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.qualityRun,
        AGENT_TOOL_SCOPES.draftCreate,
      ],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['quality', 'comparison', 'regression', 'evidence'],
    },
    handler: (input) => {
      try {
        return dependencies.compareRuns(input)
      } catch (error) {
        return mapError(error)
      }
    },
  })
  return registry
}
