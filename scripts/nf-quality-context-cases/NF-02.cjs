'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  configureIsolatedDatabase,
  createLoopbackHttpStub,
  getMigrationIds,
} = require('../nf-quality-context-fixtures.cjs')

const MIGRATION_ID = '0065_model_request_attempts'
const REQUIRED_COLUMNS = [
  'request_id', 'task_id', 'novel_id', 'kind', 'provider', 'model_id',
  'attempt_index', 'status', 'started_at', 'finished_at', 'usage_json',
  'completion_json', 'error_code', 'context_pack_id',
]

function createRunDirectory(tempRoot) {
  fs.mkdirSync(tempRoot, { recursive: true })
  return fs.mkdtempSync(path.join(tempRoot, 'nf-02-'))
}

function openDatabase(Database, dbPath) {
  const db = new Database(dbPath)
  configureIsolatedDatabase(db)
  return db
}

function assertAttemptSchema(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(model_request_attempts)').all().map((row) => row.name))
  for (const column of REQUIRED_COLUMNS) assert.ok(columns.has(column), `missing ${column}`)
  const indexes = new Set(db.prepare('PRAGMA index_list(model_request_attempts)').all().map((row) => row.name))
  assert.ok(indexes.has('idx_model_request_attempts_task_index'))
  assert.ok(indexes.has('idx_model_request_attempts_status_started'))
  assert.ok(indexes.has('idx_model_request_attempts_novel'))
}

function create0064Baseline({ runDirectory, Database, baselineRunMigrations }) {
  const baselinePath = path.join(runDirectory, 'baseline-0064.sqlite3')
  const db = openDatabase(Database, baselinePath)
  try {
    baselineRunMigrations(db)
    const ids = getMigrationIds(db)
    assert.ok(ids.includes('0064_semantic_memory_source_range_repair'))
    assert.equal(ids.includes(MIGRATION_ID), false)
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='model_request_attempts'").get().count, 0)
    return baselinePath
  } finally {
    db.close()
  }
}

function verifyFreshAndIdempotent({ runDirectory, Database, runMigrations }) {
  const dbPath = path.join(runDirectory, 'fresh.sqlite3')
  const db = openDatabase(Database, dbPath)
  try {
    runMigrations(db)
    assertAttemptSchema(db)
    const ids = getMigrationIds(db)
    assert.ok(ids.includes(MIGRATION_ID))
    runMigrations(db)
    assert.deepEqual(getMigrationIds(db), ids)
    return { dbPath, migrationCount: ids.length }
  } finally {
    db.close()
  }
}

function verifyUpgradeAndCascade({ runDirectory, baselinePath, Database, runMigrations }) {
  const dbPath = path.join(runDirectory, 'upgrade-from-0064.sqlite3')
  fs.copyFileSync(baselinePath, dbPath)
  const db = openDatabase(Database, dbPath)
  try {
    assert.equal(getMigrationIds(db).includes(MIGRATION_ID), false)
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='model_request_attempts'").get().count, 0)
    runMigrations(db)
    assertAttemptSchema(db)

    const taskId = Number(db.prepare("INSERT INTO tasks (type, status) VALUES ('chapter_writer', 'running')").run().lastInsertRowid)
    const usage = JSON.stringify({
      input: { value: null, source: 'unknown' }, output: { value: null, source: 'unknown' },
      cacheRead: { value: null, source: 'unknown' }, cacheWrite: { value: null, source: 'unknown' },
      reasoning: { value: null, source: 'unknown' },
    })
    db.prepare(`
      INSERT INTO model_request_attempts (
        request_id, task_id, kind, provider, model_id, attempt_index, status, started_at, usage_json
      ) VALUES ('req-task', ?, 'chat', 'openai', 'test', 1, 'started', CURRENT_TIMESTAMP, ?)
    `).run(taskId, usage)
    db.prepare(`
      INSERT INTO model_request_attempts (
        request_id, task_id, kind, provider, model_id, attempt_index, status, started_at, usage_json
      ) VALUES ('req-unlinked-a', NULL, 'embedding', 'openai', 'embed', 1, 'success', CURRENT_TIMESTAMP, ?),
               ('req-unlinked-b', NULL, 'auth', 'baidu', 'auth', 1, 'success', CURRENT_TIMESTAMP, ?)
    `).run(usage, usage)
    db.prepare(`
      INSERT INTO model_request_attempts (
        request_id, task_id, kind, provider, model_id, attempt_index, status, started_at
      ) VALUES ('req-default-usage', NULL, 'cli', 'codex', 'test', 1, 'started', CURRENT_TIMESTAMP)
    `).run()
    assert.equal(JSON.parse(db.prepare("SELECT usage_json FROM model_request_attempts WHERE request_id='req-default-usage'").get().usage_json).input.value, null)
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM model_request_attempts WHERE request_id='req-task'").get().count, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM model_request_attempts WHERE task_id IS NULL').get().count, 3)
    return { dbPath, taskCascade: true, unlinkedAttempts: 3, defaultUsageUnknown: true }
  } finally {
    db.close()
  }
}

function verifyMigrationRollback({ runDirectory, baselinePath, Database, runMigrations }) {
  const dbPath = path.join(runDirectory, 'fault.sqlite3')
  fs.copyFileSync(baselinePath, dbPath)
  const db = openDatabase(Database, dbPath)
  try {
    db.exec('CREATE TABLE model_request_attempts (request_id TEXT PRIMARY KEY)')
    assert.throws(() => runMigrations(db), /no such column|model_request_attempts/u)
    assert.equal(getMigrationIds(db).includes(MIGRATION_ID), false)
    assert.equal(db.prepare('PRAGMA index_list(model_request_attempts)').all().some((row) => row.name === 'idx_model_request_attempts_task_index'), false)
    return { dbPath, migrationRecorded: false, partialIndexRolledBack: true }
  } finally {
    db.close()
  }
}

async function verifyProtocolLifecycle({ loadTypeScriptModule }) {
  const { OpenAIAdapter } = loadTypeScriptModule('electron/adapters/openai.adapter.ts')
  const stub = createLoopbackHttpStub()
  try {
    await stub.start()
    stub.register('/v1/chat/completions', [
      { statusCode: 429, headers: { 'content-type': 'text/plain', 'retry-after': '0' }, body: 'rate limited' },
      {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          choices: [{ message: { content: '完成' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        },
      },
      {
        statusCode: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: 'data: {"choices":[{"delta":{"content":"半段"}}]}\n\n',
      },
    ])
    const adapter = new OpenAIAdapter('stub-key', 'stub-model', `${stub.getBaseUrl()}/v1`)
    const events = []
    const requestObserver = {
      onRequestStart: (event) => events.push(event),
      onRequestEnd: (event) => events.push(event),
    }
    await assert.rejects(
      () => adapter.chat([{ role: 'user', content: 'first' }], { requestRetryCount: 0, requestObserver }),
      (error) => error && error.statusCode === 429,
    )
    const text = await adapter.chat([{ role: 'user', content: 'second' }], { requestRetryCount: 0, requestObserver })
    assert.equal(text, '完成')
    const chunks = []
    await assert.rejects(
      () => adapter.stream([{ role: 'user', content: 'stream' }], {
        requestRetryCount: 0,
        requestObserver,
        onStream: (chunk) => chunks.push(chunk),
      }),
      (error) => error && error.code === 'MODEL_STREAM_INTERRUPTED',
    )
    assert.deepEqual(chunks, ['半段'])
    assert.equal(stub.getRequestCount('/v1/chat/completions'), 3)
    const starts = events.filter((event) => event.status === 'started')
    const ends = events.filter((event) => event.status !== 'started')
    assert.equal(starts.length, 3)
    assert.deepEqual(ends.map((event) => event.status), ['failed', 'success', 'failed'])
    assert.equal(new Set(starts.map((event) => event.requestId)).size, 3)
    assert.equal(ends[1].usage.output.value, 2)
    assert.equal(ends[2].errorCode, 'MODEL_STREAM_INTERRUPTED')
    return { requests: 3, statuses: ends.map((event) => event.status), partial: chunks.join('') }
  } finally {
    await stub.close()
  }
}

async function run({ tempRoot, Database, runMigrations, baselineRunMigrations, loadTypeScriptModule }) {
  const runDirectory = createRunDirectory(tempRoot)
  const baselinePath = create0064Baseline({ runDirectory, Database, baselineRunMigrations })
  const fresh = verifyFreshAndIdempotent({ runDirectory, Database, runMigrations })
  const upgrade = verifyUpgradeAndCascade({ runDirectory, baselinePath, Database, runMigrations })
  const rollback = verifyMigrationRollback({ runDirectory, baselinePath, Database, runMigrations })
  const protocol = await verifyProtocolLifecycle({ loadTypeScriptModule })
  return {
    checks: {
      '02-01': { status: 'PASS', protocol: { requests: 2, statuses: protocol.statuses.slice(0, 2) } },
      '02-03': { status: 'PASS', protocol: { status: protocol.statuses[2], partial: protocol.partial } },
      '02-07': { status: 'PASS', fresh, baselinePath, upgrade, rollback },
    },
    runDirectory,
  }
}

module.exports = { run }
