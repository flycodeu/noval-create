const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const ts = require(path.join(workspaceRoot, 'node_modules', 'typescript'))

app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
  }
  if (request.startsWith('@main/')) {
    return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
  }
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    for (const ext of ['.ts', '.tsx', '.js', '.json']) {
      const candidate = path.resolve(baseDir, request + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

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
