const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { LOCAL_WEB_BACKEND_VERSION } = require('./local-web-contract.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const testDataRoot = path.join(workspaceRoot, '.tmp-tests', `web-rpc-user-data-${process.pid}-${randomUUID()}`)
const electronCommand = require('electron')
const requestedPort = Number(process.env.NOVELFORGE_WEB_BACKEND_PORT || 0)

function spawnElectron(args, env) {
  return spawn(electronCommand, args, {
    cwd: workspaceRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
}

function findFreePort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', (error) => {
      if (preferredPort > 0) {
        resolve(findFreePort(0))
        return
      }
      reject(error)
    })
    server.listen({ host: '127.0.0.1', port: preferredPort }, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function fetchHealth(port) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/health`, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { raw += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch { resolve(null) }
      })
    })
    request.setTimeout(1000, () => {
      request.destroy()
      resolve(null)
    })
    request.on('error', () => resolve(null))
  })
}

async function waitForBackend(port, child) {
  let lastHealth = null
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break
    lastHealth = await fetchHealth(port)
    if (lastHealth?.ok && Number(lastHealth.data?.version) === LOCAL_WEB_BACKEND_VERSION) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`local Web backend did not become ready on port ${port}: ${JSON.stringify(lastHealth)}`)
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => child.once('close', resolve))
}

async function runSmoke(port) {
  const env = {
    ...process.env,
    NOVELFORGE_LOCAL_BACKEND: `http://127.0.0.1:${port}/rpc`,
  }
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', 'node scripts/local-web-rpc-smoke.cjs'], { cwd: workspaceRoot, env, stdio: 'inherit', windowsHide: true })
    : spawn(process.execPath, ['scripts/local-web-rpc-smoke.cjs'], { cwd: workspaceRoot, env, stdio: 'inherit' })
  const [code] = await new Promise((resolve) => child.once('exit', (exitCode, signal) => resolve([exitCode, signal])))
  return typeof code === 'number' ? code : 1
}

async function main() {
  fs.mkdirSync(testDataRoot, { recursive: true })
  const port = await findFreePort(requestedPort)
  const backendEnv = {
    ...process.env,
    NOVELFORGE_WEB_BACKEND_HOST: '127.0.0.1',
    NOVELFORGE_WEB_BACKEND_PORT: String(port),
    NOVELFORGE_USER_DATA_DIR: testDataRoot,
    NOVELFORGE_DISABLE_LEGACY_DB_COPY: '1',
  }
  const backend = spawnElectron(['scripts/local-web-backend.cjs'], backendEnv)
  let smokeCode = 1
  try {
    await waitForBackend(port, backend)
    console.log(`[web-rpc-smoke] backend ready on http://127.0.0.1:${port}; running smoke checks`)
    smokeCode = await runSmoke(port)
  } finally {
    const discovery = path.join(testDataRoot, 'novelforge-runtime.json')
    if (fs.existsSync(discovery)) {
      const owner = JSON.parse(fs.readFileSync(discovery, 'utf8'))
      await fetch(new URL('/shutdown', owner.url), { method: 'POST', headers: { Authorization: `Bearer ${owner.token}` } }).catch(() => undefined)
      for (let attempt = 0; attempt < 100 && fs.existsSync(path.join(testDataRoot, 'novelforge.single-writer.lock')); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    stopProcessTree(backend)
    await waitForExit(backend)
    const tempParent = path.resolve(workspaceRoot, '.tmp-tests')
    if (path.dirname(path.resolve(testDataRoot)) !== tempParent) {
      throw new Error('Refusing to remove a Web RPC test profile outside .tmp-tests')
    }
    fs.rmSync(testDataRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 500,
    })
  }
  if (smokeCode !== 0) process.exitCode = smokeCode
}

main().catch((error) => {
  console.error('[web-rpc-smoke] failed:', error.message)
  process.exitCode = 1
})
