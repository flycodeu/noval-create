const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

function assertFixtureRoot(root) {
  const target = path.resolve(root)
  const workspaceTemp = path.resolve(__dirname, '..', '.tmp-tests')
  const systemTemp = path.resolve(os.tmpdir())
  const parent = path.dirname(target)
  if (parent !== workspaceTemp && (parent !== systemTemp || !path.basename(target).startsWith('novelforge-'))) {
    throw new Error(`Refusing to clean a non-fixture path: ${target}`)
  }
  return target
}

if (require.main === module && process.argv[2] === '--after-parent') {
  const root = assertFixtureRoot(process.argv[3])
  const parentPid = Number(process.argv[4])
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw new Error('Invalid fixture owner PID')
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  ;(async () => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try { process.kill(parentPid, 0) } catch (error) {
        if (error.code === 'ESRCH') break
        throw error
      }
      await wait(100)
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
        return
      } catch (error) {
        if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error
        await wait(200)
      }
    }
    throw new Error(`Fixture cleanup timed out: ${root}`)
  })().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1 })
} else if (require.main === module) {
  throw new Error('Invalid fixture cleanup invocation')
}

function cleanupElectronFixture(root, label) {
  root = assertFixtureRoot(root)
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch (error) {
    // Electron 44 can retain Chromium cache handles until the owning process exits.
    // A detached Node helper removes only this validated fixture after owner exit.
    if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error
    const nodeExecutable = process.env.npm_node_execpath || 'node'
    const child = spawn(nodeExecutable, [__filename, '--after-parent', root, String(process.pid)], {
      detached: true, stdio: 'ignore', windowsHide: true,
    })
    child.unref()
    console.warn(`[${label}] scheduled temporary profile cleanup after process exit: ${error.code}`)
  }
}

module.exports = { cleanupElectronFixture }
