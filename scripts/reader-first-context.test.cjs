const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const isolatedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-rf07-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
process.env.NOVELFORGE_USER_DATA_DIR = isolatedPath
app.setPath('userData', isolatedPath)
app.commandLine.appendSwitch('disable-gpu')
registerProjectTsRuntime(root)
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex')
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const output = path.join(root, 'docs/implementation/reader-first-v1/evidence/RF-07', runId)
fs.mkdirSync(output, { recursive: true })

app.whenReady().then(async () => {
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const captures = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      captures.push(JSON.parse(body))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'rf07-loopback', choices: [{ message: { role: 'assistant', content: '隔离模型桩返回。' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const nativeFetch = globalThis.fetch
  globalThis.fetch = (url, ...args) => {
    assert.equal(new URL(String(url)).origin, baseUrl, 'network access limited to this loopback server')
    return nativeFetch(url, ...args)
  }
  const report = { task: 'RF-07', runId, kind: 'isolated-integration', command: 'npx electron scripts/reader-first-context.test.cjs',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    policyVersion: 'reader-first-v1', contextCompilerMode: ['legacy', 'shadow', 'active'], userData: isolatedPath,
    realProviderCalls: 0, limitations: ['No user database, browser, real provider or reader acceptance.'], results: [] }
  try {
    initDb()
    const sqlite = getSqlite()
    const { collectChapterContextRawData, allocateChapterContext, ContextOverflowError, HardConstraintOverflowError } = require('../electron/services/context.service.ts')
    const { resolveChapterNarrativeIdentity } = require('../electron/services/chapter-narrative-policy.ts')
    const { compileChapterContextPack } = require('../electron/services/context-compiler.ts')
    const { createChapterStagePrepareInput } = require('../electron/services/chapter-pipeline-context.ts')
    const { buildChapterWriterMessages } = require('../electron/services/chapter-pipeline-writer.ts')
    const { estimateRequestBudget } = require('../electron/services/request-budget.ts')
    const { createTask, executeChatTask } = require('../electron/services/task.service.ts')
    const modelId = Number(sqlite.prepare('INSERT INTO model_configs (name, provider, model_id, base_url, max_context_tokens, max_tokens, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)').run('RF07 loopback', 'openai', 'rf07-fixture', `${baseUrl}/v1`, 32000, 400, 1).lastInsertRowid)
    const novelId = Number(sqlite.prepare('INSERT INTO novels (title, model_config_id, settings_json) VALUES (?, ?, ?)').run('RF07 原创隔离样例', modelId, '{"readerFirst":{"schemaVersion":1,"policyVersion":"reader-first-v1","revision":1}}').lastInsertRowid)
    const key = '沈宁接过铜钥匙。她说：“锁芯只能转半圈，明天从北门走。”'
    const original = ['雨水打湿院里的台阶。'.repeat(70), key, '窗外的脚步声渐渐远去。'.repeat(70), '沈宁攥住铜钥匙，站在门边。'].join('\n\n')
    const insertChapter = sqlite.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, outline, status, next_chapter_seed) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const previousId = Number(insertChapter.run(novelId, 1, '钥匙', original, '', 'final', '未来计划：管家逃走。').lastInsertRowid)
    const currentId = Number(insertChapter.run(novelId, 2, '北门', '', '沈宁拿铜钥匙开北门，锁芯只能转半圈。', 'outline', '').lastInsertRowid)
    insertChapter.run(novelId, 3, '未来', '未来章秘密哨兵', '', 'outline', '')
    sqlite.prepare('INSERT INTO characters (novel_id, full_name, role_type) VALUES (?, ?, ?)').run(novelId, '沈宁', 'protagonist')
    const allocate = (raw, totalBudget = 18000, promptProfile = 'draft') => {
      try { return allocateChapterContext(raw, { totalBudget, promptProfile }) }
      catch (error) { if (error instanceof ContextOverflowError && !(error instanceof HardConstraintOverflowError)) return error.context; throw error }
    }
    const canonicalSnapshot = () => JSON.stringify(['novels', 'chapters', 'characters', 'scene_contracts', 'story_facts'].map((table) => sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY id').all()))
    const beforeRead = canonicalSnapshot()
    const raw = await collectChapterContextRawData(novelId, 2)
    assert.equal(canonicalSnapshot(), beforeRead, 'context read must not mutate canonical data')
    raw.narrativeIdentity = resolveChapterNarrativeIdentity(currentId)
    const context = allocate(raw)
    assert.equal(context.previousChapterContext, original)
    assert.equal(context.lastChapterEnding, '')
    assert.equal(context.previousChapterSampleReport.fullyInjected, true)
    report.results.push({ caseId: 'RF-07-01', status: 'PASS', sourceHash: hash(original), chars: original.length, canonicalReadOnly: true, derivedCacheWrites: 'Existing recall may refresh semantic indexes and request ledgers in isolated SQLite.' })
    const huge = { ...raw, chapterRows: raw.chapterRows.map((row) => row.id === previousId ? { ...row, content: ['不相关的风景。'.repeat(6000), key, '另一些路人。'.repeat(6000), '沈宁攥住铜钥匙，站在门边。'].join('\n\n') } : row) }
    const selected = allocate(huge, 9000)
    assert.ok(selected.previousChapterContext.includes(key))
    assert.equal(selected.previousChapterSampleReport.fullyInjected, false)
    assert.ok(selected.previousChapterSampleReport.sources.some((source) => source.reason === 'budget_insufficient'))
    const impossible = { ...raw, chapterRows: raw.chapterRows.map((row) => row.id === previousId ? { ...row, content: key.repeat(5000) } : row) }
    assert.throws(() => allocate(impossible, 9000), (error) => error.code === 'NF_CONTEXT_REQUIRED_OVERFLOW')
    report.results.push({ caseId: 'RF-07-02', status: 'PASS', selection: selected.previousChapterSampleReport })
    // Use actual task -> adapter -> HTTP capture in all three compiler modes.
    for (const mode of ['legacy', 'shadow', 'active']) {
      process.env.NOVELFORGE_CONTEXT_COMPILER_MODE = mode
      const currentRaw = await collectChapterContextRawData(novelId, 2)
      currentRaw.narrativeIdentity = resolveChapterNarrativeIdentity(currentId)
      const current = allocate(currentRaw)
      current.contextPack = (await compileChapterContextPack({ context: current, rawContext: currentRaw, stage: 'draft', mode })).pack
      // Synthetic approved sample is intentionally provided at the builder boundary; RF-03 tests cover storage approval.
      current.authorStyleMaterials.approvedSample = { text: '她把碗放回桌上。'.repeat(20), source: 'synthetic-approved', digest: 'fixture' }
      const messages = buildChapterWriterMessages({ novelTitle: 'RF07 原创隔离样例', genre: '悬疑', chapterNum: 2, chapterTitle: '北门', emotionTone: '', targetWords: 1000,
        storyCore: '', context: current, themeChapterTest: '', consistencyNotes: '', structuralAlertsSummary: '', scenePlanText: '沈宁去开北门。', runtimeAssertions: [], narrativeFields: {}, guidance: {}, protagonistReference: '沈宁', protagonistRule: '', promptTier: 'standard' })
      messages[0].content += '\n最终追加规则：保持人物视角。'.repeat(10)
      const initial = estimateRequestBudget({ messages, systemPrompt: '系统包装', maxTokens: 400, modelContextTokens: 32000 })
      const stageBudget = initial.estimatedTotalTokens - 300
      let diagnostics
      let sentMessages
      const prepare = createChapterStagePrepareInput(current, 'draft')
      const opts = { type: 'chapter_writer', novelId, modelConfigId: modelId, messages, chatOpts: { maxTokens: 400, systemPrompt: '系统包装' }, requestBudget: { stageBudget },
        prepareInput: (request) => { const result = prepare(request); diagnostics = result.diagnostics; sentMessages = result.messages; return result } }
      const taskId = await createTask(opts)
      await executeChatTask(taskId, opts)
      const capture = captures.at(-1)
      assert.deepEqual(capture.messages, [{ role: 'system', content: '系统包装' }, ...sentMessages])
      assert.equal(diagnostics.contextCompilerMode, mode)
      assert.equal(diagnostics.narrativeIdentity.policyVersion, 'reader-first-v1')
      assert.ok(diagnostics.finalBudget.allowed)
      assert.equal(diagnostics.finalMessagesHash, `sha256:${hash(JSON.stringify(sentMessages))}`)
      assert.ok(capture.messages.some((message) => message.content.includes(key)))
      assert.ok(!JSON.stringify(capture).includes('未来章秘密哨兵'))
      assert.ok(!JSON.stringify(capture).includes('未来计划：管家逃走'))
      report.results.push({ caseId: 'RF-07-04', mode, status: 'PASS', taskId, diagnostics, capture })
    }
    // Real SQLite knowledge projection, with reader-only secret and an explicit current POV.
    sqlite.prepare('INSERT INTO scene_contracts (novel_id, chapter_id, pov, status) VALUES (?, ?, ?, ?)').run(novelId, currentId, '沈宁', 'locked')
    sqlite.prepare('INSERT INTO story_facts (novel_id, title, reader_known_chapter_id, protagonist_known_chapter_id) VALUES (?, ?, ?, ?)').run(novelId, '铜钥匙', previousId, previousId)
    sqlite.prepare('INSERT INTO story_facts (novel_id, title, reader_known_chapter_id) VALUES (?, ?, ?)').run(novelId, '真正凶手是管家', previousId)
    sqlite.prepare('UPDATE chapters SET content = ? WHERE id = ?').run('沈宁怀疑铜钥匙被换过，他还不能肯定。\n\n另一处，读者知道真正凶手是管家。\n\n沈宁攥住铜钥匙。', previousId)
    const secretRaw = await collectChapterContextRawData(novelId, 2)
    secretRaw.narrativeIdentity = resolveChapterNarrativeIdentity(currentId)
    const writer = allocate(secretRaw)
    const review = allocate(secretRaw, 18000, 'review')
    assert.ok(!writer.previousChapterContext.includes('真正凶手是管家'))
    assert.ok(writer.previousChapterContext.includes('怀疑铜钥匙被换过，他还不能肯定'))
    assert.ok(review.previousChapterContext.includes('真正凶手是管家'))
    report.results.push({ caseId: 'RF-07-03', status: 'PASS', writer: writer.previousChapterSampleReport, review: review.previousChapterSampleReport })
    report.status = 'PASS'
    report.loopbackCalls = captures.length
    const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort()
    report.files = paths.map((relative) => ({ path: relative, hash: fs.existsSync(path.join(root, relative)) ? hash(fs.readFileSync(path.join(root, relative))) : 'deleted' }))
    report.workingTreeDigest = hash(JSON.stringify(report.files))
    console.log(JSON.stringify({ status: report.status, output, loopbackCalls: captures.length, realProviderCalls: 0 }))
  } catch (error) {
    report.status = 'FAIL'
    report.error = error.stack || String(error)
    console.error(error)
  } finally {
    fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(report, null, 2))
    closeDb()
    await new Promise((resolve) => server.close(resolve))
    globalThis.fetch = nativeFetch
    fs.rmSync(isolatedPath, { recursive: true, force: true })
    app.exit(report.status === 'PASS' ? 0 : 1)
  }
}).catch((error) => { console.error(error); app.exit(1) })
