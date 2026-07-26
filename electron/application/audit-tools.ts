import type {
  AgentToolInvocationQuery,
  AgentToolInvocationView,
} from '../services/agent-tool-audit.service'
import type { AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { AgentToolRegistry } from './tool-registry'

export interface AuditToolDependencies {
  queryInvocations: (query: AgentToolInvocationQuery) => AgentToolInvocationView[]
}

type QueryInput = Record<string, unknown> & AgentToolInvocationQuery

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[],
  additionalProperties = false,
): AgentToolJsonSchema {
  return { type: 'object', properties, required, additionalProperties }
}

export function registerAuditTools(registry: AgentToolRegistry, dependencies: AuditToolDependencies): AgentToolRegistry {
  registry.register<QueryInput, { invocations: AgentToolInvocationView[]; count: number }>({
    descriptor: {
      id: 'novelforge.audit.query',
      version: '1.0.0',
      domain: 'audit',
      title: '查询智能体操作审计',
      description: '按项目、工具、调用者或状态查询工具调用链；只返回脱敏输入、哈希、批准引用、结果状态和耗时。',
      inputSchema: objectSchema({
        novelId: { type: 'integer', minimum: 1 },
        toolId: { type: 'string', minLength: 1, maxLength: 160 },
        actorType: { enum: ['human', 'system', 'api_client'] },
        status: { enum: ['success', 'error', 'denied'] },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      }, ['novelId']),
      outputSchema: objectSchema({
        invocations: {
          type: 'array',
          maxItems: 500,
          items: objectSchema({
            id: { type: 'string' },
            novelId: { type: ['integer', 'null'] },
            runId: { type: 'string' },
            toolId: { type: 'string' },
            toolVersion: { type: 'string' },
            inputHash: { type: 'string' },
            redactedInput: { type: 'object', additionalProperties: true },
            effect: { enum: ['read', 'draft_write', 'canonical_write', 'external_effect'] },
            approvalId: { type: ['string', 'null'] },
            actorType: { type: 'string' },
            actorId: { type: 'string' },
            clientId: { type: 'string' },
            status: { enum: ['success', 'error', 'denied'] },
            durationMs: { type: 'integer', minimum: 0 },
            errorCode: { type: ['string', 'null'] },
            outputHash: { type: ['string', 'null'] },
            createdAt: { type: 'string' },
            completedAt: { type: 'string' },
          }, [
            'id', 'novelId', 'runId', 'toolId', 'toolVersion', 'inputHash',
            'redactedInput', 'effect', 'approvalId', 'actorType', 'actorId',
            'clientId', 'status', 'durationMs', 'errorCode', 'outputHash',
            'createdAt', 'completedAt',
          ]),
        },
        count: { type: 'integer', minimum: 0 },
      }, ['invocations', 'count']),
      effect: 'read',
      approval: 'never',
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.auditRead],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['audit', 'agent-operations', 'approvals', 'provenance'],
    },
    handler: (input) => {
      const invocations = dependencies.queryInvocations(input)
      return { invocations, count: invocations.length }
    },
  })
  return registry
}
