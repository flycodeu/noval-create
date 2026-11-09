const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app } = require('electron')
require('./isolate-test-session.cjs')(app)
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const { cleanupElectronFixture } = require('./cleanup-electron-fixture.cjs')

const workspace = path.resolve(__dirname, '..')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-preview-grounding-'))
process.env.NOVELFORGE_USER_DATA_DIR = fixture
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', fixture)
app.disableHardwareAcceleration()
registerProjectTsRuntime(workspace)

const project = relative => require(path.join(workspace, relative))
const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')

function databaseSnapshot(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  return tables.map(({ name }) => ({
    name,
    rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
      .map(row => JSON.stringify(row)).sort(),
  }))
}

async function main() {
  await app.whenReady()
  const { initDb, getSqlite, closeDb } = project('electron/database/db.ts')
  const nativeFetch = globalThis.fetch
  let networkAttempts = 0
  globalThis.fetch = async () => {
    networkAttempts += 1
    throw new Error('Preview grounding fixture forbids all network requests')
  }
  initDb()
  const db = getSqlite()
  const grounding = project('electron/services/source-grounding-search.service.ts')
  const recall = project('electron/services/context-recall-runtime.ts')
  const recallCore = project('electron/services/context-recall-core.ts')
  const originalEnrichment = grounding.enrichSourceGroundingFromWeb
  const originalRecall = recall.runRecallAugmentation
  let enrichmentCalls = 0
  let providerCalls = 0
  grounding.enrichSourceGroundingFromWeb = input => {
    enrichmentCalls += 1
    return originalEnrichment(input, {
      providerName: 'isolated-preview-fixture',
      provider: async () => {
        providerCalls += 1
        return [{ title: '隔离检索的官制参考', url: 'https://example.invalid/grounding-fixture', snippet: '这是生成路径才可新增的参考哨兵。', score: 0.8 }]
      },
      now: () => '2026-11-09T00:00:00.000Z',
    })
  }
  // Recall inference is covered separately. Keep this full preview deterministic
  // while exercising its real stage resolver, source renderer and persistence.
  recall.runRecallAugmentation = async () => ({
    assemblyStage: 'recall', recalledMemory: '',
    recallSnapshot: recallCore.createEmptyRecallSnapshot(),
    recallDiagnostics: recallCore.buildEmptyRecallDiagnostics(), recalledMemorySources: [],
  })

  try {
    const novels = project('electron/services/novel.service.ts')
    const chapters = project('electron/services/chapter.service.ts')
    const characters = project('electron/services/character.service.ts')
    const contracts = project('electron/services/endgame-asset.service.ts')
    const context = project('electron/services/context.service.ts')
    const pipeline = project('electron/services/chapter-pipeline-context.ts')
    const genreId = Number(db.prepare('INSERT INTO genres (name,description,is_builtin) VALUES (?,?,0)')
      .run('古言宫斗权谋隔离预览', '预览只读回归夹具').lastInsertRowid)
    const modelId = Number(db.prepare("INSERT INTO model_configs (name,provider,model_id,base_url,max_context_tokens,max_tokens,is_default) VALUES ('Preview fixture','openai','preview-fixture','http://127.0.0.1:1',65536,1000,1)").run().lastInsertRowid)
    const cachedMarker = '既存参考哨兵：州府文书先核原册'
    const cachedSource = { sourceKey: 'author:preview-cache', sourceType: 'author_created', assetType: 'creative_reference',
      factTitle: '已存官制参考', sourceText: cachedMarker, verificationStatus: 'verified', canonDecision: 'accepted' }
    const createFixture = (title, cached) => {
      const novelId = novels.createNovel({ title, genreId, targetWords: 120000,
        synopsis: '古代州府官制与客商账目。', userBackground: '历史架空，礼制、官制与州府流程需要参考。' })
      db.prepare('UPDATE novels SET model_config_id=?,source_ledger_json=?,canon_source_ledger_json=?,canon_fact_cards_json=? WHERE id=?')
        .run(modelId, cached ? JSON.stringify([cachedSource]) : '[]', '[]', '[]', novelId)
      characters.createCharacter(novelId, { fullName: '林舟', roleType: 'protagonist' })
      const chapterId = chapters.createChapter(novelId, { chapterNum: 1, title: '州府问账', outline: '林舟按官制核对州府客簿，问清一笔账。', targetWords: 1000 })
      const segment = db.prepare('SELECT id FROM chapter_segments WHERE chapter_id=? ORDER BY segment_order LIMIT 1').get(chapterId)
      assert.ok(segment)
      contracts.upsertChapterContract(chapterId, { chapterGoal: '林舟问清客簿上的一笔账', status: 'ready' })
      contracts.upsertSceneContract(chapterId, segment.id, { pov: '林舟', timeLocation: '白日，州府门前',
        sceneGoal: '问清一笔账', obstacle: '记账人与当事人的说法不同', resultState: '抄下原册待核', status: 'ready' })
      return { novelId, chapterId }
    }
    const fresh = createFixture('缺少来源的历史预览', false)
    const cached = createFixture('已有来源的历史预览', true)

    for (const fixtureCase of [fresh, cached, fresh]) {
      const beforeState = databaseSnapshot(db)
      const preview = await chapters.getChapterContextPreview(fixtureCase.chapterId, { executionMode: 'balanced' })
      assert.equal(preview.chapterId, fixtureCase.chapterId)
      assert.equal(preview.stages.length, 4, 'exercise the complete preview rather than an isolated helper')
      const afterState = databaseSnapshot(db)
      if (sha256(afterState) !== sha256(beforeState)) {
        console.error('Preview changed tables:', JSON.stringify(afterState.filter((table, index) => sha256(table) !== sha256(beforeState[index]))
          .map(table => ({ name: table.name, beforeRowCount: beforeState.find(old => old.name === table.name)?.rows.length, afterRowCount: table.rows.length }))))
      }
      assert.equal(sha256(afterState), sha256(beforeState), 'a public preview must leave every SQLite table unchanged')
      assert.equal(enrichmentCalls, 0, 'preview must not initiate source discovery')
      assert.equal(providerCalls, 0, 'preview must not invoke a search provider')
      assert.equal(networkAttempts, 0, 'preview must not generate or fetch material')
      if (fixtureCase === cached) assert.ok(JSON.stringify(preview).includes(cachedMarker), 'saved references remain available to read-only preview')
    }

    const chapter = db.prepare('SELECT * FROM chapters WHERE id=?').get(fresh.chapterId)
    const raw = await context.collectChapterContextRawData(fresh.novelId, chapter.chapter_num)
    const beforeVersion = novels.getNovel(fresh.novelId).contextVersion
    await pipeline.resolveStageContextForPipeline('draft', { ...raw.currentChapter }, raw, 'standard', { executionMode: 'balanced' })
    assert.ok(enrichmentCalls > 0, 'normal generation retains source enrichment')
    assert.ok(providerCalls > 0, 'the positive control reaches the injected search provider')
    const saved = novels.getNovel(fresh.novelId)
    assert.ok(saved.contextVersion > beforeVersion, 'generation still records newly discovered evidence')
    assert.ok(JSON.parse(saved.sourceLedgerJson).some(row => row.sourceUrl === 'https://example.invalid/grounding-fixture'))
    assert.ok(JSON.parse(saved.canonSourceLedgerJson).some(row => row.sourceUrl === 'https://example.invalid/grounding-fixture'))
    assert.ok(JSON.parse(saved.canonFactCardsJson).some(row => row.sourceKeys?.length))
    assert.equal(networkAttempts, 0)
    console.log(JSON.stringify({ status: 'PASS', readOnlyPreviews: 3, databaseDigestUnchanged: true,
      cachedReferenceReadable: true, generationGroundingRetained: true, providerCalls, networkAttempts }))
  } finally {
    grounding.enrichSourceGroundingFromWeb = originalEnrichment
    recall.runRecallAugmentation = originalRecall
    globalThis.fetch = nativeFetch
    closeDb()
    cleanupElectronFixture(fixture, 'chapter-preview-grounding')
  }
}

main().then(() => app.quit()).catch(error => { console.error(error.stack || error); app.exit(1) })
