import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { McpStorageLease } from './mcp-storage-lease'
import { acquireSingleWriterLock } from './single-writer-lock'

let directory: string | null = null
let lease: McpStorageLease | null = null

function setup() {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-mcp-lease-'))
  const open = vi.fn()
  const close = vi.fn()
  lease = new McpStorageLease(directory, open, close, 100)
  return { directory, lease, open, close }
}

afterEach(() => {
  lease?.close()
  vi.useRealTimers()
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
  directory = null
  lease = null
})

describe('MCP storage lease', () => {
  it('does not block the desktop while connected but idle', () => {
    const { directory, lease, open } = setup()
    const desktop = acquireSingleWriterLock(directory, 'desktop-main')
    expect(desktop).not.toBeNull()
    expect(lease.enter()).toBe(false)
    expect(open).not.toHaveBeenCalled()
    desktop!.release()
  })

  it('releases the writer lock after the last call and can reacquire it later', () => {
    vi.useFakeTimers()
    const { directory, lease, open, close } = setup()
    expect(lease.enter()).toBe(true)
    expect(lease.enter()).toBe(true)
    expect(acquireSingleWriterLock(directory, 'desktop-main')).toBeNull()
    lease.leave()
    vi.advanceTimersByTime(200)
    expect(acquireSingleWriterLock(directory, 'desktop-main')).toBeNull()
    lease.leave()
    vi.advanceTimersByTime(100)
    expect(close).toHaveBeenCalledOnce()
    const desktop = acquireSingleWriterLock(directory, 'desktop-main')
    expect(desktop).not.toBeNull()
    expect(lease.enter()).toBe(false)
    desktop!.release()
    expect(lease.enter()).toBe(true)
    expect(open).toHaveBeenCalledTimes(2)
    lease.leave()
  })

  it('releases the lock if database initialization fails', () => {
    const { directory, lease, open } = setup()
    open.mockImplementation(() => { throw new Error('migration failed') })
    expect(() => lease.enter()).toThrow('migration failed')
    const desktop = acquireSingleWriterLock(directory, 'desktop-main')
    expect(desktop).not.toBeNull()
    desktop!.release()
  })
})
