const path = require('node:path')
const { createHash, timingSafeEqual } = require('node:crypto')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

console.log = (...args) => console.error(...args)
console.info = (...args) => console.error(...args)
console.debug = (...args) => console.error(...args)
console.warn = (...args) => console.error(...args)

const workspaceRoot = path.resolve(__dirname, '..')
registerProjectTsRuntime(workspaceRoot)
app.setName('NovelForge')
if (process.env.NOVELFORGE_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.NOVELFORGE_USER_DATA_DIR))
}
app.commandLine.appendSwitch('disable-gpu')

function requireProject(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

function readMcpScopes(toolContracts) {
  const knownScopes = new Set(Object.values(toolContracts.AGENT_TOOL_SCOPES))
  const configured = String(process.env.NOVELFORGE_MCP_SCOPES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (configured.length === 0) return [...toolContracts.MCP_AGENT_TOOL_DEFAULT_SCOPES]

  const accepted = configured.filter((scope) => knownScopes.has(scope))
  const ignored = configured.filter((scope) => !knownScopes.has(scope))
  if (ignored.length > 0) console.error(`[novelforge-mcp-runtime] ignored unknown scopes: ${ignored.join(', ')}`)
  return accepted
}

function send(message) {
  if (!process.connected || typeof process.send !== 'function') return
  process.send(message, (error) => {
    if (error) console.error('[novelforge-mcp-runtime] IPC send failed:', error)
  })
}

function resolveConfiguredApprovalId(suppliedToken) {
  const configuredToken = String(process.env.NOVELFORGE_MCP_APPROVAL_TOKEN || '')
  if (!configuredToken || typeof suppliedToken !== 'string' || !suppliedToken) return undefined
  const configured = Buffer.from(configuredToken, 'utf8')
  const supplied = Buffer.from(suppliedToken, 'utf8')
  if (configured.length !== supplied.length || !timingSafeEqual(configured, supplied)) return undefined
  return `mcp_session_${createHash('sha256').update(configuredToken).digest('hex').slice(0, 24)}`
}

async function main() {
  await app.whenReady()
  const { acquireSingleWriterLock } = requireProject('electron/utils/single-writer-lock.ts')
  const writerLock = acquireSingleWriterLock(app.getPath('userData'), 'mcp-runtime')
  if (!writerLock) {
    console.error('[novelforge-mcp-runtime] 检测到另一个 NovelForge 实例（桌面端、本地 Web 后端或 MCP 运行时）正在写入同一个数据库。')
    console.error('[novelforge-mcp-runtime] 为避免数据损坏，本运行时拒绝启动。请先关闭其他实例再重试。')
    app.quit()
    process.exit(1)
  }
  const { initDb, closeDb } = requireProject('electron/database/db.ts')
  const { novelForgeToolRegistry } = requireProject('electron/application/novelforge-tool-registry.ts')
  const toolContracts = requireProject('src/shared/tool-contracts/index.ts')

  initDb()
  const scopes = readMcpScopes(toolContracts)
  let closing = false

  const shutdown = () => {
    if (closing) return
    closing = true
    closeDb()
    writerLock.release()
    app.quit()
  }

  process.on('message', async (message) => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'shutdown') {
      shutdown()
      return
    }
    if (message.type !== 'request' || !Number.isInteger(message.id)) return

    try {
      if (message.method !== 'call') throw new Error(`Unknown runtime method: ${String(message.method)}`)
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {}
      const suppliedContext = payload.context && typeof payload.context === 'object' ? payload.context : {}
      const suppliedRequest = payload.request && typeof payload.request === 'object' ? payload.request : {}
      const approvalId = resolveConfiguredApprovalId(suppliedRequest.approvalId)
      const request = { ...suppliedRequest }
      if (approvalId) request.approvalId = approvalId
      else delete request.approvalId
      const result = await novelForgeToolRegistry.invoke(request, {
        ...suppliedContext,
        scopes,
        ...(approvalId ? { approvalId } : {}),
      })
      send({ type: 'response', id: message.id, ok: true, data: result })
    } catch (error) {
      send({
        type: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  process.on('disconnect', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  send({
    type: 'ready',
    tools: novelForgeToolRegistry.list(),
    scopes,
  })
  console.error(`[novelforge-mcp-runtime] ready with ${novelForgeToolRegistry.list().length} tools`)
}

main().catch((error) => {
  console.error('[novelforge-mcp-runtime] fatal:', error)
  send({ type: 'fatal', error: error instanceof Error ? error.stack || error.message : String(error) })
  app.quit()
  process.exit(1)
})
