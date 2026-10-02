import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { DESKTOP_AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import type { AgentToolCallContext, AgentToolCallRequest, AgentToolCallResult, AgentToolDescriptor } from '../../src/shared/tool-contracts'

const DISCOVERY_FILE = 'novelforge-runtime.json'
export interface RuntimeConnection {
  protocol: 1
  instanceId: string
  pid: number
  url: string
  token: string
}
export interface RuntimeHealth {
  instanceId: string
  version: string
  storage: 'ready'
  tools: number
  activeRequests: number
  modelConfigured: boolean
  desktopAvailable: boolean
  desktopOpen: boolean
}
interface Registry {
  list(): AgentToolDescriptor[]
  invoke(request: AgentToolCallRequest, context: AgentToolCallContext): Promise<AgentToolCallResult>
}
export interface RuntimeHandle {
  connection: RuntimeConnection
  close(): Promise<void>
  publishEvent(channel: string, ...args: unknown[]): void
}

export function readRuntimeConnection(directory: string): RuntimeConnection | null {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(directory, DISCOVERY_FILE), 'utf8')) as RuntimeConnection
    const url = new URL(data.url)
    if (data.protocol !== 1 || url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
      || url.pathname !== '/' || !Number.isInteger(data.pid) || !data.instanceId || !/^[a-f0-9]{64}$/.test(data.token)) return null
    return data
  } catch { return null }
}

export async function runtimeRequest(connection: RuntimeConnection, route: string, options: { method?: string; body?: string; timeoutMs?: number } = {}): Promise<Response> {
  return fetch(new URL(route, connection.url), {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs || 3_000),
  })
}

export async function probeRuntime(directory: string, expectedVersion?: string): Promise<{ connection: RuntimeConnection; health: RuntimeHealth } | null> {
  const connection = readRuntimeConnection(directory)
  if (!connection) return null
  let health: RuntimeHealth
  try {
    const response = await runtimeRequest(connection, '/health')
    if (!response.ok) return null
    health = await response.json() as RuntimeHealth
    if (health.instanceId !== connection.instanceId || health.storage !== 'ready') return null
  } catch { return null }
  // An incompatible live owner must never be mistaken for an absent owner.
  if (expectedVersion !== undefined && health.version !== expectedVersion) {
    throw new Error(`NovelForge 后台版本 ${health.version || '未知'} 与当前程序 ${expectedVersion} 不一致。请先保存内容，在 NovelForge 托盘菜单选择“退出并停止创作服务”，再启动当前版本并重启 Codex 的 MCP 连接。`)
  }
  return { connection, health }
}

export async function attachToExistingRuntime(directory: string, expectedVersion: string, openDesktop: boolean): Promise<boolean> {
  const existing = await probeRuntime(directory, expectedVersion)
  if (!existing) return false
  if (openDesktop) {
    const response = await runtimeRequest(existing.connection, '/desktop/open', { method: 'POST' })
    if (!response.ok) throw new Error('已运行的服务无法打开桌面，请先退出该开发服务。')
  }
  return true
}

function authorized(received: string | undefined, token: string): boolean {
  const actual = Buffer.from(received || '')
  const expected = Buffer.from(`Bearer ${token}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function descriptorForMcp(descriptor: AgentToolDescriptor) {
  return {
    name: descriptor.id, title: descriptor.title, description: descriptor.description,
    inputSchema: descriptor.inputSchema, outputSchema: descriptor.outputSchema,
    annotations: {
      readOnlyHint: descriptor.effect === 'read',
      destructiveHint: descriptor.effect === 'canonical_write' || descriptor.effect === 'external_effect',
      idempotentHint: descriptor.idempotent, openWorldHint: descriptor.effect === 'external_effect',
    },
    // Application runs are durable. Do not create a second, in-memory MCP task lifecycle.
    execution: { taskSupport: 'forbidden' as const },
    _meta: { 'novelforge/effect': descriptor.effect, 'novelforge/scopes': descriptor.scopes },
  }
}

function toolResult(result: AgentToolCallResult) {
  return result.ok ? {
    content: [{ type: 'text' as const, text: JSON.stringify({ data: result.data, meta: result.meta }) }],
    structuredContent: result.data as Record<string, unknown>, _meta: { 'novelforge/run': result.meta },
  } : {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error, meta: result.meta }) }],
    isError: true, _meta: { 'novelforge/run': result.meta },
  }
}

/** The caller already owns and initialized storage. This transport never opens SQLite. */
export async function startMcpRuntime(options: {
  directory: string
  version: string
  registry: Registry
  modelConfigured?: () => boolean
  openDesktop?: () => void
  isDesktopOpen?: () => boolean
  shutdown?: () => void
  invokeRpc?: (service: string, method: string, args: unknown[]) => Promise<unknown>
}): Promise<RuntimeHandle> {
  const connection: RuntimeConnection = { protocol: 1, instanceId: randomUUID(), pid: process.pid, url: '', token: randomBytes(32).toString('hex') }
  const scopes = [...DESKTOP_AGENT_TOOL_SCOPES]
  const transports = new Set<Server>()
  const eventClients = new Set<http.ServerResponse>()
  let closing = false
  const server = http.createServer(async (request, response) => {
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(value))
    }
    const origin = request.headers.origin
    if (request.headers.host !== new URL(connection.url).host || (origin && origin !== new URL(connection.url).origin)) {
      json(403, { error: 'Origin or Host rejected' }); return
    }
    if (!authorized(request.headers.authorization, connection.token)) { json(401, { error: 'Local client authorization required' }); return }
    if (closing) { json(503, { error: 'Runtime is stopping' }); return }
    if (request.method === 'GET' && request.url === '/health') {
      json(200, {
        instanceId: connection.instanceId, version: options.version, storage: 'ready',
        tools: options.registry.list().length, activeRequests: transports.size,
        modelConfigured: options.modelConfigured?.() ?? false, desktopAvailable: Boolean(options.openDesktop), desktopOpen: options.isDesktopOpen?.() ?? false,
      } satisfies RuntimeHealth)
      return
    }
    if (request.method === 'POST' && request.url === '/desktop/open') {
      if (!options.openDesktop) { json(409, { error: 'This runtime has no desktop host' }); return }
      options.openDesktop(); json(200, { opened: true }); return
    }
    if (request.method === 'POST' && request.url === '/shutdown' && options.shutdown) {
      json(200, { stopping: true }); setImmediate(options.shutdown); return
    }
    if (request.method === 'GET' && request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      response.write(': connected\n\n')
      eventClients.add(response)
      response.once('close', () => eventClients.delete(response))
      return
    }
    if (request.method === 'POST' && request.url === '/rpc' && options.invokeRpc) {
      try {
        let length = 0
        const chunks: Buffer[] = []
        for await (const chunk of request) {
          length += Buffer.byteLength(chunk)
          if (length > 4 * 1024 * 1024) { json(413, { ok: false, error: { code: 'runtime.payloadTooLarge', message: '请求内容超过 4 MiB。' } }); return }
          chunks.push(Buffer.from(chunk))
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { service?: unknown; method?: unknown; args?: unknown }
        if (typeof payload.service !== 'string' || typeof payload.method !== 'string' || !Array.isArray(payload.args)) throw new Error('Invalid RPC request')
        json(200, await options.invokeRpc(payload.service, payload.method, payload.args))
      } catch (error) {
        json(400, { ok: false, error: { code: 'runtime.invalidRequest', message: error instanceof Error ? error.message : 'Invalid RPC request' } })
      }
      return
    }
    if (request.url !== '/mcp') { json(404, { error: 'Unknown runtime route' }); return }
    if (request.method !== 'POST') { json(405, { error: 'Use MCP POST requests; poll durable runs for progress' }); return }
    const mcp = new Server({ name: 'novelforge', version: options.version }, {
      capabilities: { tools: {}, resources: {} },
      instructions: 'Read the project and query only relevant assets. Use NovelForge workflows to generate, review, revise and apply changes under the project automation policy. Long workflows return durable run IDs; use run tools to poll, cancel or resume. Do not copy candidates into desktop forms.',
    })
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: options.registry.list().map(descriptorForMcp) }))
    mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
      return toolResult(await options.registry.invoke({
        toolId: call.params.name, input: call.params.arguments as Record<string, unknown> || {},
      }, {
        actor: { type: 'api_client', actorId: 'paired-local-client', clientId: 'novelforge-mcp', sessionId: connection.instanceId },
        scopes, requestId: randomUUID(), locale: 'zh-CN',
      }))
    })
    mcp.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: 'novelforge://capabilities', name: 'NovelForge capabilities', mimeType: 'application/json' }] }))
    mcp.setRequestHandler(ReadResourceRequestSchema, async (call) => {
      if (call.params.uri !== 'novelforge://capabilities') throw new Error('Unknown resource')
      return { contents: [{ uri: call.params.uri, mimeType: 'application/json', text: JSON.stringify({ server: { name: 'novelforge', version: options.version }, grantedScopes: scopes, tools: options.registry.list() }) }] }
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    transports.add(mcp)
    response.once('close', () => { transports.delete(mcp); void mcp.close() })
    try {
      await mcp.connect(transport)
      await transport.handleRequest(request, response)
    } catch (error) {
      if (!response.headersSent) json(500, { error: error instanceof Error ? error.message : 'MCP request failed' })
    }
  })
  server.requestTimeout = 0
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Runtime address unavailable')
  connection.url = `http://127.0.0.1:${address.port}/`
  const heartbeat = setInterval(() => { for (const client of eventClients) client.write(': heartbeat\n\n') }, 15_000)
  heartbeat.unref()
  fs.mkdirSync(options.directory, { recursive: true })
  const discovery = path.join(options.directory, DISCOVERY_FILE)
  const temporary = `${discovery}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(connection), { mode: 0o600 })
  fs.renameSync(temporary, discovery)
  return {
    connection,
    publishEvent(channel, ...args) {
      const message = `data: ${JSON.stringify({ channel, args })}\n\n`
      for (const client of eventClients) client.write(message)
    },
    async close() {
      if (closing) return
      closing = true
      clearInterval(heartbeat)
      for (const client of eventClients) client.end()
      eventClients.clear()
      if (readRuntimeConnection(options.directory)?.instanceId === connection.instanceId) {
        try { fs.unlinkSync(discovery) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      await Promise.allSettled([...transports].map((active) => active.close()))
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
