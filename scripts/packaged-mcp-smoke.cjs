const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { randomUUID } = require('node:crypto')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
const { seedPackagedMcpSmoke } = require('./seed-packaged-mcp-smoke.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const testRoot = path.join(workspaceRoot, '.tmp-tests')
const testUserData = path.join(testRoot, `packaged-mcp-${process.pid}-${randomUUID()}`)
const bundled = process.argv.includes('--bundled') || process.argv.includes('--bundle')
const executable = bundled ? require('electron') : path.join(workspaceRoot, 'release/win-unpacked/NovelForge.exe')
const args = bundled ? [path.join(__dirname, 'novelforge-mcp.cjs'), '--mcp'] : ['--mcp']
const discoveryPath = path.join(testUserData, 'novelforge-runtime.json')
const lockPath = path.join(testUserData, 'novelforge.single-writer.lock')
const env = { ...process.env, NOVELFORGE_USER_DATA_DIR: testUserData, NOVELFORGE_DISABLE_LEGACY_DB_COPY: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const expectedTools = [
  'capabilities.list', 'projects.list', 'projects.get', 'characters.list', 'runs.get',
  'artifacts.get', 'artifacts.list', 'workflows.start', 'workflows.get', 'workflows.list',
  'workflows.cancel', 'workflows.resume', 'workflows.apply', 'context.preview',
  'atlas.query', 'atlas.validate', 'atlas.apply', 'assets.query',
].map((name) => `novelforge.${name}`).sort()
const clients = []
let stderr = ''
let owner
let fixtureServer
let modelRequestReceived = false
let modelRequestClosed = false
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function discovery() { return JSON.parse(fs.readFileSync(discoveryPath, 'utf8')) }
function processAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
}
async function until(predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await predicate()) return; await wait(100) }
  throw new Error(`${label} timed out after ${timeout}ms`)
}
function verifyTestDirectory() {
  const workspace = fs.realpathSync(workspaceRoot)
  const root = fs.realpathSync(testRoot)
  for (const relative of [path.relative(workspace, root), path.relative(root, fs.realpathSync(testUserData))]) {
    assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'Unsafe test directory')
  }
}
async function request(route, method = 'GET', body) {
  const live = discovery()
  return fetch(new URL(route, live.url), {
    method, headers: { Authorization: `Bearer ${live.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5_000),
  })
}
async function rpc(service, method, args = []) {
  const response = await request('/rpc', 'POST', { service, method, args })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.ok, true, result.error?.message)
  return result.data
}
async function connect() {
  const transport = new StdioClientTransport({ command: executable, args, cwd: workspaceRoot, env, stderr: 'pipe' })
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const client = new Client({ name: 'packaged-mcp-smoke', version: '2.0.0' })
  clients.push(client)
  await client.connect(transport, { timeout: 60_000 })
  return client
}
async function call(client, name, input) {
  const result = await client.callTool({ name: `novelforge.${name}`, arguments: input }, undefined, { timeout: 15_000 })
  assert(!result.isError, `${name}: ${JSON.stringify(result.content)}`)
  assert(result.structuredContent, `${name} must return structured content`)
  return result.structuredContent
}
async function cleanup() {
  await Promise.allSettled(clients.map((client) => client.close()))
  try {
    if (fs.existsSync(discoveryPath)) {
      owner = discovery()
      assert.equal((await request('/shutdown', 'POST')).status, 200, 'Explicit runtime shutdown failed')
    }
    await until(() => !fs.existsSync(discoveryPath) && !fs.existsSync(lockPath) && (!owner || !processAlive(owner.pid)), 'Runtime shutdown and writer-lock release')
    verifyTestDirectory()
    await until(() => {
      try { fs.rmSync(testUserData, { recursive: true, force: true }); return true } catch (error) {
        if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error
        return false
      }
    }, 'Isolated profile cleanup')
  } finally {
    fixtureServer?.closeAllConnections()
    if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve))
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Packaged MCP smoke requires Windows.')
  assert(fs.existsSync(executable), `Executable missing: ${executable}`)
  if (bundled) assert(fs.existsSync(path.join(workspaceRoot, 'out/main/main.js')), 'Run npm run build:app first.')
  fs.mkdirSync(testUserData, { recursive: true })
  verifyTestDirectory()
  const version = require('../package.json').version
  try {
    const first = await connect()
    owner = discovery()
    const listed = await first.listTools()
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), expectedTools)
    const resource = await first.readResource({ uri: 'novelforge://capabilities' })
    const capabilities = JSON.parse(resource.contents[0].text)
    if (!bundled) assert.equal(capabilities.server.version, version, 'Packaged version must match current source')
    assert(capabilities.grantedScopes.includes('canon:write'))
    assert(fs.existsSync(lockPath), 'The shared owner must hold the writer lock while alive')
    const health = await (await request('/health')).json()
    assert.equal(health.instanceId, owner.instanceId)
    assert.equal(health.tools, 18)
    assert.equal(health.modelConfigured, false)

    const second = await connect()
    assert.equal(discovery().instanceId, owner.instanceId, 'Both bridges must connect to the same runtime')
    assert.equal(discovery().pid, owner.pid)
    const { novelId, title, background } = await seedPackagedMcpSmoke(rpc)
    const projectLists = await Promise.all([first, second].map((client) => call(client, 'projects.list', {})))
    assert(projectLists.every((result) => result.projects.some((project) => project.id === novelId && project.title === title)))
    const project = (await call(first, 'projects.get', { novelId })).project

    const changes = {
      novelId, expectedContextVersion: project.contextVersion, idempotencyKey: `packaged-atlas-${randomUUID()}`,
      effectiveFromChapter: 0, source: { kind: 'author', note: '隔离安装包测试资料' },
      changes: [
        { op: 'upsert_entity', clientId: 'valley', kind: 'location', name: '河谷', summary: '渡河商路所在区域' },
        { op: 'upsert_entity', clientId: 'village', kind: 'location', name: '渡口村', parentId: 'valley', summary: '经营渡船的村庄' },
        { op: 'upsert_entity', clientId: 'boatman', kind: 'character', name: '陈舟', summary: '渡口船工' },
        { op: 'upsert_entity', clientId: 'clerk', kind: 'character', name: '林禾', summary: '渡口记账人' },
        { op: 'upsert_relation', kind: 'relationship', fromId: 'boatman', toId: 'clerk', label: '共同经营渡口' },
      ],
    }
    const applied = (await call(first, 'atlas.apply', changes)).result
    const atlas = (await call(second, 'atlas.query', { novelId })).atlas
    assert.equal(atlas.contextVersion, applied.contextVersion)
    assert.equal(atlas.entities.length, 4)
    assert.equal(atlas.relations.length, 1)
    const village = atlas.entities.find((entity) => entity.name === '渡口村')
    assert.equal(village.parentId, applied.idMap.valley)
    assert.equal((await call(second, 'atlas.query', { novelId, locationParentId: applied.idMap.valley })).atlas.locationChildren[0].id, village.id)
    assert.equal((await call(first, 'atlas.apply', changes)).result.idempotentReplay, true)

    const missingModel = await first.callTool({ name: 'novelforge.workflows.start', arguments: { novelId, stage: 'background', request: '整理现有背景。', idempotencyKey: 'packaged-no-model' } })
    assert.equal(missingModel.isError, true)
    assert.equal(JSON.parse(missingModel.content[0].text).error.code, 'model.noneConfigured', 'Missing model must be actionable')
    fixtureServer = http.createServer(async (req, res) => {
      for await (const _chunk of req) { /* Hold a real model request until cancellation. */ }
      modelRequestReceived = true
      res.once('close', () => { modelRequestClosed = true })
    })
    await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve))
    await rpc('model', 'create', [{ name: 'Packaged cancellation fixture', provider: 'openai', modelId: 'packaged-fixture', apiKey: 'fixture-secret-only', baseUrl: `http://127.0.0.1:${fixtureServer.address().port}/v1`, maxTokens: 4000, maxContextTokens: 32000, isDefault: 1 }])
    assert(!JSON.stringify(await rpc('model', 'list')).includes('fixture-secret-only'), 'Model keys must remain masked')
    const run = (await call(first, 'workflows.start', { novelId, stage: 'background', request: '整理现有背景。', idempotencyKey: 'packaged-cancel-model' })).run
    assert(Number.isInteger(run.runId))
    await until(() => modelRequestReceived, 'Packaged model request')
    await call(second, 'workflows.cancel', { novelId, runId: run.runId })
    await until(async () => (await call(first, 'workflows.get', { novelId, runId: run.runId })).run.status === 'cancelled' && modelRequestClosed, 'Workflow cancellation')
    assert.equal((await call(first, 'assets.query', { novelId })).background, background, 'Cancellation must not apply prose')
    await first.close()
    assert.equal((await (await request('/health')).json()).instanceId, owner.instanceId, 'Disconnecting a bridge must preserve the owner')
    assert((await call(second, 'projects.list', {})).projects.some((row) => row.id === novelId))
  } catch (error) {
    if (stderr.trim()) process.stderr.write(stderr)
    throw error
  } finally {
    await cleanup()
  }
  process.stdout.write(`PASS ${bundled ? 'bundled' : 'packaged'} MCP ${version}: 18 tools; 2 clients / 1 owner; project + atlas apply/query + model error + workflow start/cancel + explicit shutdown; isolated profile removed\n`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
