const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const Database = require('better-sqlite3')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.join(workspaceRoot, '.tmp-tests')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    const directCandidates = ['.ts', '.tsx', '.js', '.json'].map((ext) => path.resolve(baseDir, request + ext))
    for (const candidate of directCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }

    const indexCandidates = ['.ts', '.tsx', '.js'].map((ext) => path.resolve(baseDir, request, 'index' + ext))
    for (const candidate of indexCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  })

  module._compile(outputText, filename)
}

require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

const { runMigrations } = require(path.join(workspaceRoot, 'electron/database/db.ts'))

function prepareTempDir() {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  fs.mkdirSync(tempRoot, { recursive: true })
}

function openDb(name) {
  const dbPath = path.join(tempRoot, name)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

function getColumns(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all()
  return new Set(rows.map((row) => row.name))
}

function getMigrationIds(db) {
  return db.prepare('SELECT id FROM _schema_migrations ORDER BY id').all().map((row) => row.id)
}

function assertRequiredColumns(db) {
  assert.ok(getColumns(db, 'model_configs').has('max_concurrency'))
  assert.ok(getColumns(db, 'model_configs').has('max_context_tokens'))
  assert.ok(getColumns(db, 'story_arcs').has('progress_percent'))
  assert.ok(getColumns(db, 'story_arcs').has('stalled_chapter_count'))
  assert.ok(getColumns(db, 'story_arcs').has('last_progress_chapter_num'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('character_cards_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('relation_cards_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('item_cards_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('timeline_cards_json'))
  assert.ok(getColumns(db, 'story_memory_checkpoints').has('thread_cards_json'))
  assert.ok(getColumns(db, 'tasks').has('runner_type'))
  assert.ok(getColumns(db, 'tasks').has('progress_json'))
  assert.ok(getColumns(db, 'chapter_versions').has('version_source'))
  assert.ok(getColumns(db, 'chapter_versions').has('word_count'))
  assert.ok(getColumns(db, 'operation_logs').has('summary'))
  assert.ok(getColumns(db, 'operation_logs').has('undo_payload_json'))
}

function testFreshDbIsIdempotent() {
  const db = openDb('fresh-migration.db')
  try {
    runMigrations(db)
    assertRequiredColumns(db)
    const firstIds = getMigrationIds(db)
    assert.deepEqual(firstIds, [
      '0001_core_schema',
      '0002_additive_schema',
      '0003_indexes',
      '0004_backfills',
      '0005_validate_schema',
      '0006_history_recovery',
      '0007_validate_history',
      '0008_model_context_windows',
      '0009_validate_model_runtime',
      '0010_model_parameter_defaults',
      '0011_embedding_and_style_tables',
      '0012_story_memory_context_cards',
    ])

    runMigrations(db)
    assert.deepEqual(getMigrationIds(db), firstIds)
    assertRequiredColumns(db)
  } finally {
    db.close()
  }
}

function testPartialSchemaCanResume() {
  const db = openDb('partial-migration.db')
  try {
    db.exec(`
      CREATE TABLE novels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        synopsis TEXT,
        genre_id INTEGER,
        status TEXT DEFAULT 'draft',
        total_words INTEGER DEFAULT 0,
        target_words INTEGER DEFAULT 200000,
        cover_image TEXT,
        user_background TEXT,
        expanded_background TEXT,
        project_brief_json TEXT,
        settings_json TEXT,
        world_rules_json TEXT,
        style_template_id INTEGER,
        world_template_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE model_configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        api_key TEXT,
        base_url TEXT,
        temperature REAL DEFAULT 0.85,
        max_tokens INTEGER DEFAULT 4096,
        max_concurrency INTEGER DEFAULT 4
      );

      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        novel_id INTEGER,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        input_json TEXT,
        output_text TEXT,
        model_config_id INTEGER,
        tokens_used INTEGER,
        duration_ms INTEGER,
        error_message TEXT,
        related_entity_type TEXT,
        related_entity_id INTEGER,
        runner_type TEXT DEFAULT 'chat',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `)

    db.prepare(`
      INSERT INTO model_configs (name, provider, model_id, api_key, temperature, max_tokens, max_concurrency)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('OpenAI Legacy', 'openai', 'gpt-4o', null, 0.85, 4096, 4)

    db.prepare(`
      INSERT INTO model_configs (name, provider, model_id, api_key, temperature, max_tokens, max_concurrency)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('Custom Legacy', 'custom', 'local-model', null, 0.85, 4096, 4)

    runMigrations(db)
    assertRequiredColumns(db)
    assert.deepEqual(getMigrationIds(db), [
      '0001_core_schema',
      '0002_additive_schema',
      '0003_indexes',
      '0004_backfills',
      '0005_validate_schema',
      '0006_history_recovery',
      '0007_validate_history',
      '0008_model_context_windows',
      '0009_validate_model_runtime',
      '0010_model_parameter_defaults',
      '0011_embedding_and_style_tables',
      '0012_story_memory_context_cards',
    ])

    const configs = db.prepare(`
      SELECT provider, temperature, max_tokens
      FROM model_configs
      ORDER BY id
    `).all()

    assert.deepEqual(configs, [
      { provider: 'openai', temperature: 0.8, max_tokens: 8192 },
      { provider: 'custom', temperature: 0.85, max_tokens: 4096 },
    ])

    runMigrations(db)
    assertRequiredColumns(db)
  } finally {
    db.close()
  }
}

function runAllTests() {
  prepareTempDir()
  testFreshDbIsIdempotent()
  testPartialSchemaCanResume()
  console.log('migration-safety tests passed')
}

async function main() {
  if (process.versions.electron) {
    const { app } = require('electron')
    await app.whenReady()
    try {
      runAllTests()
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  runAllTests()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
