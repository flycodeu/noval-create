const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { app } = require('electron')

const workspaceRoot = path.resolve(__dirname, '..')
const ts = require(path.join(workspaceRoot, 'node_modules', 'typescript'))
app.setName('NovelForge')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if (request.startsWith('@/')) return originalResolveFilename.call(this, path.join(workspaceRoot, 'src', request.slice(2)), parent, isMain, options)
  if (request.startsWith('@main/')) return originalResolveFilename.call(this, path.join(workspaceRoot, 'electron', request.slice(6)), parent, isMain, options)
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    for (const ext of ['.ts', '.tsx', '.js', '.json']) {
      const candidate = path.resolve(baseDir, request + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

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
