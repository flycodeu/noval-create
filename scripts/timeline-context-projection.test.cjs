const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
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
  loadTimelineContextEventIds,
} = require(path.join(workspaceRoot, 'electron/services/context-timeline-projection.ts'))

function runTest() {
  fs.mkdirSync(tempRoot, { recursive: true })
  const dbPath = path.join(tempRoot, 'timeline-context-projection.db')
  fs.rmSync(dbPath, { force: true })

  const db = new Database(dbPath)
  try {
    db.exec(`
    CREATE TABLE chapters (
      id INTEGER PRIMARY KEY,
      novel_id INTEGER NOT NULL,
      chapter_num INTEGER NOT NULL
    );
    CREATE TABLE timeline_events (
      id INTEGER PRIMARY KEY,
      novel_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      time_sort_value REAL DEFAULT 0,
      arc_id INTEGER,
      chapter_start_id INTEGER,
      chapter_end_id INTEGER,
      status TEXT DEFAULT 'planned'
    );
  `)

    const insertChapter = db.prepare(`
    INSERT INTO chapters (id, novel_id, chapter_num)
    VALUES (?, ?, ?)
  `)
    const insertEvent = db.prepare(`
    INSERT INTO timeline_events (
      id,
      novel_id,
      sort_order,
      time_sort_value,
      arc_id,
      chapter_start_id,
      chapter_end_id,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

    insertChapter.run(1, 1, 1)
    insertChapter.run(2, 1, 9)
    insertEvent.run(1, 1, 1, 1, null, null, 2, 'planned')

    assert.deepEqual(
      loadTimelineContextEventIds(db, 1, 10, null),
      [1],
      'an explicit past chapter anchor must override a stale planned status',
    )

    ;[
      [101, 2, 1],
      [102, 2, 9],
      [103, 2, 10],
      [104, 2, 11],
      [105, 2, 20],
    ].forEach((row) => insertChapter.run(...row))

    ;[
      [101, 2, 1, 1, null, null, 101, 'planned'],
      [102, 2, 2, 2, null, null, 102, 'planned'],
      [103, 2, 3, 3, null, null, null, 'written'],
      [104, 2, 4, 4, null, null, 102, 'planned'],
      [105, 2, 5, 5, null, null, 102, 'planned'],
      [106, 2, 6, 6, 77, 105, null, 'planned'],
      [107, 2, 7, 7, 77, 105, null, 'planned'],
      [108, 2, 8, 8, 77, 105, null, 'planned'],
      [109, 2, 9, 9, 77, 105, null, 'planned'],
      [110, 2, 10, 10, null, 103, null, 'planned'],
      [111, 2, 11, 11, null, 104, null, 'planned'],
      [112, 2, 12, 12, null, null, null, 'planned'],
      [113, 2, 13, 13, null, 105, null, 'planned'],
    ].forEach((row) => insertEvent.run(...row))

    const selectedIds = loadTimelineContextEventIds(db, 2, 10, 77)
    assert.deepEqual(
      selectedIds,
      [107, 108, 109, 110, 111, 112],
      `timeline projection must retain only the latest six merged candidates; actual=${JSON.stringify(selectedIds)}`,
    )
  } finally {
    db.close()
    fs.rmSync(dbPath, { force: true })
  }

  console.log('timeline context projection tests passed')
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
