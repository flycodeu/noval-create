/* NF-18: isolated production Electron UI; latency/failures are injected at IPC boundary. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ROOT = path.resolve(__dirname, '../..')
const EVIDENCE = path.join(ROOT, 'docs/implementation/novelforge-quality-context-v1/evidence/NF-18')

function bootstrap() {
  const { app, ipcMain, session } = require('electron')
  const isolated = path.resolve(process.env.NF18_USER_DATA || '')
  assert.ok(isolated.startsWith(path.join(ROOT, '.tmp-tests', 'nf-18-')))
  app.setPath('userData', isolated)
  app.setPath('sessionData', isolated)
  const control = { calls: [], errors: [], held: [], delayChapter: null, failSave: false }
  const originalConsoleError = console.error
  console.error = (...args) => {
    control.errors.push(args.map((value) => value instanceof Error ? value.stack || value.message : String(value)).join(' '))
    originalConsoleError(...args)
  }
  control.openDatabase = () => new (require('better-sqlite3'))(path.join(isolated, 'novelforge.db'))
  control.hash = (text) => `sha256:${require('node:crypto').createHash('sha256').update(text).digest('hex')}`
  global.__nf18 = control
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, handler) => handle(channel, async (event, ...args) => {
    const record = { channel, id: args[0], done: false }
    control.calls.push(record)
    if (channel === 'chapter:update' && control.failSave) {
      record.failed = true
      throw new Error('NF-18 injected save failure')
    }
    const result = await handler(event, ...args)
    if (channel === 'chapter:get' && args[0] === control.delayChapter) {
      await new Promise((resolve) => control.held.push(resolve))
    }
    record.done = true
    return result
  })
  const originalFetch = global.fetch
  global.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('NF-18 non-loopback fetch blocked')
    return originalFetch(input, init)
  }
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url)
      callback({ cancel: ['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname) })
    })
  })
  require(path.join(ROOT, 'out/main/main.js'))
}

async function verifyPipeline({ app, page, row, textIs }) {
  const http = require('node:http')
  const sockets = new Set()
  let requests = 0
  const requestPaths = []
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const requestPath = request.url || ''
      requestPaths.push(requestPath)
      if (requestPath.endsWith('/embeddings')) {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const inputs = Array.isArray(payload.input) ? payload.input : [payload.input]
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: [1, index + 1, 0] })) }))
        return
      }
      if (!requestPath.endsWith('/chat/completions')) {
        response.writeHead(404)
        response.end()
        return
      }
      requests += 1
      if (requests > 8) { response.writeHead(429); response.end(); return }
      // Hold the local provider response so the real task can be cancelled.
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.flushHeaders()
    })
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
    const modelId = await page.evaluate((baseUrl) => window.electron.model.create({
      name: 'NF18 loopback only', provider: 'custom', modelId: 'nf18-stub', baseUrl,
      apiKey: '', temperature: 0, maxTokens: 512, maxContextTokens: 65536, maxConcurrency: 1,
    }), baseUrl)
    await app.evaluate((_, modelId) => {
      const db = global.__nf18.openDatabase()
      db.prepare('UPDATE novels SET model_config_id = ? WHERE id = 101').run(modelId)
      db.prepare("INSERT OR REPLACE INTO chapter_contracts(novel_id, chapter_id, chapter_goal, opening_style, status) VALUES (101,901,'确认账目差异','直接切入账房核对','ready')").run()
      const segment = db.prepare('SELECT id FROM chapter_segments WHERE chapter_id = 901 ORDER BY segment_order, id LIMIT 1').get()
        || db.prepare("INSERT INTO chapter_segments(novel_id, chapter_id, segment_order, title, purpose, output_state, content, status) VALUES (101,901,1,'NF18 A','确认账目差异','找到可追查线索','甲章原始正文。','planned')").run()
      const segmentId = Number(segment.id || segment.lastInsertRowid)
      db.prepare("INSERT INTO scene_contracts(novel_id, chapter_id, segment_id, pov, scene_goal, obstacle, result_state, status) VALUES (101,901,?,'主角','确认账目差异','账目被篡改','找到可追查线索','ready')").run(segmentId)
      const scenePlan = [{
        scene_order: 1,
        scene_title: 'NF18 A',
        purpose: '确认账目差异',
        location: '账房',
        time_anchor: '当夜',
        present_characters: ['主角'],
        key_items: ['账本'],
        conflict: '账目被篡改',
        beat: '主角核对账页并锁定缺口',
        must_cover: ['找到可追查线索'],
        climax_variant: '证据反转',
        exit_hook: '缺失账页指向内鬼',
        hidden_agendas: ['篡改者试图隐藏去向'],
        irony_gap: '主角掌握的账目规律多于对手预期',
        audience: '主角与账房管事',
      }]
      db.prepare("UPDATE chapters SET scene_plan_json = ?, target_words = 5000, emotion_tone = '高潮' WHERE id = 901").run(JSON.stringify(scenePlan))
      const chapter = db.prepare('SELECT content FROM chapters WHERE id = 901').get()
      const novel = db.prepare('SELECT context_version FROM novels WHERE id = 101').get()
      const roles = Object.fromEntries(['planner', 'writer', 'critic', 'enforcer', 'rewriter', 'canonizer', 'finalize'].map((role) => [role, {
        role,
        label: role,
        status: role === 'planner' || role === 'writer' ? 'success' : role === 'critic' ? 'cancelled' : 'pending',
        tokensUsed: 0,
        durationMs: 0,
      }]))
      roles.planner.nodeRunId = 6101
      roles.planner.nodeSnapshotId = 'nf18-planner-snapshot'
      roles.writer.nodeRunId = 6102
      roles.writer.nodeSnapshotId = 'nf18-writer-snapshot'
      const snapshot = {
        kind: 'chapter_pipeline', chapterId: 901, workflowTaskId: 5001, status: 'cancelled',
        currentRole: 'critic', currentStage: 'reviewing', lastFailureRole: 'critic',
        totalTokensUsed: 0, totalDurationMs: 0, roles, partialContent: chapter.content,
        baseContentHash: global.__nf18.hash(chapter.content), baseContextVersion: novel.context_version,
        revisionBudget: { id: 'nf18-existing-budget', limit: 2, used: 1, attemptKeys: ['rewrite:previous'] },
      }
      db.prepare("INSERT INTO tasks(id,novel_id,type,status,runner_type,related_entity_type,related_entity_id,model_config_id,progress_json) VALUES (5001,101,'chapter_write','cancelled','workflow','chapter',901,?,?)").run(modelId, JSON.stringify(snapshot))
      const insertNode = db.prepare("INSERT INTO workflow_node_runs(id,workflow_task_id,novel_id,chapter_id,node_key,attempt,status,input_hash,upstream_snapshot_id,context_version,snapshot_id) VALUES (?,?,?,?,?,1,'committed',?,?,1,?)")
      insertNode.run(6101, 5001, 101, 901, 'planner', 'sha256:nf18-planner-input', null, 'nf18-planner-snapshot')
      insertNode.run(6102, 5001, 101, 901, 'writer', 'sha256:nf18-writer-input', 'nf18-planner-snapshot', 'nf18-writer-snapshot')
      const insertSnapshot = db.prepare('INSERT INTO workflow_node_snapshots(id,node_run_id,workflow_task_id,novel_id,chapter_id,node_key,attempt,input_hash,output_hash,context_version,payload_json) VALUES (?,?,?,?,?,?,1,?,?,1,?)')
      insertSnapshot.run('nf18-planner-snapshot', 6101, 5001, 101, 901, 'planner', 'sha256:nf18-planner-input', 'sha256:nf18-planner-output', JSON.stringify({ role: 'planner', status: 'success' }))
      insertSnapshot.run('nf18-writer-snapshot', 6102, 5001, 101, 901, 'writer', 'sha256:nf18-writer-input', 'sha256:nf18-writer-output', JSON.stringify({ role: 'writer', status: 'success', content: chapter.content }))
      db.close()
    }, modelId)
    // Reload clears synthetic events used by earlier cases; restore from the actual task DTO.
    await page.reload()
    await row(901).click()
    await textIs('甲章原始正文。')
    await page.getByRole('button', { name: '从断点继续', exact: true }).click()
    const stopButton = page.getByRole('button', { name: /停\s*止/ })
    await stopButton.waitFor()
    const deadline = Date.now() + 15000
    while (!requests) {
      assert.ok(Date.now() < deadline, 'resumed task must reach the loopback provider')
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    const taskRows = await app.evaluate(() => {
      const db = global.__nf18.openDatabase()
      const rows = db.prepare("SELECT id, status, created_at, updated_at, current_child_task_id, progress_json FROM tasks WHERE novel_id = 101 AND related_entity_id = 901 ORDER BY id").all()
      db.close()
      return rows
    })
    console.log(`NF18 TASK_ROWS: ${JSON.stringify(taskRows.map((task) => ({
      id: task.id,
      rowStatus: task.status,
      snapshotStatus: task.progress_json ? JSON.parse(task.progress_json).status : null,
    })))}`)
    const running = await page.evaluate(() => window.electron.task.getLatestChapterPipeline(901))
    const runningSnapshot = JSON.parse(running.progressJson)
    assert.notEqual(running.id, 5001)
    assert.equal(runningSnapshot.status, 'running')
    assert.equal(runningSnapshot.chapterId, 901)
    assert.deepEqual(runningSnapshot.revisionBudget, { id: 'nf18-existing-budget', limit: 2, used: 1, attemptKeys: ['rewrite:previous'] })
    await stopButton.click()
    const cancelDeadline = Date.now() + 15000
    let stopped
    do {
      stopped = await page.evaluate(() => window.electron.task.getLatestChapterPipeline(901))
      if (stopped.status === 'cancelled') break
      assert.ok(Date.now() < cancelDeadline, 'pipeline must persist cancellation')
      await new Promise((resolve) => setTimeout(resolve, 30))
    } while (true)
    assert.deepEqual(JSON.parse(stopped.progressJson).revisionBudget, runningSnapshot.revisionBudget)
    await row(15).click()
    await textIs('乙章后台期间编辑。')
    assert.equal(await page.getByRole('button', { name: '从断点继续', exact: true }).count(), 0)
    fs.writeFileSync(path.join(EVIDENCE, 'pipeline-ui.json'), JSON.stringify({ requests, requestPaths, taskRows, running, stopped }, null, 2))
    return 'Actual resume click → production service → loopback provider → Stop → persisted cancelled task; original used=1 budget retained and B does not offer A resume.'
  } finally {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function run() {
  const { _electron: electron } = require('playwright')
  fs.mkdirSync(EVIDENCE, { recursive: true })
  fs.mkdirSync(path.join(ROOT, '.tmp-tests'), { recursive: true })
  const isolated = fs.mkdtempSync(path.join(ROOT, '.tmp-tests', 'nf-18-'))
  const cases = []
  const env = { ...process.env, NF18_USER_DATA: isolated, NOVELFORGE_DISABLE_LEGACY_DB_COPY: '1', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE
  env.ELECTRON_RENDERER_URL = require('node:url').pathToFileURL(path.join(ROOT, 'out/renderer/index.html')).href
  let app
  let page
  const check = async (id, action) => {
    try {
      const detail = await action()
      cases.push({ id, result: 'PASS', detail })
      console.log(`${id} PASS: ${detail}`)
    } catch (error) {
      cases.push({ id, result: 'FAIL', error: String(error) })
      throw error
    }
  }
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [__filename, '--nf18-app', '--no-sandbox', '--disable-gpu'], env, timeout: 45000 })
    page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => undefined) })
    await page.waitForURL((url) => url.protocol === 'file:', { timeout: 30000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => Boolean(window.electron))
    await app.evaluate(() => {
      const db = global.__nf18.openDatabase()
      db.pragma('foreign_keys = ON')
      db.prepare("INSERT INTO novels(id,title,status,context_version) VALUES (101,'NF-18 隔离小说','draft',1),(202,'NF-18 空小说','draft',1)").run()
      const insert = db.prepare("INSERT INTO chapters(id,novel_id,chapter_num,title,content,status,word_count) VALUES (?,101,?,?,?,'draft',8)")
      insert.run(901, 3, 'NF18 A', '甲章原始正文。')
      insert.run(15, 80, 'NF18 B', '乙章原始正文。')
      db.close()
    })
    await page.evaluate(() => {
      localStorage.setItem('novelforge-workbench-view-mode', 'professional')
      window.location.hash = '#/novels/101/writing/editor'
    })
    const editor = page.locator('.novel-writing-shell__editor-sheet[contenteditable]')
    const row = (id) => page.locator(`[data-writing-chapter-row="${id}"]`)
    const textIs = async (text) => {
      await page.waitForFunction((expected) => document.querySelector('.novel-writing-shell__editor-sheet[contenteditable]')?.textContent === expected, text)
    }
    const clickSave = () => page.getByRole('button', { name: /^保\s*存$/ }).click()
    await textIs('甲章原始正文。')

    await check('18-01', async () => {
      await row(15).click()
      await textIs('乙章原始正文。')
      await app.evaluate(() => { global.__nf18.delayChapter = 901 })
      await row(901).click()
      await page.waitForFunction(() => document.querySelector('[data-writing-chapter-row="901"]')?.classList.contains('is-active'))
      await row(15).click()
      await textIs('乙章原始正文。')
      await app.evaluate(() => {
        global.__nf18.delayChapter = null
        global.__nf18.held.splice(0).forEach((resolve) => resolve())
      })
      await page.waitForFunction(() => document.querySelector('[data-writing-chapter-row="15"]')?.classList.contains('is-active'))
      assert.equal(await editor.textContent(), '乙章原始正文。')
      return 'Actual chapter clicks B→delayed A→B through production IPC; late A cannot replace B.'
    })

    await check('18-03', async () => {
      await app.evaluate(() => { global.__nf18.failSave = true })
      await editor.fill('乙章用户未保存草稿。')
      await clickSave()
      await page.getByText('保存失败', { exact: true }).waitFor()
      await row(901).click()
      const dialog = page.getByRole('dialog').filter({ hasText: '正文还有未保存修改' })
      await dialog.waitFor()
      await dialog.getByRole('button', { name: '留在当前章' }).click()
      assert.equal(await editor.textContent(), '乙章用户未保存草稿。')
      await app.evaluate(() => { global.__nf18.failSave = false; global.__nf18.calls = [] })
      await clickSave()
      await page.locator('[data-writing-save-state="saved"]').waitFor()
      const writes = await app.evaluate(() => global.__nf18.calls.filter((call) => call.channel === 'chapter:update' && call.done).length)
      assert.equal(writes, 1)
      const stored = await page.evaluate(() => window.electron.chapter.get(15))
      assert.equal(stored.content, '乙章用户未保存草稿。')
      return 'Input, failed save, leave guard/cancel, successful retry; exactly one successful retry IPC write and SQLite content matches.'
    })

    await check('18-02', async () => {
      await editor.fill('乙章后台期间编辑。')
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('chapter:generation-progress', {
          chapterId: 901, taskId: 5001, stage: 'drafting', status: 'running', label: 'NF18 A 后台生成', completed: 1, total: 7,
          pipeline: { kind: 'chapter_pipeline', chapterId: 901, workflowTaskId: 5001, status: 'running', roles: {}, currentRole: null, currentStage: 'drafting', totalTokensUsed: 0, totalDurationMs: 0 },
        })
      })
      await row(901).getByText('生成中', { exact: true }).waitFor()
      assert.equal(await editor.textContent(), '乙章后台期间编辑。')
      assert.equal(await editor.getAttribute('contenteditable'), 'true')
      await clickSave()
      await page.locator('[data-writing-save-state="saved"]').waitFor()
      return 'Synthetic A progress delivered via real Electron event/preload and production hook/store; A tracked, B remains editable and its text saves.'
    })

    await check('18-06', async () => {
      const previous = await editor.textContent()
      const edited = previous + '保留撤销记录。'.repeat(30)
      await editor.fill(edited)
      await editor.evaluate((element) => {
        const range = document.createRange()
        range.setStart(element.firstChild, 0)
        range.setEnd(element.firstChild, 6)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      })
      await page.getByText('已选 6 字', { exact: true }).waitFor()
      const before = await app.evaluate(() => global.__nf18.calls.filter((call) => call.channel === 'quality:getDashboard' && call.done).length)
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('chapter:generation-progress', {
          chapterId: 901, taskId: 5001, stage: 'drafting', status: 'failed', label: 'NF18 quality refresh trigger', completed: 1, total: 7,
        })
      })
      const deadline = Date.now() + 15000
      while (await app.evaluate(() => global.__nf18.calls.filter((call) => call.channel === 'quality:getDashboard' && call.done).length) <= before) {
        assert.ok(Date.now() < deadline, 'quality refresh must complete')
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
      assert.equal(await editor.textContent(), edited)
      assert.equal(await page.evaluate(() => window.getSelection().toString()), edited.slice(0, 6))
      await page.getByText('已选 6 字', { exact: true }).waitFor()
      await editor.press('Control+z')
      await textIs(previous)
      await clickSave()
      await page.locator('[data-writing-save-state="saved"]').waitFor()
      return 'Production quality refresh from background terminal event completes while B text/DOM selection/editor selection persist; Ctrl+Z still restores previous text.'
    })

    await check('18-04', () => verifyPipeline({ app, page, row, textIs }))
    await check('18-05', async () => {
      for (const id of [901, 15]) {
        await row(id).hover()
        await row(id).getByTitle('删除章节').click()
        const dialog = page.getByRole('dialog').filter({ hasText: '确认删除这个章节' })
        await dialog.getByRole('button', { name: /^删\s*除$/ }).click()
        await row(id).waitFor({ state: 'detached' })
      }
      await page.getByText('选择左侧章节开始写作，或点击新建章节。', { exact: true }).waitFor()
      assert.equal(await editor.count(), 0)
      assert.equal(await page.getByText('检测到可恢复的中断正文', { exact: true }).count(), 0)
      return 'Deleted both fixture chapters through actual confirmation dialogs/IPC; last chapter clears editor and pipeline projection.'
    })
    await page.screenshot({ path: path.join(EVIDENCE, 'empty-workspace.png') })
  } finally {
    if (page) await page.screenshot({ path: path.join(EVIDENCE, 'last-ui.png'), timeout: 3000 }).catch(() => undefined)
    const calls = app ? await app.evaluate(() => global.__nf18.calls).catch(() => []) : []
    const errors = app ? await app.evaluate(() => global.__nf18.errors).catch(() => []) : []
    fs.writeFileSync(path.join(EVIDENCE, 'ui-results.json'), JSON.stringify({ date: new Date().toISOString(), isolated, cases, calls, errors }, null, 2))
    if (app) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
  }
  if (cases.some((item) => item.result !== 'PASS')) process.exitCode = 2
}

if (process.argv.includes('--nf18-app')) bootstrap()
else run().catch((error) => { console.error(error); process.exitCode = 1 })
