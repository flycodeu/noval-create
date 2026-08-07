const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

async function main() {
  const novelId = Number(process.argv[2])
  if (!Number.isInteger(novelId) || novelId <= 0) throw new Error('Usage: electron scripts/inspect-novel-chapters.cjs <novelId>')
  await app.whenReady()
  const { initDb, getSqlite } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const rows = getSqlite().prepare(`
    SELECT id, novel_id AS novelId, chapter_num AS chapterNum, title, status, word_count AS wordCount,
           length(content) AS contentLength, updated_at AS updatedAt
    FROM chapters WHERE novel_id = ? ORDER BY chapter_num
  `).all(novelId)
  console.log(JSON.stringify(rows, null, 2))
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.stack || error.message : error); process.exitCode = 1 })
  .finally(() => { if (app.isReady()) app.quit() })
