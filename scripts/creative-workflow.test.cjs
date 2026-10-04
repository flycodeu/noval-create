const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(root, '.tmp-tests', 'creative-'))
const realModelSource = process.env.NOVELFORGE_REAL_MODEL_SOURCE
if (realModelSource) {
  const stateFile = path.join(path.dirname(realModelSource), 'Local State')
  if (fs.existsSync(stateFile)) {
    const { os_crypt } = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    if (os_crypt) fs.writeFileSync(path.join(temp, 'Local State'), JSON.stringify({ os_crypt }))
  }
}
app.setPath('userData', temp)
app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
const replies = []
const requests = []
const review = JSON.stringify({ summary: '候选符合需求，引用和剧情一致。', severity: 'low', rewrite_required: false, reject_required: false, top_fixes: [], issues: [] })
let heldResponse
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  requests.push(JSON.parse(body))
  const next = replies.shift()
  if (next === 'HOLD') { heldResponse = res; return }
  if (typeof next !== 'string') { res.writeHead(500).end('unexpected model call'); return }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ id: `fixture-${requests.length}`, choices: [{ index: 0, message: { role: 'assistant', content: next }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }))
})
async function main() {
  await app.whenReady()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { initDb, closeDb, getSqlite } = require('../electron/database/db.ts')
  initDb()
  const sqlite = getSqlite()
  const model = require('../electron/services/model.service.ts')
  const embedding = require('../electron/services/embedding.service.ts')
  // This fixture exercises immediate write-after-save indexing, not remote vector providers.
  // Keep optional vector traffic out of the generation/review reply queue.
  if (!realModelSource) embedding.scheduleChapterEmbeddingRefresh = embedding.indexChapterForKeywordRecall
  const { novelForgeToolRegistry: registry } = require('../electron/application/novelforge-tool-registry.ts')
  const { DESKTOP_AGENT_TOOL_SCOPES } = require('../src/shared/tool-contracts/index.ts')
  const context = { actor: { type: 'api_client', actorId: 'fixture', clientId: 'fixture' }, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] }
  let modelId
  if (realModelSource) {
    const Database = require('better-sqlite3')
    const source = new Database(realModelSource, { readonly: true })
    const config = source.prepare('SELECT * FROM model_configs WHERE is_default=1 ORDER BY id LIMIT 1').get()
    source.close()
    assert.ok(config, 'No configured default model')
    assert.ok(model.decryptApiKey(config.api_key), 'Isolated runtime cannot decrypt the configured model key')
    const { id, ...fields } = config
    const columns = Object.keys(fields).filter(key => /^[a-z_]+$/.test(key))
    modelId = Number(sqlite.prepare(`INSERT INTO model_configs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(key => fields[key])).lastInsertRowid)
  } else {
    modelId = Number(sqlite.prepare('INSERT INTO model_configs(name,provider,model_id,api_key,base_url,max_tokens,max_context_tokens,is_default) VALUES(?,?,?,?,?,?,?,1)').run('Loopback fixture', 'openai', 'creative-fixture', model.encryptApiKey('fixture-only'), `http://127.0.0.1:${server.address().port}/v1`, 4000, 32000).lastInsertRowid)
  }
  const novelId = Number(sqlite.prepare('INSERT INTO novels(title,user_background,model_config_id,context_version) VALUES(?,?,?,1)').run('河谷试验', '两个人在河谷经营渡口。', modelId).lastInsertRowid)
  const call = async (name, input) => {
    const result = await registry.invoke({ toolId: `novelforge.${name}`, input: name === 'artifacts.get' ? { artifactId: input.artifactId } : { novelId, ...input } }, context)
    assert.equal(result.ok, true, JSON.stringify(result)); return result.data
  }
  const finish = async runId => {
    for (let i = 0; i < 200; i++) {
      const { run } = await call('workflows.get', { runId })
      if (!['pending', 'running', 'cancel_requested'].includes(run.status)) return run
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error('workflow timed out')
  }
  try {
    const { validateProjectAsset } = require('../electron/services/creative-project-assets.ts')
    assert.throws(() => validateProjectAsset('world_rules', { worldRules: { timelineConfig: { currentTimeLabel: '第一日夜晚' } } }), /对应章序和时间依据/)
    validateProjectAsset('world_rules', { worldRules: { timelineConfig: { currentTimeLabel: '第一日夜晚', currentTimeChapterNum: 1, currentTimeEvidence: '第一章天色已暗。' } } })
    if (realModelSource) {
      const { run } = await call('workflows.start', { stage: 'map', request: '为河谷渡口故事新增一处河谷区域及其下属一个渡口村庄，区域为根，村庄parentId引用区域clientId。给出合理的地形、水源、生计、相对坐标；只需2个地点，不生成人物和其他资料。', count: 2, idempotencyKey: 'real-map-smoke' })
      let lastStep = ''
      for (let i = 0; i < 240; i++) {
        const state = (await call('workflows.get', { runId: run.runId })).run
        if (state.step !== lastStep) { process.stdout.write(`Real model stage: ${state.step}\n`); lastStep = state.step }
        if (!['pending', 'running', 'cancel_requested'].includes(state.status)) {
          assert.equal(state.status, 'success', `Real model run: ${state.message}`)
          const data = (await call('atlas.query', {})).atlas
          assert.equal(data.entities.length, 2)
          assert.ok(data.entities.some(entity => entity.parentId))
          process.stdout.write(`PASS real configured model: generate -> independent review -> apply -> query; ${data.entities.length} locations, context v${data.contextVersion}. User database unchanged.\n`)
          return
        }
        await new Promise(resolve => setTimeout(resolve, 2500))
      }
      await call('workflows.cancel', { runId: run.runId })
      throw new Error('Real model smoke timed out')
    }
    const creation = { title: '无默认设定', background: '两岸靠渡船往来。', constraints: '主角是凡人。', modelConfigId: modelId, idempotencyKey: 'create-from-author' }
    const created = await registry.invoke({ toolId: 'novelforge.projects.create', input: creation }, context)
    assert.equal(created.ok, true, JSON.stringify(created))
    assert.equal(created.data.source.constraints, '主角是凡人。')
    assert.deepEqual(JSON.parse(created.data.project.worldRulesJson).powerSystems, [], 'project creation must not confirm a genre template')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM characters WHERE novel_id=?').get(created.data.project.id).count, 0)
    assert.equal((await registry.invoke({ toolId: 'novelforge.projects.create', input: creation }, context)).data.project.id, created.data.project.id)
    sqlite.prepare('UPDATE novels SET world_rules_json=?,settings_json=?,theme_voice_json=?,project_brief_json=? WHERE id=?').run(
      JSON.stringify({ version: 2, writingConstraints: { extraRules: ['已有规则'], hiddenRule: '保留' }, customWorld: '保留' }),
      JSON.stringify({ customSetting: '保留', ai_engine: { default_mode: 'balanced', privateFlag: true }, writing_rules: { banned_terms: '禁用系统面板', hiddenRule: '保留' }, story_design: { story_goal: '经营渡口', hiddenStory: '保留' }, premise: { constraints: '不得获得异能' } }),
      JSON.stringify({ pov: 'third_limited', style_rules: '写具体行动', customStyle: '保留' }), JSON.stringify({ target_reader: '喜欢普通人生计故事的读者', customBrief: '保留' }), novelId)
    const generationOffset = requests.length
    replies.push(JSON.stringify({ worldRules: { writingConstraints: { extraRules: ['渡船只能载六人'], sciencePolicy: '遵守常识' } } }), review)
    const rules = (await call('workflows.start', { stage: 'world_rules', request: '补充渡船限制。', idempotencyKey: 'world-rules-patch' })).run
    assert.equal((await finish(rules.runId)).status, 'success')
    const world = JSON.parse(sqlite.prepare('SELECT world_rules_json AS value FROM novels WHERE id=?').get(novelId).value)
    assert.deepEqual(world.writingConstraints.extraRules, ['已有规则', '渡船只能载六人'])
    assert.equal(world.writingConstraints.hiddenRule, '保留'); assert.equal(world.customWorld, '保留')
    replies.push(JSON.stringify({ storyDesign: { coreConflict: '两岸争用渡船' }, writingRules: { commonSenseRules: '行程必须计入渡船停航的时间' }, projectBrief: { readerPromise: '通过人物的选择呈现渡口生计' } }), review)
    assert.equal((await finish((await call('workflows.start', { stage: 'story', request: '补充主冲突，保留目标。', idempotencyKey: 'story-patch' })).run.runId)).status, 'success')
    const settings = JSON.parse(sqlite.prepare('SELECT settings_json AS value FROM novels WHERE id=?').get(novelId).value)
    assert.equal(settings.story_design.story_goal, '经营渡口'); assert.equal(settings.story_design.core_conflict, '两岸争用渡船')
    assert.equal(settings.story_design.hiddenStory, '保留'); assert.equal(settings.customSetting, '保留'); assert.equal(settings.ai_engine.privateFlag, true)
    assert.equal(settings.writing_rules.common_sense_rules, '行程必须计入渡船停航的时间')
    assert.equal(settings.writing_rules.banned_terms, '禁用系统面板'); assert.equal(settings.writing_rules.hiddenRule, '保留')
    const brief = JSON.parse(sqlite.prepare('SELECT project_brief_json AS value FROM novels WHERE id=?').get(novelId).value)
    assert.equal(brief.reader_promise, '通过人物的选择呈现渡口生计'); assert.equal(brief.target_reader, '喜欢普通人生计故事的读者'); assert.equal(brief.customBrief, '保留')
    replies.push(JSON.stringify({ themeVoice: { dialogueRules: '对话简短' } }), review)
    assert.equal((await finish((await call('workflows.start', { stage: 'style', request: '补充对话要求。', idempotencyKey: 'style-patch' })).run.runId)).status, 'success')
    const voice = JSON.parse(sqlite.prepare('SELECT theme_voice_json AS value FROM novels WHERE id=?').get(novelId).value)
    assert.equal(voice.pov, 'third_limited'); assert.equal(voice.style_rules, '写具体行动'); assert.equal(voice.dialogue_rules, '对话简短'); assert.equal(voice.customStyle, '保留')
    assert.equal(requests.length, generationOffset + 6)
    replies.push(JSON.stringify({ synopsis: '两人守着一条渡船，在两岸争执中维持渡口。' }), review)
    assert.equal((await finish((await call('workflows.start', { stage: 'background', request: '只完善面向读者的简介，保留背景和书名。', idempotencyKey: 'synopsis-patch' })).run.runId)).status, 'success')
    assert.deepEqual(sqlite.prepare('SELECT title,user_background AS background,synopsis FROM novels WHERE id=?').get(novelId), { title: '河谷试验', background: '两个人在河谷经营渡口。', synopsis: '两人守着一条渡船，在两岸争执中维持渡口。' })
    const beforeCharacters = requests.length
    const candidate = { changes: [{ op: 'upsert_entity', clientId: 'a', kind: 'character', name: '陈舟', summary: '渡口船工', attributes: { personalityTraits: ['遇事先检查绳索'], speechPattern: '短句' } }, { op: 'upsert_entity', clientId: 'b', kind: 'character', name: '林禾', summary: '渡口记账人' }, { op: 'upsert_relation', kind: 'relationship', fromId: 'a', toId: 'b', label: '共同经营渡口' }] }
    replies.push(JSON.stringify(candidate), review)
    const startInput = { stage: 'characters', request: '生成两个人物与合作关系。', count: 2, idempotencyKey: 'characters-first' }
    const { run: started } = await call('workflows.start', startInput)
    assert.equal(started.status, 'pending', 'start must return before model completion')
    const done = await finish(started.runId)
    assert.equal(done.status, 'success', JSON.stringify(done))
    assert.equal(requests.length, beforeCharacters + 2, 'generation and review are separate requests')
    const snapshot = (await call('atlas.query', {})).atlas
    assert.equal(snapshot.entities.filter(x => x.kind === 'character').length, 2)
    assert.equal(snapshot.relations.length, 1)
    const savedEntityIndex = entities => Object.fromEntries(entities.map(({ id, kind, name }) => [id, { kind, name }]))
    assert.deepEqual(savedEntityIndex(done.result.savedEntities), savedEntityIndex(snapshot.entities), 'completed runs show committed entity names, independent of query ordering')
    assert.equal(done.result.savedEntities.length, 2, 'a saved relationship must not inflate the entity name list')
    assert.equal((await call('workflows.start', startInput)).run.runId, started.runId)
    assert.equal(requests.length, beforeCharacters + 2, 'idempotent start does not call model again')
    const characterList = (await call('characters.list', {})).characters
    assert.equal(characterList[0].id, snapshot.entities.find(entity => entity.name === characterList[0].fullName).id, 'MCP character reads share the atlas stable identity')
    assert.equal(typeof characterList[0].nativeId, 'number')
    assert.ok(characterList.find(entity => entity.fullName === '陈舟').attributes.personalityTraits.includes('遇事先检查绳索'))
    await call('workflows.apply', { runId: started.runId })
    assert.equal((await call('atlas.query', {})).atlas.entities.length, 2)
    sqlite.prepare('UPDATE tasks SET status=?, progress_json=json_set(progress_json,\'$.status\',?) WHERE id=?').run('failed', 'failed', started.runId)
    assert.equal((await call('workflows.resume', { runId: started.runId })).run.status, 'success', 'recover applied run without replaying writes or stale progress overriding persisted status')

    replies.push(JSON.stringify({ changes: [{ op: 'upsert_entity', kind: 'character', name: '周行', summary: '新到的摆渡人' }] }), review)
    const next = (await call('workflows.start', { stage: 'characters', request: '再增加一名摆渡人，保留已有角色。', count: 1, idempotencyKey: 'characters-second' })).run
    assert.equal((await finish(next.runId)).status, 'success')
    assert.equal((await call('atlas.query', {})).atlas.entities.length, 3)

    // A prose run must never commit a hidden outline before its own result exists.
    const prose = '陈舟解开旧绳，把磨断的一截放在岸上。林禾抱来一捆新绳，两人把船重新系住。河水擦着木桩过去，渡船终于停稳。'
    const firstReadiness = await call('chapters.readiness', { atChapter: 1 })
    assert.equal(firstReadiness.ready, false)
    assert.equal(firstReadiness.nextStage, 'outline')
    const beforeFirst = requests.length
    const beforeFirstTasks = sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE related_entity_type='creative_workflow' AND novel_id=?").get(novelId).count
    const blockedFirst = await registry.invoke({ toolId: 'novelforge.workflows.start', input: { novelId, stage: 'chapter', request: '写换绳的短场景。', atChapter: 1, autoApply: true, idempotencyKey: 'chapter-unprepared' } }, context)
    assert.equal(blockedFirst.ok, false)
    assert.match(blockedFirst.error.message, /先生成并应用本章的大纲与场景安排/)
    assert.equal(requests.length, beforeFirst, 'blocked prose never calls the model')
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM chapters WHERE novel_id=?').get(novelId).count, 0, 'blocked prose never creates an outline')
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM tasks WHERE related_entity_type='creative_workflow' AND novel_id=?").get(novelId).count, beforeFirstTasks, 'preflight does not create a failed workflow')
    replies.push(JSON.stringify({ chapters: [{ chapterNum: 1, title: '换绳', outline: '陈舟检查并更换系船绳。', chapterContract: { chapterGoal: '陈舟检查并更换系船绳' }, scenes: [{ pov: '陈舟', timeLocation: '清晨，渡口', sceneGoal: '检查系船绳', obstacle: '旧绳磨断', resultState: '渡船停稳', revealPayload: [] }], allowedFactIds: [], revealedFactIds: [] }] }), review)
    const firstOutline = await finish((await call('workflows.start', { stage: 'outline', request: '安排第1章换绳。', atChapter: 1, count: 1, idempotencyKey: 'chapter-first-outline' })).run.runId)
    assert.equal(firstOutline.status, 'success', JSON.stringify(firstOutline))
    assert.equal((await call('chapters.readiness', { atChapter: 1 })).ready, true)
    replies.push(JSON.stringify({ chapterNum: 1, title: '换绳', content: prose, summary: '陈舟与林禾换上新绳，渡船停稳。', changes: [] }), review)
    const writing = (await call('workflows.start', { stage: 'chapter', request: '写陈舟和林禾检查旧绳并将船重新系稳的短场景。', atChapter: 1, idempotencyKey: 'chapter-first' })).run
    const written = await finish(writing.runId)
    assert.equal(written.status, 'success', JSON.stringify(written))
    assert.equal(requests.length, beforeFirst + 4, 'outline and prose have separate generation and review requests')
    const chapter = sqlite.prepare('SELECT content, summary FROM chapters WHERE novel_id=? AND chapter_num=1').get(novelId)
    assert.equal(chapter.content, prose)
    assert.equal(chapter.summary, '陈舟与林禾换上新绳，渡船停稳。', 'content invalidation must not erase the new reviewed summary')

    const firstChapterId = sqlite.prepare('SELECT id FROM chapters WHERE novel_id=? AND chapter_num=1').get(novelId).id
    assert.ok(sqlite.prepare("SELECT count(*) AS n FROM chapter_embeddings WHERE chapter_id=? AND fragment_type='content_excerpt'").get(firstChapterId).n > 0, 'MCP prose apply must save a searchable prose index')
    const beforeReview = requests.length
    replies.push(review)
    const reviewRun = (await call('chapters.review', { chapterId: firstChapterId, idempotencyKey: 'review-existing-chapter' })).run
    assert.equal(reviewRun.operation, 'review'); assert.equal(reviewRun.atChapter, 1)
    const reviewed = await finish(reviewRun.runId)
    assert.equal(reviewed.status, 'success', JSON.stringify(reviewed))
    assert.equal(reviewed.reviewStatus, 'passed')
    assert.equal(requests.length, beforeReview + 1, 'review does not regenerate or rewrite')
    assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id=?').get(firstChapterId).content, prose)
    assert.equal((await registry.invoke({ toolId: 'novelforge.workflows.apply', input: { novelId, runId: reviewed.runId } }, context)).ok, false, 'a report is not an applicable prose candidate')

    // Draft contracts require a separate reviewed outline run; the prose run cannot promote them.
    const secondId = Number(sqlite.prepare('INSERT INTO chapters(novel_id,chapter_num,title,outline) VALUES(?,2,?,?)').run(novelId, '加固', '再次检查新绳是否牢固。').lastInsertRowid)
    sqlite.prepare("INSERT INTO chapter_contracts(novel_id,chapter_id,chapter_goal,status) VALUES(?,?,?,'draft')").run(novelId, secondId, '陈舟检查并更换系船绳')
    sqlite.prepare("INSERT INTO scene_contracts(novel_id,chapter_id,pov,time_location,scene_goal,obstacle,result_state,status) VALUES(?,?,?,?,?,?,?,'draft')").run(novelId, secondId, '陈舟', '清晨，渡口', '检查系船绳', '旧绳磨断', '渡船停稳')
    const beforeSecond = requests.length
    assert.equal((await call('chapters.readiness', { atChapter: 2 })).ready, false)
    const blockedSecond = await registry.invoke({ toolId: 'novelforge.workflows.start', input: { novelId, stage: 'chapter', request: '继续检查渡船。', atChapter: 2, autoApply: true, idempotencyKey: 'chapter-draft-contract-blocked' } }, context)
    assert.equal(blockedSecond.ok, false)
    assert.equal(requests.length, beforeSecond)
    assert.equal(sqlite.prepare('SELECT status FROM chapter_contracts WHERE chapter_id=?').get(secondId).status, 'draft')
    replies.push(JSON.stringify({ chapters: [{ id: secondId, chapterNum: 2, title: '加固', outline: '陈舟检查并更换系船绳。', chapterContract: { chapterGoal: '陈舟检查并更换系船绳' }, scenes: [{ pov: '陈舟', timeLocation: '清晨，渡口', sceneGoal: '检查系船绳', obstacle: '旧绳磨断', resultState: '渡船停稳', revealPayload: [] }], allowedFactIds: [], revealedFactIds: [] }] }), review)
    const secondOutline = await finish((await call('workflows.start', { stage: 'outline', request: '仅补齐第2章安排。', atChapter: 2, count: 1, changeScope: { chapterIds: [secondId] }, idempotencyKey: 'chapter-second-outline' })).run.runId)
    assert.equal(secondOutline.status, 'success', JSON.stringify(secondOutline))
    assert.equal((await call('chapters.readiness', { atChapter: 2 })).ready, true)
    replies.push(JSON.stringify({ chapterNum: 2, title: '加固', content: prose, summary: '陈舟与林禾检查绳结，渡船停稳。', changes: [] }), review)
    const second = (await call('workflows.start', { stage: 'chapter', request: '继续检查渡船。', atChapter: 2, idempotencyKey: 'chapter-draft-contract' })).run
    const secondDone = await finish(second.runId)
    assert.equal(secondDone.status, 'success', JSON.stringify(secondDone))
    assert.equal(requests.length, beforeSecond + 4, 'outline and prose remain separately reviewed')
    assert.equal(sqlite.prepare('SELECT status FROM chapter_contracts WHERE chapter_id=?').get(secondId).status, 'ready')
    const queriedChapter = await call('assets.query', { chapterId: secondId })
    assert.equal(queriedChapter.chapter.id, secondId)
    assert.equal(queriedChapter.chapterContract.chapterGoal, '陈舟检查并更换系船绳')
    assert.equal(queriedChapter.scenes.length, 1, 'external agents receive the real executable scene contract without the old orphan')

    replies.push(JSON.stringify({ volumes: [{ clientId: 'volume-river', title: '渡河', summary: '渡口的共同行动', parts: [{ clientId: 'part-rope', title: '系船', summary: '从旧绳到新绳' }] }],
      chapters: [{ chapterNum: 3, volumeId: 'volume-river', partId: 'part-rope', title: '查绳', outline: '陈舟检查并更换系船绳。',
        chapterContract: { chapterGoal: '陈舟检查并更换系船绳', forbiddenActions: ['不得出现异能'] },
        scenes: [{ pov: '陈舟', timeLocation: '清晨，渡口', sceneGoal: '检查系船绳', obstacle: '旧绳磨断', resultState: '渡船停稳', revealPayload: [] }] }] }), review)
    const outlined = await finish((await call('workflows.start', { stage: 'outline', atChapter: 3, count: 1, request: '新建渡河卷及系船单元，安排第3章。', idempotencyKey: 'outline-volumes-parts' })).run.runId)
    assert.equal(outlined.status, 'success', JSON.stringify(outlined)); assert.equal(outlined.atChapter, 3); assert.equal(outlined.count, 1)
    const structure = await call('assets.query', {})
    const plannedThird = structure.chapters.find(row => row.chapterNum === 3)
    const plannedPart = structure.parts.find(row => row.id === plannedThird.partId)
    assert.equal(plannedPart.volumeId, plannedThird.volumeId)
    assert.equal(structure.volumes.find(row => row.id === plannedThird.volumeId).title, '渡河')
    assert.equal((await call('assets.query', { chapterId: plannedThird.id })).chapterContract.forbiddenActions[0], '不得出现异能')

    // Machine contract failures are repaired before semantic review; a still-invalid repair
    // stays blocked and a later Resume must generate a new reviewed candidate.
    const malformedRules = JSON.stringify({ worldRules: { writingConstraints: { extraRules: '不是数组' } } })
    replies.push(malformedRules, malformedRules)
    const invalidRules = (await call('workflows.start', { stage: 'world_rules', request: '补充载货限制。', idempotencyKey: 'repair-structure-error' })).run
    const rejectedShape = await finish(invalidRules.runId)
    assert.equal(rejectedShape.status, 'blocked'); assert.equal(rejectedShape.reviewStatus, 'blocked')
    assert.ok(rejectedShape.artifactId)
    const blockedReport = (await call('artifacts.get', { artifactId: rejectedShape.reviewArtifactId })).artifact.content
    assert.equal(blockedReport.modelReview.failureStage, 'contract')
    assert.equal(blockedReport.modelReview.initialModelReviewSkipped, true)
    const beforeRepair = requests.length
    replies.push(JSON.stringify({ worldRules: { writingConstraints: { extraRules: ['木桩不能承担船身重量'] } } }), review)
    await call('workflows.resume', { runId: invalidRules.runId })
    assert.equal((await finish(invalidRules.runId)).status, 'success')
    assert.equal(requests.length, beforeRepair + 2)
    assert.ok(JSON.stringify(requests[beforeRepair]).includes('上一候选未能应用'))
    assert.ok(JSON.stringify(requests[beforeRepair]).includes('不是数组'), 'repair receives the prior candidate as a budgeted source')
    const sourceRules = (await call('workflows.get', { runId: invalidRules.runId })).run
    // Reproduce the real fourth-chapter unsupported-field failure: the valid repair is
    // checked by the strict creative schema before the independent model recheck.
    const repairedOutline = { chapters: [{ id: plannedThird.id, chapterNum: 3, title: '查绳', outline: '陈舟检查并更换系船绳。',
      chapterContract: { chapterGoal: '陈舟检查并更换系船绳' },
      scenes: [{ pov: '陈舟', timeLocation: '清晨，渡口', sceneGoal: '检查系船绳', obstacle: '旧绳磨断', resultState: '渡船停稳' }] }] }
    const invalidOutline = structuredClone(repairedOutline)
    invalidOutline.chapters[0].chapterContract.targetWords = 3200
    invalidOutline.chapters[0].scenes[0].action = '检查并换绳'
    invalidOutline.chapters[0].scenes[0].limitedResult = '渡船停稳'
    const beforeSchemaRepair = requests.length
    replies.push(JSON.stringify(invalidOutline), JSON.stringify(repairedOutline), review)
    const repairedSchemaRun = await finish((await call('workflows.start', { stage: 'outline', request: '只修订第三章场景安排，保留章名和大纲。', atChapter: 3, autoApply: false, changeScope: { chapterIds: [plannedThird.id] }, idempotencyKey: 'outline-machine-field-repair' })).run.runId)
    assert.equal(repairedSchemaRun.status, 'paused', JSON.stringify(repairedSchemaRun))
    assert.equal(requests.length, beforeSchemaRepair + 3, 'invalid initial schema skips model review, then repairs and rechecks')
    assert.ok(JSON.stringify(requests[beforeSchemaRepair + 1]).includes('targetWords'))
    const repairedSchemaReport = (await call('artifacts.get', { artifactId: repairedSchemaRun.reviewArtifactId })).artifact.content
    assert.equal(repairedSchemaReport.modelReview.initialModelReviewSkipped, true)
    assert.ok(repairedSchemaReport.modelReview.contractValidation.initialIssues.length)
    assert.deepEqual(repairedSchemaReport.modelReview.contractValidation.finalIssues, [])
    await call('workflows.apply', { runId: repairedSchemaRun.runId })
    replies.push(JSON.stringify({ worldRules: { writingConstraints: { extraRules: ['涨水时停航'] } } }), review)
    const followUp = (await call('workflows.start', { stage: 'world_rules', request: '保留有效规则并补充涨水停航。', sourceArtifactId: sourceRules.artifactId, autoApply: false, idempotencyKey: 'source-targeted-revision' })).run
    const revised = await finish(followUp.runId)
    assert.equal(revised.status, 'paused'); assert.equal(revised.sourceArtifactId, sourceRules.artifactId)
    const beforePausedResume = requests.length
    const versionBeforePausedResume = sqlite.prepare('SELECT context_version AS version FROM novels WHERE id=?').get(novelId).version
    assert.equal((await call('workflows.resume', { runId: revised.runId })).run.status, 'paused', 'Resume must not implicitly apply an author-review candidate')
    assert.equal(requests.length, beforePausedResume)
    assert.equal(sqlite.prepare('SELECT context_version AS version FROM novels WHERE id=?').get(novelId).version, versionBeforePausedResume)
    await call('workflows.apply', { runId: revised.runId })

    // Omitted position means the last written chapter for both preview and persisted generation.
    const inferred = { stage: 'items', request: '新增一只铜铃。', idempotencyKey: 'inferred-position' }
    const preview = (await call('context.preview', inferred)).context
    assert.ok(preview.text.includes('"atChapter":2'))
    replies.push(JSON.stringify({ changes: [{ op: 'upsert_entity', kind: 'item', name: '铜铃', summary: '装在渡口木桩上的铃' }] }), review)
    const positioned = (await call('workflows.start', inferred)).run
    assert.equal((await finish(positioned.runId)).status, 'success')
    assert.equal(JSON.parse(sqlite.prepare('SELECT input_json FROM tasks WHERE id=?').get(positioned.runId).input_json).request.atChapter, 2)
    assert.equal((await call('atlas.query', { atChapter: 0 })).atlas.entities.some(entity => entity.name === '铜铃'), false, 'new chapter-state fact must not be backdated to the baseline')
    assert.equal((await call('workflows.start', inferred)).run.runId, positioned.runId, 'original request remains the idempotency fingerprint')

    replies.push(JSON.stringify({ userBackground: '河谷两岸以渡口往来。' }), '{}')
    const invalid = (await call('workflows.start', { stage: 'background', request: '整理背景。', idempotencyKey: 'invalid-review' })).run
    assert.equal((await finish(invalid.runId)).status, 'blocked', 'empty review must never approve content')
    assert.equal(sqlite.prepare('SELECT user_background AS background FROM novels WHERE id=?').get(novelId).background, '两个人在河谷经营渡口。')

    const nextModelId = Number(sqlite.prepare('INSERT INTO model_configs(name,provider,model_id,api_key,base_url,max_tokens,max_context_tokens,is_default) SELECT ?,provider,?,api_key,base_url,max_tokens,max_context_tokens,0 FROM model_configs WHERE id=?').run('Next fixture model', 'next-fixture', modelId).lastInsertRowid)
    require('../electron/services/novel.service.ts').updateNovel(novelId, { modelConfigId: nextModelId })
    replies.push(JSON.stringify({ changes: [{ op: 'upsert_entity', kind: 'item', name: '渡船', summary: '运载过河的人与货物' }] }), review)
    const paused = (await call('workflows.start', { stage: 'items', request: '补充渡船。', autoApply: false, idempotencyKey: 'paused-item' })).run
    assert.equal((await finish(paused.runId)).status, 'paused')
    assert.equal(paused.modelConfigId, nextModelId, 'next workflow uses the model selected in the project UI')
    assert.equal(requests.at(-1).model, 'next-fixture')
    const version = sqlite.prepare('SELECT context_version AS version FROM novels WHERE id=?').get(novelId).version
    sqlite.prepare('UPDATE novels SET context_version=? WHERE id=?').run(version + 1, novelId)
    const stale = await registry.invoke({ toolId: 'novelforge.workflows.apply', input: { novelId, runId: paused.runId } }, context)
    assert.equal(stale.ok, false, 'stale candidate must not overwrite changes')
    assert.equal((await call('atlas.query', {})).atlas.entities.some(x => x.name === '渡船'), false)

    replies.push('HOLD')
    const cancellation = (await call('workflows.start', { stage: 'background', request: '取消测试。', idempotencyKey: 'cancel-test' })).run
    for (let i = 0; i < 100 && !heldResponse; i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(heldResponse)
    await call('workflows.cancel', { runId: cancellation.runId })
    assert.equal((await finish(cancellation.runId)).status, 'cancelled')
    replies.push(JSON.stringify({ userBackground: '河谷两岸靠渡船运送货物。' }), review)
    await call('workflows.resume', { runId: cancellation.runId })
    assert.equal((await finish(cancellation.runId)).status, 'success', 'cancelled task can resume with cleared cancellation and a new bounded attempt')

    // A passed author-review candidate can be cancelled; neither Resume nor direct service
    // access may silently save that cancelled candidate. Resume obtains a new reviewed draft.
    const lifecycleService = require('../electron/services/creative-workflow.service.ts')
    const taskService = require('../electron/services/task.service.ts')
    const artifactService = require('../electron/services/artifact.service.ts')
    const lifecycleBase = sqlite.prepare('SELECT synopsis,context_version AS version FROM novels WHERE id=?').get(novelId)
    replies.push(JSON.stringify({ synopsis: '取消的候选简介' }), review)
    const cancelPaused = await finish((await call('workflows.start', { stage: 'background', request: '生成简介候选供作者复核。', autoApply: false, idempotencyKey: 'cancel-paused-candidate' })).run.runId)
    assert.equal(cancelPaused.status, 'paused')
    const resumePausedRequests = requests.length
    assert.equal((await call('workflows.resume', { runId: cancelPaused.runId })).run.status, 'paused')
    assert.equal(requests.length, resumePausedRequests, 'resume of paused candidate neither calls models nor writes canon')
    assert.deepEqual(sqlite.prepare('SELECT synopsis,context_version AS version FROM novels WHERE id=?').get(novelId), lifecycleBase)
    for (const status of ['failed', 'blocked', 'pending', 'success']) {
      taskService.updateTask(cancelPaused.runId, { status })
      assert.throws(() => lifecycleService.applyCreativeDraft({ novelId, runId: cancelPaused.runId }), /当前任务状态/, `direct apply must honor ${status} state`)
    }
    taskService.updateTask(cancelPaused.runId, { status: 'paused' })
    assert.equal((await call('workflows.cancel', { runId: cancelPaused.runId })).run.status, 'cancelled')
    assert.throws(() => lifecycleService.applyCreativeDraft({ novelId, runId: cancelPaused.runId }), /已取消/)
    const forcedCancelled = await registry.invoke({ toolId: 'novelforge.workflows.apply', input: { novelId, runId: cancelPaused.runId } }, context)
    assert.equal(forcedCancelled.ok, false, 'passed review cannot override cancellation')
    replies.push(JSON.stringify({ synopsis: '重新生成且复核的新简介' }), review)
    await call('workflows.resume', { runId: cancelPaused.runId })
    const retriedCancelled = await finish(cancelPaused.runId)
    assert.equal(retriedCancelled.status, 'paused')
    assert.notEqual(retriedCancelled.artifactId, cancelPaused.artifactId)
    assert.deepEqual(sqlite.prepare('SELECT synopsis,context_version AS version FROM novels WHERE id=?').get(novelId), lifecycleBase)
    await call('workflows.apply', { runId: retriedCancelled.runId })
    assert.equal(sqlite.prepare('SELECT synopsis FROM novels WHERE id=?').get(novelId).synopsis, '重新生成且复核的新简介')
    const lifecycleVersion = sqlite.prepare('SELECT context_version AS version FROM novels WHERE id=?').get(novelId).version
    taskService.updateTask(retriedCancelled.runId, { status: 'cancelled', controlJson: '{"cancelRequested":true}' })
    lifecycleService.applyCreativeDraft({ novelId, runId: retriedCancelled.runId })
    await call('workflows.apply', { runId: retriedCancelled.runId })
    assert.equal((await call('workflows.get', { runId: retriedCancelled.runId })).run.status, 'success', 'a persisted commit restores success without repeating application')
    assert.equal(sqlite.prepare('SELECT context_version AS version FROM novels WHERE id=?').get(novelId).version, lifecycleVersion)
    replies.push(JSON.stringify({ synopsis: '已停用的候选简介' }), review)
    const inactiveDraft = await finish((await call('workflows.start', { stage: 'background', request: '生成另一份简介候选。', autoApply: false, idempotencyKey: 'superseded-candidate' })).run.runId)
    artifactService.updateArtifactLifecycle(inactiveDraft.artifactId, { status: 'superseded' })
    assert.throws(() => lifecycleService.applyCreativeDraft({ novelId, runId: inactiveDraft.runId }), /已停用/)
    const forcedSuperseded = await registry.invoke({ toolId: 'novelforge.workflows.apply', input: { novelId, runId: inactiveDraft.runId } }, context)
    assert.equal(forcedSuperseded.ok, false, 'passed review cannot revive a superseded candidate')
    await call('workflows.cancel', { runId: inactiveDraft.runId })
    assert.equal(sqlite.prepare('SELECT context_version AS version FROM novels WHERE id=?').get(novelId).version, lifecycleVersion)

    // Only a successful, explicitly linked revision supersedes its ancestors. Model PASS
    // before hard validation and an unrelated new draft must not retire the original.
    const lineageService = require('../electron/services/creative-candidate-lineage.ts')
    replies.push(JSON.stringify({ synopsis: '来源链原候选' }), review)
    const lineageOriginal = await finish((await call('workflows.start', { stage: 'background', request: '生成简介候选。', autoApply: false, idempotencyKey: 'lineage-original' })).run.runId)
    const lineageBase = sqlite.prepare('SELECT synopsis,context_version AS version FROM novels WHERE id=?').get(novelId)
    const invalidLineage = JSON.stringify({ synopsis: 42 })
    replies.push(invalidLineage, invalidLineage)
    const failedRevision = await finish((await call('workflows.start', { stage: 'background', request: '修订旧简介候选。', sourceArtifactId: lineageOriginal.artifactId, autoApply: false, idempotencyKey: 'lineage-failed-revision' })).run.runId)
    assert.equal(failedRevision.status, 'blocked')
    assert.equal(artifactService.getArtifact(lineageOriginal.artifactId).status, 'reviewed', 'failed revision preserves a usable original candidate')
    assert.equal(lineageService.findAcceptedCreativeSuccessor(novelId, lineageOriginal.artifactId), null)
    replies.push(JSON.stringify({ synopsis: '无关独立候选' }), review)
    const unrelatedLineage = await finish((await call('workflows.start', { stage: 'background', request: '独立试写另一份简介。', autoApply: false, idempotencyKey: 'lineage-unrelated' })).run.runId)
    assert.equal(lineageService.findAcceptedCreativeSuccessor(novelId, lineageOriginal.artifactId), null, 'a later task without an explicit source cannot retire an unrelated candidate')
    await call('workflows.cancel', { runId: unrelatedLineage.runId })
    replies.push(JSON.stringify({ synopsis: '来源链当前修订候选' }), review)
    const acceptedRevision = await finish((await call('workflows.start', { stage: 'background', request: '修订来源链原简介。', sourceArtifactId: lineageOriginal.artifactId, autoApply: false, idempotencyKey: 'lineage-accepted-revision' })).run.runId)
    assert.equal(acceptedRevision.status, 'paused')
    assert.equal(artifactService.getArtifact(lineageOriginal.artifactId).status, 'superseded')
    assert.deepEqual(lineageService.findAcceptedCreativeSuccessor(novelId, lineageOriginal.artifactId), { artifactId: acceptedRevision.artifactId, runId: acceptedRevision.runId })
    assert.throws(() => lifecycleService.applyCreativeDraft({ novelId, runId: lineageOriginal.runId }), /修订版本替代/)
    // Simulate old-release records: the read-only lineage guard must block Apply even if
    // the ancestor was never marked superseded by that release.
    artifactService.updateArtifactLifecycle(lineageOriginal.artifactId, { status: 'reviewed' })
    assert.throws(() => lifecycleService.applyCreativeDraft({ novelId, runId: lineageOriginal.runId }), /修订版本替代/)
    const legacyApply = await registry.invoke({ toolId: 'novelforge.workflows.apply', input: { novelId, runId: lineageOriginal.runId } }, context)
    assert.equal(legacyApply.ok, false)
    assert.deepEqual(sqlite.prepare('SELECT synopsis,context_version AS version FROM novels WHERE id=?').get(novelId), lineageBase)
    await call('workflows.apply', { runId: acceptedRevision.runId })
    assert.equal(sqlite.prepare('SELECT synopsis FROM novels WHERE id=?').get(novelId).synopsis, '来源链当前修订候选', 'the latest accepted revision remains applicable')

    // A new mystery project: planning a secret never grants knowledge. Only reviewed, quoted
    // chapter delivery advances that fact to the next chapter, atomically with the prose.
    const mysteryCreated = await registry.invoke({ toolId: 'novelforge.projects.create', input: { title: '断绳案', background: '沈墨与周荷看守渡口。', modelConfigId: modelId, idempotencyKey: 'mystery-full-flow' } }, context)
    assert.equal(mysteryCreated.ok, true, JSON.stringify(mysteryCreated))
    const mysteryId = mysteryCreated.data.project.id
    const mysteryCall = (name, input = {}) => call(name, { novelId: mysteryId, ...input })
    const finishMystery = async runId => {
      for (let i = 0; i < 200; i++) {
        const { run } = await mysteryCall('workflows.get', { runId })
        if (!['pending', 'running', 'cancel_requested'].includes(run.status)) return run
        await new Promise(resolve => setTimeout(resolve, 30))
      }
      throw new Error('mystery workflow timed out')
    }
    replies.push(JSON.stringify({ changes: [{ op: 'upsert_entity', kind: 'character', name: '沈墨', summary: '看守渡口的船工', attributes: { roleType: 'protagonist' } }, { op: 'upsert_entity', kind: 'character', name: '周荷', summary: '渡口掌柜' }] }), review)
    assert.equal((await finishMystery((await mysteryCall('workflows.start', { stage: 'characters', request: '登记沈墨和周荷。', idempotencyKey: 'mystery-characters' })).run.runId)).status, 'success')
    const mysteryCast = (await mysteryCall('characters.list')).characters
    const shen = mysteryCast.find(row => row.fullName === '沈墨'), zhou = mysteryCast.find(row => row.fullName === '周荷')
    const secret = '赵渡亲手割断了旧绳'
    replies.push(JSON.stringify({ facts: [
      { clientId: 'cut-rope', title: '割绳者', summary: secret, kind: 'truth', plannedRevealChapterNum: 2, notes: '通过旧信揭示割绳者。' },
      { clientId: 'initial', title: '掌柜账册', summary: '周荷早就知道账册藏在梁上', kind: 'clue', knownFromStartCharacterIds: [zhou.id] },
    ] }), review)
    const factPlan = await finishMystery((await mysteryCall('workflows.start', { stage: 'story', request: '登记两条信息点，割绳者留到第2章，只有周荷开篇就知道账册位置。', idempotencyKey: 'mystery-plan-facts' })).run.runId)
    assert.equal(factPlan.status, 'success', JSON.stringify(factPlan))
    const plannedFacts = (await mysteryCall('assets.query')).facts
    const secretFact = plannedFacts.find(fact => fact.title === '割绳者')
    assert.equal(secretFact.plannedRevealChapterNum, 2); assert.equal(secretFact.readerKnownChapterId, null); assert.deepEqual(secretFact.characterKnowledge, [])
    assert.equal(secretFact.notes, '通过旧信揭示割绳者。'); assert.equal(secretFact.sourceArtifactId, factPlan.artifactId)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM chapters WHERE novel_id=?').get(mysteryId).count, 0, 'planning a future reveal never creates a chapter')
    assert.equal(plannedFacts.find(fact => fact.title === '掌柜账册').characterKnowledge[0].knownFromStart, true)
    assert.equal(plannedFacts.find(fact => fact.title === '掌柜账册').characterKnowledge[0].knownChapterId, null)
    const firstProse = '沈墨查看旧绳。河水漫过木桩，他把断绳放在岸上，又把渡船系稳。'
    const revealProse = `沈墨读信，信被泥水浸湿。他辨出最后一行字：${secret}。沈墨知道割绳者是谁了，把信折好收起。`
    const planChapter = (chapterNum, title, goal, result, reveal = false) => ({ chapterNum, title, outline: `${goal}。${result}。`, chapterContract: { chapterGoal: goal },
      scenes: [{ pov: '沈墨', timeLocation: '清晨，渡口', sceneGoal: goal, obstacle: '信被泥水浸湿', resultState: result, revealPayload: reveal ? [`fact:${secretFact.id}`] : [] }],
      allowedFactIds: reveal ? [secretFact.id] : [], revealedFactIds: reveal ? [secretFact.id] : [] })
    replies.push(JSON.stringify({ chapters: [planChapter(1, '旧绳', '沈墨查看旧绳', '渡船系稳'), planChapter(2, '旧信', '沈墨读信', '沈墨知道割绳者', true), planChapter(3, '寻人', '沈墨寻找割绳者', '沈墨离开渡口')] }), review)
    assert.equal((await finishMystery((await mysteryCall('workflows.start', { stage: 'outline', request: '安排前三章，第2章才揭示割绳者。', count: 3, atChapter: 1, idempotencyKey: 'mystery-outline' })).run.runId)).status, 'success')
    const previewFirst = (await mysteryCall('context.preview', { stage: 'chapter', atChapter: 1, request: '沈墨查看旧绳。' })).context
    assert.ok(!previewFirst.text.includes(secret), 'planned truth is not visible to the first chapter writer')
    assert.ok(!previewFirst.text.includes('周荷早就知道账册藏在梁上'), 'one character knownFromStart is not shared with another POV')
    replies.push(JSON.stringify({ chapterNum: 1, title: '旧绳', content: firstProse, summary: '沈墨查看旧绳并系稳渡船。', changes: [], factReveals: [] }), review)
    assert.equal((await finishMystery((await mysteryCall('workflows.start', { stage: 'chapter', atChapter: 1, request: '只写查看旧绳，不揭示是谁割断。', idempotencyKey: 'mystery-chapter-one' })).run.runId)).status, 'success')
    const secondPlan = (await mysteryCall('assets.query')).chapters.find(row => row.chapterNum === 2)
    const foreignFactId = require('../electron/services/story-fact.service.ts').createStoryFact(novelId, { title: '别的小说信息点', summary: secret })
    const validReveal = { factId: secretFact.id, characterIds: [shen.id], evidenceQuote: `他辨出最后一行字：${secret}。` }
    const chapterCandidate = factReveals => ({ chapterNum: 2, title: '旧信', content: revealProse, summary: '沈墨读信知道割绳者。', changes: [], factReveals })
    for (const [label, badReveal] of [
      ['bad-quote', { ...validReveal, evidenceQuote: '这句话不在正文里面' }],
      ['bad-character', { ...validReveal, characterIds: ['character:missing'] }],
      ['foreign-character', { ...validReveal, characterIds: [characterList[0].id] }],
      ['foreign-fact', { ...validReveal, factId: foreignFactId }],
    ]) {
      const requestCount = requests.length
      replies.push(JSON.stringify(chapterCandidate([badReveal])), JSON.stringify(chapterCandidate([badReveal])))
      const failed = await finishMystery((await mysteryCall('workflows.start', { stage: 'chapter', atChapter: 2, request: '通过读信揭示割绳者。', idempotencyKey: `mystery-${label}` })).run.runId)
      assert.equal(failed.status, 'blocked', JSON.stringify(failed))
      assert.equal(requests.length, requestCount + 2, `${label} must be rejected by machine validation after one repair attempt`)
      assert.match(failed.message, /揭示证据|人物图谱ID|信息点ID/, JSON.stringify(failed))
      assert.equal((await mysteryCall('assets.query')).facts.find(fact => fact.id === secretFact.id).readerKnownChapterId, null)
      assert.equal(sqlite.prepare('SELECT content FROM chapters WHERE id=?').get(secondPlan.id).content || '', '', 'invalid revelation cannot partially commit prose')
    }
    replies.push(JSON.stringify(chapterCandidate([validReveal])), review)
    const accepted = await finishMystery((await mysteryCall('workflows.start', { stage: 'chapter', atChapter: 2, request: '通过读信揭示割绳者，只有沈墨看到。', autoApply: false, idempotencyKey: 'mystery-accepted-reveal' })).run.runId)
    assert.equal(accepted.status, 'paused', JSON.stringify(accepted))
    assert.equal((await mysteryCall('assets.query')).facts.find(fact => fact.id === secretFact.id).readerKnownChapterId, null, 'reviewed but unapplied candidate never grants knowledge')
    await mysteryCall('workflows.apply', { runId: accepted.runId })
    const afterReveal = (await mysteryCall('assets.query')).facts.find(fact => fact.id === secretFact.id)
    assert.equal(afterReveal.readerKnownChapterId, secondPlan.id)
    assert.equal(afterReveal.protagonistKnownChapterId, secondPlan.id)
    assert.deepEqual(afterReveal.characterKnowledge.map(entry => entry.characterId), [shen.id])
    assert.equal(afterReveal.characterKnowledge[0].knownChapterId, secondPlan.id)
    assert.equal(afterReveal.characterKnowledge[0].evidenceQuote, validReveal.evidenceQuote)
    const versionAfterReveal = (await mysteryCall('assets.query')).contextVersion
    await mysteryCall('workflows.apply', { runId: accepted.runId })
    assert.equal((await mysteryCall('assets.query')).contextVersion, versionAfterReveal, 'repeated apply is idempotent')
    const previewThird = (await mysteryCall('context.preview', { stage: 'chapter', atChapter: 3, request: '沈墨依据已知事实寻找割绳者。' })).context
    assert.ok(previewThird.sources.includes(`fact:${secretFact.id}`), 'the next chapter sees the committed character knowledge')
    assert.ok(previewThird.text.includes(secret))
    assert.throws(() => require('../electron/services/creative-facts.ts').validateCreativeFactPlans(mysteryId, [
      { id: secretFact.id, title: secretFact.title, summary: `${secret}。第三章又发现新的幕后人。` },
    ]), /已揭示的信息点/, 'a later discovery must not rewrite an earlier-known fact and leak into prior chapters')
    const factService = require('../electron/services/creative-facts.ts')
    assert.throws(() => factService.validateCreativeFactPlans(mysteryId, [
      { id: secretFact.id, title: secretFact.title, summary: secret, knownFromStartCharacterIds: [shen.id] },
    ]), /不能通过生成回填为开篇已知/, 'unchanged fact text must not bypass knowledge chronology')
    const initialFact = (await mysteryCall('assets.query')).facts.find(fact => fact.title === '掌柜账册')
    factService.applyCreativeFactPlans(mysteryId, [{ id: initialFact.id, title: initialFact.title, summary: initialFact.summary, knownFromStartCharacterIds: [zhou.id] }], 'repeat-initial-knowledge')
    assert.deepEqual((await mysteryCall('assets.query')).facts.find(fact => fact.id === initialFact.id).characterKnowledge, initialFact.characterKnowledge, 'repeated opening knowledge keeps its original evidence source')

    // A character introduced in this chapter can learn through actual prose; a future/planned one cannot.
    const atlasService = require('../electron/services/story-atlas.service.ts')
    for (const [name, atChapter, status] of [['程棠', 2, 'confirmed'], ['未来客', 3, 'confirmed'], ['待定客', 2, 'planned']]) {
      atlasService.applyStoryAtlasChanges({ novelId: mysteryId, expectedContextVersion: atlasService.queryStoryAtlas({ novelId: mysteryId }).contextVersion,
        effectiveFromChapter: atChapter, source: { kind: 'test' }, idempotencyKey: `introduced-${name}`,
        changes: [{ op: 'upsert_entity', kind: 'character', name, status }] })
    }
    const introduced = atlasService.queryStoryAtlas({ novelId: mysteryId, includePlanned: true }).entities
    const newcomer = introduced.find(entity => entity.name === '程棠')
    const newQuote = `程棠读信后说：“原来${secret}。”`
    const newReveal = { ...validReveal, characterIds: [newcomer.id], evidenceQuote: newQuote }
    factService.applyCreativeFactReveals(mysteryId, secondPlan.id, `${revealProse}\n${newQuote}`, [newReveal], 'newcomer-reveal')
    const newcomerKnowledge = (await mysteryCall('assets.query')).facts.find(fact => fact.id === secretFact.id).characterKnowledge.find(entry => entry.characterId === newcomer.id)
    assert.equal(newcomerKnowledge.knownChapterId, secondPlan.id)
    assert.equal(newcomerKnowledge.evidenceQuote, newQuote)
    assert.throws(() => factService.validateCreativeFactPlans(mysteryId, [{ id: secretFact.id, title: secretFact.title, summary: secret, knownFromStartCharacterIds: [newcomer.id] }]), /不能通过生成回填为开篇已知/, 'later-known non-POV knowledge cannot be backdated either')
    for (const name of ['未来客', '待定客']) {
      const quote = `${name}读信后说：“原来${secret}。”`
      assert.throws(() => factService.validateCreativeFactReveals(mysteryId, 2, quote, [{ ...validReveal, characterIds: [introduced.find(entity => entity.name === name).id], evidenceQuote: quote }]), /人物图谱ID/)
    }
    assert.throws(() => factService.validateCreativeFactReveals(mysteryId, 2, revealProse, [{ ...validReveal, characterIds: [newcomer.id] }]), /在场获知依据/, 'introduction alone is not evidence of learning')
    const openingFactId = factService.applyCreativeFactPlans(mysteryId, [{ title: '渡口旧约', summary: '沈墨早已知道旧约的日期', knownFromStartCharacterIds: [shen.id] }], 'opening-knowledge-source').factIds[0]
    const openingKnowledge = (await mysteryCall('assets.query')).facts.find(fact => fact.id === openingFactId).characterKnowledge
    sqlite.prepare('UPDATE chapters SET allowed_fact_ids_json=?,revealed_fact_ids_json=? WHERE id=?').run(JSON.stringify([openingFactId]), JSON.stringify([openingFactId]), secondPlan.id)
    sqlite.prepare('UPDATE scene_contracts SET reveal_payload_json=? WHERE chapter_id=?').run(JSON.stringify([`fact:${openingFactId}`]), secondPlan.id)
    const openingQuote = '沈墨说：“我早已知道旧约的日期。”'
    factService.applyCreativeFactReveals(mysteryId, secondPlan.id, openingQuote, [{ factId: openingFactId, characterIds: [shen.id], evidenceQuote: openingQuote }], 'reader-learns-later')
    factService.applyCreativeFactPlans(mysteryId, [{ id: openingFactId, title: '渡口旧约', summary: '沈墨早已知道旧约的日期', knownFromStartCharacterIds: [shen.id] }], 'repeat-after-reader-reveal')
    assert.deepEqual((await mysteryCall('assets.query')).facts.find(fact => fact.id === openingFactId).characterKnowledge, openingKnowledge, 'later reader revelation preserves explicit opening POV knowledge and its source')
    // A passing model review must not bypass resolved save boundaries, including clientId name reuse.
    const restrictedScope = { existingEntityIds: [], existingRelationIds: [], newEntityCount: 2, allowNewRelations: false }
    const scopeSnapshot = (await call('atlas.query', {})).atlas
    const scopedItems = { changes: [
      { op: 'upsert_entity', clientId: 'scope-lamp', kind: 'item', name: '范围校验灯', summary: '现场照明器物' },
      { op: 'upsert_entity', clientId: 'scope-book', kind: 'item', name: '范围校验薄册', summary: '随身记录册' },
    ] }
    replies.push(JSON.stringify(scopedItems), review)
    const scopedRun = (await call('workflows.start', { stage: 'items', request: '只登记两件实物', count: 2, changeScope: restrictedScope, idempotencyKey: 'scope-exact-two' })).run
    assert.equal((await finish(scopedRun.runId)).status, 'success')
    const scopeApplied = (await call('atlas.query', {})).atlas
    assert.equal(scopeApplied.entities.length, scopeSnapshot.entities.length + 2)
    const attacks = [
      { changes: [scopedItems.changes[0]] }, // reusing the name with a new clientId is an existing update
      { changes: [{ ...scopedItems.changes[0], name: '第三件物品' }] }, // incorrect exact new count
      { changes: [{ ...scopedItems.changes[0], name: '第三件物品' }, { ...scopedItems.changes[1], name: '第四件物品' },
        { op: 'upsert_relation', kind: 'ownership', fromId: scopeApplied.entities.find(entity => entity.kind === 'character').id, toId: 'scope-lamp', label: '持有' }] },
    ]
    for (const [index, attack] of attacks.entries()) {
      replies.push(JSON.stringify(attack), JSON.stringify(attack))
      const run = (await call('workflows.start', { stage: 'items', request: '只新增两件物品，不修改已有档案或关系', count: 2, changeScope: restrictedScope, idempotencyKey: `scope-attack-${index}` })).run
      const rejected = await finish(run.runId)
      assert.equal(rejected.status, 'blocked', JSON.stringify(rejected))
      assert.match(rejected.message, /超出本次保存范围|实际新增|不允许新增关系/)
      const forced = await registry.invoke({ toolId: 'novelforge.workflows.apply', input: { novelId, runId: run.runId } }, context)
      assert.equal(forced.ok, false, 'manual apply must repeat hard scope validation even after a passing model review')
      const after = (await call('atlas.query', {})).atlas
      assert.equal(after.contextVersion, scopeApplied.contextVersion)
      assert.deepEqual(after.entities, scopeApplied.entities)
      assert.deepEqual(after.relations, scopeApplied.relations)
    }
    // Frozen comparisons and real writer/reviewer routing through the registered API.
    if (!realModelSource) {
      const reviewerId = Number(sqlite.prepare('INSERT INTO model_configs(name,provider,model_id,api_key,base_url,max_tokens,max_context_tokens) VALUES(?,?,?,?,?,?,?)').run('Separate reviewer', 'openai', 'review-fixture', model.encryptApiKey('fixture-only'), `http://127.0.0.1:${server.address().port}/v1`, 4000, 16000).lastInsertRowid)
      const isolatedId = Number(sqlite.prepare('INSERT INTO novels(title,user_background,synopsis,model_config_id,settings_json,context_version) VALUES(?,?,?,?,?,1)').run('历史记录试验', '渡口生活', '保存前简介', modelId, JSON.stringify({ ai_engine: { review_model_config_id: reviewerId } })).lastInsertRowid)
      const isolatedCall = (name, args = {}) => call(name, { novelId: isolatedId, ...args })
      const isolatedFinish = async id => {
        for (let i = 0; i < 200; i++) {
          const run = (await isolatedCall('workflows.get', { runId: id })).run
          if (!['pending', 'running', 'cancel_requested'].includes(run.status)) return run
          await new Promise(resolve => setTimeout(resolve, 30))
        }
        throw new Error('isolated review timeout')
      }
      const beforeRoutes = requests.length
      replies.push(JSON.stringify({ synopsis: '本轮新简介' }), review)
      const historical = await isolatedFinish((await isolatedCall('workflows.start', { stage: 'background', atChapter: 0, request: '只更新简介', autoApply: false, idempotencyKey: 'history-candidate' })).run.runId)
      assert.equal(historical.status, 'paused', JSON.stringify(historical))
      assert.equal(historical.reviewModelConfigId, reviewerId)
      assert.deepEqual(requests.slice(beforeRoutes).map(request => request.model), ['creative-fixture', 'review-fixture'])
      assert.ok(historical.context.maxInputTokens < 10000, 'smaller reviewer window bounds shared context')
      const comparison = (await isolatedCall('artifacts.list', { kind: 'creative_comparison', parentArtifactId: historical.artifactId })).artifacts
      assert.equal(comparison.length, 1)
      const comparisonContent = (await isolatedCall('artifacts.get', { artifactId: comparison[0].id })).artifact.content
      assert.equal(comparisonContent.history[0].before, '保存前简介')
      assert.equal(comparisonContent.history[0].after, '本轮新简介')
      const committed = (await isolatedCall('workflows.apply', { runId: historical.runId })).run.result
      assert.equal(committed.history[0].before, '保存前简介'); assert.equal(committed.history[0].after, '本轮新简介')
      sqlite.prepare('UPDATE novels SET synopsis=? WHERE id=?').run('更晚的简介', isolatedId)
      assert.deepEqual((await isolatedCall('artifacts.get', { artifactId: comparison[0].id })).artifact.content, comparisonContent, 'later edits cannot change a historical comparison')
      const commitRef = (await isolatedCall('artifacts.list', { kind: 'creative_commit', parentArtifactId: historical.artifactId })).artifacts[0]
      assert.deepEqual((await isolatedCall('artifacts.get', { artifactId: commitRef.id })).artifact.content.history, committed.history)
      sqlite.prepare('UPDATE model_configs SET temperature=? WHERE id=?').run(0.3, reviewerId)
      replies.push(JSON.stringify({ synopsis: '审校模型待变更的候选' }), review)
      const frozenReviewer = await isolatedFinish((await isolatedCall('workflows.start', { stage: 'background', atChapter: 0, request: '更新简介', autoApply: false, idempotencyKey: 'reviewer-frozen' })).run.runId)
      sqlite.prepare('UPDATE model_configs SET temperature=? WHERE id=?').run(0.4, reviewerId)
      const rejectedReviewer = await registry.invoke({ toolId: 'novelforge.workflows.apply', input: { novelId: isolatedId, runId: frozenReviewer.runId } }, context)
      assert.equal(rejectedReviewer.ok, false, 'changing reviewer config invalidates an old candidate')

      const { listRevisionTasks } = require('../electron/services/revision-task.service.ts')
      const { recordCreativeReviewIssues, validateCreativeRevisionTargets } = require('../electron/services/creative-review-issues.ts')
      const qualityReview = { summary: '需要修订旧绳观察', severity: 'medium', rewriteRequired: true, rejectRequired: false, topFixes: ['写明先检查旧绳'], genreDriftRisks: [], themeDriftRisks: [], backgroundDriftRisks: [], languageRisks: [], humanLanguageRepairs: [], conflictRisks: [] }
      const itemCandidate = JSON.stringify({ changes: [{ op: 'upsert_entity', clientId: 'new-notebook', kind: 'item', name: '试用薄册', attributes: { usageMethod: '记下观察' } }] })
      const originalScope = { existingEntityIds: [], existingRelationIds: [], newEntityCount: 1, allowNewRelations: false }
      replies.push(itemCandidate, review)
      const itemRun = await isolatedFinish((await isolatedCall('workflows.start', { stage: 'items', atChapter: 0, request: '只建档一本薄册', autoApply: false, changeScope: originalScope, idempotencyKey: 'item-issue-base' })).run.runId)
      const itemIssueId = recordCreativeReviewIssues({ novelId: isolatedId, stage: 'items', atChapter: 0, count: 1, changeScope: originalScope }, itemRun.runId, itemRun.reviewArtifactId, qualityReview, [], itemRun.artifactId)[0]
      const beforeBoundChecks = requests.length
      for (const [index, attack] of [
        { sourceArtifactId: undefined, changeScope: originalScope },
        { sourceArtifactId: itemRun.artifactId, changeScope: { ...originalScope, newEntityCount: 2 } },
        { operation: 'review', changeScope: originalScope },
      ].entries()) {
        const denied = await registry.invoke({ toolId: 'novelforge.workflows.start', input: { novelId: isolatedId, stage: 'items', atChapter: 0, request: '不得误关闭另一个对象的问题', revisionIssueIds: [itemIssueId], idempotencyKey: `issue-target-attack-${index}`, ...attack } }, context)
        assert.equal(denied.ok, false, JSON.stringify(denied))
        assert.equal(denied.error.code, 'CREATIVE_REVIEW_TARGET_INVALID')
        assert.match(denied.error.message, /最新候选|保存范围|尚未保存/)
      }
      assert.equal(requests.length, beforeBoundChecks, 'wrong lineage, changed scope and unsaved formal recheck fail before model execution')
      assert.equal(listRevisionTasks(isolatedId).find(issue => issue.id === itemIssueId).status, 'open')
      replies.push(itemCandidate, review)
      const itemRepair = await isolatedFinish((await isolatedCall('workflows.start', { stage: 'items', atChapter: 0, request: '保持薄册并修订说明', sourceArtifactId: itemRun.artifactId, autoApply: false, changeScope: originalScope, revisionIssueIds: [itemIssueId], idempotencyKey: 'item-issue-repair' })).run.runId)
      assert.equal(itemRepair.status, 'paused', JSON.stringify(itemRepair))
      const itemSaved = (await isolatedCall('workflows.apply', { runId: itemRepair.runId })).run.result
      const itemMeta = JSON.parse(listRevisionTasks(isolatedId).find(issue => issue.id === itemIssueId).originMetaJson)
      assert.equal(itemMeta.repairArtifactId, itemRepair.artifactId)
      assert.equal(itemMeta.changeScope.newEntityCount, 0)
      assert.ok(itemMeta.changeScope.existingEntityIds.includes(itemSaved.idMap['new-notebook']), 'new entity repair scope transitions to actual persisted ID')
      assert.throws(() => validateCreativeRevisionTargets({ novelId: isolatedId, stage: 'items', atChapter: 0, revisionIssueIds: [itemIssueId], sourceArtifactId: itemRun.artifactId, changeScope: itemMeta.changeScope }), /最新候选依据/)
      const formalBefore = (await isolatedCall('atlas.query', { atChapter: 0 })).atlas
      const routesBeforeRecheck = requests.length
      replies.push(review)
      const formalItemRun = await isolatedFinish((await isolatedCall('workflows.start', { operation: 'review', stage: 'items', atChapter: 0, request: '复核已保存薄册用途', changeScope: itemMeta.changeScope, revisionIssueIds: [itemIssueId], idempotencyKey: 'item-formal-recheck' })).run.runId)
      assert.equal(formalItemRun.reviewStatus, 'passed', JSON.stringify(formalItemRun))
      assert.deepEqual(requests.slice(routesBeforeRecheck).map(row => row.model), ['review-fixture'], 'formal review calls only selected reviewer')
      const formalReport = (await isolatedCall('artifacts.get', { artifactId: formalItemRun.artifactId })).artifact.content
      assert.equal(formalReport.schemaVersion, 'atlas-review-v1')
      assert.equal(formalReport.snapshot.entities.length, 1)
      assert.equal(formalReport.snapshot.entities[0].id, itemSaved.idMap['new-notebook'])
      assert.deepEqual((await isolatedCall('atlas.query', { atChapter: 0 })).atlas, formalBefore, 'formal review never mutates assets or context version')
      assert.equal(listRevisionTasks(isolatedId).find(issue => issue.id === itemIssueId).status, 'resolved')
      const { captureFormalAtlasReview } = require('../electron/services/creative-formal-review.ts')
      assert.throws(() => captureFormalAtlasReview({ novelId: isolatedId, stage: 'items', atChapter: 0 }), /指定已有资料/)
      assert.throws(() => captureFormalAtlasReview({ novelId: isolatedId, stage: 'characters', atChapter: 0, changeScope: itemMeta.changeScope }), /不属于本阶段/)
      assert.throws(() => captureFormalAtlasReview({ novelId: isolatedId, stage: 'items', atChapter: 0, changeScope: { ...itemMeta.changeScope, existingEntityIds: ['item:nonexistent'] } }), /不存在/)
      const staleIssueId = recordCreativeReviewIssues({ novelId: isolatedId, stage: 'items', atChapter: 0, changeScope: itemMeta.changeScope }, formalItemRun.runId, formalItemRun.artifactId, qualityReview)[0]
      heldResponse = undefined
      replies.push('HOLD')
      const staleReview = (await isolatedCall('workflows.start', { operation: 'review', stage: 'items', atChapter: 0, request: '复核当前用途', changeScope: itemMeta.changeScope, revisionIssueIds: [staleIssueId], idempotencyKey: 'item-stale-recheck' })).run
      for (let i = 0; i < 100 && !heldResponse; i++) await new Promise(resolve => setTimeout(resolve, 20))
      assert.ok(heldResponse)
      await isolatedCall('atlas.apply', { expectedContextVersion: formalBefore.contextVersion, effectiveFromChapter: 0, source: { kind: 'user', id: 'fixture-author' }, idempotencyKey: 'change-during-recheck', changes: [{ op: 'upsert_entity', id: itemSaved.idMap['new-notebook'], kind: 'item', name: '试用薄册', attributes: { usageMethod: '作者在复核中改过的用途' } }] })
      heldResponse.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: review }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }))
      const staleFinished = await isolatedFinish(staleReview.runId)
      assert.equal(staleFinished.status, 'failed', JSON.stringify(staleFinished))
      assert.match(staleFinished.message, /资料已变化/)
      assert.equal(listRevisionTasks(isolatedId).find(issue => issue.id === staleIssueId).status, 'open', 'stale clean review cannot close current issues')
      assert.equal(staleFinished.reviewArtifactId, undefined, 'stale review produces no accepted formal report')
      replies.push(itemCandidate, review)
      const itemAgain = await isolatedFinish((await isolatedCall('workflows.start', { stage: 'items', atChapter: 0, request: '继续修订已有薄册', sourceArtifactId: itemMeta.repairArtifactId, autoApply: false, changeScope: itemMeta.changeScope, revisionIssueIds: [itemIssueId], idempotencyKey: 'item-issue-repair-again' })).run.runId)
      assert.equal(itemAgain.status, 'paused', JSON.stringify(itemAgain))
      validateCreativeRevisionTargets({ novelId: isolatedId, stage: 'items', atChapter: 0, sourceArtifactId: itemAgain.artifactId, changeScope: itemMeta.changeScope, revisionIssueIds: [itemIssueId] })
      replies.push(itemCandidate, review)
      const unboundBranch = await isolatedFinish((await isolatedCall('workflows.start', { stage: 'items', atChapter: 0, request: '另行试写档案', sourceArtifactId: itemMeta.repairArtifactId, autoApply: false, changeScope: itemMeta.changeScope, idempotencyKey: 'unbound-item-branch' })).run.runId)
      assert.throws(() => validateCreativeRevisionTargets({ novelId: isolatedId, stage: 'items', atChapter: 0, sourceArtifactId: unboundBranch.artifactId, changeScope: itemMeta.changeScope, revisionIssueIds: [itemIssueId] }), /最新候选依据/, 'unrelated drafts cannot masquerade as issue-bound repairs')
      const { createArtifact } = require('../electron/services/artifact.service.ts')
      for (let index = 0; index < 205; index++) createArtifact({ novelId: isolatedId, kind: 'creative_comparison', status: 'reviewed', parentArtifactId: itemAgain.artifactId, content: { index }, contextVersion: 1, producerType: 'system', producerId: 'history-query-test', producerClient: 'fixture' })
      assert.equal((await isolatedCall('artifacts.list', { kind: 'creative_comparison', parentArtifactId: historical.artifactId })).artifacts[0].id, comparison[0].id, 'parent filtering recovers a comparison beyond the newest 200 artifacts')
      replies.push(JSON.stringify({ volumes: [
        { clientId: 'volume-a', title: '上卷', summary: '上卷安排', parts: [{ clientId: 'part-a', title: '启程', summary: '上卷的第一次启程' }, { clientId: 'part-a2', title: '启程', summary: '上卷的第二次启程' }] },
        { clientId: 'volume-b', title: '下卷', summary: '下卷安排', parts: [{ clientId: 'part-b', title: '启程', summary: '下卷的启程' }] },
      ] }), review)
      const sameName = await isolatedFinish((await isolatedCall('workflows.start', { stage: 'outline', atChapter: 0, request: '建立两卷，各含同名启程单元，保存各自摘要', idempotencyKey: 'same-name-structure-history' })).run.runId)
      assert.equal(sameName.status, 'success', JSON.stringify(sameName))
      const partHistory = sameName.result.history.filter(change => change.path === '启程')
      assert.deepEqual(partHistory.map(change => change.before), [null, null, null])
      assert.deepEqual(partHistory.map(change => change.after.summary), ['上卷的第一次启程', '上卷的第二次启程', '下卷的启程'], 'same-named parts retain their actual saved identities')
      sqlite.prepare('UPDATE novels SET project_brief_json=? WHERE id=?').run(JSON.stringify({ reader_promise: '旧阅读承诺', target_reader: '旧读者' }), isolatedId)
      replies.push(JSON.stringify({ projectBrief: { readerPromise: '新阅读承诺' }, facts: [{ title: '渡口旧记', summary: '账房留有旧账。' }] }), review)
      const briefSaved = await isolatedFinish((await isolatedCall('workflows.start', { stage: 'story', atChapter: 0, request: '补充阅读承诺与旧账资料', idempotencyKey: 'brief-fact-history' })).run.runId)
      assert.equal(briefSaved.status, 'success', JSON.stringify(briefSaved))
      assert.equal(briefSaved.result.history.find(change => change.path === 'projectBrief').before.readerPromise, '旧阅读承诺')
      assert.equal(briefSaved.result.history.find(change => change.path === 'projectBrief').after.readerPromise, '新阅读承诺')
      const factsSaved = briefSaved.result.history.find(change => change.path === 'facts')
      assert.deepEqual(factsSaved.before, [])
      assert.ok(factsSaved.after[0].id > 0, 'new fact history contains actual saved identity')
      const oldIssueId = recordCreativeReviewIssues({ novelId, stage: 'chapter', atChapter: 1 }, reviewed.runId, reviewed.artifactId, qualityReview)[0]
      assert.equal(listRevisionTasks(novelId).find(issue => issue.id === oldIssueId).status, 'open', 'unrelated consistency scan cannot close model findings')
      assert.equal(recordCreativeReviewIssues({ novelId, stage: 'chapter', atChapter: 1 }, reviewed.runId, reviewed.artifactId, qualityReview)[0], oldIssueId, 'repeated report discovery is idempotent')
      assert.throws(() => validateCreativeRevisionTargets({ novelId: isolatedId, stage: 'chapter', atChapter: 1, revisionIssueIds: [oldIssueId] }), /不属于当前项目/)
      assert.throws(() => validateCreativeRevisionTargets({ novelId, stage: 'items', atChapter: 1, revisionIssueIds: [oldIssueId] }), /阶段或章位/)
      const oldProse = sqlite.prepare('SELECT content FROM chapters WHERE id=?').get(firstChapterId).content
      replies.push(JSON.stringify({ chapterNum: 1, title: '换绳', content: oldProse, summary: '两人检查并换好绳索。', changes: [] }), review)
      const repairedRun = await finish((await call('workflows.start', { stage: 'chapter', atChapter: 1, count: 1, request: '复核并保持原正文', revisionIssueIds: [oldIssueId], autoApply: false, idempotencyKey: 'issue-repair' })).run.runId)
      assert.equal(repairedRun.status, 'paused', JSON.stringify(repairedRun))
      assert.equal(listRevisionTasks(novelId).find(issue => issue.id === oldIssueId).status, 'open', 'a candidate does not resolve an issue')
      await call('workflows.apply', { runId: repairedRun.runId })
      assert.equal(listRevisionTasks(novelId).find(issue => issue.id === oldIssueId).status, 'in_progress', 'saving a repair still requires formal recheck')
      replies.push(review)
      const rechecked = await finish((await call('chapters.review', { chapterId: firstChapterId, revisionIssueIds: [oldIssueId], idempotencyKey: 'formal-recheck' })).run.runId)
      assert.equal(rechecked.reviewStatus, 'passed', JSON.stringify(rechecked))
      assert.equal(listRevisionTasks(novelId).find(issue => issue.id === oldIssueId).status, 'resolved')
      assert.equal(listRevisionTasks(novelId).find(issue => issue.id === oldIssueId).status, 'resolved', 'backfill never reopens resolved findings')
      assert.ok(listRevisionTasks(novelId).some(issue => JSON.parse(issue.originMetaJson || '{}').ruleId === 'deterministic_gate'), 'deterministic validation errors enter the same board')
    }
    const { buildNovelConsistencyReport } = require('../electron/services/consistency.service.ts')
    const groundedItemId = Number(sqlite.prepare('INSERT INTO story_items(novel_id,item_name,item_kind,usage_method) VALUES(?,?,?,?)').run(novelId, '普通抄册', 'instance', '记录渡口每日账目').lastInsertRowid)
    const orphanItemId = Number(sqlite.prepare('INSERT INTO story_items(novel_id,item_name,item_kind) VALUES(?,?,?)').run(novelId, '未使用木盒', 'instance').lastInsertRowid)
    const report = buildNovelConsistencyReport(novelId)
    assert.equal(report.issues.some(issue => issue.entityId === groundedItemId && issue.title === '物品实例仍然悬空'), false, 'known purpose does not require invented ownership')
    assert.equal(report.issues.some(issue => issue.entityId === orphanItemId && issue.title === '物品实例仍然悬空'), true, 'genuinely unused records still need attention')
    sqlite.prepare('UPDATE character_relations SET description=?,interaction_style=NULL,subtext_rule=NULL,intimacy_level=NULL,tension_level=NULL WHERE novel_id=?').run('经营渡口时分担修船和记账，遇账目争议先核对原账。', novelId)
    assert.equal(buildNovelConsistencyReport(novelId).issues.some(issue => /关系还停留在标签|关键关系缺少具体/.test(issue.title)), false, 'concrete relationships do not require ratings or hidden subtext')
    const boardNovelId = Number(sqlite.prepare('INSERT INTO novels(title,model_config_id,theme_voice_json) VALUES(?,?,?)').run('问题看板试验', modelId, JSON.stringify({ style_rules: '第三人称限知，调查结论不超过证据。', dialogue_rules: '人物对白按身份和当时所知分开。' })).lastInsertRowid)
    sqlite.prepare('INSERT INTO story_threads(novel_id,title,thread_type,status,start_chapter,payoff_condition) VALUES(?,?,?,?,?,?)').run(boardNovelId, '渡口失踪案', 'main', 'active', 1, '查明失踪者去向并交代责任')
    sqlite.prepare('INSERT INTO chapters(novel_id,chapter_num,title,content,stale_reason_json) VALUES(?,?,?,?,?)').run(boardNovelId, 1, '第一章', '渡口有人失踪。', '["world_rule_changed"]')
    sqlite.prepare('INSERT INTO chapters(novel_id,chapter_num,title,stale_reason_json) VALUES(?,?,?,?)').run(boardNovelId, 2, '第二章', '["world_rule_changed"]')
    const boardReport = buildNovelConsistencyReport(boardNovelId)
    assert.equal(boardReport.issues.some(issue => issue.category === 'voice'), false, 'concrete prose and dialogue rules suffice without arbitrary genre tags')
    assert.equal(boardReport.issues.some(issue => issue.title === '线程缺少回收条件'), false, 'an explicit payoff condition does not require an invented chapter number')
    const boardIssues = require('../electron/services/revision-task.service.ts').listRevisionTasks(boardNovelId)
    assert.equal(boardIssues.some(issue => issue.status === 'open' && issue.title === '第 1 章需要同步上下文'), true)
    assert.equal(boardIssues.some(issue => issue.status === 'open' && issue.title === '第 2 章需要同步上下文'), false, 'unwritten plans compile fresh context and should not clutter the repair board')
    // Every planning stage can review frozen formal data with the selected reviewer,
    // without regenerating, changing Canon or treating its report as a draft.
    const { captureFormalPlanningReview } = require('../electron/services/creative-formal-review.ts')
    const safeSnapshot = captureFormalPlanningReview({ novelId, stage: 'story', atChapter: 0, request: '检查故事', idempotencyKey: 'snapshot-check' })
    assert.equal('aiEngine' in safeSnapshot.assets, false)
    assert.equal('settingsJson' in safeSnapshot.assets, false)
    const noScope = await registry.invoke({ toolId: 'novelforge.workflows.start', input: { novelId, stage: 'outline', operation: 'review', request: '检查大纲', idempotencyKey: 'outline-review-missing-target' } }, context)
    assert.equal(noScope.ok, false, 'outline review must name existing chapters')
    for (const stage of ['background', 'world_rules', 'story', 'style', 'outline']) {
      const target = { novelId, stage, atChapter: 0, operation: 'review', request: '复核正式资料的事实、因果和限制，不补造未知设定。', idempotencyKey: `formal-planning-${stage}`, ...(stage === 'outline' ? { changeScope: { chapterIds: [firstChapterId] } } : {}) }
      const before = captureFormalPlanningReview(target)
      const version = require('../electron/services/novel.service.ts').getNovel(novelId).contextVersion
      const n = requests.length
      replies.push(review)
      const checked = await finish((await call('workflows.start', target)).run.runId)
      assert.equal(checked.status, 'success', JSON.stringify(checked))
      assert.equal(checked.reviewStatus, 'passed')
      assert.equal(requests.length, n + 1, `${stage} formal review calls only reviewer`)
      const report = (await call('artifacts.get', { artifactId: checked.artifactId })).artifact.content
      assert.equal(report.schemaVersion, 'creative-assets-review-v1')
      assert.deepEqual(report.snapshot, JSON.parse(JSON.stringify(before)))
      assert.deepEqual(captureFormalPlanningReview(target), before)
      assert.equal(require('../electron/services/novel.service.ts').getNovel(novelId).contextVersion, version)
      assert.equal((await registry.invoke({ toolId: 'novelforge.workflows.apply', input: { novelId, runId: checked.runId } }, context)).ok, false)
    }
    const stalePlanningTarget = { stage: 'background', atChapter: 0, operation: 'review', request: '检查本次正式背景', idempotencyKey: 'formal-background-stale' }
    replies.push('HOLD')
    heldResponse = undefined
    const stalePlanning = (await call('workflows.start', stalePlanningTarget)).run
    for (let i = 0; i < 100 && !heldResponse; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(heldResponse)
    // Simulate a legacy writer that changed the target without updating the CAS version.
    const oldBackground = sqlite.prepare('SELECT user_background FROM novels WHERE id=?').get(novelId).user_background
    sqlite.prepare('UPDATE novels SET user_background=? WHERE id=?').run('两岸洪水正在上涨。', novelId)
    heldResponse.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: review }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }))
    const stalePlanningResult = await finish(stalePlanning.runId)
    assert.equal(stalePlanningResult.status, 'failed')
    assert.equal(stalePlanningResult.artifactId, undefined, 'stale formal snapshot cannot produce an accepted review')
    sqlite.prepare('UPDATE novels SET user_background=? WHERE id=?').run(oldBackground, novelId)
    // Simulate process restart with a completed generation response and no completed reviewer.
    // A restored workflow must make exactly the missing reviewer call, not regenerate.
    replies.push(JSON.stringify({ synopsis: '渡口两岸共同检修船只。' }), review)
    const checkpointSource = await finish((await call('workflows.start', { stage: 'background', request: '只整理简介。', autoApply: false, idempotencyKey: 'checkpoint-source' })).run.runId)
    assert.equal(checkpointSource.status, 'paused')
    const sourceInput = sqlite.prepare('SELECT input_json FROM tasks WHERE id=?').get(checkpointSource.runId).input_json
    const recoveredId = await taskService.createTask({ type: 'planning_draft', novelId, modelConfigId: modelId, relatedEntityType: 'creative_workflow', runnerType: 'workflow', inputJson: sourceInput, status: 'running' })
    const artifacts = require('../electron/services/artifact.service.ts')
    const checkpointRows = sqlite.prepare("SELECT id FROM artifacts WHERE novel_id=? AND kind='creative_model_checkpoint' AND idempotency_key LIKE ?").all(novelId, `creative:${checkpointSource.runId}:1:checkpoint:%`)
    const sourceCheckpoint = checkpointRows.map(row => artifacts.requireArtifact(row.id)).find(artifact => artifact.content.phase === 'generate')
    assert.ok(sourceCheckpoint)
    const checkpointCopy = artifacts.createArtifact({ novelId, kind: 'creative_model_checkpoint', status: 'draft', content: sourceCheckpoint.content, contextVersion: sourceCheckpoint.contextVersion, modelConfigId: sourceCheckpoint.modelConfigId, taskId: sourceCheckpoint.taskId, producerType: 'system', producerId: 'restart-fixture', producerClient: 'fixture', idempotencyKey: `creative:${recoveredId}:1:checkpoint:${sourceCheckpoint.content.requestHash}` })
    taskService.updateTask(recoveredId, { progressJson: JSON.stringify({ step: 'reviewing', modelCheckpoint: { schemaVersion: 'creative-model-checkpoint-v1', artifactId: checkpointCopy.id, attempt: 1, identityHash: sourceCheckpoint.content.identityHash } }) })
    taskService.recoverOrphanedTasks()
    assert.equal(taskService.getTaskRecord(recoveredId).status, 'paused')
    assert.equal((await call('workflows.get', { runId: recoveredId })).run.recoveryPending, true)
    const beforeRecoveryCalls = requests.length
    replies.push(review)
    await call('workflows.resume', { runId: recoveredId })
    const recoveredRun = await finish(recoveredId)
    assert.equal(recoveredRun.status, 'paused', JSON.stringify(recoveredRun))
    assert.equal(recoveredRun.reviewStatus, 'passed')
    assert.equal(requests.length, beforeRecoveryCalls + 1, 'completed generation is reused; only missing reviewer runs')
    assert.equal(JSON.parse(taskService.getTaskRecord(recoveredId).inputJson).attempt, 1)
    assert.equal(artifacts.listArtifacts({ novelId, limit: 200 }).some(artifact => artifact.kind === 'creative_model_checkpoint'), false, 'internal checkpoints must not crowd the content version list')
    assert.ok(artifacts.listArtifacts({ novelId, kind: 'creative_model_checkpoint' }).length > 0, 'technical checkpoint lookup remains available')
    assert.equal(replies.length, 0)
    process.stdout.write('PASS creative workflow: project source and neutral rules, safe asset patches, atlas and chapter contracts, review-only reports, targeted repair, and 2-chapter secret/POV knowledge lifecycle with invalid-evidence/cross-project rejection and idempotent apply. Loopback fixture only.\n')
  } finally {
    heldResponse?.destroy(); server.closeAllConnections(); server.close(); closeDb()
    if (!path.resolve(temp).startsWith(path.resolve(root, '.tmp-tests') + path.sep)) throw new Error('unsafe cleanup')
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
