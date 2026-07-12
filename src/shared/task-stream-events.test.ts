import { describe, expect, it } from 'vitest'
import { parseTaskChunkEvent, parseTaskEventId, parseTaskStatusEvent } from './task-stream-events'

describe('task stream event parsing', () => {
  it('accepts valid stream events', () => {
    expect(parseTaskChunkEvent({ taskId: 12, chunk: '正文' })).toEqual({ taskId: 12, chunk: '正文' })
    expect(parseTaskEventId({ taskId: 12 })).toBe(12)
    expect(parseTaskStatusEvent({ taskId: 12, status: 'running' })).toEqual({ taskId: 12, status: 'running' })
  })

  it('rejects malformed bridge payloads', () => {
    expect(parseTaskChunkEvent({ taskId: undefined, chunk: '正文' })).toBeNull()
    expect(parseTaskEventId({ taskId: 1.5 })).toBeNull()
    expect(parseTaskChunkEvent({ taskId: 1, chunk: 42 })).toBeNull()
    expect(parseTaskStatusEvent({ taskId: -1, status: 'running' })).toBeNull()
    expect(parseTaskStatusEvent({ taskId: 1, status: 'unknown' })).toBeNull()
  })
})
