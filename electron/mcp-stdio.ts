import fs from 'node:fs'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { probeRuntime, readRuntimeConnection, runtimeRequest, type RuntimeConnection } from './utils/mcp-runtime'
import { assertNotUpdating } from './utils/update-lifecycle'

/** A stdio client never opens storage; every request goes to the existing owner. */
export async function startMcpStdio(runtimeArgs?: string[]): Promise<void> {
  console.log = (...args) => console.error(...args)
  console.info = (...args) => console.error(...args)
  console.debug = (...args) => console.error(...args)
  await app.whenReady()
  const directory = app.getPath('userData')
  const version = app.getVersion()
  const connectInitialOwner = async (): Promise<RuntimeConnection> => {
    assertNotUpdating(directory, version)
    const live = await probeRuntime(directory, version)
    if (live) return live.connection
    assertNotUpdating(directory, version)
    const args = runtimeArgs || [...(app.isPackaged ? [] : [app.getAppPath()]), '--runtime']
    const child = spawn(process.execPath, args, {
      env: { ...process.env, NOVELFORGE_USER_DATA_DIR: directory },
      detached: true, stdio: 'ignore', windowsHide: true,
    })
    let launchError: Error | undefined
    child.once('error', (error) => { launchError = error })
    child.unref()
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      assertNotUpdating(directory, version)
      if (launchError) throw launchError
      const ready = await probeRuntime(directory, version)
      if (ready) return ready.connection
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    throw new Error('NovelForge runtime did not become ready in 30 seconds. Check the app startup log.')
  }
  // Only initial connection may start an owner. An established bridge must release the
  // installed executable when its owner stops, even while Codex keeps stdin open.
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
