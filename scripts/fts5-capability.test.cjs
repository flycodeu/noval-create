const assert = require('node:assert/strict')

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '')
    if (message.includes('NODE_MODULE_VERSION') || message.includes('better_sqlite3.node')) {
      console.error('[fts5-capability] better-sqlite3 ABI 不匹配，请通过 Electron 运行：npm run test:fts5')
      process.exit(1)
    }
    throw error
  }
}

const Database = loadBetterSqlite3()

function quoteMatchTerm(term) {
  return `"${term.replaceAll('"', '""')}"`
}

function tryTokenizer(db, tokenizer) {
  const tableName = `fts_${tokenizer}`
  try {
    db.exec(`
      CREATE VIRTUAL TABLE ${tableName}
      USING fts5(content, tokenize='${tokenizer}');
    `)
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error || ''),
      matches: {},
      tokens: [],
    }
  }

  const rows = [
    '沈砚负责北线补给线。',
    '药箱存放在旧仓库。',
    '旧仓库已改造成临时医疗点。',
  ]
  const insert = db.prepare(`INSERT INTO ${tableName}(content) VALUES (?)`)
  rows.forEach((content) => insert.run(content))

  const terms = ['沈砚', '补给线', '旧仓库', '仓库', '药箱']
  const matches = Object.fromEntries(terms.map((term) => {
    const count = db.prepare(`
      SELECT COUNT(*) AS count
      FROM ${tableName}
      WHERE ${tableName} MATCH ?
    `).get(quoteMatchTerm(term)).count
    return [term, count]
  }))

  db.exec(`
    CREATE VIRTUAL TABLE ${tableName}_vocab
    USING fts5vocab(${tableName}, 'row');
  `)
  const tokens = db.prepare(`
    SELECT term, doc, cnt
    FROM ${tableName}_vocab
    ORDER BY term
  `).all()

  return {
    available: true,
    matches,
    tokens,
  }
}

function runCapabilityTest() {
  const db = new Database(':memory:')
  try {
    const compileOptions = db.prepare('PRAGMA compile_options').all().map((row) => row.compile_options)
    const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version
    const result = {
      runtime: process.versions.electron
        ? `electron ${process.versions.electron}`
        : `node ${process.version}`,
      sqliteVersion,
      compileOptions: compileOptions.filter((option) => option.includes('FTS')),
      unicode61: tryTokenizer(db, 'unicode61'),
      trigram: tryTokenizer(db, 'trigram'),
    }

    console.log(JSON.stringify(result, null, 2))

    assert.equal(result.unicode61.available, true, 'FTS5 unicode61 tokenizer must be available')
    if (result.trigram.available) {
      assert.equal(result.trigram.matches['补给线'], 1)
      assert.equal(result.trigram.matches['旧仓库'], 2)
    }
  } finally {
    db.close()
  }
}

async function main() {
  if (process.versions.electron) {
    const { app } = require('electron')
    await app.whenReady()
    try {
      runCapabilityTest()
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  runCapabilityTest()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
