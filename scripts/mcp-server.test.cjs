const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.tmp-tests', `mcp-runtime-${process.pid}-${randomUUID()}`)
const env = { ...process.env, NOVELFORGE_USER_DATA_DIR: directory, NOVELFORGE_DISABLE_LEGACY_DB_COPY: '1', ELECTRON_RENDERER_URL: 'data:text/html,<title>NovelForge runtime integration</title><p>Isolated desktop host</p>' }
const clients = []
let stderr = ''
let webProxy
let fixtureServer
let modelRequestReceived = false
let modelRequestClosed = false
const discoveryPath = path.join(directory, 'novelforge-runtime.json')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function discovery() { return JSON.parse(fs.readFileSync(discoveryPath, 'utf8')) }
async function request(route, method = 'GET', body, timeoutMs = 3_000) {
  const live = discovery()
  return fetch(new URL(route, live.url), { method, headers: { Authorization: `Bearer ${live.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
}
async function rpc(service, method, args = []) {
  const result = await (await request('/rpc', 'POST', { service, method, args })).json()
  assert.equal(result.ok, true, result.error?.message)
  return result.data
}
async function connect() {
  const client = new Client({ name: 'mcp-runtime-integration', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(__dirname, 'run-novelforge-mcp.cjs')], cwd: root, env, stderr: 'pipe' })
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  clients.push(client)
  await client.connect(transport, { timeout: 60_000 })
  return client
}
async function main() {
  fs.mkdirSync(directory, { recursive: true })
  try {
    const first = await connect()
    const firstOwner = discovery()
    const listed = await first.listTools()
    assert(listed.tools.some((tool) => tool.name === 'novelforge.projects.list'))
    const projects = await first.callTool({ name: 'novelforge.projects.list', arguments: {} })
    assert(!projects.isError, JSON.stringify(projects))
    assert(projects.structuredContent)
    const second = await connect()
    assert.equal(discovery().pid, firstOwner.pid)
    const simultaneous = await Promise.all([first, second].map((client) => client.callTool({ name: 'novelforge.projects.list', arguments: {} })))
    assert(simultaneous.every((result) => !result.isError))
    const webPort = await new Promise((resolve, reject) => {
      const listener = net.createServer()
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', () => { const port = listener.address().port; listener.close(() => resolve(port)) })
    })
    webProxy = spawn(require('electron'), [path.join(__dirname, 'local-web-backend.cjs')], { cwd: root, env: { ...env, NOVELFORGE_WEB_BACKEND_PORT: String(webPort) }, windowsHide: true, stdio: 'ignore' })
    let webHealth
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { webHealth = await (await fetch(`http://127.0.0.1:${webPort}/health`)).json(); break } catch { await wait(100) }
    }
    assert.equal(webHealth?.data.runtimePid, firstOwner.pid, 'Web must attach to the same database owner')
    const webRead = await (await fetch(`http://127.0.0.1:${webPort}/rpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'novel', method: 'list', args: [] }),
    })).json()
    assert.equal(webRead.ok, true)
    webProxy.kill()
    await new Promise((resolve) => webProxy.once('exit', resolve))
    webProxy = null
    assert.equal((await (await request('/health')).json()).instanceId, firstOwner.instanceId, 'Stopping Web proxy must preserve the owner')
    assert.equal((await request('/desktop/open', 'POST', undefined, 30_000)).status, 200)
    assert.equal((await (await request('/health')).json()).desktopOpen, true)
    const withWindow = await first.callTool({ name: 'novelforge.projects.list', arguments: {} })
    assert(!withWindow.isError, 'MCP must keep working while the desktop exists')
    const anotherDesktop = spawn(require('electron'), [path.join(__dirname, 'novelforge-mcp.cjs'), '--desktop'], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
    const attachExit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { anotherDesktop.kill(); reject(new Error('Second desktop did not attach and exit')) }, 30_000)
      anotherDesktop.once('exit', (code) => { clearTimeout(timer); resolve(code) })
      anotherDesktop.once('error', reject)
    })
    assert.equal(attachExit, 0)
    assert.equal(discovery().instanceId, firstOwner.instanceId)
    await first.close()
    const reconnected = await connect()
    assert(!(await reconnected.callTool({ name: 'novelforge.projects.list', arguments: {} })).isError)
    assert.equal(discovery().pid, firstOwner.pid)
    fixtureServer = http.createServer(async (req, res) => {
      for await (const _chunk of req) { /* Drain the request and deliberately hold its response. */ }
      modelRequestReceived = true
      res.once('close', () => { modelRequestClosed = true })
    })
    await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve))
    const modelId = await rpc('model', 'create', [{ name: 'Runtime cancellation fixture', provider: 'openai', modelId: 'runtime-fixture', apiKey: 'fixture-secret-only', baseUrl: `http://127.0.0.1:${fixtureServer.address().port}/v1`, maxTokens: 4000, maxContextTokens: 32000, isDefault: 1 }])
    const listedModels = await rpc('model', 'list')
    assert.equal(listedModels.find((model) => model.id === modelId).apiKey, '已设置')
    assert(!JSON.stringify(listedModels).includes('fixture-secret-only'), 'RPC must mask configured provider keys')
    const novelId = await rpc('novel', 'create', [{ title: 'Exit cancellation fixture', userBackground: '渡口的两名船工。', modelConfigId: modelId, launchMode: 'fast_launch' }])
    const running = await second.callTool({ name: 'novelforge.workflows.start', arguments: { novelId, stage: 'background', request: '整理现有背景。', idempotencyKey: 'explicit-exit-test' } })
    assert(!running.isError)
    const runId = running.structuredContent.run.runId
    for (let attempt = 0; attempt < 100 && !modelRequestReceived; attempt += 1) await wait(50)
    assert(modelRequestReceived, 'Fixture must receive a real in-flight model request before shutdown')
    assert.equal((await request('/shutdown', 'POST')).status, 200)
    for (let attempt = 0; attempt < 100 && fs.existsSync(discoveryPath); attempt += 1) await wait(100)
    assert(!fs.existsSync(discoveryPath), 'Explicit stop must remove discovery')
    for (let attempt = 0; attempt < 100 && fs.existsSync(path.join(directory, 'novelforge.single-writer.lock')); attempt += 1) await wait(100)
    assert(!fs.existsSync(path.join(directory, 'novelforge.single-writer.lock')), 'Explicit stop must release the writer lock')
    assert(modelRequestClosed, 'Explicit exit must close the in-flight model connection')
    // Stopping the owner invalidates existing bridges; only an explicit new
    // client connection may start another owner, without replaying mutations.
    await assert.rejects(second.callTool({ name: 'novelforge.projects.list', arguments: {} }, undefined, { timeout: 10_000 }))
    await wait(1_500)
    assert(!fs.existsSync(discoveryPath), 'A stopped bridge must not restart the owner')
    assert(!fs.existsSync(path.join(directory, 'novelforge.single-writer.lock')), 'A stopped bridge must not reacquire storage')
    const fresh = await connect()
    assert(!(await fresh.callTool({ name: 'novelforge.projects.list', arguments: {} })).isError)
    assert.notEqual(discovery().instanceId, firstOwner.instanceId)
    const recovered = await fresh.callTool({ name: 'novelforge.workflows.get', arguments: { novelId, runId } })
    assert.equal(recovered.structuredContent.run.status, 'cancelled', 'Restart must retain cancellation instead of re-running the model')
    assert.equal((await rpc('novel', 'get', [novelId])).userBackground, '渡口的两名船工。')
    process.stdout.write(`PASS shared Electron runtime: ${listed.tools.length} tools; desktop + Web proxy + 2 MCP clients + reconnect + owner stop invalidates old bridge + fresh-client restart + model cancellation + key masking\n`)
  } catch (error) {
    if (stderr.trim()) process.stderr.write(stderr)
    throw error
  } finally {
    webProxy?.kill()
    fixtureServer?.closeAllConnections()
    if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve))
    await Promise.allSettled(clients.map((client) => client.close()))
    if (fs.existsSync(discoveryPath)) await request('/shutdown', 'POST').catch(() => undefined)
    const target = path.resolve(directory)
    const base = path.resolve(root, '.tmp-tests')
    if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Unsafe test cleanup path')
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { fs.rmSync(target, { recursive: true, force: true }); break } catch (error) { if (attempt === 99) throw error; await wait(100) }
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
