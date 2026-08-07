const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

async function main() {
  await app.whenReady()
  const { initDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const taskService = require(path.join(workspaceRoot, 'electron/services/task.service.ts'))
  const recovered = taskService.recoverOrphanedTasks?.() || 0
  console.log(`recovered=${recovered}`)
}

main()
  .then(() => setTimeout(() => process.exit(0), 100))
  .catch((error) => {
    console.error(error)
    setTimeout(() => process.exit(1), 100)
  })
