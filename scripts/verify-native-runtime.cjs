const assert = require('node:assert/strict')
const { app } = require('electron')
app.setPath('userData', require('./isolate-test-session.cjs')(app))
app.disableHardwareAcceleration()

// better-sqlite3 13 ships Node-API binaries; rebuilding them for a V8 ABI is
// unnecessary. Exercise the shipped bindings in the actual Electron runtime.
app.whenReady().then(async () => {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  try {
    db.exec('CREATE VIRTUAL TABLE documents USING fts5(content)')
    db.prepare('INSERT INTO documents VALUES (?)').run('native runtime verification')
    assert.equal(db.prepare("SELECT count(*) AS count FROM documents WHERE documents MATCH 'verification'").get().count, 1)
  } finally {
    db.close()
  }
  const { pipeline } = await import('@huggingface/transformers')
  assert.equal(typeof pipeline, 'function')
  assert.equal(typeof require('@huggingface/transformers').pipeline, 'function')
  console.log(`Native runtime verified: Electron ${process.versions.electron}, SQLite FTS5, Transformers import`)
  app.exit(0)
}).catch(error => {
  console.error(error)
  app.exit(1)
})
