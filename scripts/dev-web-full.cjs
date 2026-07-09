const { spawn, spawnSync } = require('node:child_process')
const net = require('node:net')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electronCommand = process.platform === 'win32' ? 'electron.cmd' : 'electron'
const backendPort = Number(process.env.NOVELFORGE_WEB_BACKEND_PORT || 8787)
const frontendPort = Number(process.env.NOVELFORGE_WEB_FRONTEND_PORT || 4175)
const expectedBackendVersion = 3

function quoteWindowsArg(value) {
  const text = String(value)
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text
  return `"${text.replace(/"/g, '\\"')}"`
}

function buildWindowsCommand(command, args) {
  return [command, ...args].map(quoteWindowsArg).join(' ')
}

function startProcess(name, command, args) {
  const isWindows = process.platform === 'win32'
  const child = spawn(
    isWindows ? 'cmd.exe' : command,
    isWindows ? ['/d', '/s', '/c', buildWindowsCommand(command, args)] : args,
    {
      cwd: workspaceRoot,
      stdio: 'inherit',
      shell: false,
    },
  )

  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.log(`[dev:web] ${name} exited (${signal || code})`)
    shutdown(code || 1)
  })

  return child
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const done = (result) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(800)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

function getWindowsPidOnPort(port) {
  if (process.platform !== 'win32') return null
  const result = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  const lines = result.stdout.split(/\r?\n/)
  for (const line of lines) {
    if (!line.includes('LISTENING')) continue
    const columns = line.trim().split(/\s+/)
    if (columns.length < 5) continue
    const localAddress = columns[1]
    const pid = Number(columns[4])
    if (localAddress.endsWith(`:${port}`) && Number.isInteger(pid) && pid > 0) return pid
  }
  return null
}

function stopProcessOnPort(port) {
  const pid = getWindowsPidOnPort(port)
  if (!pid) return false
  spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
  return true
}

function fetchBackendHealth() {
  return new Promise((resolve) => {
    const request = require('node:http').get(`http://127.0.0.1:${backendPort}/health`, (response) => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        raw += chunk
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve(null)
        }
      })
    })
    request.setTimeout(1000, () => {
      request.destroy()
      resolve(null)
    })
    request.on('error', () => resolve(null))
  })
}

async function waitForBackendReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const health = await fetchBackendHealth()
    const version = health && health.ok && health.data ? Number(health.data.version) : 0
    if (version === expectedBackendVersion) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

async function waitForPortClosed(port) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await isPortListening(port))) return true
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return false
}

function stopProcessTree(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}

let shuttingDown = false
let keepAliveTimer = null
const children = []

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
  for (const child of children) {
    stopProcessTree(child)
  }
  setTimeout(() => process.exit(code), 300)
}

async function main() {
  let startedBackend = false
  if (await isPortListening(backendPort)) {
    const health = await fetchBackendHealth()
    const version = health && health.ok && health.data ? Number(health.data.version) : 0
    if (version === expectedBackendVersion) {
      console.log(`[dev:web] backend already listening on http://127.0.0.1:${backendPort}`)
    } else if (stopProcessOnPort(backendPort) && await waitForPortClosed(backendPort)) {
      console.log(`[dev:web] restarted outdated backend on http://127.0.0.1:${backendPort}`)
      children.push(startProcess('backend', electronCommand, ['scripts/local-web-backend.cjs']))
      startedBackend = true
    } else {
      console.log(`[dev:web] backend is listening on http://127.0.0.1:${backendPort}, but version is unknown; reuse it`)
    }
  } else {
    children.push(startProcess('backend', electronCommand, ['scripts/local-web-backend.cjs']))
    startedBackend = true
  }

  if (startedBackend) {
    console.log(`[dev:web] waiting for backend http://127.0.0.1:${backendPort}/health`)
    if (!(await waitForBackendReady())) {
      throw new Error(`backend did not become ready on http://127.0.0.1:${backendPort}/health`)
    }
  }

  if (await isPortListening(frontendPort)) {
    console.log(`[dev:web] frontend already listening on http://127.0.0.1:${frontendPort}`)
  } else {
    children.push(startProcess('frontend', npmCommand, ['run', 'dev:web:frontend']))
  }

  console.log(`[dev:web] open http://127.0.0.1:${frontendPort}`)
  console.log('[dev:web] running; press Ctrl+C to stop')
  keepAliveTimer = setInterval(() => undefined, 60_000)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

main().catch((error) => {
  console.error('[dev:web] failed to start:', error)
  shutdown(1)
})
