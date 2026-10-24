const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { app } = require('electron')
require('./isolate-test-session.cjs')(app)
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
fs.mkdirSync(path.join(root, '.tmp-tests'), { recursive: true })
const temp = fs.mkdtempSync(path.join(root, '.tmp-tests', 'author-assist-'))
app.setPath('userData', temp)
app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
const replies = []
const requests = []
let held
let keepForBrowser = false
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  requests.push(JSON.parse(body))
  const output = replies.shift() ?? (keepForBrowser ? (body.includes('提炼参考文本')
    ? JSON.stringify({ cards: [{ category: 'narrative', title: '抵押与代价', content: '船工抵押工具换取修船费用。', interpretation: '信用需要真实代价担保。', novelConnection: '让角色以劳动工具担保修船承诺。', quote: '留下绳索作为抵押' }] })
    : body.includes('rewrite_required') ? JSON.stringify({ summary: '本章未发现有证据的阻塞问题。', severity: 'low', rewrite_required: false, reject_required: false, issues: [], contractChecks: [{ contractItemId: 'chapterGoal', status: 'uncertain', reason: '请核对船工的动作是否体现本章目标。', evidence: [{ start: 2, end: 8, quote: '船工留下绳索' }] }] }) : '船工收回旧绳') : undefined)
  if (output === 'HOLD') { held = res; return }
  if (typeof output !== 'string') return res.writeHead(500).end('unexpected model call')
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }))
})
async function main() {
  await app.whenReady()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  initDb()
  const sql = getSqlite()
  const model = require('../electron/services/model.service.ts')
  const novels = require('../electron/services/novel.service.ts')
  const chapters = require('../electron/services/chapter.service.ts')
  const artifacts = require('../electron/services/artifact.service.ts')
  const research = require('../electron/services/reference-extraction.service.ts')
  const tasks = require('../electron/services/author-assist-task.service.ts')
  const selection = require('../electron/services/selection-revision.service.ts')
  const review = require('../electron/services/chapter-review-view.service.ts')
  const assets = require('../electron/services/endgame-asset.service.ts')
  const cards = require('../electron/services/creative-research.service.ts')
  const { novelForgeToolRegistry: registry } = require('../electron/application/novelforge-tool-registry.ts')
  const { DESKTOP_AGENT_TOOL_SCOPES } = require('../src/shared/tool-contracts/index.ts')
  const context = { actor: { type: 'api_client', actorId: 'fixture', clientId: 'fixture' }, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] }
  const call = async (name, input) => { const result = await registry.invoke({ toolId: `novelforge.${name}`, input }, context); assert.ok(result.ok, JSON.stringify(result)); return result.data }
  const modelId = Number(sql.prepare('INSERT INTO model_configs(name,provider,model_id,api_key,base_url,max_tokens,max_context_tokens,is_default) VALUES(?,?,?,?,?,?,?,1)').run('Author assist fixture', 'openai', 'fixture', model.encryptApiKey('fixture'), `http://127.0.0.1:${server.address().port}/v1`, 4000, 32000).lastInsertRowid)
  const novelId = novels.createNovel({ title: '渡口验证', userBackground: '船工以绳索抵押换取修船费用。', modelConfigId: modelId })
  const otherId = novels.createNovel({ title: '另一部作品', modelConfigId: modelId })
  const wait = async run => {
    for (let i = 0; i < 300; i++) {
      const next = tasks.getAuthorAssistRun(novelId, run.taskId)
      if (!['pending', 'running', 'cancel_requested'].includes(next.status)) return next
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw new Error('assist task timeout')
  }
  try {
    assert.deepEqual(chapters.sanitizeChapterUpdateOptions({ versionSource: 'version-restore', expectedContent: '旧稿' }), { versionSource: 'version-restore', expectedContent: '旧稿' })
    assert.throws(() => chapters.sanitizeChapterUpdateOptions({ versionSource: 'pipeline-generate' }))
    const text = '😀船工留下绳索作为抵押，修船后才能取回。'
    const draft = { category: 'narrative', title: '抵押与代价', content: '船工抵押工具以换取修船费用。', interpretation: '信用需要可见的担保。', novelConnection: '让主角承担真实的劳动损失。' }
    const input = { novelId, text, sourceTitle: '测试参考', sourceLabel: '第一章', request: '提取冲突与代价机制。', idempotencyKey: 'extract-one' }
    assert.ok(research.previewReferenceExtraction(input).fits)
    assert.throws(() => research.previewReferenceExtraction({ ...input, text: '字'.repeat(20001) }))
    replies.push(JSON.stringify({ cards: [{ ...draft, quote: '留下绳索作为抵押' }] }))
    const [first, duplicate] = await Promise.all([call('research.extract', input), call('research.extract', input)])
    assert.equal(first.run.taskId, duplicate.run.taskId)
    const completed = await wait(first.run)
    assert.equal(completed.status, 'success', completed.error)
    assert.equal(requests.length, 1, 'duplicate starts call model once')
    await assert.rejects(() => research.startReferenceExtraction({ ...input, request: '另一个要求' }), /幂等/)
    const artifact = artifacts.requireArtifact(completed.artifactId)
    assert.equal(artifact.content.source.text, text)
    const adopt = { novelId, artifactId: artifact.id, expectedContextVersion: novels.getNovel(novelId).contextVersion, idempotencyKey: 'adopt-one', entries: [{ candidateId: 'card-1', draft }] }
    const saved = await call('research.adopt', adopt)
    assert.equal(saved.sourceKeys.length, 1)
    assert.equal((await call('research.adopt', adopt)).idempotentReplay, true)
    assert.equal(cards.listAuthorCreativeResearch(novelId).length, 1)
    assert.ok(cards.listAuthorCreativeResearch(novelId)[0].provenance)
    cards.upsertAuthorCreativeResearch(novelId, [{ ...draft, sourceKey: saved.sourceKeys[0], title: '作者改过的标题' }])
    assert.equal(cards.listAuthorCreativeResearch(novelId)[0].provenance.quote, '留下绳索作为抵押')
    assert.throws(() => research.adoptReferenceCandidates({ ...adopt, idempotencyKey: 'adopt-again', expectedContextVersion: novels.getNovel(novelId).contextVersion }), /已有采用/)
    assert.throws(() => research.adoptReferenceCandidates({ ...adopt, novelId: otherId, expectedContextVersion: novels.getNovel(otherId).contextVersion }), /当前作品/)
    replies.push(JSON.stringify({ cards: [{ ...draft, quote: '正文不存在的引文' }] }))
    const invalid = await wait(await research.startReferenceExtraction({ ...input, idempotencyKey: 'invalid-evidence' }))
    assert.equal(invalid.status, 'success')
    assert.ok(artifacts.requireArtifact(invalid.artifactId).content.candidates[0].error)
    assert.throws(() => research.adoptReferenceCandidates({ ...adopt, artifactId: invalid.artifactId, idempotencyKey: 'invalid-adopt', expectedContextVersion: novels.getNovel(novelId).contextVersion }), /证据无效/)
    replies.push('HOLD')
    const cancelled = await research.startReferenceExtraction({ ...input, idempotencyKey: 'cancel-extract' })
    while (!held) await new Promise(resolve => setTimeout(resolve, 20))
    tasks.cancelAuthorAssistRun(novelId, cancelled.taskId)
    assert.equal((await wait(cancelled)).status, 'cancelled')
    held.destroy(); held = null
    assert.throws(() => tasks.getAuthorAssistRun(otherId, cancelled.taskId), /当前作品/)

    const content = '😀船工留下绳索。\n老人又留下绳索。'
    await call('atlas.apply', { novelId, expectedContextVersion: novels.getNovel(novelId).contextVersion, effectiveFromChapter: 0,
      idempotencyKey: 'fixture-cast', source: { kind: 'author', note: '隔离验证人物' }, changes: [{ op: 'upsert_entity', kind: 'character', name: '船工', summary: '经营渡口的船工' }] })
    const chapterId = chapters.createChapter(novelId, { chapterNum: 1, title: '绳索' })
    chapters.updateChapter(chapterId, { content, wordCount: content.length, summary: '旧摘要', reviewNotesJson: '{}' })
    assets.upsertChapterContract(chapterId, { chapterGoal: '船工抵押绳索', acceptanceNotes: ['留下绳索'], forbiddenActions: ['提前赎回'], status: 'ready' })
    for (const scene of assets.listSceneContracts(chapterId)) assets.upsertSceneContract(chapterId, scene.segmentId || null,
      { pov: '船工', sceneGoal: '筹得修船费用', obstacle: '缺少担保', resultState: '留下绳索', status: 'ready' })
    const start = content.lastIndexOf('留下绳索')
    const range = { novelId, chapterId, start, end: start + 4, original: '留下绳索' }
    const snapshot = selection.previewSelectionRevision(range)
    replies.push('收回旧绳')
    const revision = await wait(await selection.startSelectionRevision({ ...range, ...snapshot, request: '只将这个动作改成收回旧绳。', idempotencyKey: 'revision-one' }))
    assert.equal(revision.status, 'success', revision.error)
    const edited = selection.editSelectionRevision(novelId, revision.artifactId, '收起旧绳', 'author-edit-one')
    assert.equal(artifacts.requireArtifact(edited.artifactId).parentArtifactId, revision.artifactId)
    const apply = { novelId, chapterId, artifactId: edited.artifactId, expectedContentHash: snapshot.sourceContentHash, expectedContextVersion: snapshot.contextVersion, idempotencyKey: 'apply-one' }
    await call('chapters.apply_selection', apply)
    assert.equal(chapters.getChapter(chapterId).content, '😀船工留下绳索。\n老人又收起旧绳。')
    assert.ok(chapters.listChapterVersions(chapterId).some(version => version.content === content), 'original baseline retained')
    assert.ok(!chapters.getChapter(chapterId).summary, 'derived summary invalidated')
    assert.equal((await call('chapters.apply_selection', apply)).idempotentReplay, true)
    assert.throws(() => selection.applySelectionRevision({ ...apply, chapterId: 999999 }), /不属于/)
    assert.throws(() => selection.applySelectionRevision({ ...apply, expectedContentHash: 'changed' }), /幂等/)

    const revised = chapters.getChapter(chapterId).content
    const nextRange = { novelId, chapterId, start: 3, end: 7, original: revised.slice(3, 7) }
    const nextSnapshot = selection.previewSelectionRevision(nextRange)
    replies.push('修订动作')
    const stale = await wait(await selection.startSelectionRevision({ ...nextRange, ...nextSnapshot, request: '调整动作', idempotencyKey: 'revision-stale' }))
    assert.equal(stale.status, 'success', stale.error)
    chapters.updateChapter(chapterId, { content: revised + '作者新增一句。' })
    assert.throws(() => selection.applySelectionRevision({ ...apply, artifactId: stale.artifactId, idempotencyKey: 'apply-stale', expectedContentHash: nextSnapshot.sourceContentHash, expectedContextVersion: nextSnapshot.contextVersion }), /变化|不一致/)

    const current = chapters.getChapter(chapterId)
    const contractSnapshot = review.chapterReviewSnapshot(chapterId)
    const report = artifacts.createArtifact({ novelId, kind: 'quality_report', contextVersion: novels.getNovel(novelId).contextVersion,
      producerType: 'system', producerId: 'fixture', producerClient: 'fixture', content: { chapterId, contentHash: artifacts.hashArtifactContent(current.content), contractSnapshot, contractHash: artifacts.hashArtifactContent(contractSnapshot), summary: '逐项核对', status: 'passed', review: { issues: [], contractChecks: [{ contractItemId: 'chapterGoal', status: 'met', reason: '已写到', evidence: [{ start: 3, end: 7, quote: current.content.slice(3, 7) }] }] } } })
    const view = (await call('chapters.review_view', { novelId, chapterId, reportId: report.id })).view
    assert.equal(view.stale, false)
    assert.equal(view.reviewedContentHash, artifacts.hashArtifactContent(current.content))
    assert.equal(view.currentContentHash, view.reviewedContentHash)
    assert.equal(view.requirements.find(item => item.id === 'chapterGoal').check.status, 'met')
    assert.equal(view.requirements.find(item => item.id === 'forbiddenActions.0').check, undefined, 'unassessed does not mean met')
    assets.upsertChapterContract(chapterId, { chapterGoal: '新合同目标' })
    assert.equal(review.getChapterReviewView(novelId, chapterId, report.id).stale, true)
    assert.equal(replies.length, 0)
    console.log('PASS author assist: extraction/adoption/provenance, idempotency, cancellation, cross-project isolation, exact Unicode selection, editable candidate history, stale conflicts, original version retention, derived invalidation, review evidence/contract freshness. Loopback model only; formal database untouched.')
    if (process.env.NOVELFORGE_ASSIST_BROWSER_FIXTURE === '1') {
      keepForBrowser = true
      console.log(`BROWSER_FIXTURE ${JSON.stringify({ userData: temp, novelId, chapterId, pid: process.pid })}`)
    }
  } finally {
    held?.destroy(); closeDb()
    if (!keepForBrowser) { server.closeAllConnections(); server.close() }
    if (!path.resolve(temp).startsWith(path.resolve(root, '.tmp-tests') + path.sep)) throw new Error('unsafe cleanup')
    if (!keepForBrowser) fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => { if (!keepForBrowser) app.exit(0) }, error => { console.error(error); app.exit(1) })
