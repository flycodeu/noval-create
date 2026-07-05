const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const OUT_ROOTS = [
  path.resolve(__dirname, '..', 'out', 'novel-ai-eval-pipeline'),
  path.resolve(__dirname, '..', 'out', 'novel-ai-eval'),
]

// 通用违禁桥段兜底（run-info 未提供 tabooPatterns 时使用）
const DEFAULT_TABOO_PATTERNS = [
  '退婚',
  '婚约.{0,6}(作废|解除|取消)',
  '[一二三两四五六七八九十0-9]+(?:个)?(?:年|月)之约',
]

const WORD_FLOOR_RATIO = 0.8

function pickRunDir() {
  const requested = process.argv[2] || process.env.NOVELFORGE_EVAL_RUN_STAMP
  if (requested) {
    if (path.isAbsolute(requested)) return requested
    for (const root of OUT_ROOTS) {
      const candidate = path.join(root, requested)
      if (fs.existsSync(candidate)) return candidate
    }
    throw new Error(`Run directory not found for stamp: ${requested}`)
  }
  const dirs = OUT_ROOTS
    .filter((root) => fs.existsSync(root))
    .flatMap((root) => fs.readdirSync(root, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => path.join(root, item.name)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  if (!dirs[0]) throw new Error(`No run directories under ${OUT_ROOTS.join(' / ')}`)
  return dirs[0]
}

function rowsByNovel(db, table, novelIds) {
  const marks = novelIds.map(() => '?').join(',')
  return db.prepare(`SELECT novel_id AS novelId, COUNT(*) AS count FROM ${table} WHERE novel_id IN (${marks}) GROUP BY novel_id`).all(...novelIds)
}

function toMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.novelId, row.count]))
}

function countHanzi(text) {
  return (String(text || '').match(/[一-龥]/g) || []).length
}

function scanTaboo(text, tabooPatterns) {
  const hits = []
  for (const pattern of tabooPatterns) {
    try {
      const regex = new RegExp(pattern, 'gu')
      const matches = String(text || '').match(regex)
      if (matches && matches.length > 0) {
        hits.push({ pattern, matches: [...new Set(matches)].slice(0, 5) })
      }
    } catch {
      // 跳过非法正则
    }
  }
  return hits
}

function isEmptyScenePlan(raw) {
  if (!raw) return true
  try {
    const parsed = JSON.parse(raw)
    return !Array.isArray(parsed) || parsed.length === 0
  } catch {
    return true
  }
}

function main() {
  const runDir = pickRunDir()
  const runInfoPath = path.join(runDir, 'run-info.json')
  const runInfo = JSON.parse(fs.readFileSync(runInfoPath, 'utf8'))
  const novelIds = runInfo.projects.map((project) => project.saved.novelId)
  if (novelIds.length === 0) throw new Error(`No saved projects in ${runInfoPath}`)

  const contentChapterCount = Number(runInfo.contentChapterCount) || 2
  const tabooByNovel = Object.fromEntries(runInfo.projects.map((project) => [
    project.saved.novelId,
    Array.isArray(project.tabooPatterns) && project.tabooPatterns.length > 0
      ? project.tabooPatterns
      : DEFAULT_TABOO_PATTERNS,
  ]))

  const db = new Database(runInfo.databasePath, { readonly: true })
  try {
    const marks = novelIds.map(() => '?').join(',')
    const novels = db.prepare(`SELECT id, title, status, total_words AS totalWords, target_words AS targetWords FROM novels WHERE id IN (${marks}) ORDER BY id`).all(...novelIds)
    const chapterRows = db.prepare(`
      SELECT novel_id AS novelId, chapter_num AS chapterNum, title, outline, content,
             word_count AS wordCount, target_words AS chapterTargetWords, scene_plan_json AS scenePlanJson
      FROM chapters
      WHERE novel_id IN (${marks})
      ORDER BY novel_id, chapter_num
    `).all(...novelIds)

    const versions = toMap(rowsByNovel(db, 'chapter_versions', novelIds))
    const segments = toMap(rowsByNovel(db, 'chapter_segments', novelIds))
    const chapterContracts = toMap(rowsByNovel(db, 'chapter_contracts', novelIds))
    const sceneContracts = toMap(rowsByNovel(db, 'scene_contracts', novelIds))
    const characters = toMap(rowsByNovel(db, 'characters', novelIds))

    const verification = novels.map((novel) => {
      const rows = chapterRows.filter((row) => row.novelId === novel.id)
      const contentRows = rows.filter((row) => (row.content || '').trim() !== '')
      const laterContentRows = contentRows.filter((row) => row.chapterNum > contentChapterCount)

      // 校验 1：字数下限（正文章节实际汉字数 >= 目标 * 0.8）
      const wordFloorFailures = contentRows
        .filter((row) => row.chapterNum <= contentChapterCount)
        .filter((row) => {
          const target = row.chapterTargetWords || 1200
          return countHanzi(row.content) < Math.round(target * WORD_FLOOR_RATIO)
        })
        .map((row) => `第${row.chapterNum}章 ${countHanzi(row.content)}/${row.chapterTargetWords || 1200}`)

      // 校验 2：scenePlan 非空（全部 10 章）
      const emptyScenePlanChapters = rows
        .filter((row) => isEmptyScenePlan(row.scenePlanJson))
        .map((row) => row.chapterNum)

      // 校验 3：违禁桥段扫描（大纲 + 正文）
      const tabooPatterns = tabooByNovel[novel.id] || DEFAULT_TABOO_PATTERNS
      const tabooHits = rows.flatMap((row) => {
        const hits = scanTaboo(`${row.title || ''}\n${row.outline || ''}\n${row.content || ''}`, tabooPatterns)
        return hits.map((hit) => ({ chapterNum: row.chapterNum, ...hit }))
      })

      const contentChapterWords = contentRows
        .filter((row) => row.chapterNum <= contentChapterCount)
        .reduce((sum, row) => sum + countHanzi(row.content), 0)

      const structureOk = rows.length === 10
        && contentRows.length === contentChapterCount
        && laterContentRows.length === 0
        && (versions[novel.id] || 0) >= contentChapterCount
        && (chapterContracts[novel.id] || 0) === 10
        && (sceneContracts[novel.id] || 0) >= 10

      return {
        id: novel.id,
        title: novel.title,
        status: novel.status,
        totalWords: novel.totalWords,
        targetWords: novel.targetWords,
        chapterCount: rows.length,
        contentChapterCount: contentRows.length,
        contentChapterNums: contentRows.map((row) => row.chapterNum).join(','),
        contentChapterWords,
        versionCount: versions[novel.id] || 0,
        segmentCount: segments[novel.id] || 0,
        chapterContractCount: chapterContracts[novel.id] || 0,
        sceneContractCount: sceneContracts[novel.id] || 0,
        characterCount: characters[novel.id] || 0,
        wordFloorFailures,
        emptyScenePlanChapters,
        tabooHits,
        structureOk,
        ok: structureOk
          && wordFloorFailures.length === 0
          && emptyScenePlanChapters.length === 0
          && tabooHits.length === 0,
      }
    })

    const output = {
      runDir,
      databasePath: runInfo.databasePath,
      checkedAt: new Date().toISOString(),
      contentChapterCount,
      checks: ['结构完整', `字数下限（目标×${WORD_FLOOR_RATIO}）`, 'scenePlan 非空', '违禁桥段扫描'],
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
