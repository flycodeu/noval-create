const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

function requireProject(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

async function main() {
  const chapterId = Number(process.argv[2])
  if (!Number.isInteger(chapterId) || chapterId <= 0) {
    throw new Error('Usage: electron scripts/run-chapter-ai-check.cjs <chapterId>')
  }

  await app.whenReady()
  const { initDb } = requireProject('electron/database/db.ts')
  initDb()
  const chapterService = requireProject('electron/services/chapter.service.ts')
  const chapter = chapterService.getChapter(chapterId)
  if (!chapter) throw new Error(`Chapter ${chapterId} not found`)
  const result = await chapterService.aiCheckChapter(chapterId)
  const updated = chapterService.getChapter(chapterId)
  console.log(JSON.stringify({
    chapterId,
    novelId: chapter.novelId,
    chapterNum: chapter.chapterNum,
    wordCount: updated?.wordCount || chapter.wordCount,
    aiScore: updated?.aiScoreJson ? JSON.parse(updated.aiScoreJson) : null,
    result,
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
