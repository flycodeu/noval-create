import { describe, expect, it } from 'vitest'
import type { AgentToolDescriptor } from '../../src/shared/tool-contracts'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'

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
})
