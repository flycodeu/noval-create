import fs from 'node:fs'
import readline from 'node:readline'
import { app } from 'electron'
import { probeRuntime, readRuntimeConnection, runtimeRequest, type RuntimeConnection } from './utils/mcp-runtime'
import { assertNotUpdating } from './utils/update-lifecycle'
import { applicationVersion, isTestProfile } from './utils/desktop-profile'
import { assertMcpDesktopOwner } from './utils/mcp-owner-policy'

/** A stdio client never opens storage; every request goes to the existing owner. */
export async function startMcpStdio(): Promise<void> {
  console.log = (...args) => console.error(...args)
  console.info = (...args) => console.error(...args)
  console.debug = (...args) => console.error(...args)
  await app.whenReady()
  if (!app.isPackaged || isTestProfile()) throw new Error('MCP 不接受源码版或临时数据目录，请手动打开安装版的正式实例。')
  const directory = app.getPath('userData')
  const version = applicationVersion()
  const connectInitialOwner = async (): Promise<RuntimeConnection> => {
    assertNotUpdating(directory, version)
    const live = await probeRuntime(directory, version)
    assertMcpDesktopOwner(live?.health, directory, app.getPath('exe'))
    return live!.connection
  }
  // Connection-only: neither initial connection nor reconnect may start an owner.
  const connection = await connectInitialOwner()
  const input = fs.createReadStream('', { fd: 0, autoClose: false })
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  let stopped = false
  let checking = false
  const shutdown = () => {
    if (stopped) return
    stopped = true
    clearInterval(heartbeat)
    process.removeListener('SIGINT', shutdown)
    process.removeListener('SIGTERM', shutdown)
    input.removeListener('end', shutdown)
    lines.close()
    input.destroy()
    // On Windows a pending fd 0 read survives app.quit/app.exit even after
    // closeSync(0). This stateless bridge owns no database or windows; terminate
    // only itself so an MCP client keeping stdin open cannot lock the install.
    if (process.platform === 'win32') process.kill(process.pid, 'SIGTERM')
    else app.quit()
  }
  const assertBoundOwnerExists = () => {
    const current = readRuntimeConnection(directory)
    if (stopped || !current || current.instanceId !== connection.instanceId || current.pid !== connection.pid) {
      throw new Error('NovelForge runtime stopped or changed. Reconnect the MCP client.')
    }
    try { process.kill(connection.pid, 0) } catch (error) {
      // Lack of signal permission does not prove the owner has exited.
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') throw new Error('NovelForge runtime process has exited. Reconnect the MCP client.')
    }
  }
  const assertOwner = async () => {
    if (stopped) throw new Error('NovelForge MCP bridge has stopped. Reconnect to use the current application.')
    try {
      assertNotUpdating(directory, version)
      // Check the bound identity before probing so an old bridge never asks a
      // replacement owner to serve it.
      assertBoundOwnerExists()
      const owner = await probeRuntime(directory, version)
      if (owner) assertMcpDesktopOwner(owner.health, directory, app.getPath('exe'))
      assertNotUpdating(directory, version)
      assertBoundOwnerExists()
      // A cold BrowserWindow can temporarily block the owner's HTTP loop. A
      // health timeout is not owner loss while its discovery and PID still match.
      if (owner && (owner.connection.instanceId !== connection.instanceId || owner.connection.pid !== connection.pid)) {
        throw new Error('NovelForge runtime stopped or changed. Reconnect the MCP client.')
      }
    } catch (error) {
      shutdown()
      throw error
    }
  }
  const heartbeat = setInterval(() => {
    if (checking || stopped) return
    checking = true
    void assertOwner().catch(() => { /* Owner loss and update maintenance already close this bridge. */ }).finally(() => { checking = false })
  }, 1_000)
  lines.on('line', (line) => {
    if (stopped || !line.trim()) return
    void (async () => {
      let message: { id?: string | number; method?: string }
      try { message = JSON.parse(line) } catch { return }
      try {
        // Never attach to another owner or replay a possibly completed mutation.
        await assertOwner()
        const response = await runtimeRequest(connection, '/mcp', { method: 'POST', body: line, timeoutMs: 15 * 60_000 })
        const result = await response.text()
        if (!response.ok) throw new Error(`Runtime HTTP ${response.status}: ${result}`)
        if (!stopped && result.trim()) process.stdout.write(`${result.trim()}\n`)
      } catch (error) {
        if (message.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })}\n`)
      }
    })()
  })
  input.once('end', shutdown)
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
