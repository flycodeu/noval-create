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
  return fs.mkdtempSync(path.join(tempRoot, 'nf-04-'))
}

function openDatabase(Database, dbPath) {
  const db = new Database(dbPath)
  configureIsolatedDatabase(db)
  return db
}

function insertKnowledgeFixture(db) {
  const insertFact = db.prepare(`
    INSERT INTO story_facts (
      id, novel_id, kind, title, summary, status,
      reader_known_chapter_id, protagonist_known_chapter_id,
      character_knowledge_json, forbidden_before_volume,
      planned_reveal_volume, target_reveal_chapter_id, is_key_truth, notes
    ) VALUES (?, ?, 'truth', ?, ?, 'introduced', ?, ?, ?, NULL, NULL, NULL, 1, ?)
  `)

  const insert = db.transaction(() => {
    // N1: database IDs intentionally differ from chapter numbers.
    insertFact.run(4001, 101, '读者第3章已知', 'reader-visible', 901, null, '[]', 'fixture')
    insertFact.run(4002, 101, '角色A第3章已知', 'character-known', null, null, JSON.stringify([{ characterId: 11, knownChapterId: 901 }]), 'fixture')
    insertFact.run(4003, 101, '角色A获知时间未知', 'null-time', null, null, JSON.stringify([{ characterId: 11, knownChapterId: null }]), 'fixture')
    insertFact.run(4004, 101, '角色A第80章已知', 'future-character', null, null, JSON.stringify([{ characterId: 11, knownChapterId: 15 }]), 'fixture')
    insertFact.run(4005, 101, '角色A第20章已知', 'same-chapter', null, null, JSON.stringify([{ characterId: 11, knownChapterId: 3001 }]), 'fixture')
    insertFact.run(4006, 101, '人物记录优先', 'character-over-protagonist', null, 901, JSON.stringify([{ characterId: 11, knownChapterId: 15 }]), 'fixture')
    insertFact.run(4007, 101, '已删除引用', 'deleted-reference', null, null, JSON.stringify([{ characterId: 11, knownChapterId: 9999 }]), 'fixture')
    // 902 exists, but only in N2; N1 must not resolve it.
    insertFact.run(4008, 101, '跨小说引用', 'cross-novel-reference', null, null, JSON.stringify([{ characterId: 11, knownChapterId: 902 }]), 'fixture')
    insertFact.run(4009, 101, '主角专用记录', 'protagonist-only', null, 901, '[]', 'fixture')
    insertFact.run(4010, 202, 'N2跨小说引用N1', 'n2-cross-novel-reference', null, null, JSON.stringify([{ characterId: 11, knownChapterId: 901 }]), 'fixture')
  })
  insert()
}

function patchDatabaseDependency({ loadTypeScriptModule }) {
  const databaseModule = loadTypeScriptModule('electron/database/db.ts')
  const schemaModule = loadTypeScriptModule('electron/database/schema.ts')
  const knowledgeModule = loadTypeScriptModule('electron/services/knowledge-boundary.service.ts')
  let isolatedDb = null
  const originalGetDb = databaseModule.getDb
  databaseModule.getDb = () => isolatedDb

  return {
    knowledgeModule,
    schemaModule,
    setDatabase: (db) => { isolatedDb = db },
    restore: () => { databaseModule.getDb = originalGetDb },
  }
}

async function run({ tempRoot, Database, runMigrations, loadTypeScriptModule }) {
  const runDirectory = createRunDirectory(tempRoot)
  const dbPath = path.join(runDirectory, 'nf-04.sqlite3')
  const sqlite = openDatabase(Database, dbPath)
  let dependencies = null

  try {
    runMigrations(sqlite)
    assert.ok(getMigrationIds(sqlite).includes('0064_semantic_memory_source_range_repair'))
    insertNf00Fixture(sqlite)
    insertKnowledgeFixture(sqlite)

    dependencies = patchDatabaseDependency({ loadTypeScriptModule })
    dependencies.setDatabase(drizzle(sqlite, { schema: dependencies.schemaModule }))
    const { knowledgeModule } = dependencies

    const chapterFourSnapshot = knowledgeModule.getCharacterKnowledgeSnapshot(101, 11, 4, false)
    assert.deepEqual(chapterFourSnapshot.knownFacts.map((row) => row.id), [4002])
    assert.equal(chapterFourSnapshot.knownFacts[0].title, '角色A第3章已知')
    assert.equal('knownChapterNum' in chapterFourSnapshot.knownFacts[0], false)

    const chapterTwenty = knowledgeModule.getKnownFactsForCharacter(101, 11, 20)
    assert.deepEqual(chapterTwenty.map((row) => row.id), [4002, 4005])

    const chapterTwentyStart = knowledgeModule.getKnownFactsForCharacter(
      101,
      11,
      20,
      { boundary: 'start' },
    )
    assert.deepEqual(chapterTwentyStart.map((row) => row.id), [4002])

    const protagonistChapterTwenty = knowledgeModule.getKnownFactsForCharacter(
      101,
      11,
      20,
      { isProtagonist: true },
    )
    assert.equal(protagonistChapterTwenty.some((row) => row.id === 4006), false)
    assert.ok(protagonistChapterTwenty.some((row) => row.id === 4009))

    const chapterEighty = knowledgeModule.getKnownFactsForCharacter(101, 11, 80)
    assert.ok(chapterEighty.some((row) => row.id === 4004))
    assert.ok(chapterEighty.some((row) => row.id === 4006))

    const unknownFacts = knowledgeModule.getUnknownFactsForCharacter(101, 11, 20)
    const unknownById = new Map(unknownFacts.map((entry) => [entry.fact.id, entry]))
    assert.ok(unknownById.has(4003))
    assert.ok(unknownById.has(4004))
    assert.ok(unknownById.has(4007))
    assert.ok(unknownById.has(4008))
    assert.ok(unknownById.get(4003).diagnostics.some((item) => item.code === 'knowledge_time_unknown'))
    assert.ok(unknownById.get(4007).diagnostics.some((item) => item.code === 'chapter_reference_unresolved'))
    assert.ok(unknownById.get(4008).diagnostics.some((item) => item.code === 'chapter_reference_unresolved'))

    const n2Snapshot = knowledgeModule.getCharacterKnowledgeSnapshot(202, 11, 10, false)
    assert.equal(n2Snapshot.knownFacts.length, 0)
    assert.ok(n2Snapshot.diagnostics.some((item) => item.factId === 4010 && item.code === 'chapter_reference_unresolved'))

    return {
      runDirectory,
      dbPath,
      checks: {
        '04-01': { status: 'PASS', knownIdsAtChapter4: chapterFourSnapshot.knownFacts.map((row) => row.id) },
        '04-02': { status: 'PASS', futureChapterId: 15, futureChapterNum: 80 },
        '04-03': { status: 'PASS', readerOnlyExcluded: 4001 },
        '04-04': {
          status: 'PASS',
          unknownIds: [4003, 4007, 4008],
          diagnosticCodes: [...new Set(unknownFacts.flatMap((entry) => (entry.diagnostics || []).map((item) => item.code)))],
        },
        '04-05': { status: 'PASS', conflictingFactId: 4006, protagonistFallbackFactId: 4009 },
        '04-06': { status: 'PASS', chapterTwentyStartIds: chapterTwentyStart.map((row) => row.id), chapterTwentyEndIds: chapterTwenty.map((row) => row.id) },
        '04-07': { status: 'PASS', originalRowFieldsPreserved: true, n2Isolation: true },
      },
    }
  } finally {
    if (dependencies) dependencies.restore()
    sqlite.close()
  }
}

module.exports = { run }
