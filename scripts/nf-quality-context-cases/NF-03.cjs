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

function createRunDirectory(tempRoot) {
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, 'nf-03-'))
}

function openDatabase(Database, dbPath) {
  const db = new Database(dbPath)
  configureIsolatedDatabase(db)
  return db
}

function seedRecallFixture(db, profile) {
  insertNf00Fixture(db)
  db.prepare(`
    UPDATE chapters
    SET summary = ?, content = ?
    WHERE id = ? AND novel_id = ?
  `).run(
    '历史语义证据',
    '历史章节保留关键词线索，改写时仍可作为旧证据。',
    901,
    101,
  )
  db.prepare(`
    UPDATE chapters
    SET summary = ?, content = ?
    WHERE id = ? AND novel_id = ?
  `).run(
    '未来专属章节',
    '未来专属内容不应进入当前章节召回。',
    3001,
    101,
  )

  const insertChapter = db.prepare(`
    INSERT INTO chapters (id, novel_id, chapter_num, title, content, status)
    VALUES (?, ?, ?, ?, ?, 'outline')
  `)
  const insertEmbedding = db.prepare(`
    INSERT INTO chapter_embeddings (
      novel_id, chapter_id, fragment_type, fragment_text,
      embedding_json, model_id, dimensions, embedding_profile, context_version, visibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'canon')
  `)

  // Keep the historical row out of the lexical subset. It must survive the
  // recent-vector LIMIT only when chapters are filtered before that LIMIT.
  const futureRows = Array.from({ length: 800 }, (_, index) => ({
    id: 10_000 + index,
    chapterNum: 21 + index,
    fragmentText: `关键词未来 ${index}`,
  }))
  const insert = db.transaction(() => {
    for (const row of futureRows) {
      insertChapter.run(
        row.id,
        101,
        row.chapterNum,
        `N1 未来 ${row.chapterNum}`,
        `未来专属内容 ${row.chapterNum} 关键词`,
      )
    }
  })
  insert()

  insertEmbedding.run(101, 901, 'summary', '历史语义证据', '[0.7,0.7]', 'stub-embedding', 2, profile)
  insertEmbedding.run(101, 3001, 'summary', '关键词当前章', '[1,0]', 'stub-embedding', 2, profile)
  insertEmbedding.run(101, 15, 'summary', '关键词未来第80章', '[1,0]', 'stub-embedding', 2, profile)
  insertEmbedding.run(202, 902, 'summary', '关键词 N2 片段', '[1,0]', 'stub-embedding', 2, profile)
  for (const row of futureRows) {
    insertEmbedding.run(101, row.id, 'summary', row.fragmentText, '[1,0]', 'stub-embedding', 2, profile)
  }

  return { futureCount: futureRows.length, profile }
}

function patchEmbeddingDependencies({ loadTypeScriptModule }) {
  const databaseModule = loadTypeScriptModule('electron/database/db.ts')
  const schemaModule = loadTypeScriptModule('electron/database/schema.ts')
  const modelModule = loadTypeScriptModule('electron/services/model.service.ts')
  const embeddingModule = loadTypeScriptModule('electron/services/embedding.service.ts')
  const config = {
    id: 7,
    provider: 'stub',
    modelId: 'stub-model',
    baseUrl: 'http://127.0.0.1/nf-03',
  }
  let isolatedDb = null
  let queryVector = [1, 0]
  const original = {
    getDb: databaseModule.getDb,
    getDefaultModelConfigRecord: modelModule.getDefaultModelConfigRecord,
    getModelConfigRecord: modelModule.getModelConfigRecord,
    getAdapterById: modelModule.getAdapterById,
  }
  databaseModule.getDb = () => isolatedDb
  modelModule.getDefaultModelConfigRecord = () => config
  modelModule.getModelConfigRecord = () => config
  modelModule.getAdapterById = async () => ({
    id: 'stub-embedding',
    embed: async (texts) => texts.map(() => [...queryVector]),
  })

  return {
    embeddingModule,
    schemaModule,
    setDatabase: (db) => { isolatedDb = db },
    setQueryVector: (next) => { queryVector = next },
    restore: () => {
      databaseModule.getDb = original.getDb
      modelModule.getDefaultModelConfigRecord = original.getDefaultModelConfigRecord
      modelModule.getModelConfigRecord = original.getModelConfigRecord
      modelModule.getAdapterById = original.getAdapterById
    },
  }
}

async function run({ tempRoot, Database, runMigrations, loadTypeScriptModule }) {
  const runDirectory = createRunDirectory(tempRoot)
  const dbPath = path.join(runDirectory, 'nf-03.sqlite3')
  const sqlite = openDatabase(Database, dbPath)
  let dependencies = null

  try {
    runMigrations(sqlite)
    assert.ok(getMigrationIds(sqlite).includes('0064_semantic_memory_source_range_repair'))
    dependencies = patchEmbeddingDependencies({ loadTypeScriptModule })
    dependencies.setDatabase(drizzle(sqlite, { schema: dependencies.schemaModule }))

    const { embeddingModule } = dependencies
    const probe = await embeddingModule.embedSemanticTexts(['NF-03 profile probe'], 7)
    assert.equal(probe.source, 'remote')
    assert.ok(probe.profile)
    const fixture = seedRecallFixture(sqlite, probe.profile)
    const bounded = await embeddingModule.searchSimilarFragments(
      101,
      '关键词',
      3,
      7,
      { beforeChapterNum: 20 },
    )
    assert.ok(bounded.hits.some((hit) => hit.chapterId === 901 && hit.chapterNum === 3))
    assert.equal(bounded.hits.some((hit) => hit.chapterNum >= 20), false)
    assert.equal(bounded.hits.some((hit) => hit.chapterId === 15), false)
    assert.equal(bounded.hits.some((hit) => hit.chapterId === 902), false)
    const boundedFacadeHits = await embeddingModule.findSimilarFragments(
      101,
      '关键词',
      1,
      7,
      { beforeChapterNum: 20 },
    )
    assert.deepEqual(boundedFacadeHits.map((hit) => hit.chapterNum), [3])

    dependencies.setQueryVector([1, 0, 0])
    const profileMismatchFallback = await embeddingModule.searchSimilarFragments(
      101,
      '关键词',
      3,
      7,
      { beforeChapterNum: 20 },
    )
    assert.ok(profileMismatchFallback.hits.some((hit) => hit.chapterId === 901 && hit.chapterNum === 3))
    assert.equal(profileMismatchFallback.hits.some((hit) => hit.chapterNum >= 20), false)

    sqlite.prepare('DELETE FROM chapter_embeddings').run()
    dependencies.setQueryVector([1, 0])
    const noIndexFallback = await embeddingModule.searchSimilarFragments(
      101,
      '未来专属',
      3,
      7,
      { beforeChapterNum: 20 },
    )
    assert.deepEqual(noIndexFallback.hits, [])
    assert.equal(noIndexFallback.fallbackReason, 'no_hits')

    const legacyGlobalSearch = await embeddingModule.searchSimilarFragments(101, '未来专属', 3, 7)
    assert.ok(legacyGlobalSearch.hits.some((hit) => hit.chapterNum >= 21))

    return {
      runDirectory,
      dbPath,
      fixture,
      checks: {
        '03-01': { status: 'PASS', hits: bounded.hits.map((hit) => ({ chapterId: hit.chapterId, chapterNum: hit.chapterNum })) },
        '03-02': { status: 'PASS', excludedChapterId: 15 },
        '03-03': {
          status: 'PASS',
          profileMismatchHits: profileMismatchFallback.hits.length,
          noIndexFallback: noIndexFallback.fallbackReason,
        },
        '03-04': { status: 'PASS', excludedNovel2ChapterId: 902 },
        '03-05': { status: 'PASS', fallbackReason: noIndexFallback.fallbackReason },
        '03-06': {
          status: 'PASS',
          facadeForwardedBoundary: boundedFacadeHits.map((hit) => hit.chapterNum),
          legacyGlobalChapterNums: legacyGlobalSearch.hits.map((hit) => hit.chapterNum),
        },
      },
    }
  } finally {
    if (dependencies) dependencies.restore()
    sqlite.close()
  }
}

module.exports = { run }
