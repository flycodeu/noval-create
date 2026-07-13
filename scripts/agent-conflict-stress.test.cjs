const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(workspaceRoot, '.tmp-tests', 'agent-conflict-stress')
if (!tempRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error(`Refusing to use a temp directory outside the workspace: ${tempRoot}`)
}

function argument(name) {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return value ? value.slice(prefix.length) : ''
}

function project(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForBarrier(barrierPath) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (fs.existsSync(barrierPath)) return
    await sleep(25)
  }
  throw new Error(`Timed out waiting for conflict stress barrier: ${barrierPath}`)
}

async function runWorker() {
  const root = argument('root')
  const novelId = Number(argument('novel-id'))
  const kind = argument('kind')
  const idempotencyKey = argument('key')
  const contentVariant = argument('content')
  const agentId = argument('agent-id')
  const barrierPath = argument('barrier')
  if (!root || !novelId || !kind || !idempotencyKey || !agentId || !barrierPath) {
    throw new Error('Conflict stress worker arguments are incomplete.')
  }

  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
  app.setName('NovelForge Agent Conflict Stress Worker')
  app.setPath('userData', root)
  app.commandLine.appendSwitch('disable-gpu')
  registerProjectTsRuntime(workspaceRoot)
  await app.whenReady()

  const { closeDb, initDb } = project('electron/database/db.ts')
  const artifactService = project('electron/services/artifact.service.ts')
  initDb()
  await waitForBarrier(barrierPath)

  const content = {
    schemaVersion: 'agent-conflict-stress-v1',
    sharedPayload: contentVariant === 'same' ? 'same-payload' : `${contentVariant}-payload`,
    generatedBy: contentVariant === 'same' ? 'both-agents' : agentId,
  }
  let result
  try {
    const artifact = artifactService.createArtifact({
      novelId,
      kind,
      status: 'draft',
      content,
      contextVersion: 1,
      producerType: 'system',
      producerId: agentId,
      producerClient: 'agent-conflict-stress',
      idempotencyKey,
    })
    result = { ok: true, artifactId: artifact.id }
  } catch (error) {
    result = {
      ok: false,
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    closeDb()
  }
  process.stdout.write(`__NOVELFORGE_AGENT_RESULT__${JSON.stringify(result)}\n`)
  await app.quit()
}

function spawnWorker(options) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env }
    delete childEnv.ELECTRON_RUN_AS_NODE
    const child = spawn(process.execPath, [__filename, '--worker', ...Object.entries(options).map(([key, value]) => `--${key}=${value}`)], {
      cwd: workspaceRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      const marker = '__NOVELFORGE_AGENT_RESULT__'
      const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker))
      if (!line) {
        reject(new Error(`Conflict stress worker exited without a result (code ${code}). ${stderr || stdout}`))
        return
      }
      try {
        resolve(JSON.parse(line.slice(marker.length)))
      } catch (error) {
        reject(new Error(`Invalid conflict stress worker result: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
  })
}

async function runRaceRound({ novelId, key, content, workerCount, label }) {
  const barrierPath = path.join(tempRoot, `${label}.barrier`)
  fs.rmSync(barrierPath, { force: true })
  const workers = Array.from({ length: workerCount }, (_, index) => spawnWorker({
    root: tempRoot,
    'novel-id': novelId,
    kind: 'agent_conflict_stress',
    key,
    content,
    'agent-id': index % 2 === 0 ? 'agent-a' : 'agent-b',
    barrier: barrierPath,
  }))
  await sleep(250)
  fs.writeFileSync(barrierPath, 'go', 'utf8')
  const results = await Promise.all(workers)
  fs.rmSync(barrierPath, { force: true })
  return results
}

async function runMain() {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  fs.mkdirSync(tempRoot, { recursive: true })
  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
  app.setName('NovelForge Agent Conflict Stress')
  app.setPath('userData', tempRoot)
  app.commandLine.appendSwitch('disable-gpu')
  registerProjectTsRuntime(workspaceRoot)

  await app.whenReady()
  const { closeDb, getSqlite, initDb } = project('electron/database/db.ts')
  const novelService = project('electron/services/novel.service.ts')
  initDb()
  try {
    const novelId = novelService.createNovel({
      title: '双 Agent 冲突压测',
      synopsis: '验证同一幂等键在并发候选写入下只产生一个工件。',
      targetWords: 10000,
    })
    closeDb()

    const replayResults = await runRaceRound({
      novelId,
      key: 'dual-agent-same-content-1',
      content: 'same',
      workerCount: 12,
      label: 'same-content',
    })
    assert.equal(replayResults.length, 12)
    assert.ok(replayResults.every((result) => result.ok), JSON.stringify(replayResults))
    assert.equal(new Set(replayResults.map((result) => result.artifactId)).size, 1)

    const conflictResults = await runRaceRound({
      novelId,
      key: 'dual-agent-different-content-1',
      content: 'different',
      workerCount: 2,
      label: 'different-content',
    })
    assert.equal(conflictResults.filter((result) => result.ok).length, 1, JSON.stringify(conflictResults))
    assert.equal(conflictResults.filter((result) => result.code === 'IDEMPOTENCY_KEY_CONFLICT').length, 1, JSON.stringify(conflictResults))

    initDb()
    const sqlite = getSqlite()
    const sameRow = sqlite.prepare(`
      SELECT COUNT(*) AS count FROM artifacts
      WHERE novel_id = ? AND kind = 'agent_conflict_stress' AND idempotency_key = ?
    `).get(novelId, 'dual-agent-same-content-1')
    const conflictRow = sqlite.prepare(`
      SELECT COUNT(*) AS count FROM artifacts
      WHERE novel_id = ? AND kind = 'agent_conflict_stress' AND idempotency_key = ?
    `).get(novelId, 'dual-agent-different-content-1')
    assert.equal(sameRow.count, 1)
    assert.equal(conflictRow.count, 1)
    console.log('PASS concurrent dual-agent conflict stress: replay is single-row and different-content collision is rejected')
  } finally {
    closeDb()
    fs.rmSync(tempRoot, { recursive: true, force: true })
    await app.quit()
  }
}

const task = process.argv.includes('--worker') ? runWorker() : runMain()
task.catch((error) => {
  console.error('[agent-conflict-stress] failed:', error.stack || error.message || error)
  process.exit(1)
})
