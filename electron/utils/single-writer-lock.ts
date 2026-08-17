import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const LOCK_FILE_NAME = 'novelforge.single-writer.lock'
const STALE_LOCK_AGE_MS = 24 * 60 * 60 * 1000

interface LockRecord {
  pid: number
  identity: string
  startedAt: string
  hostname: string
}

export interface SingleWriterLockHandle {
  /** 释放写锁。仅当当前进程仍是锁的持有者时才会删除锁文件。 */
  release(): void
  /** 当前进程是否仍持有该锁。 */
  isOwner(): boolean
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // ESRCH: 进程不存在；EPERM: 进程存在但无权限向其发信号。
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readLockRecord(lockPath: string): LockRecord | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8')
    const record = JSON.parse(raw) as Partial<LockRecord>
    if (typeof record.pid !== 'number' || typeof record.identity !== 'string') return null
    return record as LockRecord
  } catch {
    return null
  }
}

function tryCreateLock(lockPath: string, identity: string): boolean {
  try {
    const fd = fs.openSync(lockPath, 'wx')
    const record: LockRecord = {
      pid: process.pid,
      identity,
      startedAt: new Date().toISOString(),
      hostname: os.hostname(),
    }
    fs.writeFileSync(fd, JSON.stringify(record, null, 2), 'utf8')
    fs.closeSync(fd)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EEXIST'
      ? false
      : (() => {
          // 除已存在外，锁目录不可写等失败按不可获取处理，由调用方决定策略。
          console.warn('[single-writer-lock] failed to create lock file:', error)
          return false
        })()
  }
}

/**
 * 获取 SQLite 单写者锁。
 *
 * 多个入口（桌面主进程、本地 Web 后端、MCP 运行时）会打开同一个
 * `userData/novelforge.db`。SQLite WAL 允许多读一写，但两个进程同时
 * 执行迁移或长写事务仍可能互相阻塞甚至破坏数据，因此这里用排他锁文件
 * 保证同一时刻只有一个写者进程。
 *
 * - 返回 handle 表示本进程成为写者。
 * - 返回 null 表示已有存活实例持有写锁（调用方应拒绝启动或降级为只读）。
 * - 崩溃遗留的陈旧锁（PID 不存在或超过 24 小时）会被自动清理并重试一次。
 */
export function acquireSingleWriterLock(
  lockDir: string,
  identity: string,
): SingleWriterLockHandle | null {
  fs.mkdirSync(lockDir, { recursive: true })
  const lockPath = path.join(lockDir, LOCK_FILE_NAME)

  if (tryCreateLock(lockPath, identity)) {
    return createHandle(lockPath)
  }

  const existing = readLockRecord(lockPath)
  const staleByAge = existing
    ? Date.now() - new Date(existing.startedAt).getTime() > STALE_LOCK_AGE_MS
    : false
  const staleByPid = existing ? !isProcessAlive(existing.pid) : true

  if (existing && (staleByAge || staleByPid)) {
    try {
      fs.unlinkSync(lockPath)
    } catch {
      // 并发清理竞争时忽略，下一次尝试会自然失败。
    }
    if (tryCreateLock(lockPath, identity)) {
      return createHandle(lockPath)
    }
  }

  return null
}

function createHandle(lockPath: string): SingleWriterLockHandle {
  let released = false
  return {
    release() {
      if (released) return
      released = true
      try {
        const record = readLockRecord(lockPath)
        if (record && record.pid === process.pid) {
          fs.unlinkSync(lockPath)
        }
      } catch {
        // 锁文件已被外部清理时忽略。
      }
    },
    isOwner() {
      if (released) return false
      const record = readLockRecord(lockPath)
      return Boolean(record && record.pid === process.pid)
    },
  }
}

export function getSingleWriterLockPath(lockDir: string): string {
  return path.join(lockDir, LOCK_FILE_NAME)
}
