const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const isolatedPath = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-rf09-'))
process.env.NOVELFORGE_USER_DATA_DIR = isolatedPath
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', isolatedPath)
registerProjectTsRuntime(path.resolve(__dirname, '..'))
const output = path.resolve(__dirname, '../docs/implementation/reader-first-v1/evidence/RF-09/2026-09-15-final')

app.whenReady().then(async () => {
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const captures = []
  let modelResponse = []
  let duringRequest = () => {}
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      captures.push(JSON.parse(body))
      duringRequest()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id: 'rf09-loopback', choices: [{ message: { role: 'assistant', content: JSON.stringify(modelResponse) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
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
    const { executeChapterPlannerPhase, loadReusablePlannerOutput } = require('../electron/services/chapter-pipeline-planner.ts')
    const { buildRecentStoryDesignProjection, formatRecentStoryDesignProjection } = require('../electron/services/story-thread.service.ts')
    const { createTask, updateTask, getTaskRecord } = require('../electron/services/task.service.ts')
    const { resolveChapterNarrativeIdentity } = require('../electron/services/chapter-narrative-policy.ts')
    const { buildChapterWriterMessages } = require('../electron/services/chapter-pipeline-writer.ts')
    const { isSceneStoryDesign, reviewRecentStoryDesign } = require('../src/shared/story-thread-generation.ts')
    const modelId = Number(sqlite.prepare('INSERT INTO model_configs (name, provider, model_id, base_url, max_context_tokens, max_tokens, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)').run('RF09 isolated model', 'openai', 'rf09-fixture', `${baseUrl}/v1`, 32000, 2000, 1).lastInsertRowid)
    const novelId = Number(sqlite.prepare('INSERT INTO novels (title, model_config_id, settings_json) VALUES (?, ?, ?)').run('近期故事原创夹具', modelId, '{"readerFirst":{"schemaVersion":1,"policyVersion":"reader-first-v1","revision":1}}').lastInsertRowid)
    const otherId = Number(sqlite.prepare('INSERT INTO novels (title) VALUES (?)').run('其他作品隔离').lastInsertRowid)
    const insertChapter = sqlite.prepare('INSERT INTO chapters (novel_id, chapter_num, title, content, scene_plan_json) VALUES (?, ?, ?, ?, ?)')
    const scene = (changes = {}) => ({ scene_order: 1, scene_title: '晚饭', purpose: '照护后相处', location: '家中', time_anchor: '傍晚', present_characters: ['林夏', '周宁'],
      key_items: [], conflict: '', beat: '安静吃完晚饭', must_cover: [], climax_variant: '', exit_hook: '', hidden_agendas: [], irony_gap: '', audience: '', ...changes })
    const oldPlan = scene({ location: '河镇', conflict: '河镇执事扣住信件要求交费', beat: '林夏替河镇找药后取回信件',
      story_design: { expectations: [{ thread_id: null, action: 'raise', expected_payoff: '另一封信的来历', outcome: '拿到新信' }] } })
    insertChapter.run(novelId, 1, '资格', '资格已取得，比赛尚未开始。', JSON.stringify([scene()]))
    insertChapter.run(novelId, 2, '河镇', '上一章原文', JSON.stringify([oldPlan]))
    insertChapter.run(novelId, 3, '等待', '照护安排已达成。', JSON.stringify([oldPlan]))
    const chapterId = Number(insertChapter.run(novelId, 4, '晚饭', '当前作者正文不变。', JSON.stringify([scene()])).lastInsertRowid)
    insertChapter.run(novelId, 8, '未来', '未来秘密', JSON.stringify([scene({ beat: '未来计划哨兵' })]))
    const insertThread = sqlite.prepare('INSERT INTO story_threads (novel_id, title, payoff_condition, current_state, status, start_chapter, target_payoff_chapter) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const qualificationId = Number(insertThread.run(novelId, '参赛资格', '取得参赛资格', '资格已确认', 'resolved', 1, 3).lastInsertRowid)
    const championId = Number(insertThread.run(novelId, '夺冠', '赢得决赛冠军', '尚未比赛', 'active', 1, 12).lastInsertRowid)
    const unansweredId = Number(insertThread.run(novelId, '旧信', '查清旧信寄件人', '还不知道寄件人', 'active', 1, 4).lastInsertRowid)
    const foreignThreadId = Number(insertThread.run(otherId, '另一作品哨兵', '别的约定', '', 'active', 1, 1).lastInsertRowid)
    insertThread.run(novelId, '未来期待哨兵', '未来约定', '', 'planned', 8, 10)
    const charId = Number(sqlite.prepare('INSERT INTO characters (novel_id, full_name, rank_level, abilities_json) VALUES (?, ?, ?, ?)').run(novelId, '林夏', '已经掌握辨印术', '["能辨认旧印章"]').lastInsertRowid)
    const supportId = Number(sqlite.prepare('INSERT INTO characters (novel_id, full_name) VALUES (?, ?)').run(novelId, '周宁').lastInsertRowid)
    sqlite.prepare('INSERT INTO character_arcs (novel_id, character_id, misbelief) VALUES (?, ?, ?)').run(novelId, charId, '林夏误以为邻居偷了信')
    sqlite.prepare('INSERT INTO character_relations (novel_id, char_a_id, char_b_id, description) VALUES (?, ?, ?, ?)').run(novelId, charId, supportId, '两人已经达成照护安排')
    const visible = { characterStates: '林夏：已经掌握辨印术；能辨认旧印章；林夏误以为邻居偷了信。周宁要回店交班。',
      relationSummary: '两人已经达成照护安排', worldRules: '辨印术只能辨别已有印章，不能凭空读取信件。', activeThreads: '参赛资格、夺冠、旧信', openLoops: '' }
    const context = { ...visible, chapterGoal: '按已有安排吃饭，周宁照顾母亲又按时交班', currentArc: '',
      narrativeIdentity: resolveChapterNarrativeIdentity(chapterId), authorStyleMaterials: { targetWorkSampleGuide: '', humanStyleSampleLock: '' } }
    const projection = buildRecentStoryDesignProjection(novelId, 4, visible)
    assert.equal(projection.threads.find((row) => row.id === qualificationId).status, 'resolved')
    assert.equal(projection.threads.find((row) => row.id === championId).status, 'active')
    assert.ok(!JSON.stringify(projection).includes('哨兵'))
    assert.equal(projection.sources.find((source) => source.kind === 'belief').authority, 'belief')
    assert.equal(projection.sources.find((source) => source.kind === 'ability').authority, 'confirmed')
    assert.match(projection.sources.find((source) => source.kind === 'belief').state, /^林夏：/)
    assert.match(projection.sources.find((source) => source.kind === 'ability').state, /^林夏：/)
    assert.match(projection.sources.find((source) => source.kind === 'relationship').state, /^林夏与周宁：/)
    assert.equal(buildRecentStoryDesignProjection(novelId, 4, { ...visible, characterStates: '', activeThreads: '', openLoops: '' }).threads.length, 0)
    const beforeCanonical = JSON.stringify(['story_threads', 'characters', 'character_arcs', 'character_relations', 'story_facts'].map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()))
    let lastTaskId
    const prompt = { context, novelTitle: '近期故事原创夹具', genre: '关系日常', chapterNum: 4, chapterTitle: '晚饭', plotPoints: '按约定吃饭', emotionTone: '满足', targetWords: 1500,
      storyCore: '', consistencyNotes: '', runtimeAssertions: [], narrativeFields: {}, guidance: {}, protagonistReference: '林夏', protagonistRule: '近距离限知', promptTier: 'standard' }
    async function run(plan) {
      modelResponse = plan
      return executeChapterPlannerPhase({ prompt, shouldRun: true, chapterId, novelId, modelConfigId: modelId, chatOptions: { maxTokens: 2000 }, fallbackScenePlan: [scene()],
        startRole: async (messages) => {
          lastTaskId = await createTask({ type: 'chapter_planner', novelId, relatedEntityType: 'chapter', relatedEntityId: chapterId, messages, modelConfigId: modelId })
          return lastTaskId
        }, validateContracts: () => 'rf09-contract', onContractValidated() {}, setUpstreamTaskId() {},
        failRole(taskId, error) { updateTask(taskId, { status: 'failed', outputText: error.outputText || '', errorMessage: error.message }); throw error },
        persistScenePlan(plan) { sqlite.prepare('UPDATE chapters SET scene_plan_json = ? WHERE id = ?').run(JSON.stringify(plan), chapterId) },
      })
    }
    const qualified = scene({ story_design: { expectations: [{ thread_id: qualificationId, action: 'respond', expected_payoff: '取得参赛资格', outcome: '谈起确认书，夺冠仍须比赛' }] } })
    const qualifiedOutput = await run([qualified])
    assert.equal(qualifiedOutput.scenePlan[0].story_design.expectations.length, 1)
    const wrong = scene({ story_design: { expectations: [{ thread_id: championId, action: 'respond', expected_payoff: '取得参赛资格', outcome: '收到确认书' }] } })
    await assert.rejects(run([wrong]), /回到规划/)
    assert.match(getTaskRecord(lastTaskId).outputText, /赢得决赛冠军/)
    const quiet = scene({ story_design: { choices: [{ character: '周宁', wants: '陪母亲吃饭，再回店交班', options: ['饭后回店', '请同事稍等'], stake: '同事也需要回家' }],
      result: '安心吃完饭', aftermath: '周宁带上工作服出门' } })
    const quietOutput = await run([quiet])
    assert.equal(quietOutput.scenePlan[0].conflict, '')
    assert.match(quietOutput.scenePlanText, /同事也需要回家/)
    const writer = buildChapterWriterMessages({ ...prompt, scenePlan: quietOutput.scenePlan, scenePlanText: quietOutput.scenePlanText, themeChapterTest: '', structuralAlertsSummary: '', lockedParagraphs: [] })
    assert.equal(JSON.stringify(writer).split('同事也需要回家').length, 2)
    const savedPlan = sqlite.prepare('SELECT scene_plan_json FROM chapters WHERE id = ?').get(chapterId).scene_plan_json
    const repeated = scene({ location: '山城', present_characters: ['沈桥'], conflict: '山城执事扣住信件要求交费', beat: '沈桥替山城找药后取回信件', story_design: oldPlan.story_design })
    await assert.rejects(run([repeated]), /回到规划/)
    const repeatedFailure = JSON.parse(getTaskRecord(lastTaskId).outputText)
    assert.ok(repeatedFailure.findings.some((finding) => finding.code === 'repeated_structure'))
    assert.ok(repeatedFailure.findings.some((finding) => finding.code === 'unanswered_expectation' && finding.evidence.includes(String(unansweredId))))
    const uses = projection.sources.filter((source) => source.kind !== 'rule').map((source) => ({ source_id: source.id, source_hash: source.hash, expected_state: source.state,
      resulting_state: source.state, interpretation: source.authority === 'belief' ? 'belief' : 'fact' }))
    assert.equal(reviewRecentStoryDesign([scene({ story_design: { state_uses: uses } })], projection).length, 0)
    const badUses = structuredClone(uses)
    badUses.find((use) => use.interpretation === 'belief').interpretation = 'fact'
    badUses.find((use) => use.source_id.includes('ability')).resulting_state = '不会辨认旧印章'
    badUses.push({ source_id: 'universal-permission', source_hash: 'new', expected_state: '万能权限自动开门', resulting_state: '万能权限自动开门', interpretation: 'fact' })
    await assert.rejects(run([scene({ story_design: { state_uses: badUses } })]), /回到规划/)
    const badFailure = JSON.parse(getTaskRecord(lastTaskId).outputText)
    assert.deepEqual(new Set(badFailure.findings.map((finding) => finding.code)), new Set(['belief_promoted', 'state_reset', 'state_source']))
    const foreign = scene({ story_design: { expectations: [{ thread_id: foreignThreadId, action: 'respond', expected_payoff: '别的约定', outcome: '全部解决' }] } })
    await assert.rejects(run([foreign]), /回到规划/)
    assert.equal(sqlite.prepare('SELECT scene_plan_json FROM chapters WHERE id = ?').get(chapterId).scene_plan_json, savedPlan)
    assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id = ?').get(chapterId).content, '当前作者正文不变。')
    assert.equal(JSON.stringify(['story_threads', 'characters', 'character_arcs', 'character_relations', 'story_facts'].map((table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all())), beforeCanonical)
    duringRequest = () => sqlite.prepare('UPDATE story_threads SET payoff_condition = ? WHERE id = ?').run('取得改期后的参赛资格', qualificationId)
    await assert.rejects(run([qualified]), /依据已变化/)
    duringRequest = () => {}
    const staleFailure = getTaskRecord(lastTaskId).outputText
    assert.match(staleFailure, /sourceProjection/)
    closeDb()
    initDb()
    sqlite = getSqlite()
    const reopened = sqlite.prepare('SELECT scene_plan_json FROM chapters WHERE id = ?').get(chapterId).scene_plan_json
    assert.equal(reopened, savedPlan)
    assert.equal(loadReusablePlannerOutput(reopened, [], savedPlan).scenePlan[0].story_design.choices[0].stake, '同事也需要回家')
    assert.equal(isSceneStoryDesign({ authorConfirmed: true }), false)
    const promptText = captures[0].messages.map((message) => message.content).join('\n')
    assert.match(promptText, /story_design/)
    assert.match(promptText, /登记约定.*确认来源未知/)
    assert.match(promptText, /不要求每场都有冲突/)
    const report = { task: 'RF-09', status: 'PASS', isolatedPath, realProviderCalls: 0, loopbackCalls: captures.length,
      cases: { 'RF-09-01': 'PASS', 'RF-09-02': 'PASS', 'RF-09-03': 'PASS', 'RF-09-04': 'PASS' },
      projection, renderedProjection: formatRecentStoryDesignProjection(projection), qualifiedOutput, quietOutput, writer, repeatedFailure, badFailure,
      staleFailure, snapshotRoundTrip: true, sourceRowsUnchangedByPlanner: true, requests: captures,
      limitations: ['No real provider, browser or reader test', 'Detection uses declared fields and exact structural/evidence matches; not universal semantic detection'] }
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'integration-capture.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ status: report.status, cases: report.cases, loopbackCalls: captures.length, isolatedPath }))
    closeDb()
    await new Promise((resolve) => server.close(resolve))
    app.exit(0)
  } catch (error) { console.error(error); closeDb(); server.close(); app.exit(1) }
})
