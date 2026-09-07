'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  configureIsolatedDatabase,
  createLoopbackHttpStub,
  getMigrationIds,
  insertNf00Fixture,
  verifyNf00Fixture,
} = require('../nf-quality-context-fixtures.cjs')

function assertInsideTempRoot(tempRoot, targetPath) {
  const root = path.resolve(tempRoot)
  const target = path.resolve(targetPath)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  assert.ok(target.startsWith(prefix), `路径必须位于临时根目录内: ${target}`)
}

function createRunDirectory(tempRoot) {
  fs.mkdirSync(tempRoot, { recursive: true })
  const runDirectory = fs.mkdtempSync(path.join(tempRoot, 'nf-00-'))
  assertInsideTempRoot(tempRoot, runDirectory)
  return runDirectory
}

function openDatabase(Database, dbPath) {
  const db = new Database(dbPath)
  configureIsolatedDatabase(db)
  return db
}

async function verifyHttpStub() {
  const stub = createLoopbackHttpStub()
  let responseCalls = 0
  try {
    await stub.start()
    stub.register('/scripted', (request) => {
      responseCalls += 1
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: { ok: true, method: request.method, body: request.body },
      }
    })

    const scripted = await stub.request('/scripted', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ case: 'NF-00' }),
    })
    assert.equal(scripted.statusCode, 200)
    assert.deepEqual(JSON.parse(scripted.body), {
      ok: true,
      method: 'POST',
      body: JSON.stringify({ case: 'NF-00' }),
    })
    assert.equal(responseCalls, 1)

    await assert.rejects(
      () => stub.request('/unregistered'),
      (error) => error && error.statusCode === 404 && error.responseBody.includes('NF_STUB_UNREGISTERED_ROUTE'),
    )
    const receivedBeforeExternalAttempt = stub.getRequestLog().length

    await assert.rejects(
      () => stub.request('https://example.com/should-never-be-called'),
      /NF_STUB_EXTERNAL_URL: example\.com/,
    )
    assert.equal(stub.getRequestLog().length, receivedBeforeExternalAttempt)
    assert.equal(stub.getRequestCount('/scripted'), 1)
    assert.equal(stub.getRequestCount('/unregistered'), 1)

    return {
      baseUrl: stub.getBaseUrl(),
      receivedRequests: stub.getRequestLog().length,
      attempts: stub.getAttemptLog().length,
      blockedExternalAttempts: stub.getAttemptLog().filter((attempt) => attempt.blocked).length,
    }
  } finally {
    await stub.close()
  }
}

async function runOne({ index, tempRoot, Database, runMigrations }) {
  const runDirectory = createRunDirectory(tempRoot)
  const dbPath = path.join(runDirectory, 'nf-00.sqlite3')
  const baselineDbPath = path.join(runDirectory, 'nf-00-baseline.sqlite3')
  assertInsideTempRoot(tempRoot, dbPath)
  assertInsideTempRoot(tempRoot, baselineDbPath)
  assert.equal(fs.existsSync(dbPath), false)
  assert.equal(fs.existsSync(baselineDbPath), false)

  let db = null
  try {
    db = openDatabase(Database, dbPath)
    runMigrations(db)
    const migrationIdsBeforeClose = getMigrationIds(db)
    assert.ok(migrationIdsBeforeClose.length > 0)
    assert.ok(migrationIdsBeforeClose.includes('0064_semantic_memory_source_range_repair'))

    await db.backup(baselineDbPath)
    let baselineDb = null
    try {
      baselineDb = openDatabase(Database, baselineDbPath)
      assert.deepEqual(getMigrationIds(baselineDb), migrationIdsBeforeClose)
      assert.equal(baselineDb.prepare('SELECT COUNT(*) AS count FROM novels').get().count, 0)
    } finally {
      if (baselineDb) baselineDb.close()
    }

    insertNf00Fixture(db)
    const beforeClose = verifyNf00Fixture(db)
    db.close()
    db = null

    db = openDatabase(Database, dbPath)
    const migrationIdsAfterReopen = getMigrationIds(db)
    assert.deepEqual(migrationIdsAfterReopen, migrationIdsBeforeClose)
    const afterReopen = verifyNf00Fixture(db)
    assert.deepEqual(afterReopen, beforeClose)

    return {
      index,
      runDirectory,
      dbPath,
      baselineDbPath,
      migrationCount: migrationIdsAfterReopen.length,
      migrationIds: migrationIdsAfterReopen,
      chapterThree: afterReopen.chapterThree,
      n1ChapterIdsByChapterNum: afterReopen.n1Rows.map((row) => row.id),
      n1ChapterNums: afterReopen.n1Rows.map((row) => row.chapterNum),
      n2ChapterIds: afterReopen.n2Rows.map((row) => row.id),
    }
  } finally {
    if (db) db.close()
  }
}

async function verifyFinallyCleanup({ tempRoot, Database, runMigrations }) {
  const runDirectory = createRunDirectory(tempRoot)
  const dbPath = path.join(runDirectory, 'nf-00-failure.sqlite3')
  let db = null
  let stub = null
  let thrown = null
  try {
    db = openDatabase(Database, dbPath)
    runMigrations(db)
    stub = createLoopbackHttpStub()
    await stub.start()
    throw new Error('NF00_INJECTED_FAILURE')
  } catch (error) {
    thrown = error
  } finally {
    try {
      if (db) db.close()
    } finally {
      if (stub) await stub.close()
    }
  }

  assert.equal(thrown?.message, 'NF00_INJECTED_FAILURE')
  assert.throws(() => db.prepare('SELECT 1'), /closed|not open/i)
  await assert.rejects(() => stub.request('/after-close'), /ECONNREFUSED|closed/i)
  assert.equal(fs.existsSync(runDirectory), true)
  return { runDirectory, databaseClosed: true, stubClosed: true, runDirectoryPreserved: true }
}

async function run({ tempRoot, Database, runMigrations }) {
  const first = await runOne({ index: 1, tempRoot, Database, runMigrations })
  const second = await runOne({ index: 2, tempRoot, Database, runMigrations })
  assert.notEqual(first.runDirectory, second.runDirectory)
  assert.notEqual(first.dbPath, second.dbPath)
  assertInsideTempRoot(tempRoot, first.dbPath)
  assertInsideTempRoot(tempRoot, second.dbPath)

  const stub = await verifyHttpStub()
  const cleanup = await verifyFinallyCleanup({ tempRoot, Database, runMigrations })
  return {
    checks: {
      '00-01': { status: 'PASS', runs: [first.runDirectory, second.runDirectory] },
      '00-03': { status: 'PASS', stub },
      '00-04': {
        status: 'PASS',
        chapterThree: first.chapterThree,
        n1ChapterIdsByChapterNum: first.n1ChapterIdsByChapterNum,
        n1ChapterNums: first.n1ChapterNums,
      },
      '00-05': { status: 'PASS', ...cleanup },
    },
    runs: [first, second],
  }
}

module.exports = { run }
