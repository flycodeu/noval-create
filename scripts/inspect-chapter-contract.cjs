const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const chapterId = Number(process.argv[2])

if (!Number.isInteger(chapterId) || chapterId <= 0) {
  throw new Error('Usage: electron scripts/inspect-chapter-contract.cjs <chapterId>')
}

app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

async function main() {
  await app.whenReady()
  const { initDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))
  const endgameAssetService = require(path.join(workspaceRoot, 'electron/services/endgame-asset.service.ts'))
  const chapter = chapterService.getChapter(chapterId)
  if (!chapter) throw new Error(`Chapter ${chapterId} not found`)
  const chapterContract = endgameAssetService.getChapterContract(chapterId)
  const sceneContracts = endgameAssetService.listSceneContracts(chapterId)
  let scenePlan = []
  try {
    const parsed = JSON.parse(chapter.scenePlanJson || '[]')
    scenePlan = Array.isArray(parsed) ? parsed : []
  } catch {
    scenePlan = []
  }
  console.log(JSON.stringify({
    chapterId,
    novelId: chapter.novelId,
    chapterNum: chapter.chapterNum,
    title: chapter.title,
    outline: chapter.outline,
    chapterContract,
    scenePlan,
    sceneContracts,
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
