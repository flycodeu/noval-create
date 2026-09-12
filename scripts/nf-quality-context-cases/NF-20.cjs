'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { createLoopbackHttpStub } = require('../nf-quality-context-fixtures.cjs')

function createContext(chapterNum, previousMarker, previousContent = previousMarker) {
  return {
    chapterGoal: `完成第${chapterNum}章并承接${previousMarker}`,
    contractVersionSummary: `nf20-contract-${chapterNum}`,
    hardConstraintEntries: [
      { label: 'chapterGoal', content: `第${chapterNum}章目标`, allocatedTokens: 8 },
      { label: 'continuityNotes', content: `必须承接:${previousMarker}\n${previousContent}`, allocatedTokens: 120 },
    ],
    softContextDecisions: [],
    contextBudgetReport: { availableContextBudget: 1200, reservedForOutput: 300 },
  }
}

function createBaselineDatabase(input) {
  if (input.databaseMode !== 'upgrade') return
  const dbPath = path.join(input.isolatedUserData, 'novelforge.db')
  const baseline = new input.Database(dbPath)
  try {
    input.baselineRunMigrations(baseline)
    baseline.prepare("INSERT INTO novels (title, context_version) VALUES ('NF-20 0064 升级占位', 1)").run()
  } finally {
    baseline.close()
  }
}

function insertWritebackDraft(sqlite, novelId, chapterId, sourceChapterVersion, chapterNum) {
  const now = new Date().toISOString()
  const runId = Number(sqlite.prepare(`
    INSERT INTO chapter_writeback_runs
      (novel_id, chapter_id, status, trigger_source, retry_count, source_chapter_version, started_at, created_at, updated_at)
    VALUES (?, ?, 'ready', 'nf20-local-acceptance', 0, ?, ?, ?, ?)
  `).run(novelId, chapterId, sourceChapterVersion, now, now, now).lastInsertRowid)
  const diffId = Number(sqlite.prepare(`
    INSERT INTO chapter_writeback_diffs
      (run_id, asset_type, entity_type, after_state_json, diff_reason, confidence,
       verification_status, canon_decision, writeback_status, sort_order, created_at, updated_at)
    VALUES (?, 'thread', 'story-thread', ?, ?, 0.95, 'auto_ready', 'pending', 'pending', 1, ?, ?)
  `).run(
    runId,
    JSON.stringify({ title: `NF20线索${chapterNum}`, summary: `承接到第${chapterNum + 1}章`, status: 'planned', priority: 'medium' }),
    `第${chapterNum}章候选，等待显式确认`,
    now,
    now,
  ).lastInsertRowid)
  return { runId, diffId }
}

async function executeTenChapterChain(input) {
  const {
    adapter,
    compiler,
    database,
    ledger,
    patching,
    revision,
    writeback,
  } = input
  const sqlite = database.getSqlite()
  const novelId = Number(sqlite.prepare(`
    INSERT INTO novels (title, target_words, context_version)
    VALUES (?, 100000, 1)
  `).run(`NF-20 ${input.databaseMode} 十章链`).lastInsertRowid)
  let previousMarker = '开篇基线'
  let casRejected = 0
  const chapterReports = []

  for (let chapterNum = 1; chapterNum <= 10; chapterNum += 1) {
    const chapterId = Number(sqlite.prepare(`
      INSERT INTO chapters (novel_id, chapter_num, title, content, status, context_version)
      VALUES (?, ?, ?, '', 'outline', 1)
    `).run(novelId, chapterNum, `第${chapterNum}章`).lastInsertRowid)
    const novel = sqlite.prepare('SELECT context_version AS contextVersion FROM novels WHERE id = ?').get(novelId)
    const previousContent = chapterNum === 1 ? '开篇基线' : sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(chapterReports.at(-1).chapterId).content
    if (chapterNum > 1) assert.ok(previousContent.includes('已经校正'))
    if (chapterNum === 6) assert.ok(previousContent.includes('第5章人工并发正文'))
    const context = createContext(chapterNum, previousMarker, previousContent)
    const compiled = await compiler.compileChapterContextPack({
      rawContext: {
        novel: { id: novelId, contextVersion: novel.contextVersion },
        currentChapter: { id: chapterId, chapterNum },
      },
      context,
      stage: 'draft',
      modelProfile: 'nf20-local',
      mode: 'active',
    })
    assert.ok(compiled.pack.sources.some((source) => source.required && source.text.includes(previousMarker)))
    assert.ok(compiled.rendered.includes(previousContent))
    const taskId = Number(sqlite.prepare(`
      INSERT INTO tasks (novel_id, type, status, runner_type, related_entity_type, related_entity_id)
      VALUES (?, 'chapter_write', 'running', 'workflow', 'chapter', ?)
    `).run(novelId, chapterId).lastInsertRowid)
    const sink = ledger.createModelAttemptLedgerSink({ taskId, novelId, contextPackId: compiled.pack.id })
    let writerCompletion = null
    const draft = await adapter.chat([{
      role: 'user',
      content: `${compiled.rendered}\n输出 NF20_CHAPTER_${chapterNum}，承接 ${previousMarker}，并保留“需要修订”。`,
    }], {
      requestRetryCount: 0,
      requestObserver: sink,
      onCompletion: (completion) => { writerCompletion = completion },
    })
    assert.equal(writerCompletion?.finish, 'stop')
    const previousContentHash = createHash('sha256').update(previousContent).digest('hex')
    assert.ok(draft.includes(`承接版本:${previousContentHash}`))
    const reviewText = await adapter.chat([{ role: 'user', content: `审校:${draft}` }], {
      requestRetryCount: 0,
      requestObserver: sink,
    })
    const review = JSON.parse(reviewText)
    assert.equal(review.status, 'repair')

    const budget = new revision.RevisionBudgetController(revision.createRevisionBudget(`nf20:${chapterId}`))
    assert.ok(budget.tryReserve(`rewrite:${chapterNum}`))
    const repairTarget = '需要修订'
    const start = draft.indexOf(repairTarget)
    assert.ok(start >= 0)
    const repaired = patching.applyRevisionPatch(draft, {
      baseArtifactHash: patching.buildRevisionPatchArtifactHash(draft),
      patches: [{ start, end: start + repairTarget.length, expectedText: repairTarget, replacement: '已经校正', issueIds: [`nf20:${chapterNum}`] }],
    })
    const restoredBudget = revision.normalizeRevisionBudget(budget.snapshot)
    assert.deepEqual(restoredBudget, budget.snapshot)
    assert.equal(new revision.RevisionBudgetController(restoredBudget).tryReserve(`rewrite:${chapterNum}`), null)

    const expected = sqlite.prepare('SELECT content, context_version AS contextVersion FROM chapters WHERE id = ?').get(chapterId)
    if (chapterNum === 5) {
      sqlite.prepare("UPDATE chapters SET content = '第5章人工并发正文', context_version = context_version + 1 WHERE id = ?").run(chapterId)
    }
    let commit = sqlite.prepare(`
      UPDATE chapters SET content = ?, status = 'draft'
      WHERE id = ? AND content = ? AND context_version = ?
    `).run(repaired, chapterId, expected.content, expected.contextVersion)
    if (chapterNum === 5) {
      assert.equal(commit.changes, 0)
      assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(chapterId).content, '第5章人工并发正文')
      casRejected += 1
      const current = sqlite.prepare('SELECT content, context_version AS contextVersion FROM chapters WHERE id = ?').get(chapterId)
      const rebased = `${current.content}\n${repaired}`
      commit = sqlite.prepare(`
        UPDATE chapters SET content = ?, status = 'draft'
        WHERE id = ? AND content = ? AND context_version = ?
      `).run(rebased, chapterId, current.content, current.contextVersion)
      assert.equal(commit.changes, 1)
    } else {
      assert.equal(commit.changes, 1)
    }

    const chapter = sqlite.prepare('SELECT content, context_version AS contextVersion FROM chapters WHERE id = ?').get(chapterId)
    const writebackDraft = insertWritebackDraft(sqlite, novelId, chapterId, chapter.contextVersion, chapterNum)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM story_threads WHERE novel_id = ? AND title = ?').get(novelId, `NF20线索${chapterNum}`).count, 0)
    await writeback.bulkUpdateChapterWritebackDecisions(writebackDraft.runId, { canonDecision: 'accepted' })
    const applied = await writeback.applyChapterWritebackRun(writebackDraft.runId, { idempotencyKey: `nf20-writeback:${input.databaseMode}:${chapterNum}` })
    assert.equal(applied.activeRun.status, 'applied')
    const commitsBeforeReplay = sqlite.prepare('SELECT COUNT(*) AS count FROM canon_commits WHERE novel_id = ?').get(novelId).count
    const outboxBeforeReplay = sqlite.prepare('SELECT COUNT(*) AS count FROM semantic_memory_outbox WHERE novel_id = ?').get(novelId).count
    await writeback.applyChapterWritebackRun(writebackDraft.runId, { idempotencyKey: `nf20-writeback:${input.databaseMode}:${chapterNum}` })
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM canon_commits WHERE novel_id = ?').get(novelId).count, commitsBeforeReplay)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM semantic_memory_outbox WHERE novel_id = ?').get(novelId).count, outboxBeforeReplay)
    sqlite.prepare("UPDATE tasks SET status = 'success', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(taskId)
    const requests = sqlite.prepare('SELECT request_id, status, usage_json, completion_json, context_pack_id FROM model_request_attempts WHERE task_id = ? ORDER BY attempt_index').all(taskId)
    assert.equal(requests.length, 2)
    assert.equal(new Set(requests.map((request) => request.request_id)).size, 2)
    assert.ok(requests.every((request) => request.status === 'success' && request.context_pack_id === compiled.pack.id))
    assert.ok(requests.every((request) => JSON.parse(request.usage_json).input.value > 0))
    previousMarker = `NF20_CHAPTER_${chapterNum}`
    assert.ok(chapter.content.includes(previousMarker))
    chapterReports.push({ chapterNum, chapterId, taskId, previousContentHash, contextPackId: compiled.pack.id, requestIds: requests.map((request) => request.request_id), revisionBudget: budget.snapshot })
  }

  return { novelId, previousMarker, casRejected, chapterReports }
}

async function verifyExceptionAndCompatibility(input) {
  const { adapter, compiler, database, patching, revision } = input
  const sqlite = database.getSqlite()
  const before = sqlite.prepare('SELECT COUNT(*) AS count FROM chapters').get().count
  let completion = null
  const partial = await adapter.chat([{ role: 'user', content: 'NF20_LENGTH_PROBE' }], {
    requestRetryCount: 0,
    onCompletion: (value) => { completion = value },
  })
  assert.equal(completion?.finish, 'length')
  assert.ok(partial.includes('截断候选'))
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM chapters').get().count, before)

  const locked = '锁定正文。可修正文。'
  const target = '锁定正文'
  assert.throws(() => patching.applyRevisionPatch(locked, {
    baseArtifactHash: patching.buildRevisionPatchArtifactHash(locked),
    patches: [{ start: 0, end: target.length, expectedText: target, replacement: '越权修改', issueIds: ['nf20:locked'] }],
  }, [{ start: 0, end: target.length }]), (error) => error?.code === 'NF_PATCH_LOCKED')

  const legacy = revision.deriveRevisionBudgetFromLegacySnapshot('nf20-legacy', { roles: { rewriter: { taskId: 88 } } })
  assert.equal(legacy.reliable, false)
  assert.equal(legacy.budget.used, 1)

  const rawContext = { novel: { id: 999, contextVersion: 1 }, currentChapter: { id: 998, chapterNum: 11 } }
  const context = createContext(11, 'NF20_CHAPTER_10')
  const previousMode = process.env.NOVELFORGE_CONTEXT_COMPILER_MODE
  delete process.env.NOVELFORGE_CONTEXT_COMPILER_MODE
  assert.equal(compiler.resolveContextCompilerMode(), 'legacy')
  assert.equal(compiler.resolveContextCompilerMode('active'), 'active')
  assert.equal(compiler.resolveContextCompilerMode('legacy'), 'legacy')
  assert.equal(compiler.resolveContextCompilerMode('shadow'), 'shadow')
  assert.equal(compiler.resolveContextCompilerMode('invalid'), 'legacy')
  if (previousMode === undefined) delete process.env.NOVELFORGE_CONTEXT_COMPILER_MODE
  else process.env.NOVELFORGE_CONTEXT_COMPILER_MODE = previousMode
  const active = await compiler.compileChapterContextPack({ rawContext, context, stage: 'draft', modelProfile: 'nf20-mode', mode: 'active' })
  const explicitLegacy = await compiler.compileChapterContextPack({ rawContext, context, stage: 'draft', modelProfile: 'nf20-mode', mode: 'legacy' })
  assert.equal(active.pack.id, explicitLegacy.pack.id)
  assert.ok(active.pack.sources.filter((source) => source.required).every((source) => source.included))
  await assert.rejects(() => compiler.compileChapterContextPack({
    rawContext: { ...rawContext, novel: { id: 999, contextVersion: 2 } },
    context,
    stage: 'draft',
    modelProfile: 'nf20-mode',
    mode: 'active',
    restoredPack: active.pack,
  }), (error) => error?.code === 'NF_CONTEXT_STALE')
  return {
    lengthDetectedInMemory: true,
    lockedPatchRejected: true,
    legacyBudgetUsed: legacy.budget.used,
    defaultMode: 'legacy',
    explicitActivePackId: active.pack.id,
    explicitLegacyPackId: explicitLegacy.pack.id,
  }
}

function seedProductionProbe(sqlite, baseUrl, mode) {
  const modelId = Number(sqlite.prepare(`
    INSERT INTO model_configs (name, provider, model_id, base_url, api_key, temperature, max_tokens, max_context_tokens, is_default)
    VALUES ('NF20 production loopback', 'custom', 'nf20-production', ?, '', 0, 1024, 65536, 1)
  `).run(baseUrl).lastInsertRowid)
  const novelId = Number(sqlite.prepare(`
    INSERT INTO novels (title, model_config_id, context_version, target_words)
    VALUES (?, ?, 1, 20000)
  `).run(`NF20 production ${mode}`, modelId).lastInsertRowid)
  const chapterId = Number(sqlite.prepare(`
    INSERT INTO chapters (novel_id, chapter_num, title, content, status, target_words, context_version)
    VALUES (?, 1, '账房', '作者保留的原稿。', 'draft', 1200, 1)
  `).run(novelId).lastInsertRowid)
  sqlite.prepare("INSERT INTO chapter_contracts (novel_id, chapter_id, chapter_goal, opening_style, status) VALUES (?, ?, '确认账目差异', '直接核对账页', 'ready')").run(novelId, chapterId)
  const segmentId = Number(sqlite.prepare(`
    INSERT INTO chapter_segments (novel_id, chapter_id, segment_order, title, purpose, output_state, status)
    VALUES (?, ?, 1, '账房', '确认账目差异', '找到可追查线索', 'planned')
  `).run(novelId, chapterId).lastInsertRowid)
  sqlite.prepare(`
    INSERT INTO scene_contracts (novel_id, chapter_id, segment_id, pov, scene_goal, obstacle, result_state, status)
    VALUES (?, ?, ?, '主角', '确认账目差异', '账目被篡改', '找到可追查线索', 'ready')
  `).run(novelId, chapterId, segmentId)
  return { novelId, chapterId, modelId }
}

function injectProductionConflict(scenario, sqlite, seeded, services) {
  if (scenario === 'content-conflict') {
    assert.throws(() => services.chapter.updateChapter(seeded.chapterId, { content: '不应写入' }), /请先取消或等待生成结束/)
    // Simulate an external writer bypassing the normal editing lock. The CAS under test remains production code.
    sqlite.prepare("UPDATE chapters SET content = '并发人工保留稿。' WHERE id = ?").run(seeded.chapterId)
  } else if (scenario === 'contract-conflict') {
    services.contract.upsertChapterContract(seeded.chapterId, { chapterGoal: '人工修改后的合同目标' })
  } else if (scenario === 'cancel') {
    const root = sqlite.prepare("SELECT id FROM tasks WHERE novel_id = ? AND type = 'chapter_write' ORDER BY id DESC LIMIT 1").get(seeded.novelId)
    assert.equal(services.task.cancelTask(root.id), true)
  }
}

async function verifyLengthResume(input, stub, services, seeded, route, root, partial) {
  const sqlite = input.database.getSqlite()
  const continuation = '管事停在门口，望向那半页账本。'
  const requests = []
  const sourceSnapshot = JSON.parse(root.progress_json)
  const savedBudget = input.revision.reserveRevisionAttempt(sourceSnapshot.revisionBudget, 'nf20:prior-revision').budget
  sqlite.prepare('UPDATE tasks SET progress_json = ? WHERE id = ?').run(JSON.stringify({ ...sourceSnapshot, revisionBudget: savedBudget }), root.id)
  stub.register(`${route}/chat/completions`, (request) => {
    const body = JSON.parse(request.body)
    requests.push({ stream: body.stream, includesPartial: body.messages.some((message) => message.content.includes(partial)) })
    const frames = [
      { choices: [{ delta: { content: continuation }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 50, completion_tokens: 20 } },
    ]
    return { statusCode: 200, headers: { 'content-type': 'text/event-stream' }, body: `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n` }
  })
  let sourceTaskId = root.id
  let candidate = partial
  const resumptions = []
  for (let round = 0; round < 2; round += 1) {
    await assert.rejects(() => services.chapter.resumeChapterPipeline(sourceTaskId), /length/)
    const tasks = sqlite.prepare('SELECT id, type, status, parent_task_id, output_text, progress_json FROM tasks WHERE novel_id = ? AND id > ? ORDER BY id').all(seeded.novelId, sourceTaskId)
    const resumed = tasks.find((task) => task.type === 'chapter_write')
    const writer = tasks.find((task) => task.parent_task_id === resumed?.id && task.type === 'chapter_writer')
    resumptions.push({ sourceTaskId, rootTaskId: resumed?.id, writerTaskId: writer?.id, tasks })
    fs.writeFileSync(path.join(input.evidenceDirectory, `production-${input.databaseMode}-length-resume.json`), JSON.stringify({ savedBudget, requests, resumptions }, null, 2))
    assert.equal(resumed.status, 'failed')
    assert.equal(writer.status, 'failed')
    candidate += `\n\n${continuation}`
    const snapshot = JSON.parse(resumed.progress_json)
    assert.equal(snapshot.partialContent, candidate)
    assert.deepEqual(snapshot.revisionBudget, savedBudget, 'repeated recovery must inherit the original quota and attempt keys')
    sourceTaskId = resumed.id
  }
  assert.deepEqual(requests, [{ stream: true, includesPartial: true }, { stream: true, includesPartial: true }])
  assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(seeded.chapterId).content, '作者保留的原稿。')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM canon_commits WHERE novel_id = ?').get(seeded.novelId).n, 0)
  return { rootTaskId: sourceTaskId, requestCount: requests.length, candidateRetained: true, revisionBudget: savedBudget }
}

async function verifyProductionEntry(input, stub, loadTypeScriptModule, scenario) {
  const sqlite = input.database.getSqlite()
  const services = {
    chapter: loadTypeScriptModule('electron/services/chapter.service.ts'),
    contract: loadTypeScriptModule('electron/services/endgame-asset.service.ts'),
    task: loadTypeScriptModule('electron/services/task.service.ts'),
  }
  const route = `/nf20-production-${scenario}/v1`
  const seeded = seedProductionProbe(sqlite, `${stub.getBaseUrl()}${route}`, `${input.databaseMode}-${scenario}`)
  loadTypeScriptModule('electron/services/story-structure.service.ts').ensureStoryStructure(seeded.novelId)
  const scenePlan = [{
    scene_order: 1, scene_title: '账房', purpose: '确认账目差异', location: '账房', time_anchor: '当夜',
    present_characters: ['主角'], key_items: ['账本'], conflict: '账目被篡改', beat: '核对账页并锁定缺口',
    must_cover: ['找到可追查线索'], climax_variant: '证据反转', exit_hook: '缺失账页指向内鬼',
    hidden_agendas: ['管事隐瞒账页去向'], irony_gap: '主角发现了账目的破绽', audience: '主角与管事',
  }]
  const partial = 'NF20生产入口截断候选。主角按住账页，找到缺口。'
  const candidate = '主角按住账页，指尖停在被涂改的数字旁。账本缺了半页，门外传来脚步声。'
  const observed = []
  stub.register(`${route}/chat/completions`, (request) => {
    const body = JSON.parse(request.body)
    const running = sqlite.prepare("SELECT id, type, pipeline_role FROM tasks WHERE novel_id = ? AND status = 'running' AND runner_type = 'chat' ORDER BY id DESC LIMIT 1").get(seeded.novelId)
    assert.ok(running, 'production request must have a running task')
    observed.push({ taskId: running.id, role: running.pipeline_role, stream: Boolean(body.stream) })
    assert.ok(['planner', 'writer'].includes(running.pipeline_role), 'probe stops before Critic')
    if (running.pipeline_role === 'writer') injectProductionConflict(scenario, sqlite, seeded, services)
    const content = running.pipeline_role === 'planner' ? JSON.stringify(scenePlan) : scenario === 'length' ? partial : candidate
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: {
      choices: [{ message: { content }, finish_reason: running.pipeline_role === 'writer' && scenario === 'length' ? 'length' : 'stop' }],
      usage: { prompt_tokens: 50, completion_tokens: 30 },
    } }
  })
  stub.register(`${route}/embeddings`, (request) => {
    const body = JSON.parse(request.body)
    const texts = Array.isArray(body.input) ? body.input : [body.input]
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: { data: texts.map((_, index) => ({ index, embedding: [1, 0, 1] })) } }
  })
  let failure
  try {
    await services.chapter.generateChapterContent(seeded.chapterId)
  } catch (error) {
    failure = error
  }
  const tasks = sqlite.prepare('SELECT id, type, status, pipeline_role, output_text, progress_json, error_message FROM tasks WHERE novel_id = ? ORDER BY id').all(seeded.novelId)
  const attempts = sqlite.prepare('SELECT task_id, request_id, status, context_pack_id, completion_json FROM model_request_attempts WHERE novel_id = ? ORDER BY started_at').all(seeded.novelId)
  fs.writeFileSync(path.join(input.evidenceDirectory, `production-${input.databaseMode}-${scenario}.json`), JSON.stringify({ seeded, scenario, observed, failure: failure?.message, tasks, attempts }, null, 2))
  assert.ok(failure, `${scenario} must stop the production workflow`)
  assert.ok(observed.some((request) => request.role === 'writer'), `Writer was not reached: ${failure?.message}`)
  const writer = tasks.find((task) => task.type === 'chapter_writer')
  const root = tasks.find((task) => task.type === 'chapter_write')
  assert.equal(root.status, scenario === 'cancel' ? 'cancelled' : 'failed')
  const expectedBody = scenario === 'content-conflict' ? '并发人工保留稿。' : '作者保留的原稿。'
  assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(seeded.chapterId).content, expectedBody)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM canon_commits WHERE novel_id = ?').get(seeded.novelId).n, 0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM chapter_writeback_runs WHERE novel_id = ?').get(seeded.novelId).n, 0)
  assert.equal(observed.length, 2)
  assert.equal(attempts.length, 2)
  const snapshot = JSON.parse(root.progress_json)
  let resume
  if (scenario === 'length') {
    assert.equal(writer.status, 'failed')
    assert.equal(writer.output_text, partial)
    assert.match(failure.message, /length/)
    assert.equal(JSON.parse(attempts.find((attempt) => attempt.task_id === writer.id).completion_json).finish, 'length')
    assert.equal(snapshot.partialContent, partial, 'length candidate must be available to workflow recovery')
    resume = await verifyLengthResume(input, stub, services, seeded, route, root, partial)
  } else if (scenario === 'cancel') {
    assert.equal(writer.status, 'cancelled')
    assert.equal(attempts.find((attempt) => attempt.task_id === writer.id).status, 'cancelled')
  } else {
    const expectedError = scenario === 'content-conflict' ? /章节正文在生成期间已发生变化/ : /项目上下文在章节生成期间已发生变化/
    assert.match(failure.message, expectedError)
    assert.equal(writer.output_text, candidate)
    assert.equal(snapshot.partialContent, candidate, 'CAS-rejected candidate must be available without overwriting the current chapter')
    const requestsBeforeResume = observed.length
    await assert.rejects(() => services.chapter.resumeChapterPipeline(root.id), expectedError)
    assert.equal(observed.length, requestsBeforeResume, 'stale resume must reject before another model call')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM tasks WHERE novel_id = ?').get(seeded.novelId).n, tasks.length)
  }
  return {
    scenario, rootTaskId: root.id, writerTaskId: writer.id, originalBodyPreserved: true,
    candidateInTask: writer.output_text === (scenario === 'length' ? partial : candidate),
    candidateInWorkflowSnapshot: Boolean(snapshot.partialContent), revisionBudget: snapshot.revisionBudget, observed, resume,
  }
}

async function verifyUnscopedMetering(input, stub, loadTypeScriptModule) {
  const sqlite = input.database.getSqlite()
  const { createAdapter } = loadTypeScriptModule('electron/services/model.service.ts')
  const route = '/nf20-metering/v1'
  stub.register(`${route}/chat/completions`, { statusCode: 200, body: { choices: [{ message: { content: '计量候选' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 } } })
  stub.register(`${route}/embeddings`, { statusCode: 200, body: { data: [{ embedding: [1, 2, 3] }], usage: { prompt_tokens: 9, total_tokens: 9 } } })
  const before = sqlite.prepare('SELECT COUNT(*) AS n FROM model_request_attempts').get().n
  const adapter = createAdapter({ provider: 'custom', modelId: 'nf20-metering', baseUrl: `${stub.getBaseUrl()}${route}` })
  await adapter.chat([{ role: 'user', content: 'fixture' }])
  await adapter.embed(['fixture'], { model: 'nf20-embedding' })
  const taskId = Number(sqlite.prepare("INSERT INTO tasks (type, status, runner_type) VALUES ('chapter_writer', 'running', 'chat')").run().lastInsertRowid)
  await adapter.chat([{ role: 'user', content: 'scoped' }], { requestObserver: input.ledger.createModelAttemptLedgerSink({ taskId }) })
  const rows = sqlite.prepare("SELECT request_id, task_id, model_id, kind, usage_json FROM model_request_attempts WHERE model_id IN ('nf20-metering', 'nf20-embedding')").all()
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM model_request_attempts').get().n - before, 3)
  assert.equal(rows.filter((row) => row.task_id === null).length, 2)
  assert.equal(rows.filter((row) => row.task_id === taskId).length, 1)
  const embedding = rows.find((row) => row.kind === 'embedding')
  assert.equal(JSON.parse(embedding.usage_json).input.value, 9)
  assert.equal(JSON.parse(embedding.usage_json).output.value, null)
  return { requests: rows.length, unscoped: 2, scoped: 1, embeddingInputTokens: 9 }
}

async function verifyProductionMatrix(input, stub, loadTypeScriptModule) {
  const results = []
  for (const scenario of ['length', 'content-conflict', 'contract-conflict', 'cancel']) {
    try {
      const result = await verifyProductionEntry(input, stub, loadTypeScriptModule, scenario)
      results.push({ ...result, status: 'PASS' })
    } catch (error) {
      results.push({ scenario, status: 'FAIL', error: error instanceof Error ? error.message : String(error) })
    }
  }
  const failures = results.filter((result) => result.status === 'FAIL')
  const report = {
    databaseMode: input.databaseMode, isolatedUserData: input.isolatedUserData,
    runAt: new Date().toISOString(), status: failures.length ? 'FAIL' : 'PASS', results,
    network: input.getNetworkEvidence(),
  }
  fs.writeFileSync(path.join(input.evidenceDirectory, `production-matrix-${input.databaseMode}.json`), JSON.stringify(report, null, 2))
  assert.equal(report.network.blockedRemoteRequests, 1, 'only the deliberate remote probe may be blocked')
  assert.equal(failures.length, 0, `NF20_PRODUCTION_REGRESSION: ${failures.map((result) => `${result.scenario}: ${result.error}`).join('\n')}`)
  return results
}

async function run({ Database, tempRoot, baselineRunMigrations, loadTypeScriptModule, databaseMode = 'fresh' }) {
  const { app } = require('electron')
  fs.mkdirSync(tempRoot, { recursive: true })
  const originalUserData = app.getPath('userData')
  const isolatedUserData = fs.mkdtempSync(path.join(tempRoot, `nf20-${databaseMode}-`))
  app.setPath('userData', isolatedUserData)
  process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
  createBaselineDatabase({ databaseMode, isolatedUserData, Database, baselineRunMigrations })

  const database = loadTypeScriptModule('electron/database/db.ts')
  const stub = createLoopbackHttpStub()
  const originalFetch = globalThis.fetch
  let loopbackFetches = 0
  let blockedRemoteRequests = 0
  let requestNumber = 0
  stub.register('/v1/chat/completions', (request) => {
    const body = JSON.parse(request.body)
    const prompt = body.messages?.map((message) => message.content).join('\n') || ''
    if (prompt.includes('NF20_LENGTH_PROBE')) {
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: {
        choices: [{ message: { content: '截断候选' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      } }
    }
    requestNumber += 1
    const chapter = Math.ceil(requestNumber / 2)
    const sqlite = database.getSqlite()
    const previousContent = chapter === 1 ? '开篇基线' : sqlite.prepare('SELECT content FROM chapters WHERE chapter_num = ? ORDER BY id DESC LIMIT 1').get(chapter - 1).content
    if (requestNumber % 2 === 1) assert.ok(prompt.includes(previousContent), 'Writer must receive the persisted repaired previous chapter')
    const previousContentHash = createHash('sha256').update(previousContent).digest('hex')
    const content = requestNumber % 2 === 1
      ? `NF20_CHAPTER_${chapter} 承接版本:${previousContentHash}。需要修订。`
      : JSON.stringify({ status: 'repair', issue: '需要修订' })
    return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: {
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12 + chapter, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 2 } },
    } }
  })

  try {
    globalThis.fetch = (input, options) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      if (url.hostname !== '127.0.0.1') {
        blockedRemoteRequests += 1
        throw new Error('NF20_NON_LOOPBACK_BLOCKED')
      }
      loopbackFetches += 1
      return originalFetch(input, options)
    }
    assert.throws(() => globalThis.fetch('https://nf20-probe.invalid'), /NF20_NON_LOOPBACK_BLOCKED/)
    database.initDb()
    await stub.start()
    const { OpenAIAdapter } = loadTypeScriptModule('electron/adapters/openai.adapter.ts')
    const input = {
      adapter: new OpenAIAdapter('nf20-local-key', 'nf20-loopback', `${stub.getBaseUrl()}/v1`, 65536, 0, 256),
      compiler: loadTypeScriptModule('electron/services/context-compiler.ts'),
      database,
      ledger: loadTypeScriptModule('electron/services/model-attempt-ledger.service.ts'),
      patching: loadTypeScriptModule('src/shared/revision-patch.ts'),
      revision: loadTypeScriptModule('electron/services/revision-budget.ts'),
      writeback: loadTypeScriptModule('electron/services/chapter-writeback.service.ts'),
      databaseMode,
    }
    const chain = await executeTenChapterChain(input)
    const exceptions = await verifyExceptionAndCompatibility(input)
    const sqlite = database.getSqlite()
    const canonCommits = sqlite.prepare('SELECT COUNT(*) AS count FROM canon_commits WHERE novel_id = ?').get(chain.novelId).count
    const outboxRows = sqlite.prepare('SELECT COUNT(*) AS count FROM semantic_memory_outbox WHERE novel_id = ?').get(chain.novelId).count
    const attemptRows = sqlite.prepare('SELECT COUNT(*) AS count FROM model_request_attempts WHERE novel_id = ?').get(chain.novelId).count
    assert.equal(chain.chapterReports.length, 10)
    assert.equal(chain.previousMarker, 'NF20_CHAPTER_10')
    assert.equal(chain.casRejected, 1)
    assert.equal(attemptRows, 20)
    assert.equal(canonCommits, 10)
    assert.ok(outboxRows >= 10)
    assert.equal(stub.getRequestCount('/v1/chat/completions'), 21)
    assert.equal(loopbackFetches, 21)
    assert.equal(blockedRemoteRequests, 1)
    const evidenceDirectory = path.resolve(__dirname, '../../docs/implementation/novelforge-quality-context-v1/evidence/NF-20')
    const production = await verifyProductionMatrix({
      ...input, evidenceDirectory, isolatedUserData,
      getNetworkEvidence: () => ({ remoteRequests: 0, blockedRemoteRequests, loopbackRequests: loopbackFetches, source: 'fetch guard before transport' }),
    }, stub, loadTypeScriptModule)
    const metering = await verifyUnscopedMetering(input, stub, loadTypeScriptModule)
    const productionChain = await require('./nf20-production-chain.cjs').verifyProductionChain(
      { ...input, evidenceDirectory }, stub, loadTypeScriptModule, seedProductionProbe,
    )
    assert.equal(blockedRemoteRequests, 1, 'production probes must not attempt any remote transport')
    return {
      checks: {
        persistedContinuity: 'PASS', requestLedger: 'PASS', manualSqlCas: 'PASS',
        writebackReplay: 'PASS', patchAndBudget: 'PASS', compilerModes: 'PASS',
        productionLength: 'PASS', productionContentCas: 'PASS', productionContractCas: 'PASS', productionCancel: 'PASS',
        unscopedMetering: 'PASS',
        productionServiceChain: 'PASS',
      },
      cases: { '20-01': 'UNVERIFIED', '20-02': 'UNVERIFIED', '20-03': 'UNVERIFIED', '20-04': 'UNVERIFIED', '20-05': 'UNVERIFIED', '20-06': 'UNVERIFIED', '20-07': 'PASS', '20-08': 'NOT_APPLICABLE' },
      evidenceLevel: 'ten-chapter module chain and ten-chapter production service orchestration with explicit Canon confirmation; complete generation IPC chain and full fault matrix remain unverified',
      databaseMode,
      isolatedUserData,
      chain: { chapters: 10, attempts: attemptRows, canonCommits, outboxRows, casRejected: chain.casRejected, finalMarker: chain.previousMarker, chapterReports: chain.chapterReports },
      exceptions,
      production,
      metering,
      productionChain,
      remoteRequests: 0,
      remoteRequestEvidence: 'fetch guard rejects non-loopback before transport; 1 deliberate blocked probe',
      blockedRemoteRequests,
      loopbackRequests: loopbackFetches,
    }
  } finally {
    globalThis.fetch = originalFetch
    await stub.close()
    database.closeDb()
    app.setPath('userData', originalUserData)
  }
}

module.exports = { run }
