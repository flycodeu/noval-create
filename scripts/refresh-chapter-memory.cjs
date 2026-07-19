const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const ts = require(path.join(workspaceRoot, 'node_modules', 'typescript'))
const chapterId = Number(process.argv[2])

if (!Number.isInteger(chapterId) || chapterId <= 0) {
  throw new Error('Usage: electron scripts/refresh-chapter-memory.cjs <chapterId>')
}

app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
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
