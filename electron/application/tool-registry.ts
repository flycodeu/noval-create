import { randomUUID } from 'node:crypto'
import type {
  AgentToolCallContext,
  AgentToolCallMeta,
  AgentToolCallRequest,
  AgentToolCallResult,
  AgentToolDescriptor,
  AgentToolErrorPayload,
  AgentToolListQuery,
} from '../../src/shared/tool-contracts'
import {
  AGENT_TOOL_ID_PATTERN,
  AGENT_TOOL_VERSION_PATTERN,
  validateJsonSchema,
} from '../../src/shared/tool-contracts'

export interface AgentToolHandlerContext extends AgentToolCallContext {
  runId: string
  tool: AgentToolDescriptor
  requestedAt: string
}

export type AgentToolHandler<Input extends Record<string, unknown>, Output> = (
  input: Input,
  context: AgentToolHandlerContext,
) => Output | Promise<Output>

export interface AgentToolRegistration<Input extends Record<string, unknown>, Output> {
  descriptor: AgentToolDescriptor
  handler: AgentToolHandler<Input, Output>
}

export interface AgentToolAuditEvent {
  descriptor?: AgentToolDescriptor
  request: AgentToolCallRequest
  context: AgentToolCallContext
  result: AgentToolCallResult
}

export type AgentToolAuditSink = (event: AgentToolAuditEvent) => void | Promise<void>

interface StoredAgentToolRegistration {
  descriptor: AgentToolDescriptor
  handler: AgentToolHandler<Record<string, unknown>, unknown>
}

export class AgentToolInvocationError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly detail?: string

  constructor(code: string, message: string, options: { retryable?: boolean; detail?: string } = {}) {
    super(message)
    this.name = 'AgentToolInvocationError'
    this.code = code
    this.retryable = options.retryable === true
    this.detail = options.detail
  }
}

function cloneDescriptor(descriptor: AgentToolDescriptor): AgentToolDescriptor {
  return {
    ...descriptor,
    inputSchema: structuredClone(descriptor.inputSchema),
    outputSchema: structuredClone(descriptor.outputSchema),
    scopes: [...descriptor.scopes],
    tags: [...descriptor.tags],
  }
}

function validateDescriptor(descriptor: AgentToolDescriptor): void {
  if (!AGENT_TOOL_ID_PATTERN.test(descriptor.id)) {
    throw new Error(`Invalid NovelForge tool id: ${descriptor.id}`)
  }
  if (!AGENT_TOOL_VERSION_PATTERN.test(descriptor.version)) {
    throw new Error(`Invalid NovelForge tool version for ${descriptor.id}: ${descriptor.version}`)
  }
  if (!descriptor.domain.trim()) throw new Error(`Tool ${descriptor.id} must declare a domain`)
  if (!descriptor.title.trim()) throw new Error(`Tool ${descriptor.id} must declare a title`)
  if (!descriptor.description.trim()) throw new Error(`Tool ${descriptor.id} must declare a description`)
  if (descriptor.inputSchema.type !== 'object') throw new Error(`Tool ${descriptor.id} input schema must have an object root`)
  if (descriptor.outputSchema.type !== 'object') throw new Error(`Tool ${descriptor.id} output schema must have an object root`)
  if (descriptor.effect === 'read' && descriptor.approval === 'always') {
    throw new Error(`Read-only tool ${descriptor.id} cannot require unconditional write approval`)
  }
}

function buildMeta(params: {
  descriptor?: AgentToolDescriptor
  toolId: string
  runId: string
  context: AgentToolCallContext
  requestedAt: string
  startedAt: number
}): AgentToolCallMeta {
  const completedAt = new Date().toISOString()
  return {
    tool: params.toolId,
    toolVersion: params.descriptor?.version,
    runId: params.runId,
    requestId: params.context.requestId,
    correlationId: params.context.correlationId,
    requestedAt: params.requestedAt,
    completedAt,
    durationMs: Math.max(0, Date.now() - params.startedAt),
    warnings: [],
  }
}

function errorPayload(
  code: string,
  message: string,
  options: Partial<AgentToolErrorPayload> = {},
): AgentToolErrorPayload {
  return {
    code,
    message,
    retryable: options.retryable === true,
    ...(options.detail ? { detail: options.detail } : {}),
    ...(options.validationIssues ? { validationIssues: options.validationIssues } : {}),
    ...(options.missingScopes ? { missingScopes: options.missingScopes } : {}),
  }
}

function normalizeQueryText(value: string | undefined): string {
  return (value || '').trim().toLowerCase()
}

export class AgentToolRegistry {
  private readonly registrations = new Map<string, StoredAgentToolRegistration>()

  constructor(private readonly auditSink?: AgentToolAuditSink) {}

  private async finalizeAudit(event: AgentToolAuditEvent): Promise<AgentToolCallResult> {
    if (this.auditSink) {
      try {
        await this.auditSink(event)
      } catch (error) {
        console.warn('[agent-tool-registry] failed to persist invocation audit:', error instanceof Error ? error.message : error)
      }
    }
    return event.result
  }

  register<Input extends Record<string, unknown>, Output>(
    registration: AgentToolRegistration<Input, Output>,
  ): this {
    validateDescriptor(registration.descriptor)
    if (this.registrations.has(registration.descriptor.id)) {
      throw new Error(`Duplicate NovelForge tool id: ${registration.descriptor.id}`)
    }
    this.registrations.set(registration.descriptor.id, {
      descriptor: cloneDescriptor(registration.descriptor),
      handler: registration.handler as AgentToolHandler<Record<string, unknown>, unknown>,
    })
    return this
  }

  list(query: AgentToolListQuery = {}): AgentToolDescriptor[] {
    const domain = normalizeQueryText(query.domain)
    const search = normalizeQueryText(query.search)
    return [...this.registrations.values()]
      .map((registration) => registration.descriptor)
      .filter((descriptor) => !domain || descriptor.domain.toLowerCase() === domain)
      .filter((descriptor) => !query.effect || descriptor.effect === query.effect)
      .filter((descriptor) => {
        if (!search) return true
        const haystack = [
          descriptor.id,
          descriptor.title,
          descriptor.description,
          descriptor.domain,
          ...descriptor.tags,
        ].join('\n').toLowerCase()
        return haystack.includes(search)
      })
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneDescriptor)
  }

  get(toolId: string): AgentToolDescriptor | null {
    const registration = this.registrations.get(toolId)
    return registration ? cloneDescriptor(registration.descriptor) : null
  }

  async invoke(
    request: AgentToolCallRequest,
    context: AgentToolCallContext,
  ): Promise<AgentToolCallResult> {
    const startedAt = Date.now()
    const requestedAt = new Date(startedAt).toISOString()
    const runId = context.correlationId || randomUUID()
    const toolId = typeof request?.toolId === 'string' ? request.toolId.trim() : ''
    const registration = this.registrations.get(toolId)
    const metaParams = { descriptor: registration?.descriptor, toolId, runId, context, requestedAt, startedAt }
    const finalize = (result: AgentToolCallResult) => this.finalizeAudit({
      descriptor: registration?.descriptor,
      request,
      context,
      result,
    })

    if (!registration) {
      return finalize({
        ok: false,
        error: errorPayload('TOOL_NOT_FOUND', `Unknown NovelForge tool: ${toolId || '(empty)'}`),
        meta: buildMeta(metaParams),
      })
    }

    const missingScopes = registration.descriptor.scopes.filter((scope) => !context.scopes.includes(scope))
    if (missingScopes.length > 0) {
      return finalize({
        ok: false,
        error: errorPayload('AUTH_SCOPE_REQUIRED', 'The caller does not have all scopes required by this tool.', {
          missingScopes,
        }),
        meta: buildMeta(metaParams),
      })
    }

    // Transport adapters must validate approvals and place the trusted id in
    // context. A caller-supplied request.approvalId is never authorization by
    // itself; it may only echo the already validated context id.
    const effectiveApprovalId = context.approvalId
      && (!request.approvalId || request.approvalId === context.approvalId)
      ? context.approvalId
      : undefined

    if (registration.descriptor.approval === 'always' && !effectiveApprovalId) {
      return finalize({
        ok: false,
        error: errorPayload('APPROVAL_REQUIRED', 'This tool requires an explicit approval before execution.'),
        meta: buildMeta(metaParams),
      })
    }

    const input = request.input || {}
    const inputValidation = validateJsonSchema(input, registration.descriptor.inputSchema)
    if (!inputValidation.valid) {
      return finalize({
        ok: false,
        error: errorPayload('VALIDATION_FAILED', 'Tool input does not match its declared schema.', {
          validationIssues: inputValidation.issues,
        }),
        meta: buildMeta(metaParams),
      })
    }

    try {
      const output = await registration.handler(input, {
        ...context,
        approvalId: effectiveApprovalId,
        idempotencyKey: request.idempotencyKey || context.idempotencyKey,
        expectedVersion: request.expectedVersion ?? context.expectedVersion,
        runId,
        tool: cloneDescriptor(registration.descriptor),
        requestedAt,
      })
      const outputValidation = validateJsonSchema(output, registration.descriptor.outputSchema)
      if (!outputValidation.valid) {
        return finalize({
          ok: false,
          error: errorPayload('TOOL_OUTPUT_INVALID', 'Tool output does not match its declared schema.', {
            validationIssues: outputValidation.issues,
          }),
          meta: buildMeta(metaParams),
        })
      }
      return finalize({ ok: true, data: output, meta: buildMeta(metaParams) })
    } catch (error) {
      if (error instanceof AgentToolInvocationError) {
        return finalize({
          ok: false,
          error: errorPayload(error.code, error.message, {
            detail: error.detail,
            retryable: error.retryable,
          }),
          meta: buildMeta(metaParams),
        })
      }
      return finalize({
        ok: false,
        error: errorPayload('TOOL_EXECUTION_FAILED', 'NovelForge could not complete the tool call.', {
          retryable: false,
        }),
        meta: buildMeta(metaParams),
      })
    }
  }
}
