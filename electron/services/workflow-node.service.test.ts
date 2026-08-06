import { describe, expect, it } from 'vitest'
import { hashWorkflowNodeInput, WorkflowNodeError } from './workflow-node.service'

describe('workflow node contracts', () => {
  it('hashes equivalent node inputs deterministically', () => {
    expect(hashWorkflowNodeInput({ role: 'writer', input: { b: 2, a: 1 } }))
      .toBe(hashWorkflowNodeInput({ input: { a: 1, b: 2 }, role: 'writer' }))
  })

  it('exposes a stable domain error type for lease failures', () => {
    const error = new WorkflowNodeError('LEASE_CONFLICT', 'busy')
    expect(error.code).toBe('LEASE_CONFLICT')
    expect(error).toBeInstanceOf(Error)
  })
})
