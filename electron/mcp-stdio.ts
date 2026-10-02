import fs from 'node:fs'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import { probeRuntime, runtimeRequest, type RuntimeConnection } from './utils/mcp-runtime'

/** A stdio client never opens storage; every request goes to the existing owner. */
export async function startMcpStdio(runtimeArgs?: string[]): Promise<void> {
  console.log = (...args) => console.error(...args)
  console.info = (...args) => console.error(...args)
  console.debug = (...args) => console.error(...args)
  await app.whenReady()
  const directory = app.getPath('userData')
  const version = app.getVersion()
  let launching: Promise<RuntimeConnection> | null = null
  const connect = async (): Promise<RuntimeConnection> => {
    const live = await probeRuntime(directory, version)
    if (live) return live.connection
    if (launching) return launching
    launching = (async () => {
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
        if (launchError) throw launchError
        const ready = await probeRuntime(directory, version)
        if (ready) return ready.connection
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      throw new Error('NovelForge runtime did not become ready in 30 seconds. Check the app startup log.')
    })().finally(() => { launching = null })
    return launching
  }
  await connect()
  const input = fs.createReadStream('', { fd: 0, autoClose: false })
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  lines.on('line', (line) => {
    if (!line.trim()) return
    void (async () => {
      let message: { id?: string | number; method?: string }
      try { message = JSON.parse(line) } catch { return }
      try {
        // Re-discover before sending. Never replay a possibly completed mutation after a network failure.
        const connection = await connect()
        const response = await runtimeRequest(connection, '/mcp', { method: 'POST', body: line, timeoutMs: 15 * 60_000 })
        const result = await response.text()
        if (!response.ok) throw new Error(`Runtime HTTP ${response.status}: ${result}`)
        if (result.trim()) process.stdout.write(`${result.trim()}\n`)
      } catch (error) {
        if (message.id !== undefined) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })}\n`)
      }
    })()
  })
  const shutdown = () => { lines.close(); input.destroy(); app.quit() }
  input.once('end', shutdown)
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
