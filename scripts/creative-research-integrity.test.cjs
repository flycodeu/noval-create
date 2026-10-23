const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const root = path.resolve(__dirname, '..')
const tempRoot = path.join(root, '.tmp-tests')
fs.mkdirSync(tempRoot, { recursive: true })
const profile = fs.mkdtempSync(path.join(tempRoot, 'creative-research-integrity-'))
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', profile)
registerProjectTsRuntime(root)

async function main() {
  await app.whenReady()
  const { initDb, getSqlite, closeDb } = require('../electron/database/db.ts')
  const { getNovel, updateNovel } = require('../electron/services/novel.service.ts')
  const { upsertAuthorCreativeResearch, deleteAuthorCreativeResearch, searchCreativeResearch } = require('../electron/services/creative-research.service.ts')
  const { onNovelResearchChanged } = require('../electron/utils/novel-research-events.ts')
  const { getNovelContextStatus } = require('../electron/services/context-impact.service.ts')
  const { createMemorySourceManifest, createMemorySourceRef } = require('../electron/services/memory-source-manifest.ts')
  const { buildStoryMemoryPromptPackage, refreshStoryMemoryCheckpoints } = require('../electron/services/story-memory.service.ts')
  process.env.NOVELFORGE_CONTEXT_COMPILER_MODE = 'active'
  initDb()
  const sqlite = getSqlite()
  const narrativeTime = new Date(Date.now() - 3600000).toISOString()
  const novelId = Number(sqlite.prepare('INSERT INTO novels (title,context_version,source_ledger_json,updated_at) VALUES (?,1,?,?)').run('资料完整性隔离测试', '[]', narrativeTime).lastInsertRowid)
  sqlite.prepare('INSERT INTO chapters (novel_id,chapter_num,title,content,context_version,stale_reason_json) VALUES (?,1,?,?,1,?)').run(novelId, '保留章节', '正式正文不得改变。', '[]')
  const manifest = { ...createMemorySourceManifest({ contextVersion: 1, sources: [createMemorySourceRef('novel', novelId, { title: '资料完整性隔离测试' }, narrativeTime)], range: { startChapterNum: 1, endChapterNum: 1 } }), auditExtension: { preserve: true } }
  const insertCheckpoint = sqlite.prepare('INSERT INTO story_memory_checkpoints (novel_id,scope_type,label,summary,stale,locked,source_context_version,source_manifest_json,character_cards_json,relation_cards_json,item_cards_json,timeline_cards_json,thread_cards_json,source_range_start,source_range_end) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  for (const [label, stale, locked, version, rawManifest] of [
    ['valid', 0, 0, 1, JSON.stringify(manifest)], ['locked', 0, 1, 1, JSON.stringify(manifest)],
    ['stale', 1, 0, 1, JSON.stringify(manifest)], ['older', 0, 0, 0, JSON.stringify(manifest)],
    ['legacy', 0, 0, 1, null], ['invalid', 0, 0, 1, '{}'],
  ]) insertCheckpoint.run(novelId, label === 'valid' ? 'novel' : 'volume', label, '既有记忆', stale, locked, version, rawManifest, '[]', '[]', '[]', '[]', '[]', 1, 1)
  for (const [label, patch, start, end] of [
    ['missing-unresolved', { unresolvedRefs: undefined }, 1, 1], ['non-array-unresolved', { unresolvedRefs: 'bad' }, 1, 1],
    ['mixed-unresolved', { unresolvedRefs: [null, 7] }, 1, 1], ['unresolved', { unresolvedRefs: ['pending-source'] }, 1, 1],
    ['negative-range', { range: { startChapterNum: -1, endChapterNum: 1 } }, 1, 1],
    ['reversed-range', { range: { startChapterNum: 2, endChapterNum: 1 } }, 1, 1],
    ['fraction-range', { range: { startChapterNum: 0.5, endChapterNum: 1 } }, 1, 1],
    ['range-mismatch', {}, 1, 2], ['negative-checkpoint-range', {}, -1, 1], ['missing-checkpoint-range', {}, null, null],
    ['null-zero-with-chapter', { range: { startChapterNum: 0, endChapterNum: 0 }, sources: [...manifest.sources, createMemorySourceRef('chapter', 1, { title: '不应出现在空范围' })] }, null, null],
    ['mixed-null-zero-range', { range: { startChapterNum: 0, endChapterNum: 0 } }, null, 0],
    ['empty-sources', { sources: [] }, 1, 1], ['invalid-source', { sources: [null] }, 1, 1],
    ['unknown-source', { sources: [{ ...manifest.sources[0], sourceKind: 'unknown' }] }, 1, 1],
    ['missing-hash', { sources: [{ ...manifest.sources[0], artifactHash: undefined }] }, 1, 1],
    ['missing-version', { sources: [{ ...manifest.sources[0], sourceVersion: undefined }] }, 1, 1],
    ['other-novel', { sources: [{ ...manifest.sources[0], sourceId: novelId + 1 }] }, 1, 1],
  ]) insertCheckpoint.run(novelId, 'volume', label, '坏来源必须保留', 0, 0, 1, JSON.stringify({ ...manifest, ...patch }), '[]', '[]', '[]', '[]', '[]', start, end)
  sqlite.prepare('INSERT INTO characters (novel_id,full_name,updated_at) VALUES (?,?,?)').run(novelId, '保持新鲜的人物', narrativeTime)
  sqlite.prepare('INSERT INTO story_items (novel_id,item_name,updated_at) VALUES (?,?,?)').run(novelId, '原已失效的物品', new Date(Date.parse(narrativeTime) - 120000).toISOString())
  // IDs overlap across tables; reference audit IDs must never become thread/timeline/contract dependencies.
  const chapterId = sqlite.prepare('SELECT id FROM chapters WHERE novel_id=?').get(novelId).id
  sqlite.prepare('INSERT INTO story_threads (id,novel_id,title,updated_at) VALUES (?,?,?,?)').run(novelId, novelId, '同ID线程', narrativeTime)
  sqlite.prepare('INSERT INTO timeline_events (id,novel_id,event_title,time_label,chapter_start_id,updated_at) VALUES (?,?,?,?,?,?)').run(novelId, novelId, '同ID时间轴', '旧时', chapterId, narrativeTime)
  sqlite.prepare('INSERT INTO chapter_contracts (novel_id,chapter_id,required_asset_refs_json) VALUES (?,?,?)').run(novelId, chapterId, JSON.stringify([{ assetType: 'creative_reference', assetId: novelId }]))
  const rows = table => sqlite.prepare(`SELECT * FROM ${table} WHERE ${table === 'novels' ? 'id' : 'novel_id'}=? ORDER BY id`).all(novelId)
  const derived = () => JSON.stringify(Object.fromEntries(['chapters', 'story_threads', 'timeline_events', 'chapter_contracts', 'story_memory_checkpoints', 'asset_change_impacts', 'revision_tasks'].map(table => [table, rows(table).map(row => {
    if (table !== 'story_memory_checkpoints' || !['valid', 'locked'].includes(row.label)) return row
    const { source_context_version, source_manifest_json, ...rest } = row
    const { contextVersion, ...manifestRest } = JSON.parse(source_manifest_json)
    return { ...rest, manifestRest }
  })])))
  const snapshot = () => JSON.stringify({ novel: rows('novels'), derived: derived(), checkpoints: rows('story_memory_checkpoints'), events: rows('asset_change_events') })
  const initialDerived = derived()
  const initialStatus = getNovelContextStatus(novelId)
  assert.deepEqual(initialStatus.staleAssetKeys, ['item'])
  assert.ok(initialStatus.staleCheckpointCount >= 4)
  const assertFreshDependencies = version => {
    const checkpoints = rows('story_memory_checkpoints')
    for (const row of checkpoints.filter(row => ['valid', 'locked'].includes(row.label))) {
      assert.equal(row.source_context_version, version)
      assert.equal(JSON.parse(row.source_manifest_json).contextVersion, version)
    }
    const status = getNovelContextStatus(novelId)
    assert.deepEqual(status.staleAssetKeys, ['item'], 'reference edits preserve fresh assets and never wash existing stale assets')
    assert.equal(status.staleCheckpointCount, checkpoints.length - 2, 'malformed, legacy, stale and older memory dependencies are never rebased')
    assert.equal(rows('asset_change_impacts').length, 0, 'neutral reference audits create no impacts even with overlapping asset IDs and explicit references')
    assert.equal(rows('revision_tasks').length, 0, 'neutral reference audits create no manual work')
    const prompt = buildStoryMemoryPromptPackage(novelId, { readOnly: true })
    assert.equal(prompt.observability.buckets.find(bucket => bucket.scopeType === 'novel').verifiedSource, true, 'actual story-memory reader accepts rebased provenance')
  }
  const notifications = []
  const unsubscribe = onNovelResearchChanged(event => { assert.equal(sqlite.inTransaction, false, 'UI notifications follow commit'); notifications.push(event) })
  const drafts = Array.from({ length: 100 }, (_, index) => ({ sourceKey: `author:fixture:${index}`, category: 'humanity', title: `资料${index}`, content: `选择${index}`, interpretation: '承担后果', novelConnection: '与本作同行者的选择相关' }))

  const first = upsertAuthorCreativeResearch(novelId, drafts, 1)
  assert.equal(first.length, 100)
  assert.equal(getNovel(novelId).contextVersion, 2)
  assert.equal(derived(), initialDerived, 'reference additions preserve narrative content, locks, audit, timestamps and impact jobs')
  assertFreshDependencies(2)
  assert.equal(rows('asset_change_events').length, 1, 'real reference writes retain one neutral audit without derived impacts')
  assert.equal(notifications.length, 1)
  const saved = snapshot()
  assert.deepEqual(upsertAuthorCreativeResearch(novelId, drafts.map(draft => ({ ...draft, title: ` ${draft.title} ` })), 2), first)
  assert.equal(snapshot(), saved, 'normalized 100-card replay preserves timestamps, version and every row')
  assert.equal(notifications.length, 1, 'no notification for no-op replay')
  assert.throws(() => upsertAuthorCreativeResearch(novelId, drafts, 1), /其他任务修改/)
  assert.equal(snapshot(), saved, 'stale replay still fails CAS without side effects')
  assert.equal(notifications.length, 1)

  upsertAuthorCreativeResearch(novelId, [{ ...drafts[0], content: '修订后的选择' }], 2)
  assert.equal(getNovel(novelId).contextVersion, 3)
  assert.equal(derived(), initialDerived)
  assertFreshDependencies(3)
  deleteAuthorCreativeResearch(novelId, drafts[1].sourceKey, 3)
  assert.equal(getNovel(novelId).contextVersion, 4)
  assert.equal(derived(), initialDerived)
  assertFreshDependencies(4)
  assert.equal(notifications.length, 3)

  const research = await searchCreativeResearch(novelId, '搜索道教资料', undefined, { providerName: 'fixture', provider: async () => [{ title: '道教原典', url: 'https://example.org/source', snippet: '道家思想的公开参考摘要。' }] })
  assert.equal(research.updated, true)
  assert.equal(getNovel(novelId).contextVersion, 5)
  assert.equal(derived(), initialDerived, 'known web references retain the same non-narrative dependency scope')
  assertFreshDependencies(5)
  assert.equal(notifications.length, 4)

  const beforeFailure = snapshot()
  sqlite.exec("CREATE TEMP TRIGGER fail_reference_update BEFORE UPDATE ON main.novels BEGIN SELECT RAISE(ABORT, 'isolated reference failure'); END")
  assert.throws(() => upsertAuthorCreativeResearch(novelId, [{ ...drafts[0], content: '不能落库的修订' }], 5), /isolated reference failure/)
  assert.equal(snapshot(), beforeFailure, 'write failure rolls back the whole research transaction')
  assert.equal(notifications.length, 4)
  sqlite.exec('DROP TRIGGER fail_reference_update')
  sqlite.exec("CREATE TEMP TRIGGER fail_reference_audit BEFORE INSERT ON main.asset_change_events BEGIN SELECT RAISE(ABORT, 'isolated audit failure'); END")
  assert.throws(() => upsertAuthorCreativeResearch(novelId, [{ ...drafts[0], content: '已写小说和重基记忆后审计失败' }], 5), /isolated audit failure/)
  assert.equal(snapshot(), beforeFailure, 'late audit failure rolls back novel, rebased checkpoints and every persisted row')
  assert.equal(notifications.length, 4, 'rolled-back writes never notify consumers')
  sqlite.exec('DROP TRIGGER fail_reference_audit')

  const ledger = JSON.parse(getNovel(novelId).sourceLedgerJson)
  ledger[0].canonDecision = 'accepted'
  updateNovel(novelId, { sourceLedgerJson: JSON.stringify(ledger) }, { expectedContextVersion: 5 })
  assert.equal(getNovel(novelId).contextVersion, 6)
  assert.match(rows('chapters')[0].stale_reason_json, /Historical\/source\/canon data changed/)
  assert.equal(rows('story_memory_checkpoints')[0].stale, 1)
  assert.equal(rows('chapters')[0].content, '正式正文不得改变。')
  assert.ok(rows('asset_change_events').length > 0, 'Canon adoption retains the existing impact event')
  const eventCount = rows('asset_change_events').length
  updateNovel(novelId, { sourceLedgerJson: getNovel(novelId).sourceLedgerJson, canonFactCardsJson: '[{"cardKey":"new-canon"}]' }, { expectedContextVersion: 6 })
  assert.equal(getNovel(novelId).contextVersion, 7)
  assert.equal(rows('asset_change_events').length, eventCount + 1, 'mixed Canon updates cannot use the reference-only exception')
  assert.ok(getNovelContextStatus(novelId).staleAssetKeys.includes('character'), 'real Canon update ends the reference freshness baseline')
  assert.equal(buildStoryMemoryPromptPackage(novelId, { readOnly: true }).observability.buckets.find(bucket => bucket.scopeType === 'novel').verifiedSource, false)

  // An ordinary timestamp write between reference edits must also end the previous baseline.
  const secondId = Number(sqlite.prepare('INSERT INTO novels (title,context_version,source_ledger_json,updated_at) VALUES (?,1,?,?)').run('中间普通更新时间测试', '[]', narrativeTime).lastInsertRowid)
  sqlite.prepare('INSERT INTO characters (novel_id,full_name,updated_at) VALUES (?,?,?)').run(secondId, '先前新鲜的人物', narrativeTime)
  upsertAuthorCreativeResearch(secondId, [drafts[0]], 1)
  assert.deepEqual(getNovelContextStatus(secondId).staleAssetKeys, [])
  updateNovel(secondId, { totalWords: 10 })
  assert.deepEqual(getNovelContextStatus(secondId).staleAssetKeys, ['character'], 'mismatched ordinary update conservatively uses the current timestamp')
  upsertAuthorCreativeResearch(secondId, [{ ...drafts[0], content: '再次参考变更' }], 2)
  assert.deepEqual(getNovelContextStatus(secondId).staleAssetKeys, ['character'], 'later reference writes inherit the newer baseline without washing stale assets')

  // Use an actual builder-produced empty checkpoint to verify its native null/null range contract.
  const emptyId = Number(sqlite.prepare('INSERT INTO novels (title,context_version,source_ledger_json,updated_at) VALUES (?,1,?,?)').run('空小说记忆兼容', '[]', narrativeTime).lastInsertRowid)
  refreshStoryMemoryCheckpoints(emptyId)
  const emptyBefore = sqlite.prepare('SELECT * FROM story_memory_checkpoints WHERE novel_id=? AND scope_type=?').get(emptyId, 'novel')
  assert.equal(emptyBefore.source_range_start, null)
  assert.equal(emptyBefore.source_range_end, null)
  assert.deepEqual(JSON.parse(emptyBefore.source_manifest_json).range, { startChapterNum: 0, endChapterNum: 0 })
  upsertAuthorCreativeResearch(emptyId, [drafts[0]], 1)
  const emptyAfter = sqlite.prepare('SELECT * FROM story_memory_checkpoints WHERE id=?').get(emptyBefore.id)
  assert.equal(emptyAfter.source_context_version, 2)
  assert.equal(emptyAfter.source_range_start, null)
  assert.equal(emptyAfter.source_range_end, null)
  assert.equal(emptyAfter.updated_at, emptyBefore.updated_at)
  assert.equal(getNovelContextStatus(emptyId).staleCheckpointCount, 0)
  assert.equal(buildStoryMemoryPromptPackage(emptyId, { readOnly: true }).observability.buckets.find(bucket => bucket.scopeType === 'novel').verifiedSource, true)
  unsubscribe()
  closeDb()
  initDb()
  assert.equal(getNovel(novelId).contextVersion, 7)
  assert.equal(JSON.parse(getNovel(novelId).sourceLedgerJson).filter(row => row.sourceType === 'author_created').length, 99)
  closeDb()
  console.log('[creative-research-integrity] isolated SQLite: 100-card add/replay/stale CAS/edit/delete, web references, strict memory rebase, freshness baselines, neutral same-ID audit, post-commit notifications, rollback, Canon adoption and reopen passed')
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
