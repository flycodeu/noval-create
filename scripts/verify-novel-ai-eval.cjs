const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const OUT_ROOT = path.resolve(__dirname, '..', 'out', 'novel-ai-eval')

function pickRunDir() {
  const requested = process.argv[2] || process.env.NOVELFORGE_EVAL_RUN_STAMP
  if (requested) {
    return path.isAbsolute(requested) ? requested : path.join(OUT_ROOT, requested)
  }
  const dirs = fs.readdirSync(OUT_ROOT, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => path.join(OUT_ROOT, item.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  if (!dirs[0]) throw new Error(`No run directories under ${OUT_ROOT}`)
  return dirs[0]
}

function rowsByNovel(db, table, novelIds) {
  const marks = novelIds.map(() => '?').join(',')
  return db.prepare(`SELECT novel_id AS novelId, COUNT(*) AS count FROM ${table} WHERE novel_id IN (${marks}) GROUP BY novel_id`).all(...novelIds)
}

function toMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.novelId, row.count]))
}

function main() {
  const runDir = pickRunDir()
  const runInfoPath = path.join(runDir, 'run-info.json')
  const runInfo = JSON.parse(fs.readFileSync(runInfoPath, 'utf8'))
  const novelIds = runInfo.projects.map((project) => project.saved.novelId)
  if (novelIds.length === 0) throw new Error(`No saved projects in ${runInfoPath}`)

  const db = new Database(runInfo.databasePath, { readonly: true })
  try {
    const marks = novelIds.map(() => '?').join(',')
    const novels = db.prepare(`SELECT id, title, status, total_words AS totalWords, target_words AS targetWords FROM novels WHERE id IN (${marks}) ORDER BY id`).all(...novelIds)
    const chapterStats = db.prepare(`
      SELECT
        novel_id AS novelId,
        COUNT(*) AS chapterCount,
        SUM(CASE WHEN COALESCE(content, '') <> '' THEN 1 ELSE 0 END) AS contentChapterCount,
        SUM(CASE WHEN chapter_num BETWEEN 3 AND 10 AND COALESCE(content, '') <> '' THEN 1 ELSE 0 END) AS laterContentChapterCount,
        SUM(COALESCE(word_count, 0)) AS chapterWords,
        GROUP_CONCAT(CASE WHEN COALESCE(content, '') <> '' THEN chapter_num END) AS contentChapterNums
      FROM chapters
      WHERE novel_id IN (${marks})
      GROUP BY novel_id
      ORDER BY novel_id
    `).all(...novelIds)

    const versions = toMap(rowsByNovel(db, 'chapter_versions', novelIds))
    const segments = toMap(rowsByNovel(db, 'chapter_segments', novelIds))
    const chapterContracts = toMap(rowsByNovel(db, 'chapter_contracts', novelIds))
    const sceneContracts = toMap(rowsByNovel(db, 'scene_contracts', novelIds))
    const characters = toMap(rowsByNovel(db, 'characters', novelIds))

    const verification = novels.map((novel) => {
      const stats = chapterStats.find((row) => row.novelId === novel.id) || {}
      return {
        ...novel,
        chapterCount: stats.chapterCount || 0,
        contentChapterCount: stats.contentChapterCount || 0,
        contentChapterNums: stats.contentChapterNums || '',
        laterContentChapterCount: stats.laterContentChapterCount || 0,
        chapterWords: stats.chapterWords || 0,
        versionCount: versions[novel.id] || 0,
        segmentCount: segments[novel.id] || 0,
        chapterContractCount: chapterContracts[novel.id] || 0,
        sceneContractCount: sceneContracts[novel.id] || 0,
        characterCount: characters[novel.id] || 0,
        ok: (stats.chapterCount || 0) === 10
          && (stats.contentChapterCount || 0) === 2
          && (stats.laterContentChapterCount || 0) === 0
          && (versions[novel.id] || 0) === 2
          && (chapterContracts[novel.id] || 0) === 10
          && (sceneContracts[novel.id] || 0) >= 10,
      }
    })

    const output = {
      runDir,
      databasePath: runInfo.databasePath,
      checkedAt: new Date().toISOString(),
      verification,
      allOk: verification.every((item) => item.ok),
    }
    fs.writeFileSync(path.join(runDir, 'verification.json'), JSON.stringify(output, null, 2), 'utf8')
    console.log(JSON.stringify(output, null, 2))
    if (!output.allOk) process.exitCode = 1
  } finally {
    db.close()
  }
}

function exitProcess(code) {
  process.exitCode = code
  try {
    const electron = require('electron')
    electron?.app?.quit?.()
  } catch {}
  setTimeout(() => process.exit(code), 50)
}

main()
exitProcess(process.exitCode || 0)
