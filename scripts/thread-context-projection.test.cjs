const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.join(workspaceRoot, '.tmp-tests')

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

require.extensions['.ts'] = compileTs

const {
  loadChapterThreadContextProjection,
} = require(path.join(workspaceRoot, 'electron/services/context-thread-projection.ts'))

function runTest() {
  fs.mkdirSync(tempRoot, { recursive: true })
  const dbPath = path.join(tempRoot, 'thread-context-projection.db')
  fs.rmSync(dbPath, { force: true })

  const db = new Database(dbPath)
  try {
    db.exec(`
      CREATE TABLE chapters (
        id INTEGER PRIMARY KEY,
        novel_id INTEGER NOT NULL,
        chapter_num INTEGER NOT NULL
      );
      CREATE TABLE story_threads (
        id INTEGER PRIMARY KEY,
        novel_id INTEGER NOT NULL,
        thread_type TEXT DEFAULT 'subplot',
        status TEXT DEFAULT 'planned',
        priority TEXT DEFAULT 'medium',
        start_chapter INTEGER,
        target_payoff_chapter INTEGER,
        planted_chapter INTEGER,
        last_referenced_chapter INTEGER,
        reminder_interval INTEGER DEFAULT 20,
        sort_order INTEGER DEFAULT 0
      );
      CREATE TABLE foreshadow_ledger (
        id INTEGER PRIMARY KEY,
        novel_id INTEGER NOT NULL,
        source_chapter_id INTEGER,
        target_payoff_chapter INTEGER,
        status TEXT NOT NULL DEFAULT 'draft',
        linked_thread_id INTEGER
      );
    `)

    const insertChapter = db.prepare(`
      INSERT INTO chapters (id, novel_id, chapter_num)
      VALUES (?, ?, ?)
    `)
    const insertThread = db.prepare(`
      INSERT INTO story_threads (
        id,
        novel_id,
        thread_type,
        status,
        priority,
        start_chapter,
        target_payoff_chapter,
        planted_chapter,
        last_referenced_chapter,
        reminder_interval,
        sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertLedger = db.prepare(`
      INSERT INTO foreshadow_ledger (
        id,
        novel_id,
        source_chapter_id,
        target_payoff_chapter,
        status,
        linked_thread_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    ;[
      [1, 1, 1],
      [50, 1, 50],
      [55, 1, 55],
      [80, 1, 80],
    ].forEach((row) => insertChapter.run(...row))

    ;[
      [1, 1, 'main', 'active', 'high', 1, 200, null, 80, 20, 50],
      [2, 1, 'subplot', 'active', 'medium', 95, 103, null, 95, 20, 1],
      [3, 1, 'subplot', 'active', 'medium', 20, null, 20, 60, 20, 2],
      [4, 1, 'subplot', 'active', 'medium', 10, 102, null, 98, 20, 3],
      [5, 1, 'subplot', 'active', 'low', 96, null, null, 99, 20, 0],
      [6, 1, 'subplot', 'active', 'low', null, null, null, null, 20, 4],
      [7, 1, 'mystery', 'planned', 'medium', 50, 90, 50, 50, 20, 7],
      [8, 1, 'mystery', 'planned', 'high', 90, 101, 90, 90, 20, 8],
      [9, 1, 'payoff', null, 'low', 90, 99, 90, 90, 20, 9],
      [10, 1, 'mystery', 'planned', 'low', 1, 99, 1, 1, 20, 10],
      [11, 1, 'mystery', 'planned', 'high', 95, 101, 95, 95, 20, 11],
    ].forEach((row) => insertThread.run(...row))

    ;[
      [101, 1, 1, 99, 'active', 10],
      [102, 1, 50, 101, 'active', 11],
      [103, 1, 55, 102, 'active', null],
      [104, 1, 50, null, 'active', null],
      [105, 1, 55, null, 'active', null],
      [106, 1, 80, null, 'active', null],
      [107, 1, 1, null, 'resolved', null],
      [108, 1, 1, 200, 'active', 8],
    ].forEach((row) => insertLedger.run(...row))

    const projection = loadChapterThreadContextProjection(db, {
      novelId: 1,
      chapterNum: 100,
      dueLimit: 2,
      currentArc: {
        chapterStart: 90,
        chapterEnd: 120,
      },
    })

    assert.deepEqual(
      projection.activeThreadIds,
      [4, 2, 1],
      'the top active candidates must remain bounded while retaining the best main thread',
    )
    assert.equal(
      projection.pressureCount,
      4,
      'pressure must count all urgent and reminder-due active threads, not only displayed rows',
    )
    assert.deepEqual(
      projection.dueForeshadowIds,
      [101, 102],
      'overdue ledger entries must rank before near-future entries',
    )
    assert.deepEqual(projection.foreshadowLinkedThreadIds, [10, 11])
    assert.deepEqual(
      projection.dueThreadIds,
      [9, 7],
      'fallback threads must exclude every thread linked by any ledger row',
    )
    assert.deepEqual(
      projection.staleForeshadowIds,
      [104, 105],
      'only unresolved targetless foreshadows suspended for at least 40 chapters should surface',
    )
  } finally {
    db.close()
    fs.rmSync(dbPath, { force: true })
  }

  console.log('thread context projection tests passed')
}

async function main() {
  if (!process.versions.electron) {
    runTest()
    return
  }

  const { app } = require('electron')
  await app.whenReady()
  try {
    runTest()
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
