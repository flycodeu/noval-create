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
const review = JSON.stringify({ summary: '候选符合需求，引用和剧情一致。', severity: 'low', rewrite_required: false, reject_required: false, top_fixes: [] })
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
    const result = await registry.invoke({ toolId: `novelforge.${name}`, input: { novelId, ...input } }, context)
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
    const candidate = { changes: [{ op: 'upsert_entity', clientId: 'a', kind: 'character', name: '陈舟', summary: '渡口船工', attributes: { personalityTraits: ['遇事先检查绳索'], speechPattern: '短句' } }, { op: 'upsert_entity', clientId: 'b', kind: 'character', name: '林禾', summary: '渡口记账人' }, { op: 'upsert_relation', kind: 'relationship', fromId: 'a', toId: 'b', label: '共同经营渡口' }] }
    replies.push(JSON.stringify(candidate), review)
    const startInput = { stage: 'characters', request: '生成两个人物与合作关系。', count: 2, idempotencyKey: 'characters-first' }
    const { run: started } = await call('workflows.start', startInput)
    assert.equal(started.status, 'pending', 'start must return before model completion')
    const done = await finish(started.runId)
    assert.equal(done.status, 'success', JSON.stringify(done))
    assert.equal(requests.length, 2, 'generation and review are separate requests')
    const snapshot = (await call('atlas.query', {})).atlas
    assert.equal(snapshot.entities.filter(x => x.kind === 'character').length, 2)
    assert.equal(snapshot.relations.length, 1)
    assert.equal((await call('workflows.start', startInput)).run.runId, started.runId)
    assert.equal(requests.length, 2, 'idempotent start does not call model again')
    await call('workflows.apply', { runId: started.runId })
    assert.equal((await call('atlas.query', {})).atlas.entities.length, 2)
    sqlite.prepare('UPDATE tasks SET status=?, progress_json=json_set(progress_json,\'$.status\',?) WHERE id=?').run('failed', 'failed', started.runId)
    assert.equal((await call('workflows.resume', { runId: started.runId })).run.status, 'success', 'recover applied run without replaying writes or stale progress overriding persisted status')

    replies.push(JSON.stringify({ changes: [{ op: 'upsert_entity', kind: 'character', name: '周行', summary: '新到的摆渡人' }] }), review)
    const next = (await call('workflows.start', { stage: 'characters', request: '再增加一名摆渡人，保留已有角色。', count: 1, idempotencyKey: 'characters-second' })).run
    assert.equal((await finish(next.runId)).status, 'success')
    assert.equal((await call('atlas.query', {})).atlas.entities.length, 3)

    // Writing prepares missing contracts itself, then commits prose and its reviewed summary together.
    const prose = '陈舟解开旧绳，把磨断的一截放在岸上。林禾抱来一捆新绳，两人把船重新系住。河水擦着木桩过去，渡船终于停稳。'
    replies.push(JSON.stringify({ chapters: [{ chapterNum: 1, title: '换绳', outline: '陈舟检查并更换系船绳。', chapterContract: { chapterGoal: '陈舟检查并更换系船绳' }, scenes: [{ pov: '陈舟', timeLocation: '清晨，渡口', sceneGoal: '检查系船绳', obstacle: '旧绳磨断', resultState: '渡船停稳', revealPayload: [] }], allowedFactIds: [], revealedFactIds: [] }] }), review,
      JSON.stringify({ chapterNum: 1, title: '换绳', content: prose, summary: '陈舟与林禾换上新绳，渡船停稳。', changes: [] }), review)
    const writing = (await call('workflows.start', { stage: 'chapter', request: '写陈舟和林禾检查旧绳并将船重新系稳的短场景。', atChapter: 1, idempotencyKey: 'chapter-first' })).run
    const written = await finish(writing.runId)
    assert.equal(written.status, 'success', JSON.stringify(written))
    const chapter = sqlite.prepare('SELECT content, summary FROM chapters WHERE novel_id=? AND chapter_num=1').get(novelId)
    assert.equal(chapter.content, prose)
    assert.equal(chapter.summary, '陈舟与林禾换上新绳，渡船停稳。', 'content invalidation must not erase the new reviewed summary')

    // Complete-looking draft contracts still need automatic review and activation before writing.
    const secondId = Number(sqlite.prepare('INSERT INTO chapters(novel_id,chapter_num,title,outline) VALUES(?,2,?,?)').run(novelId, '加固', '再次检查新绳是否牢固。').lastInsertRowid)
    sqlite.prepare("INSERT INTO chapter_contracts(novel_id,chapter_id,chapter_goal,status) VALUES(?,?,?,'draft')").run(novelId, secondId, '陈舟检查并更换系船绳')
    sqlite.prepare("INSERT INTO scene_contracts(novel_id,chapter_id,pov,time_location,scene_goal,obstacle,result_state,status) VALUES(?,?,?,?,?,?,?,'draft')").run(novelId, secondId, '陈舟', '清晨，渡口', '检查系船绳', '旧绳磨断', '渡船停稳')
    const beforeSecond = requests.length
    replies.push(JSON.stringify({ chapters: [{ id: secondId, chapterNum: 2, title: '加固', outline: '陈舟检查并更换系船绳。', chapterContract: { chapterGoal: '陈舟检查并更换系船绳' }, scenes: [{ pov: '陈舟', timeLocation: '清晨，渡口', sceneGoal: '检查系船绳', obstacle: '旧绳磨断', resultState: '渡船停稳', revealPayload: [] }], allowedFactIds: [], revealedFactIds: [] }] }), review,
      JSON.stringify({ chapterNum: 2, title: '加固', content: prose, summary: '陈舟与林禾检查绳结，渡船停稳。', changes: [] }), review)
    const second = (await call('workflows.start', { stage: 'chapter', request: '继续检查渡船。', atChapter: 2, idempotencyKey: 'chapter-draft-contract' })).run
    const secondDone = await finish(second.runId)
    assert.equal(secondDone.status, 'success', JSON.stringify(secondDone))
    assert.equal(requests.length, beforeSecond + 4, 'draft status cannot skip the reviewed prerequisite workflow')
    assert.equal(sqlite.prepare('SELECT status FROM chapter_contracts WHERE chapter_id=?').get(secondId).status, 'ready')
    const queriedChapter = await call('assets.query', { chapterId: secondId })
    assert.equal(queriedChapter.chapter.id, secondId)
    assert.equal(queriedChapter.chapterContract.chapterGoal, '陈舟检查并更换系船绳')
    assert.equal(queriedChapter.scenes.length, 1, 'external agents receive the real executable scene contract without the old orphan')

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
    assert.equal(replies.length, 0)
    process.stdout.write('PASS creative workflow: async model/review/apply, incremental graph, replay, malformed review, stale rejection, cancellation. Loopback fixture only.\n')
  } finally {
    heldResponse?.destroy(); server.closeAllConnections(); server.close(); closeDb()
    if (!path.resolve(temp).startsWith(path.resolve(root, '.tmp-tests') + path.sep)) throw new Error('unsafe cleanup')
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
