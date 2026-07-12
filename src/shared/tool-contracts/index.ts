export type AgentToolEffect = 'read' | 'draft_write' | 'canonical_write' | 'external_effect'
export type AgentToolApproval = 'never' | 'policy' | 'always'
export type AgentToolTaskMode = 'sync' | 'app_async' | 'mcp_task_optional'
export type AgentToolTimeoutClass = 'short' | 'model' | 'workflow'

export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'

export interface AgentToolJsonSchema {
  $schema?: string
  $id?: string
  title?: string
  description?: string
  type?: JsonSchemaType | JsonSchemaType[]
  properties?: Record<string, AgentToolJsonSchema>
  required?: string[]
  additionalProperties?: boolean | AgentToolJsonSchema
  items?: AgentToolJsonSchema
  enum?: Array<string | number | boolean | null>
  const?: string | number | boolean | null
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
  anyOf?: AgentToolJsonSchema[]
  oneOf?: AgentToolJsonSchema[]
}

export interface AgentToolDescriptor {
  id: string
  version: string
  domain: string
  title: string
  description: string
  inputSchema: AgentToolJsonSchema
  outputSchema: AgentToolJsonSchema
  effect: AgentToolEffect
  approval: AgentToolApproval
  scopes: string[]
  idempotent: boolean
  taskMode: AgentToolTaskMode
  timeoutClass: AgentToolTimeoutClass
  tags: string[]
}

export interface AgentToolListQuery {
  domain?: string
  effect?: AgentToolEffect
  search?: string
}

export interface AgentToolActor {
  type: 'human' | 'codex' | 'claude_code' | 'system' | 'api_client'
  actorId: string
  clientId: string
  sessionId?: string
}

export interface AgentToolCallContext {
  actor: AgentToolActor
  scopes: string[]
  requestId?: string
  correlationId?: string
  approvalId?: string
  idempotencyKey?: string
  expectedVersion?: number
  locale?: string
}

export interface AgentToolCallRequest {
  toolId: string
  input?: Record<string, unknown>
  idempotencyKey?: string
  expectedVersion?: number
  approvalId?: string
}

export interface AgentToolApprovalRequest {
  request: AgentToolCallRequest
}

export interface AgentToolApprovalResult {
  approved: boolean
  approvalId?: string
  expiresAt?: string
  reason?: string
}

export interface AgentToolCallMeta {
  tool: string
  toolVersion?: string
  runId: string
  requestId?: string
  correlationId?: string
  requestedAt: string
  completedAt: string
  durationMs: number
  warnings: string[]
}

export interface AgentToolErrorPayload {
  code: string
  message: string
  detail?: string
  retryable: boolean
  validationIssues?: string[]
  missingScopes?: string[]
}

export type AgentToolCallResult<T = unknown> =
  | { ok: true; data: T; meta: AgentToolCallMeta }
  | { ok: false; error: AgentToolErrorPayload; meta: AgentToolCallMeta }

export const AGENT_TOOL_ID_PATTERN = /^novelforge\.[a-z][a-z0-9_-]*\.[a-z][a-z0-9_-]*$/u
export const AGENT_TOOL_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u

export const AGENT_TOOL_SCOPES = Object.freeze({
  discover: 'tool:discover',
  novelRead: 'novel:read',
  contextRead: 'context:read',
  taskRead: 'task:read',
  auditRead: 'audit:read',
  draftCreate: 'draft:create',
  draftReview: 'draft:review',
  canonWrite: 'canon:write',
  qualityRun: 'quality:run',
  qualityRepair: 'quality:repair',
  recommendationRead: 'recommendation:read',
  recommendationRecord: 'recommendation:record',
} as const)

export const DESKTOP_AGENT_TOOL_SCOPES = Object.freeze(Object.values(AGENT_TOOL_SCOPES))

export const WEB_PREVIEW_AGENT_TOOL_SCOPES = Object.freeze([
  AGENT_TOOL_SCOPES.discover,
  AGENT_TOOL_SCOPES.novelRead,
  AGENT_TOOL_SCOPES.contextRead,
  AGENT_TOOL_SCOPES.taskRead,
  AGENT_TOOL_SCOPES.auditRead,
  AGENT_TOOL_SCOPES.draftCreate,
  AGENT_TOOL_SCOPES.draftReview,
  AGENT_TOOL_SCOPES.qualityRun,
  AGENT_TOOL_SCOPES.qualityRepair,
  AGENT_TOOL_SCOPES.recommendationRead,
])

export const MCP_AGENT_TOOL_DEFAULT_SCOPES = Object.freeze([
  AGENT_TOOL_SCOPES.discover,
  AGENT_TOOL_SCOPES.novelRead,
  AGENT_TOOL_SCOPES.contextRead,
  AGENT_TOOL_SCOPES.taskRead,
  AGENT_TOOL_SCOPES.auditRead,
  AGENT_TOOL_SCOPES.draftCreate,
  AGENT_TOOL_SCOPES.draftReview,
  AGENT_TOOL_SCOPES.qualityRun,
  AGENT_TOOL_SCOPES.qualityRepair,
  AGENT_TOOL_SCOPES.recommendationRead,
])

export interface JsonSchemaValidationResult {
  valid: boolean
  issues: string[]
}

function matchesType(value: unknown, type: JsonSchemaType): boolean {
  switch (type) {
    case 'null': return value === null
    case 'array': return Array.isArray(value)
    case 'object': return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    default: return false
  }
}

function describeTypes(types: JsonSchemaType[]): string {
  return types.map((type) => type === 'null' ? 'null' : type).join(' or ')
}

function validateValue(
  value: unknown,
  schema: AgentToolJsonSchema,
  path: string,
  issues: string[],
): void {
  if (schema.anyOf && schema.anyOf.length > 0) {
    const branchMatches = schema.anyOf.some((branch) => validateJsonSchema(value, branch, path).valid)
    if (!branchMatches) issues.push(`${path} does not match any allowed schema`)
    return
  }

  if (schema.oneOf && schema.oneOf.length > 0) {
    const matchCount = schema.oneOf.filter((branch) => validateJsonSchema(value, branch, path).valid).length
    if (matchCount !== 1) issues.push(`${path} must match exactly one allowed schema`)
    return
  }

  if (schema.const !== undefined && value !== schema.const) {
    issues.push(`${path} must equal ${JSON.stringify(schema.const)}`)
    return
  }

  if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
    issues.push(`${path} must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`)
    return
  }

  const types = schema.type == null
    ? []
    : Array.isArray(schema.type)
      ? schema.type
      : [schema.type]
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    issues.push(`${path} must be ${describeTypes(types)}`)
    return
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push(`${path} must contain at least ${schema.minLength} characters`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push(`${path} must contain at most ${schema.maxLength} characters`)
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      issues.push(`${path} does not match the required pattern`)
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push(`${path} must be >= ${schema.minimum}`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push(`${path} must be <= ${schema.maximum}`)
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push(`${path} must contain at least ${schema.minItems} items`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push(`${path} must contain at most ${schema.maxItems} items`)
    }
    if (schema.items) {
      value.forEach((item, index) => validateValue(item, schema.items as AgentToolJsonSchema, `${path}[${index}]`, issues))
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const properties = schema.properties || {}
    for (const requiredKey of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(record, requiredKey) || record[requiredKey] === undefined) {
        issues.push(`${path}.${requiredKey} is required`)
      }
    }
    for (const [key, childValue] of Object.entries(record)) {
      if (childValue === undefined) continue
      const childSchema = properties[key]
      if (childSchema) {
        validateValue(childValue, childSchema, `${path}.${key}`, issues)
      } else if (schema.additionalProperties === false) {
        issues.push(`${path}.${key} is not allowed`)
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateValue(childValue, schema.additionalProperties, `${path}.${key}`, issues)
      }
    }
  }
}

export function validateJsonSchema(
  value: unknown,
  schema: AgentToolJsonSchema,
  path = '$',
): JsonSchemaValidationResult {
  const issues: string[] = []
  validateValue(value, schema, path, issues)
  return { valid: issues.length === 0, issues }
}

export function isAgentToolEffect(value: unknown): value is AgentToolEffect {
  return value === 'read'
    || value === 'draft_write'
    || value === 'canonical_write'
    || value === 'external_effect'
}
