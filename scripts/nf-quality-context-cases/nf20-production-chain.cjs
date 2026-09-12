'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const scenePlan = [{
  scene_order: 1, scene_title: '账房', purpose: '确认账目差异', location: '账房', time_anchor: '当夜',
  present_characters: ['主角'], key_items: ['账本'], conflict: '账目被篡改', beat: '核对账页并锁定缺口',
  must_cover: ['找到可追查线索'], climax_variant: '证据反转', exit_hook: '缺失账页指向内鬼',
  hidden_agendas: ['管事隐瞒账页去向'], irony_gap: '主角发现了账目的破绽', audience: '主角与管事',
}]

function chapterText(chapterNum) {
  return `门外响起落锁声，主角抓起第${chapterNum}册账本，退到灯下。管事挡住门口，伸手要抢账页：“今晚查不清，你就别想出去。”主角按住被涂改的数字，将灯挪近，先看清了纸角的新折痕。

“这笔钱是谁领走的？”他把收据推到管事面前。

管事拒绝接过收据，反倒伸手去拨灯芯。“天亮再查。仓门已经落锁，你拿不到存根。”

主角挡住他的手，从袖中取出白天留下的拓印。拓印上的数目与账本不同，日期却一模一样。他逐项核对账页，确认账目差异，终于找到可追查线索：最后一笔支出下面还压着半个指印。

“账目被篡改了。”主角将两张纸并在一起，“你说没有存根，这半页又从哪里来？”

管事后退了一步，碰翻椅子。主角追到桌边，抓住他的衣袖，却被袖口的铜扣划破手指。血落在纸上，他赶紧松手，用干净布角裹住伤口。管事趁机抓起门边的钥匙，拧开铜锁。

门外传来脚步声。管事带走钥匙，决定离开账房，把查账的责任留给主角。主角没有追出去，先撕下被血浸湿的空白边，留下拓印和账页的接缝。他失去了当面对质的机会，却保住了可以核查的证据。

灯下，缺失账页的边缘露出一笔细小的签押。签押来自只有内院经手人才能使用的印章，缺失账页指向内鬼。他把两张纸折入衣襟，听见走廊尽头有人低声叫出了管事的名字。`
}

function responseFor(task, prompt, chapterNum, characterId) {
  if (task?.pipeline_role === 'planner') return JSON.stringify(scenePlan)
  if (task?.pipeline_role === 'writer' || task?.pipeline_role === 'rewriter') return chapterText(chapterNum)
  if (task?.pipeline_role === 'critic') return JSON.stringify({ summary: '账页差异有实物证据，受伤与失去对质机会构成代价，末尾留下可追查签押。', severity: 'low', rewrite_required: false, strengths: ['核对账页并保留证据'], protagonist_setback: 'minor', setback_summary: '管事离开，失去对质机会', cost_present: true, cost_summary: '手指受伤', pace_marker: 'progression', reward_state: 'partial', protagonist_pressure: 45 })
  if (prompt.includes('你是小说审校复核员')) return JSON.stringify({ step_memory_risks: [], opening_hook_risks: [], coherence_risks: [], reader_hook_risks: [], resolved_risks: [] })
  if (prompt.includes('你是 NovelForge 的章节语义验收员')) {
    const dimensions = prompt.match(/"dimension": "([^"]+)"/)[1].split('|')
    return JSON.stringify({ verdicts: dimensions.map((dimension) => ({ dimension, status: 'pass', summary: '本章账页证据与对质行动相互衔接。', evidence: [{ excerpt: '他失去了当面对质的机会，却保住了可以核查的证据。', explanation: '对质失败但保住证据，行动有代价和后果。' }] })) })
  }
  if (prompt.includes('你是小说 Canonizer')) return JSON.stringify({ extracts: [{ assetType: 'thread', sourceText: '缺失账页指向内鬼', confidence: 0.95, fact: { title: `第${chapterNum}册签押`, summary: '追查签押的经手人' } }], diffs: [{ assetType: 'thread', entityType: 'story-thread', diffReason: '账页揭示可追查签押', confidence: 0.95, afterState: { title: `第${chapterNum}册签押`, summary: '追查签押的经手人', status: 'planned', priority: 'medium', relatedCharacterIds: [characterId] } }] })
  if (prompt.includes('"chapterFacts"')) return JSON.stringify({ chapterFacts: '主角核对账本并发现签押', characterStates: '主角手指受伤，管事离开', threadForeshadow: '追查签押经手人' })
  if (task?.type === 'summary') return JSON.stringify({ summary: `第${chapterNum}册账页出现涂改与签押，主角保住纸证，管事离开。`, nextChapterSeed: '追查签押的经手人' })
  if (task?.type === 'continuity') return JSON.stringify({ plotProgress: ['账目差异已确认'], openLoops: ['追查签押'], characterStates: [], worldStates: [] })
  if (prompt.includes('"characters"') && prompt.includes('"items"')) return JSON.stringify({ characters: [], items: [] })
  throw new Error(`NF20_UNSCRIPTED_PRODUCTION_REQUEST: ${task?.type}/${task?.pipeline_role} ${prompt.slice(0, 180)}`)
}

async function verifyProductionChain(input, stub, loadTypeScriptModule, seedProductionProbe) {
  const sqlite = input.database.getSqlite()
  const route = '/nf20-production-chain/v1'
  const seeded = seedProductionProbe(sqlite, `${stub.getBaseUrl()}${route}`, `${input.databaseMode}-chain`)
  const chapterService = loadTypeScriptModule('electron/services/chapter.service.ts')
  const characterId = Number(sqlite.prepare("INSERT INTO characters (novel_id, full_name, role_type) VALUES (?, '管事', 'minor')").run(seeded.novelId).lastInsertRowid)
  chapterService.updateChapter(seeded.chapterId, { title: '账页上的签押' })
  loadTypeScriptModule('electron/services/story-structure.service.ts').ensureStoryStructure(seeded.novelId)
  const requests = []
  let currentChapterNum = 1
  stub.register(`${route}/chat/completions`, (request) => {
    const body = JSON.parse(request.body)
    const task = sqlite.prepare("SELECT id, type, pipeline_role FROM tasks WHERE novel_id = ? AND status = 'running' AND runner_type IN ('chat', 'stream') ORDER BY id DESC LIMIT 1").get(seeded.novelId)
    const prompt = body.messages.map((message) => message.content).join('\n')
    const includesPrevious = currentChapterNum === 1 || prompt.includes(`第${currentChapterNum - 1}册`)
    if (task?.pipeline_role === 'writer') assert.ok(includesPrevious, 'Writer must receive the prior persisted chapter or summary')
    requests.push({ chapterNum: currentChapterNum, task, includesPrevious, promptPreview: prompt.slice(0, 500) })
    const content = responseFor(task, prompt, currentChapterNum, characterId)
    if (body.stream) return { statusCode: 200, headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 200 } })}\n\ndata: [DONE]\n\n` }
    return { statusCode: 200, body: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 200 } } }
  })
  stub.register(`${route}/embeddings`, (request) => {
    const body = JSON.parse(request.body)
    return { statusCode: 200, body: { data: (Array.isArray(body.input) ? body.input : [body.input]).map((_, index) => ({ index, embedding: [1, 0, 1] })), usage: { prompt_tokens: 12, total_tokens: 12 } } }
  })
  const chapterReports = []
  for (currentChapterNum = 1; currentChapterNum <= 10; currentChapterNum += 1) {
    const chapterId = currentChapterNum === 1 ? seeded.chapterId : seedNextChapter(sqlite, seeded.novelId, currentChapterNum)
    loadTypeScriptModule('electron/services/story-structure.service.ts').ensureStoryStructure(seeded.novelId)
    let failure
    let rootTaskId
    try { rootTaskId = await chapterService.generateChapterContent(chapterId, undefined, { totalBudget: 32000 }) } catch (error) { failure = error.message }
    const tasks = sqlite.prepare('SELECT id, type, status, pipeline_role, progress_json, error_message FROM tasks WHERE novel_id = ? AND related_entity_id = ? ORDER BY id').all(seeded.novelId, chapterId)
    const chapter = sqlite.prepare('SELECT content, summary, status, review_notes_json FROM chapters WHERE id = ?').get(chapterId)
    const publishCheck = chapterService.runChapterPublishCheck(chapterId, { phase: 'pipeline' })
    chapterReports.push({ chapterNum: currentChapterNum, chapterId, rootTaskId, failure, tasks, chapter, publishCheck })
    fs.writeFileSync(path.join(input.evidenceDirectory, `production-chain-${input.databaseMode}.json`), JSON.stringify({ seeded, requests, chapterReports }, null, 2))
    assert.equal(failure, undefined, `production chapter ${currentChapterNum} failed: ${failure}`)
    assert.equal(tasks.find((task) => task.id === rootTaskId).status, 'success')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM canon_commits WHERE novel_id = ?').get(seeded.novelId).n, currentChapterNum - 1, 'generation must not accept Canon on behalf of the author')
    const run = sqlite.prepare('SELECT id FROM chapter_writeback_runs WHERE chapter_id = ? ORDER BY id DESC LIMIT 1').get(chapterId)
    assert.ok(run)
    await input.writeback.bulkUpdateChapterWritebackDecisions(run.id, { canonDecision: 'accepted' })
    const options = { idempotencyKey: `nf20-production:${input.databaseMode}:${chapterId}` }
    const applied = await input.writeback.applyChapterWritebackRun(run.id, options)
    chapterReports.at(-1).writeback = applied
    fs.writeFileSync(path.join(input.evidenceDirectory, `production-chain-${input.databaseMode}.json`), JSON.stringify({ seeded, requests, chapterReports }, null, 2))
    assert.equal(applied.activeRun.status, 'applied')
    const commits = sqlite.prepare('SELECT COUNT(*) AS n FROM canon_commits WHERE novel_id = ?').get(seeded.novelId).n
    const outbox = sqlite.prepare('SELECT COUNT(*) AS n FROM semantic_memory_outbox WHERE novel_id = ?').get(seeded.novelId).n
    await input.writeback.applyChapterWritebackRun(run.id, options)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM canon_commits WHERE novel_id = ?').get(seeded.novelId).n, commits)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM semantic_memory_outbox WHERE novel_id = ?').get(seeded.novelId).n, outbox)
    assert.equal(commits, currentChapterNum)
  }
  return { chapters: chapterReports.length, rootTaskIds: chapterReports.map((chapter) => chapter.rootTaskId), requests: requests.length, totalBudget: 32000, manualCanonCommits: 10 }
}

function seedNextChapter(sqlite, novelId, chapterNum) {
  const chapterId = Number(sqlite.prepare("INSERT INTO chapters (novel_id, chapter_num, title, content, status, target_words, context_version) VALUES (?, ?, '账页上的签押', '', 'draft', 1200, (SELECT context_version FROM novels WHERE id = ?))").run(novelId, chapterNum, novelId).lastInsertRowid)
  sqlite.prepare("INSERT INTO chapter_contracts (novel_id, chapter_id, chapter_goal, opening_style, status) VALUES (?, ?, '确认账目差异', '直接核对账页', 'ready')").run(novelId, chapterId)
  const segmentId = Number(sqlite.prepare("INSERT INTO chapter_segments (novel_id, chapter_id, segment_order, title, purpose, output_state, status) VALUES (?, ?, 1, '账房', '确认账目差异', '找到可追查线索', 'planned')").run(novelId, chapterId).lastInsertRowid)
  sqlite.prepare("INSERT INTO scene_contracts (novel_id, chapter_id, segment_id, pov, scene_goal, obstacle, result_state, status) VALUES (?, ?, ?, '主角', '确认账目差异', '账目被篡改', '找到可追查线索', 'ready')").run(novelId, chapterId, segmentId)
  return chapterId
}

module.exports = { verifyProductionChain }
