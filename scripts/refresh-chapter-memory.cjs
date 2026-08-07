const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const chapterId = Number(process.argv[2])

if (!Number.isInteger(chapterId) || chapterId <= 0) {
  throw new Error('Usage: electron scripts/refresh-chapter-memory.cjs <chapterId>')
}

app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

async function main() {
  await app.whenReady()
  const { initDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))
  const chapter = chapterService.getChapter(chapterId)
  if (!chapter) throw new Error(`Chapter ${chapterId} not found`)
  await chapterService.generateChapterSummary(chapterId)
  const updated = chapterService.getChapter(chapterId)
  console.log(JSON.stringify({
    chapterId,
    novelId: updated?.novelId || chapter.novelId,
    status: updated?.status || chapter.status,
    wordCount: updated?.wordCount || chapter.wordCount,
    summary: updated?.summary || '',
    nextChapterSeed: updated?.nextChapterSeed || '',
    hasContinuityState: Boolean(updated?.continuityStateJson?.trim()),
    contextVersion: updated?.contextVersion || null,
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
