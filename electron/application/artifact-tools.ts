import type { AgentArtifact, AgentArtifactListQuery } from '../../src/shared/agent-artifacts'
import type { AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { ArtifactServiceError } from './artifact-error'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'

export interface ArtifactToolDependencies {
  getArtifact: (artifactId: string) => AgentArtifact | null
  listArtifacts: (query: AgentArtifactListQuery) => AgentArtifact[]
}

type GetInput = Record<string, unknown> & { artifactId: string }
type ListInput = Record<string, unknown> & AgentArtifactListQuery

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[],
  additionalProperties = false,
): AgentToolJsonSchema {
  return { type: 'object', properties, required, additionalProperties }
}

const artifactStatusSchema: AgentToolJsonSchema = {
  enum: ['draft', 'reviewed', 'approved', 'committed', 'rejected', 'superseded'],
}

const artifactReferenceSchema = objectSchema({
  id: { type: 'string', minLength: 1 },
  novelId: { type: 'integer', minimum: 1 },
  kind: { type: 'string', minLength: 1 },
  status: artifactStatusSchema,
  version: { type: 'integer', minimum: 1 },
  parentArtifactId: { type: ['string', 'null'] },
  contentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  contextVersion: { type: 'integer', minimum: 1 },
  producerType: { type: 'string' },
  producerId: { type: 'string' },
  producerClient: { type: 'string' },
  modelConfigId: { type: ['integer', 'null'] },
  taskId: { type: ['integer', 'null'] },
  reviewArtifactId: { type: ['string', 'null'] },
  committedEntityIds: { type: 'array', items: { type: 'integer', minimum: 1 } },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
}, [
  'id', 'novelId', 'kind', 'status', 'version', 'parentArtifactId', 'contentHash',
  'contextVersion', 'producerType', 'producerId', 'producerClient', 'modelConfigId',
  'taskId', 'reviewArtifactId', 'committedEntityIds', 'createdAt', 'updatedAt',
])

export function compactArtifact(artifact: AgentArtifact) {
  return {
    id: artifact.id,
    novelId: artifact.novelId,
    kind: artifact.kind,
    status: artifact.status,
    version: artifact.version,
    parentArtifactId: artifact.parentArtifactId,
    contentHash: artifact.contentHash,
    contextVersion: artifact.contextVersion,
    producerType: artifact.producerType,
    producerId: artifact.producerId,
    producerClient: artifact.producerClient,
    modelConfigId: artifact.modelConfigId,
    taskId: artifact.taskId,
    reviewArtifactId: artifact.reviewArtifactId,
    committedEntityIds: artifact.committedEntityIds,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  }
}

function mapError(error: unknown): never {
  if (error instanceof ArtifactServiceError) {
    throw new AgentToolInvocationError(error.code, error.message)
  }
  throw error
}

export function registerArtifactTools(
  registry: AgentToolRegistry,
  dependencies: ArtifactToolDependencies,
): AgentToolRegistry {
  registry.register<GetInput, { artifact: ReturnType<typeof compactArtifact> & { content: unknown } }>({
    descriptor: {
      id: 'novelforge.artifacts.get',
      version: '1.0.0',
      domain: 'artifacts',
      title: '读取版本化工件',
      description: '按工件 ID 读取人物计划、草稿、审校报告或提交 Diff 的不可变正文与来源信息。',
      inputSchema: objectSchema({ artifactId: { type: 'string', minLength: 1, maxLength: 160 } }, ['artifactId']),
      outputSchema: objectSchema({
        artifact: objectSchema({
          ...(artifactReferenceSchema.properties || {}),
          content: {},
        }, [...(artifactReferenceSchema.required || []), 'content']),
      }, ['artifact']),
      effect: 'read',
      approval: 'never',
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['artifacts', 'drafts', 'reviews', 'provenance'],
    },
    handler: (input) => {
      try {
        const artifact = dependencies.getArtifact(input.artifactId)
        if (!artifact) throw new AgentToolInvocationError('ARTIFACT_NOT_FOUND', `Artifact ${input.artifactId} does not exist.`)
        return { artifact: { ...compactArtifact(artifact), content: artifact.content } }
      } catch (error) {
        return mapError(error)
      }
    },
  })

  registry.register<ListInput, { artifacts: ReturnType<typeof compactArtifact>[]; count: number }>({
    descriptor: {
      id: 'novelforge.artifacts.list',
      version: '1.0.0',
      domain: 'artifacts',
      title: '列出版本化工件',
      description: '按项目、类型和状态列出紧凑工件引用；先列表再按需读取正文，避免把完整草稿挤入智能体上下文。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        kind: { type: 'string', minLength: 1, maxLength: 100 },
        status: artifactStatusSchema,
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      }, ['novelId']),
      outputSchema: objectSchema({
        artifacts: { type: 'array', items: artifactReferenceSchema, maxItems: 200 },
        count: { type: 'integer', minimum: 0 },
      }, ['artifacts', 'count']),
      effect: 'read',
      approval: 'never',
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['artifacts', 'drafts', 'reviews', 'discovery'],
    },
    handler: (input) => {
      try {
        const artifacts = dependencies.listArtifacts(input).map(compactArtifact)
        return { artifacts, count: artifacts.length }
      } catch (error) {
        return mapError(error)
      }
    },
  })
  return registry
}

export { artifactReferenceSchema }
