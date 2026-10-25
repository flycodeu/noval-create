const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { randomUUID } = require('node:crypto')
const { app } = require('electron')
require('./isolate-test-session.cjs')(app)
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..'), base = path.join(root, '.tmp-tests')
fs.mkdirSync(base, { recursive: true })
const temp = fs.mkdtempSync(path.join(base, 'writing-discovery-'))
app.setPath('userData', temp); app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
let keep = false, streamMode = 'normal', held, streamCalls = 0, closedStreams = 0, chatCalls = 0, badChat = false, holdChat = false, heldChat
const requests = []
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw); requests.push(body)
  if (body.stream) {
    streamCalls++; res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.flushHeaders()
    let timer
    res.on('close', () => { closedStreams++; clearInterval(timer) })
    if (streamMode === 'hold') { held = res; res.write(': waiting\n\n'); return }
    const parts = streamMode === 'long' ? ['字'.repeat(500)]
      : streamMode === 'split-quote' ? ['他低声说：“走吧。', '”', '这句不应进入补全结果。']
      : streamMode === 'sentence-eof' ? ['船工望向河面。']
      : streamMode === 'empty' ? []
      : ['船工收紧', '绳结，抬眼望向河面。', '这句不应进入补全结果。']
    timer = setInterval(() => {
      const chunk = parts.shift()
      if (chunk) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
      else { clearInterval(timer); res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":20,"total_tokens":40}}\n\ndata: [DONE]\n\n'); res.end() }
    }, streamMode === 'slow' ? 150 : 25)
    return
  }
  chatCalls++
  if (holdChat) { heldChat = res; res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); return }
  const packaging = raw.includes('书名和简介组合')
  const content = badChat ? 'not-json' : packaging
    ? JSON.stringify({ packages: [{ title: '渡口旧绳', synopsis: '船工抵押工具换取修船费用，必须在三日内找回丢失的担保凭据。' }, { title: '三日过河', synopsis: '修船与偿债的三天，让船工重新理解自己的承诺。' }] })
    : JSON.stringify({ directions: [{ title: '抵押的代价', premise: '船工抵押绳索换得修船木料。', conflict: '暂时修好船，却失去安全渡河的工具。' }, { title: '渡口的旧账', premise: '船工替木匠运送一册账本。', conflict: '偿还旧债与守住承诺之间必须作出选择。' }] })
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 40, total_tokens: 70 } }))
})
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  await app.whenReady(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts'); initDb()
  const sql = getSqlite(), novels = require('../electron/services/novel.service.ts'), chapters = require('../electron/services/chapter.service.ts')
  const assets = require('../electron/services/endgame-asset.service.ts'), model = require('../electron/services/model.service.ts')
  const inline = require('../electron/services/inline-completion.service.ts'), inspiration = require('../electron/services/inspiration.service.ts')
  const { novelForgeToolRegistry: registry } = require('../electron/application/novelforge-tool-registry.ts')
  const { DESKTOP_AGENT_TOOL_SCOPES } = require('../src/shared/tool-contracts/index.ts')
  const context = { actor: { type: 'api_client', actorId: 'discovery-fixture', clientId: 'fixture' }, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] }
  const call = async (name, input) => { const result = await registry.invoke({ toolId: `novelforge.${name}`, input }, context); assert.ok(result.ok, JSON.stringify(result)); return result.data }
  const modelId = Number(sql.prepare('INSERT INTO model_configs(name,provider,model_id,api_key,base_url,max_tokens,max_context_tokens,max_concurrency,is_default) VALUES(?,?,?,?,?,?,?,?,1)').run('第三批隔离模型', 'openai', 'fixture', model.encryptApiKey('fixture'), `http://127.0.0.1:${server.address().port}/v1`, 4096, 32768, 1).lastInsertRowid)
  const novelId = novels.createNovel({ title: '第三批写作验证', modelConfigId: modelId }), otherId = novels.createNovel({ title: '其他作品', modelConfigId: modelId })
  const chapterId = chapters.createChapter(novelId, { chapterNum: 1, title: '渡口' })
  const content = '船工站在渡口。\n\n老人望着河面。'
  chapters.updateChapter(chapterId, { content, wordCount: content.length })
  await call('atlas.apply', { novelId, expectedContextVersion: novels.getNovel(novelId).contextVersion, effectiveFromChapter: 0, idempotencyKey: 'discovery-fixture-cast', source: { kind: 'author' }, changes: [{ op: 'upsert_entity', kind: 'character', name: '船工' }] })
  assets.upsertChapterContract(chapterId, { chapterGoal: '船工筹措修船材料', acceptanceNotes: ['承担担保代价'], status: 'ready' })
  for (const scene of assets.listSceneContracts(chapterId)) assets.upsertSceneContract(chapterId, scene.segmentId || null, { pov: '船工', sceneGoal: '得到木料', obstacle: '缺少担保', resultState: '留下绳索', status: 'ready' })
  const input = () => ({ novelId, chapterId, editorId: 'fixture-editor-'+randomUUID(), requestId: randomUUID(), editVersion: 1, cursor: 7, before: '船工站在渡口。', after: '老人望着河面。', mode: 'sentence' })
  const wait = async run => { for (let i = 0; i < 200; i++) { const next = inspiration.getInspirationRun(run.input.draftId, run.taskId); if (!['pending','running','cancel_requested'].includes(next.status)) return next; await pause(20) }; throw new Error('inspiration timeout') }
  try {
    const taskCount = sql.prepare('SELECT count(*) n FROM tasks').get().n, artifactCount = sql.prepare('SELECT count(*) n FROM artifacts').get().n
    const suggestion = await call('writing.complete', input())
    assert.equal(suggestion.text, '船工收紧绳结，抬眼望向河面。')
    streamMode = 'split-quote'
    assert.equal((await call('writing.complete', input())).text, '他低声说：“走吧。”', 'closing quote in a later SSE chunk is preserved')
    streamMode = 'sentence-eof'
    assert.equal((await call('writing.complete', input())).text, '船工望向河面。', 'a trailing sentence is finalized when the upstream stream ends')
    streamMode = 'empty'
    const beforeEmpty = streamCalls
    assert.equal((await call('writing.complete', input())).text, '')
    assert.equal(streamCalls, beforeEmpty + 1, 'an empty response does not silently trigger another model request')
    streamMode = 'long'
    assert.equal(Array.from((await call('writing.complete', { ...input(), mode: 'paragraph' })).text).length, 220)
    assert.equal(Array.from((await call('writing.complete', input())).text).length, 60)
    const preCancelled = input(), beforeCancel = streamCalls
    await call('writing.cancel_completion', { novelId, chapterId, editorId: preCancelled.editorId, requestId: preCancelled.requestId })
    assert.equal((await call('writing.complete', preCancelled)).cancelled, true)
    assert.equal(streamCalls, beforeCancel)
    streamMode = 'hold'; held = null
    const heldInput = input(), heldRequest = call('writing.complete', heldInput)
    while (!held) await pause(10)
    const beforeBusy = streamCalls
    assert.equal((await call('writing.complete', input())).busy, true)
    assert.equal(streamCalls, beforeBusy, 'busy completion is not queued or sent')
    await call('writing.cancel_completion', { novelId, chapterId, editorId: heldInput.editorId, requestId: heldInput.requestId })
    assert.equal((await heldRequest).cancelled, true)
    held.destroy(); held = null
    streamMode = 'slow'
    const staleInput = input(), stale = call('writing.complete', staleInput)
    await pause(90); novels.updateNovel(novelId, { synopsis: '作者改动设定' })
    assert.equal((await stale).cancelled, true)
    await assert.rejects(() => call('writing.complete', { ...input(), novelId: otherId }), /章节不属于/)
    assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n, taskCount, 'inline completion creates no background task')
    assert.equal(sql.prepare('SELECT count(*) n FROM artifacts').get().n, artifactCount, 'inline completion creates no artifact')
    assert.equal(chapters.getChapter(chapterId).content, content)
    assert.ok(sql.prepare('SELECT count(*) n FROM model_request_attempts').get().n > 0, 'existing request telemetry retained')
    assert.ok(closedStreams >= 4, 'upstream streams close at caps or cancellation')

    const beforeBooks = novels.listNovels().length
    const idea = { draftId: randomUUID(), requestId: randomUUID(), kind: 'directions', seed: '普通船工想修好漏水的船', constraints: '没有超能力', direction: '', request: '', modelConfigId: modelId }
    const first = (await call('inspiration.generate', idea)).run
    const run = await wait(first)
    assert.equal(run.status, 'success', run.error)
    const callCount = chatCalls
    assert.equal((await call('inspiration.generate', idea)).run.taskId, first.taskId)
    assert.equal(chatCalls, callCount)
    await assert.rejects(() => call('inspiration.get', { draftId: randomUUID(), taskId: first.taskId }), /不属于/)
    assert.equal(novels.listNovels().length, beforeBooks, 'candidate generation never creates a placeholder novel')
    const direction = run.result.directions[0], directionText = `${direction.premise}\n核心冲突：${direction.conflict}`
    const packaging = await wait((await call('inspiration.generate', { ...idea, requestId: randomUUID(), kind: 'packaging', direction: directionText })).run)
    assert.equal(packaging.status, 'success')
    const selected = packaging.result.packages[0]
    const creation = { title: selected.title, synopsis: selected.synopsis, background: `${idea.seed}\n\n${directionText}`, constraints: idea.constraints, modelConfigId: modelId, idempotencyKey: `inspiration:${idea.draftId}:create`,
      inspiration: { draftId: idea.draftId, seed: idea.seed, directionTaskId: first.taskId, directionId: direction.id, packagingTaskId: packaging.taskId, packagingId: selected.id } }
    await assert.rejects(() => call('projects.create', { ...creation, constraints: '改过限制', idempotencyKey: 'stale-creation-key' }), /过期/)
    const [created, replay] = await Promise.all([call('projects.create', creation), call('projects.create', creation)])
    assert.equal(created.project.id, replay.project.id)
    assert.equal(novels.listNovels().length, beforeBooks + 1)
    assert.equal(created.project.synopsis, selected.synopsis)
    const source = JSON.parse(novels.getNovel(created.project.id).settingsJson).mcpCreation.inspiration
    assert.deepEqual(source.direction, direction)
    assert.deepEqual(source.packaging, selected)
    assert.equal((await call('projects.creation_status', { idempotencyKey: creation.idempotencyKey })).project.id, created.project.id)
    await assert.rejects(() => call('projects.create', { ...creation, title: '另一个标题' }))
    badChat = true
    const bad = await wait((await call('inspiration.generate', { ...idea, requestId: randomUUID() })).run)
    assert.equal(bad.status, 'failed', 'invalid JSON never becomes a selected candidate')
    badChat = false; holdChat = true
    const stopping = (await call('inspiration.generate', { ...idea, requestId: randomUUID() })).run
    while (!heldChat) await pause(10)
    await assert.rejects(() => call('inspiration.cancel', { draftId: randomUUID(), taskId: stopping.taskId }), /不属于/)
    await call('inspiration.cancel', { draftId: idea.draftId, taskId: stopping.taskId })
    assert.equal((await wait(stopping)).status, 'cancelled')
    heldChat.destroy(); heldChat = undefined; holdChat = false
    badChat = false; streamMode = 'normal'
    console.log('PASS writing discovery: bounded Unicode streams, split closing quotes and end-of-stream finalization, empty output without retry, abort and busy gating, stale context/cross-project rejection, no inline tasks/artifacts, telemetry, inspiration candidates without placeholder novels, source validation, idempotent creation and failure recovery. Formal library untouched.')
    if (process.env.NOVELFORGE_DISCOVERY_BROWSER_FIXTURE === '1') { keep = true; console.log(`BROWSER_FIXTURE ${JSON.stringify({ userData: temp, novelId, chapterId, pid: process.pid })}`) }
  } finally {
    closeDb()
    if (!keep) { server.closeAllConnections(); server.close(); if (!path.resolve(temp).startsWith(base + path.sep)) throw new Error('Unsafe cleanup'); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  }
}
main().then(() => { if (!keep) app.exit(0) }, error => { console.error(error); app.exit(1) })
