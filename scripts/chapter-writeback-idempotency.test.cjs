const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(workspaceRoot, '.tmp-tests', 'chapter-writeback-idempotency')
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

async function runWorker() {
  const root = argument('root')
  const runId = Number(argument('run-id'))
  const key = argument('key')
  if (!root || !runId || !key) throw new Error('Writeback idempotency worker arguments are incomplete.')

  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
  app.setName('NovelForge Chapter Writeback Idempotency Worker')
  app.setPath('userData', root)
  app.commandLine.appendSwitch('disable-gpu')
  registerProjectTsRuntime(workspaceRoot)
  await app.whenReady()

  const { closeDb, initDb } = project('electron/database/db.ts')
  const writebackService = project('electron/services/chapter-writeback.service.ts')
  initDb()
  let result
  try {
    const center = await writebackService.applyChapterWritebackRun(runId, { idempotencyKey: key })
    result = { ok: true, status: center.activeRun && center.activeRun.status }
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    closeDb()
  }
  process.stdout.write(`__NOVELFORGE_WRITEBACK_RESULT__${JSON.stringify(result)}\n`)
  await app.quit()
}

function spawnWorker(options) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env }
    delete childEnv.ELECTRON_RUN_AS_NODE
    const child = spawn(process.execPath, [
      __filename,
      '--worker',
      ...Object.entries(options).map(([key, value]) => `--${key}=${value}`),
    ], {
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
      const marker = '__NOVELFORGE_WRITEBACK_RESULT__'
      const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker))
      if (!line) {
        reject(new Error(`Writeback worker exited without a result (code ${code}). ${stderr || stdout}`))
        return
      }
      try {
        resolve(JSON.parse(line.slice(marker.length)))
      } catch (error) {
        reject(new Error(`Invalid writeback worker result: ${error instanceof Error ? error.message : String(error)}`))
      }
    })
  })
}

async function runMain() {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  fs.mkdirSync(tempRoot, { recursive: true })
  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
  app.setName('NovelForge Chapter Writeback Idempotency')
  app.setPath('userData', tempRoot)
  app.commandLine.appendSwitch('disable-gpu')
  registerProjectTsRuntime(workspaceRoot)

  await app.whenReady()
  const { closeDb, getSqlite, initDb } = project('electron/database/db.ts')
  const { chapterWritebackDiffs, chapterWritebackRuns } = project('electron/database/schema.ts')
  const novelService = project('electron/services/novel.service.ts')
  const chapterService = project('electron/services/chapter.service.ts')
  const writebackService = project('electron/services/chapter-writeback.service.ts')
  initDb()

  try {
    const novelId = novelService.createNovel({
      title: '回写幂等性测试',
      synopsis: '验证单章候选回写的数据库级幂等键和乐观锁。',
      targetWords: 3000,
    })
    const chapterId = chapterService.createChapter(novelId, {
      chapterNum: 1,
      title: '第一章 幂等入口',
      outline: '准备一个可重复应用的回写候选。',
      targetWords: 1000,
    })
    const chapter = getSqlite().prepare('SELECT context_version FROM chapters WHERE id = ?').get(chapterId)
    const now = new Date().toISOString()
    const runResult = getSqlite().prepare(`
      INSERT INTO chapter_writeback_runs
        (novel_id, chapter_id, status, trigger_source, retry_count, source_chapter_version, started_at, created_at, updated_at)
      VALUES (?, ?, 'ready', 'idempotency-test', 0, ?, ?, ?, ?)
    `).run(novelId, chapterId, chapter.context_version || 1, now, now, now)
    const runId = Number(runResult.lastInsertRowid)
    getSqlite().prepare(`
      INSERT INTO chapter_writeback_diffs
        (run_id, asset_type, entity_type, after_state_json, diff_reason, confidence, verification_status, canon_decision, writeback_status, sort_order, created_at, updated_at)
      VALUES (?, 'thread', 'story-thread', ?, '幂等压测候选', 0.95, 'auto_ready', 'accepted', 'pending', 1, ?, ?)
    `).run(runId, JSON.stringify({ title: '幂等测试线索', summary: '只允许创建一次。', status: 'planned', priority: 'medium' }), now, now)
    closeDb()

    const key = 'chapter-writeback-idempotency-test-1'
    const results = await Promise.all([
      spawnWorker({ root: tempRoot, 'run-id': runId, key }),
      spawnWorker({ root: tempRoot, 'run-id': runId, key }),
    ])
    assert.ok(results.every((result) => result.ok), JSON.stringify(results))

    initDb()
    const sqlite = getSqlite()
    const run = sqlite.prepare(`
      SELECT status, apply_idempotency_key, apply_lock_version
      FROM chapter_writeback_runs WHERE id = ?
    `).get(runId)
    const diff = sqlite.prepare(`
      SELECT writeback_status FROM chapter_writeback_diffs WHERE run_id = ?
    `).get(runId)
    const threads = sqlite.prepare(`
      SELECT COUNT(*) AS count FROM story_threads WHERE novel_id = ? AND title = ?
    `).get(novelId, '幂等测试线索')
    assert.equal(run.status, 'applied')
    assert.equal(run.apply_idempotency_key, key)
    assert.equal(run.apply_lock_version, 1)
    assert.equal(diff.writeback_status, 'applied')
    assert.equal(threads.count, 1)

    const replay = await writebackService.applyChapterWritebackRun(runId, { idempotencyKey: key })
    assert.equal(replay.activeRun.status, 'applied')
    const replayRun = sqlite.prepare('SELECT apply_lock_version FROM chapter_writeback_runs WHERE id = ?').get(runId)
    const replayThreads = sqlite.prepare(`
      SELECT COUNT(*) AS count FROM story_threads WHERE novel_id = ? AND title = ?
    `).get(novelId, '幂等测试线索')
    assert.equal(replayRun.apply_lock_version, 1)
    assert.equal(replayThreads.count, 1)
    console.log('PASS chapter writeback idempotency: concurrent apply is one-shot and replay does not mutate again')
  } finally {
    closeDb()
    fs.rmSync(tempRoot, { recursive: true, force: true })
    await app.quit()
  }
}

const task = process.argv.includes('--worker') ? runWorker() : runMain()
task.catch((error) => {
  console.error('[chapter-writeback-idempotency] failed:', error.stack || error.message || error)
  process.exit(1)
})
