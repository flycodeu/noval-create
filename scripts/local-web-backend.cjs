// Browser transport only. All storage, models and business handlers live in the shared runtime.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { app } = require('electron')
const { LOCAL_WEB_BACKEND_VERSION } = require('./local-web-contract.cjs')
const root = path.resolve(__dirname, '..')
app.setName('NovelForge')
app.disableHardwareAcceleration()
if (process.env.NOVELFORGE_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.NOVELFORGE_USER_DATA_DIR))
const host = '127.0.0.1'
const port = Number(process.env.NOVELFORGE_WEB_BACKEND_PORT || 8787)
const frontendPort = Number(process.env.NOVELFORGE_WEB_FRONTEND_PORT || 4175)
const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://127.0.0.1:${frontendPort}`, `http://localhost:${frontendPort}`])
let starting = null
let server
function readConnection() {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'novelforge-runtime.json'), 'utf8'))
    const url = new URL(record.url)
    return record.protocol === 1 && url.hostname === host && url.protocol === 'http:' && /^[a-f0-9]{64}$/.test(record.token) ? record : null
  } catch { return null }
}
async function probe() {
  const connection = readConnection()
  if (!connection) return null
  try {
    const response = await fetch(new URL('/health', connection.url), { headers: { Authorization: `Bearer ${connection.token}` }, signal: AbortSignal.timeout(1500) })
    const health = await response.json()
    return response.ok && health.instanceId === connection.instanceId ? { connection, health } : null
  } catch { return null }
}
async function ensureRuntime() {
  const live = await probe()
  if (live) return live
  if (starting) return starting
  starting = (async () => {
    const child = spawn(process.execPath, [path.join(__dirname, 'novelforge-mcp.cjs'), '--runtime'], {
      cwd: root, env: { ...process.env, NOVELFORGE_USER_DATA_DIR: app.getPath('userData') }, detached: true, windowsHide: true, stdio: 'ignore',
    })
    let failure
    child.once('error', (error) => { failure = error })
    child.unref()
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (failure) throw failure
      const ready = await probe()
      if (ready) return ready
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('Shared runtime unavailable; run npm run build:app and inspect runtime-startup.log')
  })().finally(() => { starting = null })
  return starting
}
function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(payload))
}
async function start() {
  await app.whenReady()
  await ensureRuntime()
  server = http.createServer(async (request, response) => {
    const origin = request.headers.origin
    const expectedHost = origins.has(`http://${request.headers.host}`)
    if (!expectedHost || (origin && !origins.has(origin))) { json(response, 403, { ok: false, error: { message: 'Local origin required' } }); return }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    const controller = new AbortController()
    response.once('close', () => controller.abort())
    try {
      const live = await ensureRuntime()
      if (request.method === 'GET' && request.url === '/health') {
        json(response, 200, { ok: true, data: { app: 'NovelForge local web backend', version: LOCAL_WEB_BACKEND_VERSION, storage: live.health.storage, runtimeInstanceId: live.health.instanceId, runtimePid: live.connection.pid } })
        return
      }
      if (request.method === 'GET' && request.url === '/events') {
        const upstream = await fetch(new URL('/events', live.connection.url), { headers: { Authorization: `Bearer ${live.connection.token}` }, signal: controller.signal })
        if (!upstream.ok || !upstream.body) throw new Error('Runtime event stream unavailable')
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        for await (const chunk of upstream.body) response.write(Buffer.from(chunk))
        response.end()
        return
      }
      if (request.method !== 'POST' || request.url !== '/rpc') { json(response, 404, { ok: false, error: { code: 'localBackend.notFound', message: '接口不存在' } }); return }
      if (!String(request.headers['content-type'] || '').startsWith('application/json')) { json(response, 415, { ok: false, error: { message: 'JSON required' } }); return }
      const chunks = []
      let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 4 * 1024 * 1024) { json(response, 413, { ok: false, error: { message: '请求超过 4 MiB' } }); return }
        chunks.push(chunk)
      }
      const upstream = await fetch(new URL('/rpc', live.connection.url), {
        method: 'POST', headers: { Authorization: `Bearer ${live.connection.token}`, 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks), signal: controller.signal,
      })
      response.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(await upstream.text())
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, 503, { ok: false, error: { code: 'runtime.unavailable', message: error.message } })
    }
  })
  server.on('error', (error) => { console.error('[local-web-proxy]', error.message); app.quit() })
  server.listen(port, host, () => console.log(`[local-web-proxy] ${host}:${port} → shared NovelForge runtime`))
}
app.on('before-quit', () => { server?.closeAllConnections(); server?.close() })
process.on('SIGINT', () => app.quit())
process.on('SIGTERM', () => app.quit())
start().catch((error) => { console.error('[local-web-proxy]', error.message); app.exit(1) })
