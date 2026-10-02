import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { attachToExistingRuntime, probeRuntime, readRuntimeConnection, runtimeRequest, startMcpRuntime, type RuntimeHandle } from './mcp-runtime'
import type { AgentToolDescriptor } from '../../src/shared/tool-contracts'

const descriptor: AgentToolDescriptor = {
  id: 'novelforge.projects.list', version: '1.0.0', title: 'Projects', description: 'Read projects', domain: 'project',
  inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { projects: { type: 'array' } }, required: ['projects'] },
  effect: 'read', approval: 'never', scopes: ['novel:read'], idempotent: true, taskMode: 'sync', timeoutClass: 'short', tags: [],
}
let directory: string
let runtime: RuntimeHandle
let reads: number
let opened: number
const clients: Client[] = []

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-runtime-test-'))
  reads = 0; opened = 0
  runtime = await startMcpRuntime({
    directory, version: 'test', modelConfigured: () => true, openDesktop: () => { opened += 1 },
    registry: {
      list: () => [descriptor],
      async invoke(request, context) {
        reads += 1
        expect(context.scopes).toContain('canon:write')
        return { ok: true, data: { projects: [{ id: 292 }] }, meta: { tool: request.toolId, runId: 'read', requestedAt: '', completedAt: '', durationMs: 0, warnings: [] } }
      },
    },
  })
})
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()))
  await runtime.close()
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'novelforge-runtime-test-'))) throw new Error('Unsafe test cleanup path')
  fs.rmSync(directory, { recursive: true, force: true })
})

async function connect() {
  const client = new Client({ name: 'runtime-test', version: '1.0.0' })
  clients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', runtime.connection.url), {
    requestInit: { headers: { Authorization: `Bearer ${runtime.connection.token}` } },
  }))
  return client
}

describe('shared MCP runtime', () => {
  it('serves two MCP clients and an open desktop from the same owner', async () => {
    const first = await connect()
    const second = await connect()
    expect((await runtimeRequest(runtime.connection, '/desktop/open', { method: 'POST' })).ok).toBe(true)
    expect(opened).toBe(1)
    const results = await Promise.all([first.callTool({ name: descriptor.id, arguments: {} }), second.callTool({ name: descriptor.id, arguments: {} })])
    expect(results.every((result) => !result.isError)).toBe(true)
    expect(reads).toBe(2)
    const live = await probeRuntime(directory)
    expect(live?.connection.pid).toBe(process.pid)
    expect(live?.health.modelConfigured).toBe(true)
  })

  it('keeps the owner available when one client disconnects and another reconnects', async () => {
    const first = await connect()
    await first.close()
    const next = await connect()
    expect((await next.listTools()).tools[0].name).toBe(descriptor.id)
    expect((await probeRuntime(directory))?.connection.instanceId).toBe(runtime.connection.instanceId)
  })

  it('attaches the desktop only when its package version matches the owner', async () => {
    await expect(attachToExistingRuntime(directory, 'new-package', true)).rejects.toThrow('后台版本 test 与当前程序 new-package 不一致')
    expect(opened).toBe(0)
    expect((await probeRuntime(directory))?.connection.instanceId).toBe(runtime.connection.instanceId)
    expect(await attachToExistingRuntime(directory, 'test', true)).toBe(true)
    expect(opened).toBe(1)
  })

  it('reports a live version mismatch instead of treating the owner as absent', async () => {
    await expect(probeRuntime(directory, 'new-package')).rejects.toThrow('重启 Codex 的 MCP 连接')
    expect((await probeRuntime(directory, 'test'))?.health.version).toBe('test')
    expect(readRuntimeConnection(directory)?.instanceId).toBe(runtime.connection.instanceId)
    await runtime.close()
    expect(await probeRuntime(directory, 'new-package')).toBeNull()
  })

  it('rejects unpaired requests and browser origin or host spoofing', async () => {
    expect((await fetch(new URL('/health', runtime.connection.url))).status).toBe(401)
    const headers = { Authorization: `Bearer ${runtime.connection.token}`, Origin: 'https://untrusted.example' }
    expect((await fetch(new URL('/health', runtime.connection.url), { headers })).status).toBe(403)
    const spoofedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      http.get(new URL('/health', runtime.connection.url), { headers: { Authorization: headers.Authorization, Host: 'untrusted.example' } }, (response) => {
        response.resume(); resolve(response.statusCode)
      }).on('error', reject)
    })
    expect(spoofedHostStatus).toBe(403)
  })

  it('removes discovery on explicit service shutdown without leaving a stale owner', async () => {
    expect(readRuntimeConnection(directory)?.instanceId).toBe(runtime.connection.instanceId)
    await runtime.close()
    expect(readRuntimeConnection(directory)).toBeNull()
    expect(await probeRuntime(directory)).toBeNull()
  })
})
