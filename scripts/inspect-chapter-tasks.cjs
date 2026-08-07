const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

function requireProject(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

function summarizeTask(task) {
  return {
    id: task.id,
    type: task.type,
    status: task.status,
    runnerType: task.runnerType,
    relatedEntityType: task.relatedEntityType,
    relatedEntityId: task.relatedEntityId,
    pipelineRole: task.pipelineRole,
    pipelineStage: task.pipelineStage,
    parentTaskId: task.parentTaskId,
    upstreamTaskId: task.upstreamTaskId,
    contractVersion: task.contractVersion,
    canonRunId: task.canonRunId,
    retryable: task.retryable,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

async function main() {
  const novelId = Number(process.argv[2])
  const chapterId = Number(process.argv[3])
  if (!Number.isInteger(novelId) || novelId <= 0 || !Number.isInteger(chapterId) || chapterId <= 0) {
    throw new Error('Usage: electron scripts/inspect-chapter-tasks.cjs <novelId> <chapterId>')
  }

  await app.whenReady()
  const { initDb } = requireProject('electron/database/db.ts')
  initDb()
  const taskService = requireProject('electron/services/task.service.ts')
  const writebackService = requireProject('electron/services/chapter-writeback.service.ts')
  const tasks = taskService.listTasks(novelId)
    .filter((task) => task.relatedEntityType === 'chapter' && Number(task.relatedEntityId) === chapterId)
    .map(summarizeTask)
  const runs = await writebackService.listChapterWritebackRuns(chapterId)
  const pipeline = tasks.filter((task) => task.runnerType === 'workflow' || task.pipelineRole)
  console.log(JSON.stringify({
    novelId,
    chapterId,
    pipeline,
    allChapterTasks: tasks,
    writebackRuns: runs,
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
