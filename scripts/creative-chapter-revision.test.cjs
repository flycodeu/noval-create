const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(root, '.tmp-tests', 'chapter-revision-'))
app.setPath('userData', temp)
app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
const replies = [], requests = []
const review = JSON.stringify({ summary: '修订范围与正文事实一致。', severity: 'low', rewrite_required: false, reject_required: false, top_fixes: [], issues: [] })
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const part of req) body += part
  requests.push(JSON.parse(body))
  const reply = replies.shift()
  if (reply === undefined) { res.writeHead(500).end('unexpected model call'); return }
  const output = typeof reply === 'string' ? reply : reply.output
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ id: `fixture-${requests.length}`, choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: typeof reply === 'string' ? 'stop' : reply.finishReason }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }))
})
async function main() {
  await app.whenReady(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { initDb, closeDb, getSqlite } = require('../electron/database/db.ts')
  initDb(); const sqlite = getSqlite()
  const model = require('../electron/services/model.service.ts')
  const models = Number(sqlite.prepare('INSERT INTO model_configs(name,provider,model_id,api_key,base_url,max_tokens,max_context_tokens,is_default) VALUES(?,?,?,?,?,?,?,1)').run('Revision loopback', 'openai', 'revision-fixture', model.encryptApiKey('fixture-only'), `http://127.0.0.1:${server.address().port}/v1`, 8000, 64000).lastInsertRowid)
  const { novelForgeToolRegistry: registry } = require('../electron/application/novelforge-tool-registry.ts')
  const context = { actor: { type: 'api_client', actorId: 'fixture', clientId: 'fixture' }, scopes: [...require('../src/shared/tool-contracts/index.ts').DESKTOP_AGENT_TOOL_SCOPES] }
  const novel = require('../electron/services/novel.service.ts'), chapter = require('../electron/services/chapter.service.ts'), atlas = require('../electron/services/story-atlas.service.ts'), contracts = require('../electron/services/endgame-asset.service.ts')
  const artifacts = require('../electron/services/artifact.service.ts'), tasks = require('../electron/services/task.service.ts')
  const novelId = novel.createNovel({ title: '局部修订试验', userBackground: '沈墨看守干台上的纸片。', modelConfigId: models })
  let key = 0
  const invoke = (tool, input) => registry.invoke({ toolId: `novelforge.${tool}`, input: { novelId, ...input } }, context)
  const call = async (tool, input) => { const result = await invoke(tool, input); assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
  const start = input => call('workflows.start', { stage: 'chapter', atChapter: 1, count: 1, autoApply: false, request: '按指定范围修订。', idempotencyKey: `revision-test-${++key}`, ...input })
  const finish = async id => { for (let i = 0; i < 300; i++) { const run = (await call('workflows.get', { runId: id })).run; if (!['pending', 'running', 'cancel_requested'].includes(run.status)) return run; await new Promise(resolve => setTimeout(resolve, 20)) } throw new Error('workflow timeout') }
  try {
    const person = atlas.applyStoryAtlasChanges({ novelId, expectedContextVersion: novel.getNovel(novelId).contextVersion, effectiveFromChapter: 0, source: { kind: 'user', id: 'fixture' }, idempotencyKey: 'revision-cast', changes: [{ op: 'upsert_entity', clientId: 'lu', kind: 'character', name: '沈墨', summary: '干台的看守者', attributes: { roleType: 'protagonist', publicSummary: '看守纸片的人' }, status: 'confirmed' }] }).idMap.lu
    const chapterId = chapter.createChapter(novelId, { chapterNum: 1, title: '干台', outline: '沈墨核对纸片是否仍干，记录而不移动。' })
    contracts.upsertChapterContract(chapterId, { chapterGoal: '核对纸片是否仍干', status: 'ready' })
    const segmentId = require('../electron/services/story-structure.service.ts').listChapterSegments(chapterId)[0].id
    contracts.upsertSceneContract(chapterId, segmentId, { pov: '沈墨', timeLocation: '当日，干台', sceneGoal: '核对纸片', obstacle: '不能移动原物', resultState: '记录纸片仍干', status: 'ready' })
    const content = '  沈墨站在干台边，核对纸片是否仍干。\r\n \t\r\n他看见纸片仍干，把原位置记在薄册。\r\n\r\n他合上薄册，没有移动纸片。 '
    const full = { chapterNum: 1, title: '干台', content, summary: '沈墨核对纸片。', changes: [], factReveals: [] }
    replies.push(JSON.stringify(full), review)
    const source = await finish((await start({ request: '生成完整正文候选。' })).run.runId)
    assert.equal(source.status, 'paused', JSON.stringify(source)); assert.equal(chapter.getChapter(chapterId).content, null)

    // A summary patch of an unapplied candidate never silently adopts that candidate.
    const beforeSummary = requests.length
    replies.push(JSON.stringify({ summary: '沈墨确认纸片仍干，记下位置。' }), review)
    const summary = await finish((await start({ sourceArtifactId: source.artifactId, autoApply: true, chapterRevision: { target: 'summary' } })).run.runId)
    assert.equal(summary.status, 'paused', JSON.stringify(summary)); assert.equal(chapter.getChapter(chapterId).content, null)
    assert.equal(requests.length, beforeSummary + 2)
    assert.equal(requests[beforeSummary].max_tokens, 2000); assert.equal(requests[beforeSummary + 1].max_tokens, 6000)
    assert.deepEqual(JSON.parse(artifacts.requireArtifact(summary.artifactId).content.output), { summary: '沈墨确认纸片仍干，记下位置。' })

    replies.push(JSON.stringify({ paragraphs: [{ index: 2, text: '他看见纸片仍干，随即将原位置记入薄册。' }] }), review)
    const paragraphs = await finish((await start({ sourceArtifactId: summary.artifactId, chapterRevision: { target: 'paragraphs', paragraphIndexes: [2] } })).run.runId)
    assert.equal(paragraphs.status, 'paused', JSON.stringify(paragraphs))
    const generation = requests.at(-2).messages[0].content
    assert.ok(generation.includes('指定段落')); assert.equal(generation.includes('"output"'), false, 'generation must not repeat the complete source artifact JSON')
    await call('workflows.apply', { runId: paragraphs.runId })
    const expected = content.replace('他看见纸片仍干，把原位置记在薄册。', '他看见纸片仍干，随即将原位置记入薄册。')
    assert.equal(chapter.getChapter(chapterId).content, expected); assert.equal(chapter.getChapter(chapterId).summary, '沈墨确认纸片仍干，记下位置。')
    const appliedVersion = novel.getNovel(novelId).contextVersion
    await call('workflows.apply', { runId: paragraphs.runId }); assert.equal(novel.getNovel(novelId).contextVersion, appliedVersion)

    // Formal summary repairs preserve prose and status, and detect even edits made outside version bookkeeping.
    replies.push(JSON.stringify({ summary: '只修正式摘要。' }), review)
    const formal = await finish((await start({ chapterRevision: { target: 'summary' } })).run.runId)
    const originalStatus = chapter.getChapter(chapterId).status
    await call('workflows.apply', { runId: formal.runId })
    assert.equal(chapter.getChapter(chapterId).content, expected); assert.equal(chapter.getChapter(chapterId).status, originalStatus)
    replies.push(JSON.stringify({ summary: '过期摘要。' }), review)
    const stale = await finish((await start({ chapterRevision: { target: 'summary' } })).run.runId)
    sqlite.prepare('UPDATE chapters SET summary=? WHERE id=?').run('作者另改摘要。', chapterId)
    assert.equal((await invoke('workflows.apply', { runId: stale.runId })).ok, false)
    assert.equal(chapter.getChapter(chapterId).summary, '作者另改摘要。')

    const beforeInvalid = requests.length
    assert.equal((await invoke('workflows.start', { stage: 'chapter', atChapter: 1, request: '越界', chapterRevision: { target: 'paragraphs', paragraphIndexes: [99] }, idempotencyKey: 'bad-paragraph-range' })).ok, false)
    assert.equal((await invoke('workflows.start', { stage: 'chapter', atChapter: 1, request: '非法scope', changeScope: { chapterIds: [chapterId] }, idempotencyKey: 'bad-chapter-scope' })).ok, false)
    assert.equal(requests.length, beforeInvalid)
    const invalid = { ...full, content: expected, changes: [{ op: 'upsert_entity', kind: 'character', id: person, name: '沈墨', attributes: { publicSummary: '擅改人物', evidenceQuote: '沈墨站在干台边' } }] }
    for (const changeScope of [undefined, {}]) {
      replies.push(JSON.stringify(invalid), JSON.stringify(invalid))
      const blocked = await finish((await start({ changeScope })).run.runId)
      assert.equal(blocked.status, 'blocked', JSON.stringify(blocked)); assert.equal(blocked.result.reviewFailureStage, 'contract')
      assert.equal(atlas.queryStoryAtlas({ novelId, atChapter: 1 }).entities.find(row => row.id === person).attributes.publicSummary, '看守纸片的人')
    }

    // Persist failed review evidence, then recover only the missing review without regenerating the patch.
    const beforeFailure = requests.length
    replies.push(JSON.stringify({ summary: '恢复后通过的摘要。' }), { output: review, finishReason: 'length' })
    const failed = await finish((await start({ chapterRevision: { target: 'summary' } })).run.runId)
    assert.equal(failed.status, 'blocked', JSON.stringify(failed)); assert.equal(failed.recoveryPending, true)
    assert.deepEqual(failed.result.issueIds, [], 'a failed review request is not a novel-content finding')
    const oldDraft = artifacts.requireArtifact(failed.artifactId), oldReport = artifacts.requireArtifact(failed.reviewArtifactId)
    assert.equal(requests.length, beforeFailure + 2)
    replies.push(review)
    await call('workflows.resume', { runId: failed.runId })
    const recovered = await finish(failed.runId)
    assert.equal(recovered.status, 'paused', JSON.stringify(recovered)); assert.equal(recovered.reviewStatus, 'passed')
    assert.equal(requests.length, beforeFailure + 3, 'recovery only calls the unfinished review, not generation')
    assert.notEqual(recovered.artifactId, oldDraft.id); assert.equal(artifacts.requireArtifact(oldReport.id).contentHash, oldReport.contentHash)
    assert.equal(JSON.parse(tasks.getTaskRecord(failed.runId).inputJson).attempt, 1)
    assert.equal(JSON.parse(tasks.getTaskRecord(failed.runId).inputJson).recoveryPass, 1)
    await call('workflows.apply', { runId: recovered.runId })
    assert.equal(chapter.getChapter(chapterId).summary, '恢复后通过的摘要。'); assert.equal(chapter.getChapter(chapterId).content, expected)
    assert.equal(artifacts.listArtifacts({ novelId, limit: 200 }).some(row => row.kind === 'creative_chapter_revision_base'), false)
    assert.equal(replies.length, 0)
    process.stdout.write('PASS bounded chapter revision: candidate chain, CRLF preservation, independent review reserve, formal-summary-only apply, CAS/idempotency, default graph isolation and failed-review recovery. Loopback fixture only.\n')
  } finally {
    server.closeAllConnections(); server.close(); closeDb()
    if (!path.resolve(temp).startsWith(path.resolve(root, '.tmp-tests') + path.sep)) throw new Error('unsafe cleanup')
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
