const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const isolatedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-rf10-'))
process.env.NOVELFORGE_USER_DATA_DIR = isolatedPath
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', isolatedPath)
registerProjectTsRuntime(path.resolve(__dirname, '..'))
const output = path.resolve(__dirname, '../docs/implementation/reader-first-v1/evidence/RF-10/2026-09-15-final')

app.whenReady().then(async () => {
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const captures = []
  let response = { extracts: [], diffs: [] }
  let duringRequest = () => {}
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      captures.push(JSON.parse(body))
      duringRequest()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'rf10-loopback', choices: [{ message: { role: 'assistant', content: typeof response === 'string' ? response : JSON.stringify(response) }, finish_reason: 'stop' }] }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const nativeFetch = globalThis.fetch
  globalThis.fetch = (url, ...args) => {
    assert.equal(new URL(String(url)).origin, baseUrl)
    return nativeFetch(url, ...args)
  }
  try {
    initDb()
    let sqlite = getSqlite()
    const writeback = require('../electron/services/chapter-writeback.service.ts')
    const { updateChapter } = require('../electron/services/chapter-generation.usecase.ts')
    const { getNovelContextStatus, markNovelContextChanged } = require('../electron/services/context-impact.service.ts')
    const { collectChapterContextRawData, allocateChapterContext, ContextOverflowError, HardConstraintOverflowError } = require('../electron/services/context.service.ts')
    const { loadOrPrepareChapterCanonRun } = require('../electron/services/chapter-pipeline-finalize.ts')
    const { buildChapterContentHash, validateChapterPipelineResumeBase } = require('../electron/services/chapter-pipeline-state.ts')
    const nodes = require('../electron/services/workflow-node.service.ts')
    const modelId = Number(sqlite.prepare('INSERT INTO model_configs (name, provider, model_id, base_url, max_context_tokens, max_tokens, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('RF10 loopback', 'openai', 'rf10-fixture', `${baseUrl}/v1`, 32000, 1000, 1).lastInsertRowid)
    const novelId = Number(sqlite.prepare('INSERT INTO novels (title, model_config_id, settings_json) VALUES (?, ?, ?)')
      .run('回写版本原创夹具', modelId, '{"readerFirst":{"schemaVersion":1,"policyVersion":"reader-first-v1","revision":1}}').lastInsertRowid)
    const insertChapter = sqlite.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, summary, continuity_state_json, review_notes_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const bodyA = '沈宁说：“明天从南门走。”两人收好碗筷。'
    const bodyB = '沈宁说：“明天从北门走。”两人收好碗筷。'
    const chapterId = Number(insertChapter.run(novelId, 1, '饭后', bodyA, 'A稿南门摘要', '{}', '{"summary":"已评A稿"}').lastInsertRowid)
    const secondId = Number(insertChapter.run(novelId, 2, '出门', '后章二作者正文保持', '后章二旧摘要哨兵', '{"openLoops":["后章二旧连续性哨兵"]}', '{}').lastInsertRowid)
    const thirdId = Number(insertChapter.run(novelId, 3, '归来', '后章三作者正文保持', '后章三旧摘要哨兵', '{}', '{}').lastInsertRowid)
    const currentRun = (id) => sqlite.prepare('SELECT * FROM chapter_writeback_runs WHERE id = ?').get(id)
    const mappedRun = (id) => {
      const row = currentRun(id)
      return { id: row.id, chapterId: row.chapter_id, sourceIdentityJson: row.source_identity_json, sourceChapterVersion: row.source_chapter_version }
    }
    const threadResponse = (title) => ({ extracts: [], diffs: [{ assetType: 'thread', entityType: 'story-thread', diffReason: '约定次日从指定门出发', confidence: 0.9,
      afterState: { title, currentState: '已约定出发地点', payoffCondition: '按约定出发', status: 'active' } }] })
    response = threadResponse('南门约定')
    const runA = await writeback.prepareChapterWritebackRun(chapterId)
    assert.equal(runA.status, 'ready')
    assert.equal(JSON.parse(currentRun(runA.id).source_identity_json).contentHash, crypto.createHash('sha256').update(bodyA).digest('hex'))
    updateChapter(chapterId, { content: bodyB }, { expectedContent: bodyA })
    assert.equal(currentRun(runA.id).status, 'failed')
    await assert.rejects(writeback.applyChapterWritebackRun(runA.id), /旧回写候选已失效/)
    await assert.rejects(writeback.refreshFinalizedChapterCanonRun(runA.id), /旧回写候选已失效/)
    await assert.rejects(loadOrPrepareChapterCanonRun({ chapterId, prepare: false }), /没有可复用/)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM story_threads').get().n, 0)
    assert.equal(sqlite.prepare('SELECT review_notes_json FROM chapters WHERE id = ?').get(chapterId).review_notes_json, '')

    response = { extracts: [], diffs: [] }
    const empty = await writeback.prepareChapterWritebackRun(chapterId)
    assert.equal(empty.status, 'applied')
    assert.equal((await writeback.applyChapterWritebackRun(empty.id)).writebackStatus.readyForNextChapter, true)
    await writeback.applyChapterWritebackRun(empty.id)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM canon_commits').get().n, 0)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM story_items').get().n, 0)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM characters').get().n, 0)
    assert.ok(captures[1].messages[0].content.includes(bodyB))
    assert.ok(!captures[1].messages[0].content.includes(bodyA))
    const raw = await collectChapterContextRawData(novelId, 2)
    let context
    try { context = allocateChapterContext(raw, { totalBudget: 18000, promptProfile: 'draft' }) }
    catch (error) { if (error instanceof ContextOverflowError && !(error instanceof HardConstraintOverflowError)) context = error.context; else throw error }
    assert.ok(context.previousChapterContext.includes(bodyB))
    assert.ok(!context.previousChapterContext.includes('A稿南门摘要'))

    response = threadResponse('北门约定')
    let runB = await writeback.prepareChapterWritebackRun(chapterId)
    const beforeFinalizeRunId = runB.id
    markNovelContextChanged(novelId, 'Finalize 派生资料刷新')
    runB = await writeback.refreshFinalizedChapterCanonRun(runB.id)
    assert.notEqual(runB.id, beforeFinalizeRunId)
    assert.equal(writeback.isChapterWritebackRunCurrent(mappedRun(runB.id)), true)
    const centerB = await writeback.getChapterWritebackCenterData(chapterId, runB.id)
    await writeback.bulkUpdateChapterWritebackDecisions(runB.id, { canonDecision: 'accepted' })
    const applied = await writeback.applyChapterWritebackRun(runB.id)
    assert.equal(applied.activeRun.status, 'applied')
    await writeback.applyChapterWritebackRun(runB.id)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM story_threads').get().n, 1)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM canon_commits').get().n, 1)
    const ledgerBefore = JSON.stringify(sqlite.prepare('SELECT * FROM canon_commits').all())
    const version = sqlite.prepare('SELECT context_version v FROM novels WHERE id = ?').get(novelId).v
    const workflowTaskId = Number(sqlite.prepare("INSERT INTO tasks (novel_id, type, status, runner_type) VALUES (?, 'chapter_write', 'failed', 'workflow')").run(novelId).lastInsertRowid)
    const lease = nodes.beginWorkflowNode({ workflowTaskId, novelId, chapterId: secondId, nodeKey: 'writer', inputHash: 'rf10-input', contextVersion: version, leaseOwner: 'rf10-test' })
    const snapshot = nodes.recordWorkflowNodeSnapshot({ nodeRunId: lease.nodeRunId, leaseToken: lease.leaseToken,
      payload: { baseContentHash: buildChapterContentHash('后章二作者正文保持'), baseContextVersion: version } })
    const cancelledLease = nodes.beginWorkflowNode({ workflowTaskId, novelId, chapterId: secondId, nodeKey: 'critic', inputHash: 'rf10-review', contextVersion: version, leaseOwner: 'rf10-test' })
    nodes.failWorkflowNode({ nodeRunId: cancelledLease.nodeRunId, leaseToken: cancelledLease.leaseToken, status: 'cancelled' })
    updateChapter(chapterId, { content: bodyB.replace('北门', '西门') }, { expectedContent: bodyB })
    const afterVersion = sqlite.prepare('SELECT context_version v FROM novels WHERE id = ?').get(novelId).v
    assert.equal(afterVersion, version + 1)
    assert.deepEqual(sqlite.prepare('SELECT content FROM chapters WHERE id IN (?, ?) ORDER BY chapter_num').all(secondId, thirdId).map((row) => row.content), ['后章二作者正文保持', '后章三作者正文保持'])
    const status = getNovelContextStatus(novelId)
    assert.ok(status.staleChapterIds.includes(secondId) && status.staleChapterIds.includes(thirdId))
    const laterRaw = await collectChapterContextRawData(novelId, 3)
    assert.equal(laterRaw.chapterRows.find((row) => row.id === secondId).summary, '')
    assert.equal(sqlite.prepare('SELECT summary FROM chapters WHERE id = ?').get(secondId).summary, '后章二旧摘要哨兵')
    assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM canon_commits').all()), ledgerBefore)
    await assert.rejects(writeback.applyChapterWritebackRun(runB.id), /旧回写候选已失效/)

    response = threadResponse('西门旧提取')
    duringRequest = () => updateChapter(chapterId, { content: '沈宁改口：“明天留在家里。”' })
    const racing = await writeback.prepareChapterWritebackRun(chapterId)
    duringRequest = () => {}
    assert.equal(racing.status, 'failed')
    assert.ok(sqlite.prepare('SELECT count(*) n FROM chapter_writeback_diffs WHERE run_id = ?').get(racing.id).n > 0)
    assert.equal((await writeback.getChapterWritebackCenterData(chapterId, racing.id)).writebackStatus.readyForNextChapter, false)
    response = 'not a valid extraction'
    const malformed = await writeback.prepareChapterWritebackRun(chapterId)
    assert.equal(malformed.status, 'failed')
    assert.equal((await writeback.getChapterWritebackCenterData(chapterId, malformed.id)).writebackStatus.readyForNextChapter, false)
    assert.match(malformed.errorMessage, /不能视为无增量|尚未确认是否无增量/)

    response = { extracts: [], diffs: [{ assetType: 'unknown', afterState: {} }] }
    const invalidItems = await writeback.prepareChapterWritebackRun(chapterId)
    assert.equal(invalidItems.status, 'failed')
    assert.match(invalidItems.errorMessage, /不可识别条目/)
    const { refreshSummaryHealthSemantic } = require('../electron/services/summary-decay.service.ts')
    response = { events: ['旧稿约定出门'], entities: ['沈宁'], hooks: ['旧稿下一步'] }
    duringRequest = () => updateChapter(chapterId, { content: '沈宁已经决定在家休息，窗边的花开了。' })
    await refreshSummaryHealthSemantic(chapterId)
    duringRequest = () => {}
    assert.equal(sqlite.prepare('SELECT summary FROM chapters WHERE id = ?').get(chapterId).summary, '')

    response = threadResponse('留家约定')
    const recoveryRun = await writeback.prepareChapterWritebackRun(chapterId)
    await writeback.bulkUpdateChapterWritebackDecisions(recoveryRun.id, { canonDecision: 'accepted' })
    sqlite.exec(`CREATE TEMP TRIGGER rf10_fail_terminal BEFORE INSERT ON canon_commits
      WHEN NEW.source_run_id = ${recoveryRun.id} BEGIN SELECT RAISE(ABORT, 'rf10 terminal failure'); END`)
    await assert.rejects(writeback.applyChapterWritebackRun(recoveryRun.id), /rf10 terminal failure/)
    assert.equal(currentRun(recoveryRun.id).status, 'applying')
    assert.equal((await writeback.getChapterWritebackCenterData(chapterId, recoveryRun.id)).writebackStatus.readyForNextChapter, false)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM canon_commits').get().n, 1)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM chapter_writeback_diffs WHERE run_id = ? AND writeback_status = ?').get(recoveryRun.id, 'applied').n, 1)

    closeDb()
    initDb()
    sqlite = getSqlite()
    assert.equal(nodes.getWorkflowNodeRun(cancelledLease.nodeRunId).status, 'cancelled')
    const reopenedSnapshot = nodes.getWorkflowNodeSnapshot(snapshot.id)
    assert.equal(validateChapterPipelineResumeBase(reopenedSnapshot.payload, {
      content: '后章二作者正文保持', contextVersion: sqlite.prepare('SELECT context_version v FROM novels WHERE id = ?').get(novelId).v,
    }), 'context_conflict')
    assert.equal(writeback.isChapterWritebackRunCurrent(mappedRun(runA.id)), false)
    assert.equal(currentRun(runB.id).status, 'applied')
    assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM canon_commits').all()), ledgerBefore)
    sqlite.prepare('UPDATE chapter_writeback_runs SET updated_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', recoveryRun.id)
    const recovered = await writeback.applyChapterWritebackRun(recoveryRun.id)
    assert.equal(recovered.activeRun.status, 'applied')
    assert.equal(recovered.writebackStatus.readyForNextChapter, true)
    await writeback.applyChapterWritebackRun(recoveryRun.id)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM story_threads').get().n, 2)
    assert.equal(sqlite.prepare('SELECT count(*) n FROM canon_commits').get().n, 2)
    assert.ok(sqlite.prepare('PRAGMA table_info(chapter_writeback_runs)').all().some((column) => column.name === 'source_identity_json'))
    const report = { task: 'RF-10', status: 'PASS', isolatedPath, realProviderCalls: 0, loopbackCalls: captures.length,
      cases: { 'RF-10-01': 'PASS', 'RF-10-02': 'PASS', 'RF-10-03': 'PASS', 'RF-10-04': 'PASS' },
      runIds: { runA: runA.id, empty: empty.id, runB: runB.id, racing: racing.id, malformed: malformed.id, invalidItems: invalidItems.id, recovery: recoveryRun.id },
      reviewedCandidateCount: centerB.diffs.length, sourceIdentity: JSON.parse(currentRun(runB.id).source_identity_json),
      contextVersions: { beforeEdit: version, afterEdit: afterVersion }, staleStatus: status, snapshotId: snapshot.id,
      canonicalRowsPreserved: true, laterBodiesPreserved: true, requests: captures,
      limitations: ['No real provider, browser or reader validation', 'Source identity is deterministic; narrative belief/fact classification still needs author review'] }
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'integration-capture.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ status: report.status, cases: report.cases, loopbackCalls: captures.length, isolatedPath }))
    closeDb()
    await new Promise((resolve) => server.close(resolve))
    app.exit(0)
  } catch (error) {
    console.error(error)
    closeDb()
    server.close()
    app.exit(1)
  }
})
