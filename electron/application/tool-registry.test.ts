import { describe, expect, it } from 'vitest'
import type { AgentToolDescriptor } from '../../src/shared/tool-contracts'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'
import { CreativeResearchValidationError } from '../../src/shared/creative-research'
import { UserFacingError } from '../utils/user-facing-error'

const descriptor: AgentToolDescriptor = {
  id: 'novelforge.tests.echo',
  version: '1.0.0',
  domain: 'tests',
  title: 'Echo',
  description: 'Echo a validated test value.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      value: { type: 'string', minLength: 1 },
    },
    required: ['value'],
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      value: { type: 'string' },
    },
    required: ['value'],
  },
  effect: 'read',
  approval: 'never',
  scopes: ['tests:read'],
  idempotent: true,
  taskMode: 'sync',
  timeoutClass: 'short',
  tags: ['test'],
}

function context(scopes = ['tests:read']) {
  return {
    actor: { type: 'human' as const, actorId: 'tester', clientId: 'vitest' },
    scopes,
    requestId: 'request-1',
    correlationId: 'run-1',
  }
}

describe('AgentToolRegistry', () => {
  it('lists descriptors without exposing handlers and supports discovery filters', () => {
    const registry = new AgentToolRegistry().register({
      descriptor,
      handler: async (input) => ({ value: input.value as string }),
    })

    expect(registry.list()).toEqual([descriptor])
    expect(registry.list({ domain: 'tests' })).toHaveLength(1)
    expect(registry.list({ effect: 'draft_write' })).toHaveLength(0)
    expect(registry.list({ search: 'echo' })).toHaveLength(1)
  })

  it('rejects duplicate and malformed definitions', () => {
    const registry = new AgentToolRegistry().register({ descriptor, handler: () => ({ value: 'ok' }) })
    expect(() => registry.register({ descriptor, handler: () => ({ value: 'again' }) }))
      .toThrow(/Duplicate NovelForge tool/u)
    expect(() => new AgentToolRegistry().register({
      descriptor: { ...descriptor, id: 'bad tool id' },
      handler: () => ({ value: 'bad' }),
    })).toThrow(/Invalid NovelForge tool id/u)
  })

  it('validates scopes, inputs, and outputs before returning success', async () => {
    const registry = new AgentToolRegistry().register({
      descriptor,
      handler: async (input) => ({ value: input.value as string }),
    })

    const denied = await registry.invoke({ toolId: descriptor.id, input: { value: 'hello' } }, context([]))
    const invalid = await registry.invoke({ toolId: descriptor.id, input: { value: '', extra: true } }, context())
    const success = await registry.invoke({ toolId: descriptor.id, input: { value: 'hello' } }, context())

    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('AUTH_SCOPE_REQUIRED')
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) {
      expect(invalid.error.code).toBe('VALIDATION_FAILED')
      expect(invalid.error.validationIssues).toEqual(expect.arrayContaining([
        expect.stringContaining('at least 1'),
        expect.stringContaining('is not allowed'),
      ]))
    }
    expect(success).toMatchObject({
      ok: true,
      data: { value: 'hello' },
      meta: { tool: descriptor.id, toolVersion: '1.0.0', runId: 'run-1' },
    })
  })

  it('rejects invalid handler output and normalizes expected domain errors', async () => {
    const invalidOutputRegistry = new AgentToolRegistry().register({
      descriptor,
      handler: async () => ({ value: 42 } as unknown as { value: string }),
    })
    const domainErrorRegistry = new AgentToolRegistry().register({
      descriptor,
      handler: async () => {
        throw new AgentToolInvocationError('RESOURCE_NOT_FOUND', 'The requested item does not exist.')
      },
    })

    const invalidOutput = await invalidOutputRegistry.invoke({ toolId: descriptor.id, input: { value: 'x' } }, context())
    const domainError = await domainErrorRegistry.invoke({ toolId: descriptor.id, input: { value: 'x' } }, context())

    expect(invalidOutput.ok).toBe(false)
    if (!invalidOutput.ok) expect(invalidOutput.error.code).toBe('TOOL_OUTPUT_INVALID')
    expect(domainError.ok).toBe(false)
    if (!domainError.ok) expect(domainError.error.code).toBe('RESOURCE_NOT_FOUND')
  })

  it('returns a stable not-found result instead of throwing for unknown tools', async () => {
    const result = await new AgentToolRegistry().invoke({ toolId: 'novelforge.tests.missing' }, context())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('TOOL_NOT_FOUND')
  })

  it.each([
    [new UserFacingError('novel.contextVersionConflict'), 'CONTEXT_VERSION_CONFLICT'],
    [new UserFacingError('novel.invalidExpectedContextVersion'), 'EXPECTED_CONTEXT_VERSION_INVALID'],
    [new UserFacingError('services.projectNotFound'), 'PROJECT_NOT_FOUND'],
    [new UserFacingError('services.creativeResearch.notFound'), 'CREATIVE_RESEARCH_NOT_FOUND'],
    [new UserFacingError('services.creativeResearch.batchInvalid'), 'CREATIVE_RESEARCH_BATCH_INVALID'],
    [new UserFacingError('services.research.contextChangedBeforeSearch'), 'CONTEXT_VERSION_CONFLICT'],
    [new UserFacingError('services.research.contextChangedDuringSearch'), 'CONTEXT_VERSION_CONFLICT'],
    [new CreativeResearchValidationError('资料字段不合法。'), 'CREATIVE_RESEARCH_INVALID'],
    [new CreativeResearchValidationError('同批资料编号重复。', 'CREATIVE_RESEARCH_DUPLICATE_KEY'), 'CREATIVE_RESEARCH_DUPLICATE_KEY'],
    [new CreativeResearchValidationError('资料数量超过上限。', 'CREATIVE_RESEARCH_LIMIT_EXCEEDED'), 'CREATIVE_RESEARCH_LIMIT_EXCEEDED'],
    [new CreativeResearchValidationError('来源账本无法读取。', 'CREATIVE_RESEARCH_LEDGER_INVALID'), 'CREATIVE_RESEARCH_LEDGER_INVALID'],
  ])('returns public domain error %s without making writes automatically retryable', async (error, code) => {
    const registry = new AgentToolRegistry().register({ descriptor, handler: () => { throw error } })
    const result = await registry.invoke({ toolId: descriptor.id, input: { value: 'x' } }, context())
    expect(result).toMatchObject({ ok: false, error: { code, message: error.message, retryable: false } })
  })

  it('does not expose arbitrary coded infrastructure errors or their sensitive details', async () => {
    const error = Object.assign(new Error('sqlite path C:/private/novelforge.db token=private-value'), { code: 'SQLITE_BUSY', detail: 'private-value' })
    const registry = new AgentToolRegistry().register({ descriptor, handler: () => { throw error } })
    const result = await registry.invoke({ toolId: descriptor.id, input: { value: 'x' } }, context())
    expect(result).toMatchObject({ ok: false, error: { code: 'TOOL_EXECUTION_FAILED', retryable: false } })
    expect(JSON.stringify(result)).not.toMatch(/SQLITE_BUSY|C:\/private|private-value/u)
  })
})
