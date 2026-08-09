const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const Database = require('better-sqlite3')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.join(workspaceRoot, '.tmp-tests')
const databasePath = path.join(tempRoot, 'semantic-memory-soak.db')
const candidateLimit = 512
const measurementRounds = 7

const queryCases = [
  { term: '补给线', divisor: 97, ftsEligible: true },
  { term: '旧仓库', divisor: 211, ftsEligible: true },
  { term: '沈砚', divisor: 389, ftsEligible: false },
  { term: '仓库', divisor: 211, ftsEligible: false },
  { term: '药箱', divisor: 503, ftsEligible: false },
]

function parseTargets() {
  const configured = String(process.env.NOVELFORGE_SEMANTIC_SOAK_SIZES || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0)
  const targets = configured.length > 0 ? configured : [10_000, 50_000, 100_000]
  return [...new Set(targets)].sort((left, right) => left - right)
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function measureCandidates(statement, parameters) {
  statement.all(...parameters)
  const durations = []
  let candidateCount = 0
  for (let round = 0; round < measurementRounds; round += 1) {
    const startedAt = performance.now()
    const rows = statement.all(...parameters)
    durations.push(performance.now() - startedAt)
    candidateCount = rows.length
  }
  return {
    candidateCount,
    medianMs: Number(percentile(durations, 0.5).toFixed(3)),
    p95Ms: Number(percentile(durations, 0.95).toFixed(3)),
  }
}

function contentFor(index) {
  const markers = []
  if (index % 97 === 0) markers.push('北线补给线需要重新核验')
  if (index % 211 === 0) markers.push('旧仓库改造成临时据点')
  if (index % 389 === 0) markers.push('沈砚负责现场协调')
  if (index % 503 === 0) markers.push('药箱由医疗组保管')
  const details = markers.length > 0 ? markers.join('；') : '常规人物状态与剧情推进记录'
  return `第${index}号语义片段。${details}。章节锚点${index % 2400}，状态版本${index % 17}。`
}

function removeDatabaseFiles() {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true })
  }
}

function createDatabase() {
  fs.mkdirSync(tempRoot, { recursive: true })
  removeDatabaseFiles()
  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE semantic_memory_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      fragment_key TEXT NOT NULL,
      content_text TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'canon',
      valid_from_chapter INTEGER,
      valid_to_chapter INTEGER
    );
    CREATE INDEX idx_semantic_memory_scope
      ON semantic_memory_entries(novel_id, source_type, visibility, id);

    CREATE TABLE semantic_memory_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL
    );
    CREATE INDEX idx_semantic_memory_dirty_source
      ON semantic_memory_outbox(novel_id, source_type, source_id);

    CREATE VIRTUAL TABLE semantic_memory_fts
    USING fts5(content_text, tokenize='trigram');

    CREATE TRIGGER trg_semantic_memory_fts_insert
    AFTER INSERT ON semantic_memory_entries
    BEGIN
      INSERT INTO semantic_memory_fts(rowid, content_text)
      VALUES (NEW.id, NEW.content_text);
    END;
  `)
  return db
}

function runSoak() {
  const targets = parseTargets()
  const db = createDatabase()
  let observedPeakRss = process.memoryUsage().rss
  const initialRss = observedPeakRss
  const reports = []
  try {
    const insert = db.prepare(`
      INSERT INTO semantic_memory_entries (
        novel_id, source_type, source_id, fragment_key, content_text, visibility
      ) VALUES (1, ?, ?, 'identity', ?, 'canon')
    `)
    const insertRange = db.transaction((start, end) => {
      for (let index = start; index <= end; index += 1) {
        const sourceType = ['character', 'map', 'item', 'story_thread', 'timeline_event'][index % 5]
        insert.run(sourceType, index, contentFor(index))
        if (index % 5_000 === 0) {
          observedPeakRss = Math.max(observedPeakRss, process.memoryUsage().rss)
        }
      }
    })

    const ftsCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM semantic_memory_fts
      INNER JOIN semantic_memory_entries AS entry
        ON entry.id = semantic_memory_fts.rowid
      WHERE semantic_memory_fts MATCH ?
        AND entry.novel_id = 1
        AND entry.visibility = 'canon'
        AND NOT EXISTS (
          SELECT 1
          FROM semantic_memory_outbox AS dirty
          WHERE dirty.novel_id = entry.novel_id
            AND dirty.source_type = entry.source_type
            AND dirty.source_id = entry.source_id
        )
    `)
    const likeCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM semantic_memory_entries AS entry
      WHERE entry.novel_id = 1
        AND entry.visibility = 'canon'
        AND entry.content_text LIKE ?
        AND NOT EXISTS (
          SELECT 1
          FROM semantic_memory_outbox AS dirty
          WHERE dirty.novel_id = entry.novel_id
            AND dirty.source_type = entry.source_type
            AND dirty.source_id = entry.source_id
        )
    `)
    const ftsCandidates = db.prepare(`
      SELECT semantic_memory_fts.rowid AS id
      FROM semantic_memory_fts
      INNER JOIN semantic_memory_entries AS entry
        ON entry.id = semantic_memory_fts.rowid
      WHERE semantic_memory_fts MATCH ?
        AND entry.novel_id = 1
        AND entry.visibility = 'canon'
        AND NOT EXISTS (
          SELECT 1
          FROM semantic_memory_outbox AS dirty
          WHERE dirty.novel_id = entry.novel_id
            AND dirty.source_type = entry.source_type
            AND dirty.source_id = entry.source_id
        )
      ORDER BY bm25(semantic_memory_fts), semantic_memory_fts.rowid DESC
      LIMIT ?
    `)
    const likeCandidates = db.prepare(`
      SELECT entry.id
      FROM semantic_memory_entries AS entry
      WHERE entry.novel_id = 1
        AND entry.visibility = 'canon'
        AND entry.content_text LIKE ?
        AND NOT EXISTS (
          SELECT 1
          FROM semantic_memory_outbox AS dirty
          WHERE dirty.novel_id = entry.novel_id
            AND dirty.source_type = entry.source_type
            AND dirty.source_id = entry.source_id
        )
      ORDER BY entry.id DESC
      LIMIT ?
    `)

    let insertedCount = 0
    for (const target of targets) {
      const insertStartedAt = performance.now()
      insertRange(insertedCount + 1, target)
      const insertMs = performance.now() - insertStartedAt
      insertedCount = target
      db.pragma('wal_checkpoint(TRUNCATE)')
      observedPeakRss = Math.max(observedPeakRss, process.memoryUsage().rss)

      const queries = queryCases.map(({ term, divisor, ftsEligible }) => {
        const expectedMatches = Math.floor(target / divisor)
        const quotedTerm = `"${term}"`
        const ftsMatches = Number(ftsCount.get(quotedTerm).count)
        const likeMatches = Number(likeCount.get(`%${term}%`).count)
        assert.equal(likeMatches, expectedMatches, `${term} LIKE count at ${target}`)
        assert.equal(
          ftsMatches,
          ftsEligible ? expectedMatches : 0,
          `${term} FTS count at ${target}`,
        )

        const ftsTiming = measureCandidates(ftsCandidates, [quotedTerm, candidateLimit])
        const likeTiming = measureCandidates(likeCandidates, [`%${term}%`, candidateLimit])
        const selectedTiming = ftsEligible ? ftsTiming : likeTiming
        assert.equal(selectedTiming.candidateCount, Math.min(expectedMatches, candidateLimit))
        observedPeakRss = Math.max(observedPeakRss, process.memoryUsage().rss)
        return {
          term,
          selectedMode: ftsEligible ? 'fts5_trigram' : 'like_short_term_fallback',
          expectedMatches,
          ftsMatches,
          likeMatches,
          ftsCandidates: ftsTiming,
          likeCandidates: likeTiming,
        }
      })

      reports.push({
        entries: target,
        insertedThisStep: target - (reports.at(-1)?.entries || 0),
        insertMs: Number(insertMs.toFixed(1)),
        databaseMiB: Number((fs.statSync(databasePath).size / 1024 / 1024).toFixed(2)),
        observedPeakRssMiB: Number((observedPeakRss / 1024 / 1024).toFixed(1)),
        rssGrowthMiB: Number(((observedPeakRss - initialRss) / 1024 / 1024).toFixed(1)),
        queries,
      })
    }

    console.log(JSON.stringify({
      runtime: `electron ${process.versions.electron || 'none'} / sqlite ${db.prepare('SELECT sqlite_version() AS version').get().version}`,
      candidateLimit,
      measurementRounds,
      reports,
    }, null, 2))
  } finally {
    db.close()
    removeDatabaseFiles()
  }
}

async function main() {
  if (process.versions.electron) {
    const { app } = require('electron')
    await app.whenReady()
    try {
      runSoak()
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
    return
  }

  runSoak()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
