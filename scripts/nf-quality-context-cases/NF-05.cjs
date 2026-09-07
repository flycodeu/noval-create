'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const {
  configureIsolatedDatabase,
  getMigrationIds,
  insertNf00Fixture,
} = require('../nf-quality-context-fixtures.cjs')

const MODEL_CONFIG_ID = 7
const EMBEDDING_DIMENSIONS = 2

function createRunDirectory(tempRoot) {
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, 'nf-05-'))
}

function openDatabase(Database, dbPath) {
  const db = new Database(dbPath)
  configureIsolatedDatabase(db)
  return db
}

function buildRecallInput(overrides = {}) {
  return {
    novelId: 101,
    chapterNum: 6,
    modelConfigId: MODEL_CONFIG_ID,
    entityFreshnessMap: new Map(),
    constraintText: '',
    chapterGoal: '守住补给线',
    outline: '角色确认守住补给线并保护药箱。',
    arcGoal: '',
    arcSummary: '',
    storyGoal: '',
    coreConflict: '',
    mainPlot: '',
    themeVoiceSummary: '',
    worldRules: '',
    mapSummary: '',
    relationSummary: '',
    characterStates: '',
    worldStates: '',
    itemSummary: '',
    timelineSummary: '',
    timelineOpenThreads: '',
    activeThreads: '寻找守住补给线的药箱',
    openLoops: '',
    dueForeshadows: '',
    continuityNotes: '',
    chapterBridgePlan: '',
    storyThreadsSummary: '',
    mentionedCharacters: ['沈砚'],
    mentionedItems: ['药箱'],
    mentionedLocations: [],
    mentionedFactions: [],
    mentionValidationCharacters: [],
    mentionValidationItems: ['药箱'],
    mentionValidationLocations: [],
    mentionValidationFactions: [],
    ...overrides,
  }
}

function seedRecallFixture(db, embeddingProfile) {
  insertNf00Fixture(db)
  db.prepare(`
    UPDATE chapters
    SET summary = ?, content = ?
    WHERE id = ? AND novel_id = ?
  `).run(
    '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的历史语义证据，药箱仍在旧仓库。',
    '历史章节保留角色关系召回、规则主题召回、线程伏笔召回，以及守住补给线与药箱关键词线索。',
    901,
    101,
  )
  db.prepare(`
    UPDATE chapters
    SET summary = ?, content = ?
    WHERE id = ? AND novel_id = ?
  `).run(
    '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的未来专属章节。',
    '未来专属内容不应进入第六章以前的召回。',
    3001,
    101,
  )

  const insertEmbedding = db.prepare(`
    INSERT INTO chapter_embeddings (
      novel_id, chapter_id, fragment_type, fragment_text,
      embedding_json, model_id, dimensions, embedding_profile,
      context_version, visibility
    ) VALUES (?, ?, 'summary', ?, ?, 'stub-model', ?, ?, 1, 'canon')
  `)
  insertEmbedding.run(
    101,
    901,
    '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的历史语义证据，药箱仍在旧仓库。',
    JSON.stringify([1, 0]),
    EMBEDDING_DIMENSIONS,
    embeddingProfile,
  )
  insertEmbedding.run(
    101,
    3001,
    '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的未来专属章节，药箱不应提前出现。',
    JSON.stringify([1, 0]),
    EMBEDDING_DIMENSIONS,
    embeddingProfile,
  )

  const insertSemantic = db.prepare(`
    INSERT INTO semantic_memory_entries (
      novel_id, source_type, source_id, fragment_key, content_text,
      embedding_json, model_id, dimensions, embedding_profile, source_hash,
      context_version, entity_refs_json, visibility,
      source_chapter_start, source_chapter_end, valid_from_chapter, valid_to_chapter
    ) VALUES (?, ?, ?, ?, ?, ?, 'stub-model', ?, ?, ?, 1, ?, 'canon', ?, ?, ?, ?)
  `)
  const semanticRows = [
    ['character', 5101, 'nf05-character', '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的人物关系证据，药箱由沈砚看守。', 1, 3, null, null],
    ['map', 5102, 'nf05-map', '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的旧仓库地图证据，药箱位于补给线内。', 1, 3, null, null],
    ['item', 5103, 'nf05-item', '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的药箱物品证据。', 1, 3, null, null],
    ['story_thread', 5104, 'nf05-thread', '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的活跃线程证据，药箱去向待回收。', 1, 3, null, null],
    ['timeline_event', 5105, 'nf05-timeline', '角色关系召回 规则主题召回 线程伏笔召回；守住补给线的时间线事件证据，药箱仍在旧仓库。', 1, 3, null, null],
  ]
  semanticRows.forEach(([sourceType, sourceId, fragmentKey, content, sourceStart, sourceEnd, validFrom, validTo]) => {
    insertSemantic.run(
      101,
      sourceType,
      sourceId,
      fragmentKey,
      content,
      JSON.stringify([1, 0]),
      EMBEDDING_DIMENSIONS,
      embeddingProfile,
      `nf05:${sourceType}:${sourceId}`,
      JSON.stringify(['守住补给线', '药箱']),
      sourceStart,
      sourceEnd,
      validFrom,
      validTo,
    )
  })
}

function patchDependencies({ loadTypeScriptModule }) {
  const databaseModule = loadTypeScriptModule('electron/database/db.ts')
  const embeddingModule = loadTypeScriptModule('electron/services/embedding.service.ts')
  const modelModule = loadTypeScriptModule('electron/services/model.service.ts')
  const queryEmbeddingModule = loadTypeScriptModule('electron/services/query-embedding.ts')
  const semanticModule = loadTypeScriptModule('electron/services/semantic-memory.service.ts')
  const runtimeModule = loadTypeScriptModule('electron/services/context-recall-runtime.ts')

  let isolatedDb = null
  let isolatedSqlite = null
  const calls = []
  const original = {
    getDb: databaseModule.getDb,
    getSqlite: databaseModule.getSqlite,
    embedSemanticTexts: embeddingModule.embedSemanticTexts,
    getDefaultModelConfigRecord: modelModule.getDefaultModelConfigRecord,
    getModelConfigRecord: modelModule.getModelConfigRecord,
    getAdapterById: modelModule.getAdapterById,
  }

  databaseModule.getDb = () => isolatedDb
  databaseModule.getSqlite = () => isolatedSqlite
  const config = {
    id: MODEL_CONFIG_ID,
    provider: 'stub',
    modelId: 'stub-model',
    baseUrl: 'http://127.0.0.1/nf-05',
  }
  modelModule.getDefaultModelConfigRecord = () => config
  modelModule.getModelConfigRecord = () => config
  modelModule.getAdapterById = async () => ({
    id: 'stub-embedding',
    embed: async (texts) => {
      calls.push([...texts])
      return texts.map(() => [1, 0])
    },
  })

  return {
    embeddingModule,
    queryEmbeddingModule,
    semanticModule,
    runtimeModule,
    calls,
    setDatabase: (db, sqlite) => {
      isolatedDb = db
      isolatedSqlite = sqlite
    },
    setMode: (nextMode) => {
      if (nextMode === 'fail') {
        embeddingModule.embedSemanticTexts = async (texts) => {
          calls.push([...texts])
          return { source: 'unavailable' }
        }
        return
      }
      embeddingModule.embedSemanticTexts = original.embedSemanticTexts
    },
    clearCalls: () => { calls.length = 0 },
    restore: () => {
      databaseModule.getDb = original.getDb
      databaseModule.getSqlite = original.getSqlite
      embeddingModule.embedSemanticTexts = original.embedSemanticTexts
      modelModule.getDefaultModelConfigRecord = original.getDefaultModelConfigRecord
      modelModule.getModelConfigRecord = original.getModelConfigRecord
      modelModule.getAdapterById = original.getAdapterById
    },
  }
}

function assertAllVectorHits(result) {
  assert.ok(result.recallSnapshot.retrievalUsed)
  assert.ok(result.recalledMemorySources.length > 0)
  assert.ok(result.recalledMemorySources.every((source) => source.searchMode === 'vector'))
}

async function run({ tempRoot, Database, runMigrations, loadTypeScriptModule }) {
  const runDirectory = createRunDirectory(tempRoot)
  const dbPath = path.join(runDirectory, 'nf-05.sqlite3')
  const sqlite = openDatabase(Database, dbPath)
  let dependencies = null

  try {
    runMigrations(sqlite)
    assert.ok(getMigrationIds(sqlite).includes('0064_semantic_memory_source_range_repair'))

    dependencies = patchDependencies({ loadTypeScriptModule })
    dependencies.setDatabase(drizzle(sqlite, { schema: loadTypeScriptModule('electron/database/schema.ts') }), sqlite)

    const { embeddingModule, queryEmbeddingModule, semanticModule, runtimeModule, calls } = dependencies
    const probe = await embeddingModule.embedSemanticTexts(['NF-05 profile probe'], MODEL_CONFIG_ID)
    assert.equal(probe.source, 'remote')
    assert.ok(probe.profile)
    const embeddingProfile = probe.profile
    seedRecallFixture(sqlite, embeddingProfile)
    dependencies.clearCalls()

    // 05-01: production recall plans three distinct buckets, embeds once, and
    // both real retrieval services consume the prepared vectors.
    const productionResult = await runtimeModule.runRecallAugmentation(buildRecallInput())
    assert.equal(calls.length, 1)
    assert.equal(calls[0].length, 3)
    assert.equal(new Set(calls[0]).size, 3)
    assertAllVectorHits(productionResult)
    const firstBatch = calls[0]

    // 05-02: normalization/dedup happens before the one embedding batch.
    dependencies.clearCalls()
    const deduped = await queryEmbeddingModule.prepareQueryEmbeddings(
      ['重复查询', ' 重复查询 ', '另一条查询'],
      MODEL_CONFIG_ID,
    )
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], ['重复查询', '另一条查询'])
    assert.equal(deduped.size, 2)

    // 05-03: an index profile/dimension mismatch is not repaired by a second
    // query embedding; it takes the existing keyword path.
    dependencies.clearCalls()
    const incompatible = await embeddingModule.searchSimilarFragments(
      101,
      '守住补给线',
      4,
      MODEL_CONFIG_ID,
      {
        beforeChapterNum: 6,
        preparedQuery: {
          queryHash: queryEmbeddingModule.hashQueryText('守住补给线'),
          profile: 'other-model:3',
          dimensions: 3,
          embedding: [1, 0, 0],
        },
      },
    )
    assert.equal(calls.length, 0)
    assert.equal(incompatible.fallbackReason, 'embedding_profile_mismatch')
    assert.ok(incompatible.hits.some((hit) => hit.chapterId === 901 && hit.searchMode === 'keyword'))

    // 05-04: a whole batch failure sends null to both channels. The chapter
    // boundary remains active and neither channel starts a second embedding.
    dependencies.setMode('fail')
    dependencies.clearCalls()
    const failedResult = await runtimeModule.runRecallAugmentation(buildRecallInput())
    assert.equal(calls.length, 1)
    assert.equal(calls[0].length, 3)
    assert.ok(
      failedResult.recallSnapshot.fallbackHitCount > 0,
      JSON.stringify(failedResult.recallSnapshot),
    )
    const failedBounded = await embeddingModule.searchSimilarFragments(
      101,
      '守住补给线',
      4,
      MODEL_CONFIG_ID,
      { beforeChapterNum: 6, preparedQuery: null },
    )
    assert.equal(calls.length, 1)
    assert.ok(failedBounded.hits.some((hit) => hit.chapterId === 901 && hit.chapterNum === 3))
    assert.equal(failedBounded.hits.some((hit) => hit.chapterId === 3001), false)
    const failedSemantic = await semanticModule.searchSemanticMemory(
      101,
      '守住补给线',
      {
        topK: 4,
        chapterNum: 6,
        preparedQuery: null,
        sourceTypes: ['story_thread'],
        visibility: 'canon',
        refreshOutbox: false,
      },
    )
    assert.equal(calls.length, 1)
    assert.ok(failedSemantic.some((hit) => hit.searchMode === 'keyword'))

    // 05-05: a wrong query hash is rejected, the wrong vector is never used,
    // and the chapter result exposes the downgrade reason.
    dependencies.setMode('success')
    dependencies.clearCalls()
    const wrongHash = await embeddingModule.searchSimilarFragments(
      101,
      '守住补给线',
      4,
      MODEL_CONFIG_ID,
      {
        beforeChapterNum: 6,
        preparedQuery: {
          queryHash: 'sha256:nf05-wrong-query',
          profile: embeddingProfile,
          dimensions: EMBEDDING_DIMENSIONS,
          embedding: [1, 0],
        },
      },
    )
    assert.equal(calls.length, 0)
    assert.equal(wrongHash.fallbackReason, 'query_embedding_failed')
    assert.ok(wrongHash.hits.some((hit) => hit.searchMode === 'keyword'))
    const wrongHashSemantic = await semanticModule.searchSemanticMemory(
      101,
      '守住补给线',
      {
        topK: 4,
        chapterNum: 6,
        preparedQuery: {
          queryHash: 'sha256:nf05-wrong-query',
          profile: embeddingProfile,
          dimensions: EMBEDDING_DIMENSIONS,
          embedding: [1, 0],
        },
        sourceTypes: ['character'],
        visibility: 'canon',
        refreshOutbox: false,
      },
    )
    assert.equal(calls.length, 0)
    assert.ok(wrongHashSemantic.some((hit) => hit.searchMode === 'keyword'))

    // 05-06: old standalone search without a prepared query still performs
    // its own embedding and returns vector results.
    const standalone = await embeddingModule.searchSimilarFragments(
      101,
      '守住补给线',
      4,
      MODEL_CONFIG_ID,
      { beforeChapterNum: 6 },
    )
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], ['守住补给线'])
    assert.ok(standalone.hits.some((hit) => hit.chapterId === 901 && hit.searchMode === 'vector'))
    const standaloneSemantic = await semanticModule.searchSemanticMemory(
      101,
      '守住补给线',
      {
        topK: 4,
        chapterNum: 6,
        sourceTypes: ['character'],
        visibility: 'canon',
        refreshOutbox: false,
      },
    )
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1], ['守住补给线'])
    assert.ok(standaloneSemantic.some((hit) => hit.searchMode === 'vector'))

    return {
      runDirectory,
      dbPath,
      checks: {
        '05-01': {
          status: 'PASS',
          batchCount: 1,
          vectorCount: firstBatch.length,
          queryTexts: firstBatch,
          channels: 'chapter + semantic_memory',
        },
        '05-02': { status: 'PASS', uniqueTexts: calls.length === 1 ? 2 : deduped.size },
        '05-03': { status: 'PASS', fallbackReason: incompatible.fallbackReason, embeddingCalls: 0 },
        '05-04': {
          status: 'PASS',
          batchFailureCalls: 1,
          chapterFallbackReason: failedBounded.fallbackReason,
          semanticFallbackMode: failedSemantic[0]?.searchMode || 'keyword',
          historicalChapterNums: failedBounded.hits.map((hit) => hit.chapterNum),
        },
        '05-05': {
          status: 'PASS',
          chapterFallbackReason: wrongHash.fallbackReason,
          semanticFallbackMode: wrongHashSemantic[0]?.searchMode || 'keyword',
          embeddingCalls: 0,
        },
        '05-06': {
          status: 'PASS',
          standaloneEmbeddingCalls: 2,
          chapterSearchMode: standalone.hits[0]?.searchMode,
          semanticSearchMode: standaloneSemantic[0]?.searchMode,
        },
      },
    }
  } finally {
    if (dependencies) dependencies.restore()
    sqlite.close()
  }
}

module.exports = { run }
