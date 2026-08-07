// Re-run the chapter publish gate for existing chapter content.
// Usage:
//   NOVELFORGE_NOVEL_ID=32 NOVELFORGE_CHAPTERS=1,2 NOVELFORGE_GATE_PHASE=pipeline npx electron scripts/check-chapter-publish.cjs
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

function parseChapterNums(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}

async function main() {
  await app.whenReady()
  const novelId = Number(process.env.NOVELFORGE_NOVEL_ID || 0)
  const chapterNums = parseChapterNums(process.env.NOVELFORGE_CHAPTERS || process.env.NOVELFORGE_CHAPTER_NUM)
  const phase = process.env.NOVELFORGE_GATE_PHASE === 'final' ? 'final' : 'pipeline'
  if (!novelId || chapterNums.length === 0) {
    throw new Error('Set NOVELFORGE_NOVEL_ID and NOVELFORGE_CHAPTERS, for example 32 and 1,2.')
  }

  const { initDb, getSqlite } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const rawDb = getSqlite()
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))

  for (const chapterNum of chapterNums) {
    const chapter = rawDb.prepare(`
      SELECT id, title, status, word_count
      FROM chapters
      WHERE novel_id = ? AND chapter_num = ?
    `).get(novelId, chapterNum)
    if (!chapter) {
      console.log(`missing novel=${novelId} ch${chapterNum}`)
      continue
    }

    const check = chapterService.runChapterPublishCheck(chapter.id, { phase })
    console.log(`novel=${novelId} ch${chapterNum}《${chapter.title}》 status=${chapter.status} phase=${phase}`)
    console.log(`gate=${check.gateLevel} ready=${check.ready} summary=${check.summary}`)
    const issues = check.checklist
      .filter((item) => item.status === 'rewrite' || item.status === 'blocker')
      .map((item) => `${item.status}:${item.key}:${item.detail}`)
      .slice(0, 12)
    if (issues.length === 0) {
      console.log('blocking_issues=[]')
    } else {
      for (const issue of issues) console.log(`- ${issue}`)
    }
    const contractIssues = (check.contractValidation?.itemResults || [])
      .filter((item) => item.verdict && item.verdict !== 'pass')
      .map((item) => `${item.verdict}:${item.contractItemType}:${item.expected || item.rewriteHint || ''}`)
      .slice(0, 12)
    if (contractIssues.length > 0) {
      console.log('contract_issues=')
      for (const issue of contractIssues) console.log(`- ${issue}`)
    }
  }
}

main()
  .then(() => setTimeout(() => process.exit(0), 100))
  .catch((error) => {
    console.error(error)
    setTimeout(() => process.exit(1), 100)
  })
