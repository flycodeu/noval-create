const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { randomUUID } = require('node:crypto')
const { app } = require('electron')
require('./isolate-test-session.cjs')(app)
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const base = path.join(root, '.tmp-tests')
fs.mkdirSync(base, { recursive: true })
const temp = fs.mkdtempSync(path.join(base, 'author-library-'))
app.setPath('userData', temp)
app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
let calls = 0
let browserFixture = false
const sampleText = '船工把长绳压在铺里，换回一桶桐油。\n\n“天黑前还你。”他说。\n\n掌柜伸出手，却没有接那张欠条。'
const server = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  calls++
  const analysis = body.includes('风格分析师')
  const output = analysis ? JSON.stringify({ narrativeTechniques: '通过动作表达承诺与疑虑', dialogueStyle: '短句对话', descriptionDensity: '细节集中于工具', paceProfile: '短段落推进', exampleExcerpts: ['船工把长绳压在铺里，换回一桶桐油。', '模型虚构的引文'], avgSentenceLength: 9999, dialogueLineRate: 99 }) : '船工把绳头打了个结。\n\n“等我回来。”他推开门，桐油桶碰着门框。'
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 30, total_tokens: 60 } }))
})
async function main() {
  await app.whenReady()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dbModule = require('../electron/database/db.ts')
  dbModule.initDb()
  const sql = dbModule.getSqlite()
  const novels = require('../electron/services/novel.service.ts')
  const research = require('../electron/services/creative-research.service.ts')
  const personal = require('../electron/services/personal-research.service.ts')
  const atlas = require('../electron/services/story-atlas.service.ts')
  const ledger = require('../electron/services/author-ledger.service.ts')
  const styles = require('../electron/services/author-style.service.ts')
  const styleBase = require('../electron/services/style-analysis.service.ts')
  const assets = require('../electron/services/endgame-asset.service.ts')
  const model = require('../electron/services/model.service.ts')
  const { novelForgeToolRegistry: registry } = require('../electron/application/novelforge-tool-registry.ts')
  const { DESKTOP_AGENT_TOOL_SCOPES } = require('../src/shared/tool-contracts/index.ts')
  const context = { actor: { type: 'api_client', actorId: 'library-fixture', clientId: 'fixture' }, scopes: [...DESKTOP_AGENT_TOOL_SCOPES] }
  const call = async (name, input) => { const result = await registry.invoke({ toolId: `novelforge.${name}`, input }, context); assert.ok(result.ok, JSON.stringify(result)); return result.data }
  const modelId = Number(sql.prepare('INSERT INTO model_configs(name,provider,model_id,api_key,base_url,max_tokens,max_context_tokens,is_default) VALUES(?,?,?,?,?,?,?,1)').run('隔离文风模型', 'openai', 'fixture', model.encryptApiKey('fixture'), `http://127.0.0.1:${server.address().port}/v1`, 4096, 32768).lastInsertRowid)
  const a = novels.createNovel({ title: '共享来源测试', operatingMode: 'creative_workflow', modelConfigId: modelId })
  const b = novels.createNovel({ title: '第二批验证作品', operatingMode: 'creative_workflow', modelConfigId: modelId })
  const version = id => novels.getNovel(id).contextVersion
  const draft = { category: 'narrative', title: '抵押与承诺', content: '工具抵押使承诺产生可见成本。', interpretation: '信任也需要承担后果。', novelConnection: '本作私有转化不应发布。' }
  try {
    const entry = research.upsertAuthorCreativeResearch(a, [draft])[0]
    const provenance = { artifactId: 'source-artifact', candidateId: 'one', sourceHash: 'source-hash', sourceLabel: '测试段落', start: 0, end: 4, quote: '船工抵押' }
    const novel = novels.getNovel(a)
    const rows = JSON.parse(novel.sourceLedgerJson); rows[0].provenance = provenance
    novels.updateNovel(a, { sourceLedgerJson: JSON.stringify(rows) })
    const published = (await call('research.publish', { novelId: a, sourceKey: entry.sourceKey })).card
    assert.equal(published.content.novelConnection, undefined)
    assert.equal(JSON.stringify(published).includes(draft.novelConnection), false)
    assert.deepEqual(published.content.provenance, provenance)
    assert.equal(personal.listPersonalResearch('', false, 'narrative').length, 1)
    assert.equal(personal.listPersonalResearch('', false, 'politics').length, 0)
    const adopt = card => call('research.reference', { novelId: b, cardId: card.id, expectedRevision: card.revision, expectedContextVersion: version(b), novelConnection: '第二部的原创转化。' })
    const first = (await adopt(published)).entry
    await adopt(published)
    assert.equal(research.listAuthorCreativeResearch(b).length, 1)
    research.upsertAuthorCreativeResearch(b, [{ ...first, novelConnection: '作者在第二部中独立调整。' }])
    const next = personal.updatePersonalResearch(published.id, 1, { ...published.content, content: '新版通用内容。' }, false)
    assert.equal(research.getAuthorCreativeResearch(b, first.sourceKey).content, draft.content)
    assert.equal(personal.publishPersonalResearch(a, entry.sourceKey).revision, 2, 'repeat publish cannot overwrite')
    assert.throws(() => personal.updatePersonalResearch(published.id, 1, published.content, false), /新版/)
    await adopt(next)
    const updated = research.getAuthorCreativeResearch(b, first.sourceKey)
    assert.equal(updated.content, '新版通用内容。')
    assert.equal(updated.novelConnection, '作者在第二部中独立调整。')
    const staleVersion = version(b)
    const third = personal.updatePersonalResearch(next.id, next.revision, { ...next.content, title: '第三版' }, false)
    novels.updateNovel(b, { synopsis: '触发版本变化' })
    assert.throws(() => personal.referencePersonalResearch({ novelId: b, cardId: third.id, expectedRevision: third.revision, expectedContextVersion: staleVersion, novelConnection: '不能覆盖' }), /变化/)
    const archived = personal.updatePersonalResearch(third.id, third.revision, third.content, true)
    assert.equal(personal.listPersonalResearch().length, 0)
    assert.equal(personal.listPersonalResearch('', true).length, 1)
    await assert.rejects(() => adopt(archived), /归档/)
    assert.deepEqual(research.getAuthorCreativeResearch(b, first.sourceKey).provenance, provenance)

    const atlasInput = changes => ({ novelId: b, expectedContextVersion: version(b), effectiveFromChapter: 0, idempotencyKey: randomUUID(), source: { kind: 'fixture' }, changes })
    const made = atlas.applyStoryAtlasChanges(atlasInput([{ op: 'upsert_entity', clientId: 'hero', kind: 'character', name: '陆闻', attributes: { origin: '渡口', abilityLimits: '不能隔墙识物' } }]))
    const hero = made.idMap.hero
    await call('ledger.correct_character', { novelId: b, entityId: hero, expectedContextVersion: version(b), effectiveFromChapter: 0, name: '陆闻', origin: '船户', abilityLimits: '不能隔墙识物', protectedFields: ['name', 'attributes.origin'], note: '作者核对人物出身', idempotencyKey: 'protect-hero' })
    const change = atlasInput([{ op: 'upsert_entity', id: hero, kind: 'character', name: '陆闻', attributes: { origin: '世家' } }])
    assert.throws(() => atlas.validateStoryAtlasChanges(change), /作者保护/)
    await assert.rejects(() => call('atlas.apply', change), /作者保护/)
    atlas.applyStoryAtlasChanges(atlasInput([{ op: 'upsert_entity', id: hero, kind: 'character', name: '陆闻', attributes: { injury: '左手受伤' } }]))
    assert.equal(ledger.getAuthorLedger(b).characters[0].entity.attributes.origin, '船户')
    const snapshots = sql.prepare('SELECT snapshot_json FROM story_atlas_revisions WHERE novel_id=?').all(b)
    assert.ok(snapshots.every(row => !row.snapshot_json.includes('protectedFields')))
    await call('ledger.correct_character', { novelId: b, entityId: hero, expectedContextVersion: version(b), effectiveFromChapter: 0, name: '陆闻', origin: '船户', abilityLimits: '不能隔墙识物', protectedFields: [], note: '明确解除保护', idempotencyKey: 'unlock-hero' })
    atlas.applyStoryAtlasChanges(atlasInput([{ op: 'upsert_entity', id: hero, kind: 'character', name: '陆闻', attributes: { origin: '世家' } }]))
    assert.equal(ledger.getAuthorLedger(b).characters[0].entity.attributes.origin, '世家')
    atlas.applyStoryAtlasChanges({ ...atlasInput([{ op: 'upsert_entity', id: hero, kind: 'character', name: '陆闻', attributes: { injury: '右肩受伤' } }]), effectiveFromChapter: 3 })
    assert.equal(atlas.queryStoryAtlas({ novelId: b, atChapter: 3 }).entities.find(item => item.id === hero).attributes.injury, '右肩受伤')

    const chapterId = Number(sql.prepare('INSERT INTO chapters(novel_id,chapter_num,title,content) VALUES(?,1,?,?)').run(b, '渡口', sampleText).lastInsertRowid)
    const otherChapter = Number(sql.prepare('INSERT INTO chapters(novel_id,chapter_num,title,content) VALUES(?,1,?,?)').run(a, '异作', sampleText).lastInsertRowid)
    const clueId = Number(sql.prepare('INSERT INTO foreshadow_ledger(novel_id,title,detail) VALUES(?,?,?)').run(b, '旧绳', '绳头系了结').lastInsertRowid)
    sql.prepare('INSERT INTO foreshadow_ledger(novel_id,title,detail) VALUES(?,?,?)').run(b, '旧 绳', '须人工核对是否重复')
    assert.equal(ledger.getAuthorLedger(b).duplicateGroups.length, 1)
    const correction = { novelId: b, expectedContextVersion: version(b), id: clueId, title: '旧绳', detail: '作者确认绳结标记身份', status: 'resolved', sourceChapterId: chapterId, targetPayoffChapter: 1, actualPayoffChapterId: chapterId, requiredEvidence: '绳结被船工认出' }
    assert.throws(() => ledger.correctAuthorClue({ ...correction, actualPayoffChapterId: otherChapter }), /不属于/)
    await call('ledger.correct_clue', correction)
    assert.throws(() => assets.upsertForeshadowLedger(b, { id: clueId, detail: '自动覆盖' }), /作者更正/)
    assert.equal(ledger.getAuthorLedger(b).clues.find(item => item.id === clueId).actualPayoffChapterId, chapterId)
    const legacyClueId = sql.prepare('SELECT id FROM foreshadow_ledger WHERE novel_id=? AND id<>?').get(b, clueId).id
    sql.prepare('UPDATE foreshadow_ledger SET status=? WHERE id=?').run('active', legacyClueId)
    await call('ledger.correct_clue', { ...correction, id: legacyClueId, expectedContextVersion: version(b), status: 'active', actualPayoffChapterId: null })
    assert.equal(ledger.getAuthorLedger(b).clues.find(item => item.id === legacyClueId).status, 'active', 'legacy states stay intact during explicit edits')

    const analyzed = await call('style.analyze', { novelId: b, name: '渡口样稿', chapterIds: [chapterId] })
    assert.notEqual(analyzed.stats.avgSentenceLength, 9999)
    assert.deepEqual(analyzed.fingerprint.exampleExcerpts, ['船工把长绳压在铺里，换回一桶桐油。'])
    assert.equal(styleBase.resolveAuthorStyleMaterial(b).approvedSample, undefined)
    await call('style.approve', { novelId: b, fingerprintId: analyzed.record.id, expectedContextVersion: version(b) })
    assert.ok(styleBase.resolveAuthorStyleMaterial(b).approvedSample)
    sql.prepare('UPDATE chapters SET content=? WHERE id=?').run(sampleText + '作者新增一句。', chapterId)
    assert.deepEqual(styleBase.resolveAuthorStyleMaterial(b).styleSourceDiagnostics, ['source_chapter_changed'])
    assert.throws(() => styles.approveAuthorStyle(b, analyzed.record.id, version(b)), /重新分析/)
    const copied = (await call('style.copy_sample', { novelId: a, sourceId: analyzed.record.id })).record
    assert.equal(styles.copyAuthorStyle(a, analyzed.record.id).record.id, copied.id)
    assert.equal(styleBase.resolveAuthorStyleMaterial(a).approvedSample, undefined)
    await assert.rejects(() => call('style.approve', { novelId: a, fingerprintId: analyzed.record.id, expectedContextVersion: version(a) }))
    await call('style.approve', { novelId: a, fingerprintId: copied.id, expectedContextVersion: version(a) })
    const trial = await call('style.trial', { novelId: a, fingerprintId: copied.id, sceneBrief: '船工抵押绳索换桐油，只写他的承诺和掌柜的犹豫。' })
    assert.ok(trial.withFingerprint.text && trial.without.text)
    assert.equal(calls, 3, 'one analysis and two trial requests')
    const trialSample = await call('style.approve_trial', { novelId: a, text: trial.withFingerprint.text, expectedContextVersion: version(a) })
    assert.equal(trialSample.record.sourceText, trial.withFingerprint.text)
    assert.equal(styleBase.resolveAuthorStyleMaterial(a).approvedSample.text, trial.withFingerprint.text)
    assert.equal(sql.prepare('SELECT content FROM chapters WHERE id=?').get(otherChapter).content, sampleText, 'trial never writes chapters')
    await call('style.approve', { novelId: a, fingerprintId: null, expectedContextVersion: version(a) })
    assert.equal(styleBase.resolveAuthorStyleMaterial(a).approvedSample, undefined)

    // Whole database backup preserves new shared cards and revision metadata.
    await sql.backup(path.join(temp, 'backup.db'))
    const Database = require('better-sqlite3')
    const backup = new Database(path.join(temp, 'backup.db'), { readonly: true })
    assert.equal(backup.prepare('SELECT count(*) n FROM personal_research').get().n, 1)
    assert.deepEqual(JSON.parse(backup.prepare('SELECT content_json FROM personal_research').get().content_json).provenance, provenance)
    assert.ok(backup.prepare("SELECT author_protection_json FROM story_atlas_revisions WHERE author_protection_json<>'[]' LIMIT 1").get())
    backup.close()
    sql.prepare('DELETE FROM novels WHERE id=?').run(a)
    assert.deepEqual(personal.getPersonalResearch(published.id).content.provenance, provenance, 'deleting origin keeps shared quote')
    assert.equal(styles.getAuthorStyle(analyzed.record.id).record.novelId, b)
    console.log('PASS author library: snapshot isolation, explicit revisions, private adaptation excluded, provenance survives deletion/backup, author protection conflicts/unlock, normal chapter changes, clue corrections, sample stats/approval/stale source, copy, two-variant trial; formal database untouched.')
    if (process.env.NOVELFORGE_LIBRARY_BROWSER_FIXTURE === '1') {
      browserFixture = true
      console.log(`BROWSER_FIXTURE ${JSON.stringify({ userData: temp, novelId: b, chapterId, hero, pid: process.pid })}`)
    }
  } finally {
    dbModule.closeDb()
    if (!browserFixture) { server.closeAllConnections(); server.close(); if (!path.resolve(temp).startsWith(base + path.sep)) throw new Error('Unsafe cleanup'); fs.rmSync(temp, { recursive: true, force: true }) }
  }
}
main().then(() => { if (!browserFixture) app.exit(0) }, error => { console.error(error); app.exit(1) })
