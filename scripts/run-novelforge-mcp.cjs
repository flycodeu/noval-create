const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js')
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')

const workspaceRoot = path.resolve(__dirname, '..')
const electronExecutable = require('electron')
const runtimeEntry = path.join(workspaceRoot, 'scripts', 'novelforge-mcp.cjs')

function inferActorType(clientName) {
  const normalized = String(clientName || '').toLowerCase()
  if (normalized.includes('claude')) return 'claude_code'
  if (normalized.includes('codex') || normalized.includes('openai')) return 'codex'
  return 'api_client'
}

function mapToolDescriptor(descriptor) {
  const readOnly = descriptor.effect === 'read'
  return {
    name: descriptor.id,
    title: descriptor.title,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    outputSchema: descriptor.outputSchema,
    annotations: {
      title: descriptor.title,
      readOnlyHint: readOnly,
      destructiveHint: descriptor.effect === 'canonical_write' || descriptor.effect === 'external_effect',
      idempotentHint: descriptor.idempotent,
      openWorldHint: descriptor.effect === 'external_effect',
    },
    execution: {
      taskSupport: descriptor.taskMode === 'mcp_task_optional' ? 'optional' : 'forbidden',
    },
    _meta: {
      'novelforge/version': descriptor.version,
      'novelforge/domain': descriptor.domain,
      'novelforge/effect': descriptor.effect,
      'novelforge/approval': descriptor.approval,
      'novelforge/scopes': descriptor.scopes,
      'novelforge/taskMode': descriptor.taskMode,
      'novelforge/timeoutClass': descriptor.timeoutClass,
      'novelforge/tags': descriptor.tags,
    },
  }
}

function startElectronRuntime() {
  const child = spawn(electronExecutable, [runtimeEntry], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  })
  child.stderr.pipe(process.stderr)

  let readyState = null
  let closedError = null
  let nextMessageId = 1
  const pending = new Map()
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const readyTimer = setTimeout(() => {
    rejectReady(new Error('NovelForge Electron runtime did not become ready within 30 seconds.'))
    child.kill()
  }, 30_000)

  child.on('message', (message) => {
    if (!message || typeof message !== 'object') return
    if (message.type === 'ready') {
      clearTimeout(readyTimer)
      readyState = message
      resolveReady(message)
      return
    }
    if (message.type === 'response' && Number.isInteger(message.id)) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.ok) request.resolve(message.data)
      else request.reject(new Error(message.error || 'NovelForge runtime request failed.'))
      return
    }
    if (message.type === 'fatal') {
      const error = new Error(message.error || 'NovelForge Electron runtime failed.')
      closedError = error
      clearTimeout(readyTimer)
      rejectReady(error)
    }
  })

  child.on('error', (error) => {
    closedError = error
    clearTimeout(readyTimer)
    rejectReady(error)
  })

  child.on('exit', (code, signal) => {
    const error = closedError || new Error(`NovelForge Electron runtime exited code=${String(code)} signal=${String(signal)}`)
    closedError = error
    clearTimeout(readyTimer)
    if (!readyState) rejectReady(error)
    pending.forEach((request) => {
      clearTimeout(request.timer)
      request.reject(error)
    })
    pending.clear()
  })

  function call(method, payload, timeoutMs = 15 * 60_000) {
    if (closedError) return Promise.reject(closedError)
    return ready.then(() => new Promise((resolve, reject) => {
      const id = nextMessageId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`NovelForge runtime request timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      child.send({ type: 'request', id, method, payload }, (error) => {
        if (!error) return
        const request = pending.get(id)
        if (!request) return
        pending.delete(id)
        clearTimeout(request.timer)
        reject(error)
      })
    }))
  }

  function close() {
    if (child.connected) child.send({ type: 'shutdown' })
    const killTimer = setTimeout(() => child.kill(), 2_000)
    killTimer.unref?.()
  }

  return { child, ready, call, close }
}

async function main() {
  const runtime = startElectronRuntime()
  const readyState = await runtime.ready
  const descriptors = Array.isArray(readyState.tools) ? readyState.tools : []
  const grantedScopes = Array.isArray(readyState.scopes) ? readyState.scopes : []

  const server = new Server(
    { name: 'novelforge', version: '1.0.0' },
    {
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false, subscribe: false },
      },
      instructions: [
        'NovelForge exposes stable, schema-validated novel creation tools.',
        'Start by listing projects or reading the capabilities resource.',
        'Model-backed analysis tools create recorded NovelForge tasks but do not write canonical assets unless their effect explicitly says canonical_write.',
        'Treat contextVersion as an optimistic-concurrency token and review blocked/needs_revision results before continuing.',
        'Canonical writes are disabled by default. Operator-enabled writes require both explicit scopes and a matching novelforge/approvalToken call metadata value.',
      ].join(' '),
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: descriptors.map(mapToolDescriptor),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const client = server.getClientVersion()
    const input = request.params.arguments && typeof request.params.arguments === 'object'
      ? request.params.arguments
      : {}
    const requestMeta = request.params._meta && typeof request.params._meta === 'object'
      ? request.params._meta
      : {}
    const approvalToken = typeof requestMeta['novelforge/approvalToken'] === 'string'
      ? requestMeta['novelforge/approvalToken']
      : undefined
    const result = await runtime.call('call', {
      request: {
        toolId: request.params.name,
        input,
        ...(approvalToken ? { approvalId: approvalToken } : {}),
      },
      context: {
        actor: {
          type: inferActorType(client && client.name),
          actorId: client && client.name ? `${client.name}:${client.version || 'unknown'}` : 'mcp-client',
          clientId: client && client.name ? client.name : 'mcp-client',
          sessionId: `stdio-${process.pid}`,
        },
        requestId: `mcp-${randomUUID()}`,
        locale: Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN',
      },
    })

    if (!result.ok) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: result.error, meta: result.meta }, null, 2) }],
        isError: true,
        _meta: { 'novelforge/run': result.meta },
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ data: result.data, meta: result.meta }, null, 2) }],
      structuredContent: result.data,
      _meta: { 'novelforge/run': result.meta },
    }
  })

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: 'novelforge://capabilities',
      name: 'NovelForge capability registry',
      title: 'NovelForge 能力注册表',
      description: '完整工具契约、权限、影响级别、版本、任务模式与 JSON Schema。',
      mimeType: 'application/json',
    }],
  }))

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== 'novelforge://capabilities') {
      throw new Error(`Unknown NovelForge resource: ${request.params.uri}`)
    }
    return {
      contents: [{
        uri: request.params.uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          server: { name: 'novelforge', version: '1.0.0' },
          grantedScopes,
          tools: descriptors,
        }, null, 2),
      }],
    }
  })

  const transport = new StdioServerTransport()
  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    try {
      await server.close()
    } catch {
      // Client transport may already be closed.
    }
    runtime.close()
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.stdin.on('end', () => void shutdown())

  await server.connect(transport)
  console.error(`[novelforge-mcp] ready with ${descriptors.length} tools; scopes=${grantedScopes.join(',')}`)
}

main().catch((error) => {
  console.error('[novelforge-mcp] fatal:', error)
  process.exit(1)
})
