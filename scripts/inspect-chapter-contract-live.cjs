const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

async function main() {
  const chapterId = Number(process.argv[2])
  if (!Number.isInteger(chapterId) || chapterId <= 0) {
    throw new Error('Usage: electron scripts/inspect-chapter-contract-live.cjs <chapterId>')
  }

  await app.whenReady()
  const { initDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))
  const validator = require(path.join(workspaceRoot, 'electron/services/chapter-contract-validator.service.ts'))
  const chapter = chapterService.getChapter(chapterId)
  if (!chapter) throw new Error(`Chapter ${chapterId} not found`)

  const reviewNotes = chapter.reviewNotesJson
    ? (() => {
      try { return JSON.parse(chapter.reviewNotesJson) } catch { return {} }
    })()
    : {}
  const result = validator.validateChapterContractDelivery({
    chapterId,
    content: chapter.content || '',
    reviewNotes,
  })
  console.log(JSON.stringify({
    chapterId,
    status: chapter.status,
    wordCount: chapter.wordCount,
    contractStatus: result.status,
    summary: result.summary,
    failedItems: result.itemResults
      .filter((item) => item.verdict !== 'pass')
      .map((item) => ({
        type: item.contractItemType,
        verdict: item.verdict,
        segmentTitle: item.segmentTitle || '',
        evidence: item.evidenceExcerpt,
        rewriteHint: item.rewriteHint,
      })),
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    if (app.isReady()) app.quit()
  })
