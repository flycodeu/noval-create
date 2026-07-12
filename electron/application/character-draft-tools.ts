import type {
  CharacterDraftReviewContent,
  CommitCharacterDraftInput,
  CommitCharacterDraftResult,
  GenerateCharacterDraftInput,
  GenerateCharacterDraftResult,
  ReviewCharacterDraftInput,
} from '../../src/shared/character-draft-workflow'
import type { AgentArtifact } from '../../src/shared/agent-artifacts'
import type { AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { CharacterDraftWorkflowError } from './character-draft-workflow-error'
import { compactArtifact, artifactReferenceSchema } from './artifact-tools'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'

export interface CharacterDraftToolDependencies {
  generateDraft: (input: GenerateCharacterDraftInput) => Promise<GenerateCharacterDraftResult>
  reviewDraft: (input: ReviewCharacterDraftInput) => {
    reviewArtifact: AgentArtifact<CharacterDraftReviewContent>
    review: CharacterDraftReviewContent
  }
  commitDraft: (input: CommitCharacterDraftInput) => CommitCharacterDraftResult
}

type GenerateInput = Record<string, unknown> & GenerateCharacterDraftInput
type ReviewInput = Record<string, unknown> & ReviewCharacterDraftInput
type CommitInput = Record<string, unknown> & CommitCharacterDraftInput

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[],
  additionalProperties = false,
): AgentToolJsonSchema {
  return { type: 'object', properties, required, additionalProperties }
}

const reviewSchema = objectSchema({
  schemaVersion: { const: 'character-draft-review-v1' },
  draftArtifactId: { type: 'string' },
  draftContentHash: { type: 'string' },
  status: { enum: ['passed', 'needs_revision', 'blocked'] },
  score: { type: 'integer', minimum: 0, maximum: 100 },
  committable: { type: 'boolean' },
  summary: { type: 'string' },
  hardBlockers: { type: 'array', items: { type: 'string' } },
  warnings: { type: 'array', items: { type: 'string' } },
  checks: {
    type: 'array',
    items: objectSchema({
      code: { type: 'string' },
      status: { enum: ['pass', 'warn', 'fail'] },
      message: { type: 'string' },
      characterNames: { type: 'array', items: { type: 'string' } },
    }, ['code', 'status', 'message', 'characterNames']),
  },
  modelReview: { type: 'object', additionalProperties: true },
  reviewedContextVersion: { type: 'integer', minimum: 1 },
  createdAt: { type: 'string' },
}, [
  'schemaVersion', 'draftArtifactId', 'draftContentHash', 'status', 'score',
  'committable', 'summary', 'hardBlockers', 'warnings', 'checks', 'modelReview',
  'reviewedContextVersion', 'createdAt',
])

function mapError(error: unknown): never {
  if (error instanceof CharacterDraftWorkflowError) {
    throw new AgentToolInvocationError(error.code, error.message)
  }
  throw error
}

export function registerCharacterDraftTools(
  registry: AgentToolRegistry,
  dependencies: CharacterDraftToolDependencies,
): AgentToolRegistry {
  registry.register<GenerateInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.characters.generate_draft',
      version: '1.0.0',
      domain: 'characters',
      title: '按人物计划生成草稿',
      description: '在已审校 Cast Plan 上调用 NovelForge 模型生成版本化人物草稿并独立审校；不会写入正式人物库。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        planId: { type: 'string', minLength: 1, maxLength: 160 },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
        maxCharacters: { type: 'integer', minimum: 1, maximum: 30 },
        specialRequirements: { type: 'string', maxLength: 4000 },
      }, ['novelId', 'planId', 'idempotencyKey']),
      outputSchema: objectSchema({
        draftArtifact: artifactReferenceSchema,
        reviewArtifact: artifactReferenceSchema,
        taskId: { type: 'integer', minimum: 1 },
        characterCount: { type: 'integer', minimum: 1, maximum: 30 },
        characterNames: { type: 'array', items: { type: 'string' }, maxItems: 30 },
        diffSummary: objectSchema({
          createCount: { type: 'integer', minimum: 0 },
          updateSuggestionCount: { type: 'integer', minimum: 0 },
          mergeSuggestionCount: { type: 'integer', minimum: 0 },
          archiveSuggestionCount: { type: 'integer', minimum: 0 },
        }, ['createCount', 'updateSuggestionCount', 'mergeSuggestionCount', 'archiveSuggestionCount']),
        review: reviewSchema,
        idempotentReplay: { type: 'boolean' },
      }, ['draftArtifact', 'reviewArtifact', 'taskId', 'characterCount', 'characterNames', 'diffSummary', 'review', 'idempotentReplay']),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.draftCreate,
        AGENT_TOOL_SCOPES.draftReview,
      ],
      idempotent: true,
      taskMode: 'app_async',
      timeoutClass: 'model',
      tags: ['characters', 'generation', 'draft', 'artifact', 'quality-review'],
    },
    handler: async (input) => {
      try {
        const result = await dependencies.generateDraft(input)
        return {
          draftArtifact: compactArtifact(result.draftArtifact),
          reviewArtifact: compactArtifact(result.reviewArtifact),
          taskId: result.taskId,
          characterCount: result.characterCount,
          characterNames: result.characterNames,
          diffSummary: result.diffSummary,
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
      id: 'novelforge.characters.review',
      version: '1.0.0',
      domain: 'characters',
      title: '复核人物草稿',
      description: '对版本化人物草稿重新执行重名、动机链、戏剧引擎、角色类型和模型审校证据检查，并保存新的审校工件。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        draftArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
      }, ['novelId', 'draftArtifactId']),
      outputSchema: objectSchema({
        reviewArtifact: artifactReferenceSchema,
        review: reviewSchema,
      }, ['reviewArtifact', 'review']),
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.draftReview,
      ],
      idempotent: false,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['characters', 'review', 'quality-gate', 'artifact'],
    },
    handler: (input) => {
      try {
        const result = dependencies.reviewDraft(input)
        return { reviewArtifact: compactArtifact(result.reviewArtifact), review: result.review }
      } catch (error) {
        return mapError(error)
      }
    },
  })

  registry.register<CommitInput, Record<string, unknown>>({
    descriptor: {
      id: 'novelforge.characters.commit_draft',
      version: '1.0.0',
      domain: 'characters',
      title: '批准并提交人物草稿',
      description: '仅在草稿哈希、上下文版本和独立审校均有效时，把新增人物事务写入正式库；必须使用可信的一次性批准。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        draftArtifactId: { type: 'string', minLength: 1, maxLength: 160 },
        expectedContextVersion: { type: 'integer', minimum: 1 },
        expectedContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      }, ['novelId', 'draftArtifactId', 'expectedContextVersion', 'expectedContentHash', 'idempotencyKey']),
      outputSchema: objectSchema({
        draftArtifactId: { type: 'string' },
        commitArtifact: artifactReferenceSchema,
        createdCharacterIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
        createdCharacterNames: { type: 'array', items: { type: 'string' } },
        contextVersionBefore: { type: 'integer', minimum: 1 },
        contextVersionAfter: { type: 'integer', minimum: 1 },
        idempotentReplay: { type: 'boolean' },
        warnings: { type: 'array', items: { type: 'string' } },
      }, [
        'draftArtifactId', 'commitArtifact', 'createdCharacterIds', 'createdCharacterNames',
        'contextVersionBefore', 'contextVersionAfter', 'idempotentReplay', 'warnings',
      ]),
      effect: 'canonical_write',
      approval: 'always',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.draftReview,
        AGENT_TOOL_SCOPES.canonWrite,
      ],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'workflow',
      tags: ['characters', 'commit', 'canonical-write', 'approval-required', 'artifact'],
    },
    handler: (input) => {
      try {
        const result = dependencies.commitDraft(input)
        return { ...result, commitArtifact: compactArtifact(result.commitArtifact) }
      } catch (error) {
        return mapError(error)
      }
    },
  })
  return registry
}
