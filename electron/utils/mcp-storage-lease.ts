import { acquireSingleWriterLock, type SingleWriterLockHandle } from './single-writer-lock'

const DEFAULT_IDLE_RELEASE_MS = 1_500

/** Keeps the MCP transport alive without owning the database while idle. */
export class McpStorageLease {
  private writerLock: SingleWriterLockHandle | null = null
  private activeCalls = 0
  private idleTimer: NodeJS.Timeout | null = null
  private closed = false

  constructor(
    private readonly lockDir: string,
    private readonly openStorage: () => void,
    private readonly closeStorage: () => void,
    private readonly idleReleaseMs = DEFAULT_IDLE_RELEASE_MS,
  ) {}

  enter(): boolean {
    if (this.closed) return false
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (!this.writerLock) {
      const lock = acquireSingleWriterLock(this.lockDir, 'mcp-runtime')
      if (!lock) return false
      try {
        this.openStorage()
        this.writerLock = lock
      } catch (error) {
        try { this.closeStorage() } catch { /* Keep the original open error. */ }
        lock.release()
        throw error
      }
    }
    this.activeCalls += 1
    return true
  }

  leave(): void {
    if (this.activeCalls === 0) return
    this.activeCalls -= 1
    if (this.activeCalls !== 0) return
    if (this.closed) {
      this.releaseStorage()
      return
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.activeCalls === 0) this.releaseStorage()
    }, this.idleReleaseMs)
    this.idleTimer.unref()
  }

  close(): void {
    this.closed = true
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.activeCalls === 0) this.releaseStorage()
  }

  private releaseStorage(): void {
    const lock = this.writerLock
    if (!lock) return
    this.writerLock = null
    try {
      this.closeStorage()
    } finally {
      lock.release()
    }
  }
}
