// Optional real-provider check. Reads only the default model configuration from the source library.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..'), base = path.join(root, '.tmp-tests')
const sourcePath = process.env.NOVELFORGE_REAL_MODEL_SOURCE
if (!sourcePath) throw new Error('Set NOVELFORGE_REAL_MODEL_SOURCE to a configured library database.')
fs.mkdirSync(base, { recursive: true })
const temp = fs.mkdtempSync(path.join(base, 'discovery-real-'))
const statePath = path.join(path.dirname(sourcePath), 'Local State')
if (fs.existsSync(statePath)) {
  const { os_crypt } = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (os_crypt) fs.writeFileSync(path.join(temp, 'Local State'), JSON.stringify({ os_crypt }))
}
app.setPath('userData', temp); app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  await app.whenReady()
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts'); initDb()
  const sql = getSqlite(), model = require('../electron/services/model.service.ts')
  const Database = require('better-sqlite3')
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  let config
  try { config = source.prepare('SELECT * FROM model_configs WHERE is_default=1 ORDER BY id LIMIT 1').get() } finally { source.close() }
  assert.ok(config && model.decryptApiKey(config.api_key), 'Configured model key unavailable.')
  const fields = Object.keys(config).filter(key => key !== 'id' && /^[a-z_]+$/.test(key) && sql.prepare('PRAGMA table_info(model_configs)').all().some(row => row.name === key))
  const modelId = Number(sql.prepare(`INSERT INTO model_configs(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...fields.map(key => config[key])).lastInsertRowid)
  const novels = require('../electron/services/novel.service.ts'), chapters = require('../electron/services/chapter.service.ts')
  const assets = require('../electron/services/endgame-asset.service.ts'), inspiration = require('../electron/services/inspiration.service.ts')
  const { novelForgeToolRegistry: registry } = require('../electron/application/novelforge-tool-registry.ts')
  const { DESKTOP_AGENT_TOOL_SCOPES } = require('../src/shared/tool-contracts/index.ts')
  const context = { actor: { type: 'api_client', actorId: 'real-discovery-test', clientId: 'isolated-test' }, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] }
  const call = async (name, input) => { const response = await registry.invoke({ toolId: `novelforge.${name}`, input }, context); assert.ok(response.ok, JSON.stringify(response)); return response.data }
  const report = { formalDatabaseWritten: false, realModelCalled: true, provider: config.provider, model: config.model_id }
  try {
    const novelId = novels.createNovel({ title: '行内补全真实模型验证', modelConfigId: modelId })
    const chapterId = chapters.createChapter(novelId, { chapterNum: 1, title: '修船' })
    const body = '陈舟把一卷绳索放在木匠的桌上。木匠看了看绳结，又看了看门外漏水的船。'
    chapters.updateChapter(chapterId, { content: body, wordCount: body.length })
    await call('atlas.apply', { novelId, expectedContextVersion: novels.getNovel(novelId).contextVersion, effectiveFromChapter: 0, idempotencyKey: 'real-discovery-character', source: { kind: 'author' }, changes: [{ op: 'upsert_entity', kind: 'character', name: '陈舟' }] })
    assets.upsertChapterContract(chapterId, { chapterGoal: '陈舟用绳索作抵押换取修船木料', acceptanceNotes: ['交出抵押物后才得到木料'], status: 'ready' })
    for (const scene of assets.listSceneContracts(chapterId)) assets.upsertSceneContract(chapterId, scene.segmentId || null, { pov: '陈舟', sceneGoal: '得到修船木料', obstacle: '缺乏担保', resultState: '留下绳索', status: 'ready' })
    const taskCount = sql.prepare('SELECT count(*) n FROM tasks').get().n
    const startedAt = Date.now()
    const inline = await call('writing.complete', { novelId, chapterId, editorId: randomUUID(), requestId: randomUUID(), editVersion: 1, cursor: body.length, before: body, after: '', mode: 'sentence' })
    Object.assign(report, { inline, inlineElapsedMs: Date.now() - startedAt })
    assert.ok(inline.text.trim() && !inline.cancelled && !inline.busy, 'No usable inline completion returned.')
    assert.ok(Array.from(inline.text).length <= 60)
    assert.equal(chapters.getChapter(chapterId).content, body)
    assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n, taskCount)
    const run = (await call('inspiration.generate', { draftId: randomUUID(), requestId: randomUUID(), kind: 'directions', seed: '普通船工用绳索抵押换取修船木料，三日内必须赎回。', constraints: '朴素现实题材，没有超能力与隐藏身份，不预定结局。', direction: '', request: '各方向通过不同的人物选择与现实代价形成区别。', modelConfigId: modelId })).run
    let result = run
    const deadline = Date.now() + 180000
    while (['pending', 'running', 'cancel_requested'].includes(result.status) && Date.now() < deadline) { await pause(300); result = inspiration.getInspirationRun(run.input.draftId, run.taskId) }
    if (['pending', 'running', 'cancel_requested'].includes(result.status)) inspiration.cancelInspirationRun(run.input.draftId, run.taskId)
    report.directions = result.result?.directions
    assert.equal(result.status, 'success', result.error || 'Real inspiration request timed out.')
    assert.ok(report.directions?.length >= 1 && report.directions.length <= 3)
    assert.equal(novels.listNovels().length, 1, 'Generating candidates must not create a placeholder novel.')
    if (process.env.NOVELFORGE_EXTENDED_AUTHOR_SMOKE === '1') {
      const waitFor = async (load, cancel) => {
        const until = Date.now() + 180000
        let current = load()
        while (['pending', 'running', 'cancel_requested'].includes(current.status) && Date.now() < until) { await pause(300); current = load() }
        if (['pending', 'running', 'cancel_requested'].includes(current.status)) { await cancel(); throw new Error('Extended real-model task timed out.') }
        assert.equal(current.status, 'success', current.error || current.message)
        return current
      }
      const paragraph = await call('writing.complete', { novelId, chapterId, editorId: randomUUID(), requestId: randomUUID(), editVersion: 2, cursor: body.length, before: body, after: '', mode: 'paragraph' })
      assert.ok(paragraph.text.trim() && Array.from(paragraph.text).length <= 220 && !paragraph.cancelled)
      const direction = `${report.directions[0].premise}\n核心冲突：${report.directions[0].conflict}`
      const packagingTask = (await call('inspiration.generate', { ...run.input, requestId: randomUUID(), kind: 'packaging', direction })).run
      const packaging = await waitFor(() => inspiration.getInspirationRun(run.input.draftId, packagingTask.taskId), () => inspiration.cancelInspirationRun(run.input.draftId, packagingTask.taskId))
      assert.ok(packaging.result.packages.length >= 1 && packaging.result.packages.length <= 3)
      const workflow = require('../electron/services/creative-workflow.service.ts'), assists = require('../electron/services/author-assist-task.service.ts')
      const revisions = require('../electron/services/selection-revision.service.ts'), reviewViews = require('../electron/services/chapter-review-view.service.ts')
      const artifacts = require('../electron/services/artifact.service.ts')
      const prefix = '陈舟把一卷绳索放在木匠的桌上。', original = '他没有交出绳索。木匠却把两块修船的木料递给了他。', suffix = '陈舟低头看着木料，门外的船还在漏水。'
      chapters.updateChapter(chapterId, { content: prefix + original + suffix })
      const review = async key => {
        const started = (await call('chapters.review', { novelId, chapterId, request: '重点核对是否先留下绳索作抵押，再得到木料。逐项提供原句证据；不因篇幅短否定这个完整小场景。', idempotencyKey: key })).run
        await waitFor(() => workflow.getCreativeRun(novelId, started.runId), () => call('workflows.cancel', { novelId, runId: started.runId }))
        const view = reviewViews.getChapterReviewView(novelId, chapterId)
        assert.ok(view && !view.stale && view.requirements.length > 0)
        return view
      }
      const before = await review('real-finish-review-before')
      const selection = { novelId, chapterId, start: prefix.length, end: prefix.length + original.length, original }
      const snapshot = revisions.previewSelectionRevision(selection)
      const revisionTask = await revisions.startSelectionRevision({ ...selection, ...snapshot, request: '修复先后因果：陈舟先将绳索作为抵押留在桌上，木匠确认后才给木料。只改选区，两三句即可；不增加人物、地点、身世和超能力。', idempotencyKey: 'real-finish-selection' })
      const revised = await waitFor(() => assists.getAuthorAssistRun(novelId, revisionTask.taskId), () => assists.cancelAuthorAssistRun(novelId, revisionTask.taskId))
      const candidate = artifacts.requireArtifact(revised.artifactId).content
      assert.notEqual(candidate.replacement, original)
      revisions.applySelectionRevision({ novelId, chapterId, artifactId: revised.artifactId, expectedContentHash: snapshot.sourceContentHash, expectedContextVersion: snapshot.contextVersion, idempotencyKey: 'real-finish-adopt' })
      assert.equal(chapters.getChapter(chapterId).content, prefix + candidate.replacement + suffix)
      assert.equal(reviewViews.getChapterReviewView(novelId, chapterId, before.reportId).stale, true)
      const after = await review('real-finish-review-after')
      report.extended = { paragraph, packages: packaging.result.packages, before, selectedOriginal: original, replacement: candidate.replacement, after, preservedPrefixAndSuffix: true, oldReviewMarkedStale: true }
      console.log(JSON.stringify({ extendedFlow: 'passed', paragraphChars: Array.from(paragraph.text).length, packageCount: packaging.result.packages.length, reviewBefore: before.status, reviewAfter: after.status }))
    }
    report.passed = true
  } catch (error) { Object.assign(report, { passed: false, error: error.message }); process.exitCode = 1 }
  finally {
    report.attempts = sql.prepare('SELECT status,usage_json,completion_json,output_chars FROM model_request_attempts ORDER BY rowid').all().map(row => ({ status: row.status, usage: JSON.parse(row.usage_json), completion: row.completion_json ? JSON.parse(row.completion_json) : null, outputChars: row.output_chars }))
    closeDb()
    const output = path.join(root, 'outputs', process.env.NOVELFORGE_EXTENDED_AUTHOR_SMOKE === '1' ? 'wenlan-completion' : 'wenlan-third-batch'); fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(path.join(output, 'real-model-smoke.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ passed: report.passed, formalDatabaseWritten: false, provider: report.provider, model: report.model, inlineElapsedMs: report.inlineElapsedMs, directionCount: report.directions?.length, error: report.error }))
    if (!path.resolve(temp).startsWith(base + path.sep)) throw new Error('Unsafe cleanup')
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(process.exitCode || 0), error => { console.error(error.message); app.exit(1) })
