import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import { app } from 'electron'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { InMemoryTaskStore } from '@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js'
import { novelForgeToolRegistry } from './application/novelforge-tool-registry'
import { closeDb, initDb } from './database/db'
import { acquireSingleWriterLock } from './utils/single-writer-lock'
import { AGENT_TOOL_SCOPES, MCP_AGENT_TOOL_DEFAULT_SCOPES } from '../src/shared/tool-contracts'
import type { AgentToolCallResult, AgentToolDescriptor } from '../src/shared/tool-contracts'

function scopesFromEnvironment(): string[] {
  const configured = String(process.env.NOVELFORGE_MCP_SCOPES || '').split(',').map((value) => value.trim()).filter(Boolean)
  if (configured.length === 0) return [...MCP_AGENT_TOOL_DEFAULT_SCOPES]
  const known = new Set<string>(Object.values(AGENT_TOOL_SCOPES))
  const ignored = configured.filter((scope) => !known.has(scope))
  if (ignored.length) console.error(`[novelforge-mcp] ignored unknown scopes: ${ignored.join(', ')}`)
  return configured.filter((scope) => known.has(scope))
}

function approvedSessionId(suppliedToken: unknown): string | undefined {
  const configuredToken = String(process.env.NOVELFORGE_MCP_APPROVAL_TOKEN || '')
  if (!configuredToken || typeof suppliedToken !== 'string' || !suppliedToken) return undefined
  const configured = Buffer.from(configuredToken, 'utf8')
  const supplied = Buffer.from(suppliedToken, 'utf8')
  if (configured.length !== supplied.length || !timingSafeEqual(configured, supplied)) return undefined
  return `mcp_session_${createHash('sha256').update(configuredToken).digest('hex').slice(0, 24)}`
}

function descriptorForMcp(descriptor: AgentToolDescriptor) {
  const taskSupport = descriptor.taskMode === 'app_async' || descriptor.taskMode === 'mcp_task_optional'
    ? 'optional' as const : 'forbidden' as const
  return {
    name: descriptor.id,
    title: descriptor.title,
    description: descriptor.description,
    inputSchema: descriptor.inputSchema,
    outputSchema: descriptor.outputSchema,
    annotations: {
      title: descriptor.title,
      readOnlyHint: descriptor.effect === 'read',
      destructiveHint: descriptor.effect === 'canonical_write' || descriptor.effect === 'external_effect',
      idempotentHint: descriptor.idempotent,
      openWorldHint: descriptor.effect === 'external_effect',
    },
    execution: { taskSupport },
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

function toolResult(result: AgentToolCallResult) {
  if (result.ok) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ data: result.data, meta: result.meta }, null, 2) }],
      structuredContent: result.data as Record<string, unknown>,
      _meta: { 'novelforge/run': result.meta },
    }
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error, meta: result.meta }, null, 2) }],
    isError: true,
    _meta: { 'novelforge/run': result.meta },
  }
}

function infrastructureError(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  }
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.trunc(value))) : fallback
}

/** The installed GUI executable runs this branch with `--mcp`; fd 0 is the real pipe on Windows. */
export async function startMcpStdio(): Promise<void> {
  // JSON-RPC owns stdout. Electron's process.stdin may report EOF immediately
  // in a Windows GUI executable even while OS file descriptor 0 remains open.
  console.log = (...args) => console.error(...args)
  console.info = (...args) => console.error(...args)
  console.debug = (...args) => console.error(...args)
  console.warn = (...args) => console.error(...args)

  await app.whenReady()
  const writerLock = acquireSingleWriterLock(app.getPath('userData'), 'mcp-runtime')
  if (!writerLock) throw new Error('另一个 NovelForge 实例正在使用该数据库。请先退出桌面端；最小化仍会持有写锁。')
  let initialized = false
  let closed = false
  const closeStorage = () => {
    if (closed) return
    closed = true
    if (initialized) closeDb()
    writerLock.release()
  }
  app.once('before-quit', closeStorage)

  try {
    initDb()
    initialized = true
    const scopes = scopesFromEnvironment()
    const descriptors = novelForgeToolRegistry.list()
    const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
    const server = new Server(
      { name: 'novelforge', version: app.getVersion() },
      {
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
        },
        taskStore: new InMemoryTaskStore(),
        defaultTaskPollInterval: 1000,
        instructions: [
          'List projects and read the selected project before writing.',
          'Analyze the user request, choose one stage, then call novelforge.assets.import_draft with the project contextVersion.',
          'Imported text is an immutable candidate, not canonical content. Review it and ask the author to confirm application.',
          'Canonical writes are disabled by default and require scopes plus a matching novelforge/approvalToken metadata value.',
        ].join(' '),
      },
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: descriptors.map(descriptorForMcp) }))
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const descriptor = descriptorById.get(request.params.name)
      const taskRequested = Boolean(request.params.task)
      if (taskRequested && (!descriptor || (descriptor.taskMode !== 'app_async' && descriptor.taskMode !== 'mcp_task_optional'))) {
        throw new Error(`Tool ${request.params.name} does not support task execution.`)
      }
      const requestMeta = request.params._meta && typeof request.params._meta === 'object' ? request.params._meta : {}
      const approvalId = approvedSessionId(requestMeta['novelforge/approvalToken'])
      const client = server.getClientVersion()
      const invoke = () => novelForgeToolRegistry.invoke({
        toolId: request.params.name,
        input: request.params.arguments && typeof request.params.arguments === 'object'
          ? request.params.arguments as Record<string, unknown> : {},
        ...(approvalId ? { approvalId } : {}),
      }, {
        actor: {
          type: 'api_client',
          actorId: client?.name ? `${client.name}:${client.version || 'unknown'}` : 'mcp-client',
          clientId: client?.name || 'mcp-client',
          sessionId: `stdio-${process.pid}`,
        },
        scopes,
        requestId: `mcp-${randomUUID()}`,
        locale: Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN',
        ...(approvalId ? { approvalId } : {}),
      })

      if (taskRequested) {
        if (!extra.taskStore) throw new Error('MCP task store is not available.')
        const taskStore = extra.taskStore
        const task = await taskStore.createTask({
          ttl: boundedNumber(request.params.task?.ttl, 30 * 60_000, 60_000, 2 * 60 * 60_000),
          pollInterval: boundedNumber((request.params.task as { pollInterval?: number } | undefined)?.pollInterval, 1000, 250, 10_000),
        })
        void invoke().then(async (result) => {
          const current = await taskStore.getTask(task.taskId)
          if (current && current.status !== 'cancelled') {
            await taskStore.storeTaskResult(task.taskId, 'completed', toolResult(result))
          }
        }).catch(async (error: unknown) => {
          const current = await taskStore.getTask(task.taskId)
          if (current && current.status !== 'cancelled') {
            await taskStore.storeTaskResult(task.taskId, 'failed', infrastructureError(error))
          }
        })
        return { task }
      }
      return toolResult(await invoke())
    })
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [{
        uri: 'novelforge://capabilities', name: 'NovelForge capability registry',
        title: 'NovelForge 能力注册表', description: '工具契约、权限、影响级别、版本与 JSON Schema。',
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
            server: { name: 'novelforge', version: app.getVersion() },
            grantedScopes: scopes, tools: descriptors,
          }, null, 2),
        }],
      }
    })

    const input = fs.createReadStream('', { fd: 0, autoClose: false })
    const shutdown = async () => {
      await server.close().catch(() => undefined)
      input.destroy()
      closeStorage()
      app.quit()
    }
    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
    input.once('end', () => void shutdown())
    await server.connect(new StdioServerTransport(input, process.stdout))
    console.error(`[novelforge-mcp] ready with ${descriptors.length} tools; scopes=${scopes.join(',')}`)
  } catch (error) {
    closeStorage()
    throw error
  }
}
