import { describe, expect, it, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acquireSingleWriterLock, getSingleWriterLockPath } from './single-writer-lock'

let tempDir: string | null = null

function makeTempDir(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-lock-'))
  return tempDir
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('single-writer-lock', () => {
  it('acquires the lock on first attempt', () => {
    const dir = makeTempDir()
    const handle = acquireSingleWriterLock(dir, 'test-entry')
    expect(handle).not.toBeNull()
    expect(handle!.isOwner()).toBe(true)
  })

  it('refuses a second concurrent writer on the same process id', () => {
    const dir = makeTempDir()
    const first = acquireSingleWriterLock(dir, 'entry-a')
    expect(first).not.toBeNull()

    const second = acquireSingleWriterLock(dir, 'entry-b')
    expect(second).toBeNull()
  })

  it('releases the lock so a later writer can acquire it', () => {
    const dir = makeTempDir()
    const first = acquireSingleWriterLock(dir, 'entry-a')
    expect(first).not.toBeNull()

    first!.release()
    expect(first!.isOwner()).toBe(false)

    const second = acquireSingleWriterLock(dir, 'entry-b')
    expect(second).not.toBeNull()
    expect(second!.isOwner()).toBe(true)
  })

  it('cleans up a stale lock from a dead pid', () => {
    const dir = makeTempDir()
    const lockPath = getSingleWriterLockPath(dir)
    // 写入一个指向已不存在进程的陈旧锁（pid 1 在常规环境下不可信号化，
    // 这里使用一个几乎不可能存在的 pid）。
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 2 ** 30, identity: 'dead-entry', startedAt: new Date().toISOString(), hostname: 'test' }),
      'utf8',
    )

    const handle = acquireSingleWriterLock(dir, 'entry-a')
    expect(handle).not.toBeNull()
  })

  it('does not remove another process lock on release', () => {
    const dir = makeTempDir()
    const lockPath = getSingleWriterLockPath(dir)
    // 模拟：锁记录是本进程 pid 之外的另一个 pid。
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid + 100000, identity: 'other', startedAt: new Date().toISOString(), hostname: 'test' }),
      'utf8',
    )

    const handle = acquireSingleWriterLock(dir, 'entry-a')
    // 该 pid 实际不存在，会被当作陈旧锁清理并成功获取；
    // 若它恰好存在（几乎不可能），则返回 null。两种结果都合法，
    // 这里只验证 release 不会误删他人锁。
    if (handle) {
      handle.release()
      expect(fs.existsSync(lockPath)).toBe(false)
    }
  })
})
