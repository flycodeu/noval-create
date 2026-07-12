import type { AgentArtifact } from '../../src/shared/agent-artifacts'
import type {
  GenerateGenericAssetDraftInput,
  GenerateGenericAssetDraftResult,
  GenericAssetDraftContent,
  GenericAssetReviewContent,
  ReviewGenericAssetDraftInput,
  ReviewGenericAssetDraftResult,
} from '../../src/shared/generic-asset-workflow'
import type { AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { artifactReferenceSchema, compactArtifact } from './artifact-tools'
import { ArtifactServiceError } from './artifact-error'
import { GenericAssetWorkflowError } from './generic-asset-workflow-error'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'

export interface GenericAssetToolDependencies {
  generateDraft: (input: GenerateGenericAssetDraftInput) => Promise<GenerateGenericAssetDraftResult>
  reviewDraft: (input: ReviewGenericAssetDraftInput) => Promise<ReviewGenericAssetDraftResult>
}

type GenerateInput = Record<string, unknown> & GenerateGenericAssetDraftInput
type ReviewInput = Record<string, unknown> & ReviewGenericAssetDraftInput

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[],
  additionalProperties = false,
): AgentToolJsonSchema {
  return { type: 'object', properties, required, additionalProperties }
}

const assetTypeSchema: AgentToolJsonSchema = {
  enum: [
    'character', 'faction', 'item', 'thread', 'timeline', 'subplot', 'map',
    'world_rules', 'outline', 'chapter', 'project_brief', 'theme_voice',
  ],
}

const executionModeSchema: AgentToolJsonSchema = {
  enum: ['fast', 'balanced', 'premium', 'review_first', 'cost_saver'],
}

const reviewCheckSchema = objectSchema({
  code: { enum: ['non_empty', 'output_shape', 'process_leak', 'model_review', 'context_freshness'] },
  status: { enum: ['pass', 'warn', 'fail'] },
  message: { type: 'string' },
}, ['code', 'status', 'message'])

const reviewSchema = objectSchema({
  schemaVersion: { const: 'generic-asset-review-v1' },
  draftArtifactId: { type: 'string' },
  draftContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  effectiveArtifactId: { type: 'string' },
  effectiveContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  status: { enum: ['passed', 'needs_revision', 'blocked'] },
  score: { type: 'integer', minimum: 0, maximum: 100 },
  readyForHumanApply: { type: 'boolean' },
  summary: { type: 'string' },
  hardBlockers: { type: 'array', items: { type: 'string' } },
  warnings: { type: 'array', items: { type: 'string' } },
  checks: { type: 'array', items: reviewCheckSchema },
  modelReview: { type: 'object', additionalProperties: true },
  reviewedContextVersion: { type: 'integer', minimum: 1 },
  createdAt: { type: 'string' },
}, [
  'schemaVersion', 'draftArtifactId', 'draftContentHash', 'effectiveArtifactId',
  'effectiveContentHash', 'status', 'score', 'readyForHumanApply', 'summary',
  'hardBlockers', 'warnings', 'checks', 'modelReview', 'reviewedContextVersion', 'createdAt',
])

function mapError(error: unknown): never {
  if (error instanceof GenericAssetWorkflowError) {
    throw new AgentToolInvocationError(error.code, error.message)
  }
  if (error instanceof ArtifactServiceError) {
    throw new AgentToolInvocationError(error.code, error.message)
  }
  throw error
}

function compact(artifact: AgentArtifact<GenericAssetDraftContent | GenericAssetReviewContent>) {
  return compactArtifact(artifact)
}

export function registerGenericAssetTools(
  registry: AgentToolRegistry,
  dependencies: GenericAssetToolDependencies,
): AgentToolRegistry {
  registry.register<GenerateInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.assets.generate_draft',
      version: '1.0.0',
      domain: 'assets',
      title: '生成并审校小说资产草稿',
      description: '调用项目配置的模型生成世界规则、大纲、章节、人物、势力、物品、线程、时间轴、支线、地图、项目定位或主题声音草稿，完成独立审校与必要的定向优化后保存为不可变工件；不会写入正式资产。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        assetType: assetTypeSchema,
        title: { type: 'string', minLength: 1, maxLength: 200 },
        requirements: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 1200 }, maxItems: 20 },
        outputFormat: { enum: ['json', 'markdown', 'text'] },
        schemaHint: { type: 'string', maxLength: 6000 },
        executionMode: executionModeSchema,
        modelConfigId: { type: 'integer', minimum: 1 },
        parentArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      }, ['novelId', 'assetType', 'title', 'idempotencyKey']),
      outputSchema: objectSchema({
        draftArtifact: artifactReferenceSchema,
        effectiveArtifact: artifactReferenceSchema,
        reviewArtifact: artifactReferenceSchema,
        taskId: { type: 'integer', minimum: 1 },
        outputPreview: { type: 'string', maxLength: 901 },
        review: reviewSchema,
        idempotentReplay: { type: 'boolean' },
      }, [
        'draftArtifact', 'effectiveArtifact', 'reviewArtifact', 'taskId',
        'outputPreview', 'review', 'idempotentReplay',
      ]),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.draftCreate,
        AGENT_TOOL_SCOPES.draftReview,
        AGENT_TOOL_SCOPES.qualityRun,
      ],
      idempotent: true,
      taskMode: 'app_async',
      timeoutClass: 'model',
      tags: ['assets', 'generation', 'model', 'quality-review', 'optimization', 'artifact'],
    },
    handler: async (input) => {
      try {
        const result = await dependencies.generateDraft(input)
        return {
          draftArtifact: compact(result.draftArtifact),
          effectiveArtifact: compact(result.effectiveArtifact),
          reviewArtifact: compact(result.reviewArtifact),
          taskId: result.taskId,
          outputPreview: result.outputPreview,
          review: result.review,
          idempotentReplay: result.idempotentReplay,
        }
      } catch (error) {
        return mapError(error)
      }
    },
  })

  registry.register<ReviewInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.assets.review_draft',
      version: '1.0.0',
      domain: 'assets',
      title: '独立复核并优化资产草稿',
      description: '按当前项目上下文复核通用资产草稿；需要优化时创建新的子版本，原工件保持不可变。结果仍须由作者在现有界面中确认应用。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        draftArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        executionMode: executionModeSchema,
        modelConfigId: { type: 'integer', minimum: 1 },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      }, ['novelId', 'draftArtifactId', 'idempotencyKey']),
      outputSchema: objectSchema({
        sourceArtifact: artifactReferenceSchema,
        effectiveArtifact: artifactReferenceSchema,
        reviewArtifact: artifactReferenceSchema,
        outputPreview: { type: 'string', maxLength: 901 },
        review: reviewSchema,
        idempotentReplay: { type: 'boolean' },
      }, [
        'sourceArtifact', 'effectiveArtifact', 'reviewArtifact', 'outputPreview',
        'review', 'idempotentReplay',
      ]),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.draftReview,
        AGENT_TOOL_SCOPES.qualityRun,
        AGENT_TOOL_SCOPES.qualityRepair,
      ],
      idempotent: true,
      taskMode: 'app_async',
      timeoutClass: 'model',
      tags: ['assets', 'review', 'optimization', 'versioning', 'artifact'],
    },
    handler: async (input) => {
      try {
        const result = await dependencies.reviewDraft(input)
        return {
          sourceArtifact: compact(result.sourceArtifact),
          effectiveArtifact: compact(result.effectiveArtifact),
          reviewArtifact: compact(result.reviewArtifact),
          outputPreview: result.outputPreview,
          review: result.review,
          idempotentReplay: result.idempotentReplay,
        }
      } catch (error) {
        return mapError(error)
      }
    },
  })
  return registry
}
