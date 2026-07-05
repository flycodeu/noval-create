// Generate chapter 3《井底枯鳞》 for novel 31 (百妖谱 goal0705c) via the real pipeline.
//   npx electron scripts/generate-chapter3-baiyao.cjs
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
    for (const ext of ['.ts', '.tsx', '.js']) {
      const candidate = path.resolve(baseDir, request, 'index' + ext)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}
function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  })
  module._compile(outputText, filename)
}
require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

const NOVEL_ID = 31
const CHAPTER_NUM = 3

function countHanzi(text) {
  return (String(text || '').match(/[一-龥]/g) || []).length
}

async function main() {
  await app.whenReady()
  const { initDb, getSqlite } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const rawDb = getSqlite()
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))
  const taskService = require(path.join(workspaceRoot, 'electron/services/task.service.ts'))
  const recovered = taskService.recoverOrphanedTasks?.() || 0
  if (recovered > 0) console.log(`recovered ${recovered} orphaned tasks`)

  const chapter = rawDb.prepare('SELECT id, title, target_words FROM chapters WHERE novel_id = ? AND chapter_num = ?').get(NOVEL_ID, CHAPTER_NUM)
  if (!chapter) throw new Error('chapter 3 not found')
  console.log(`generating novel=${NOVEL_ID} ch${CHAPTER_NUM}《${chapter.title}》 target=${chapter.target_words}`)

  const startedAt = Date.now()
  try {
    await chapterService.generateChapterContent(chapter.id, undefined, { executionMode: 'balanced' })
    console.log('pipeline: ok')
  } catch (error) {
    console.log('pipeline:', String(error && error.message || error).slice(0, 300))
  }
  const after = chapterService.getChapter(chapter.id)
  const words = countHanzi(after && after.content)
  console.log(`duration ${Math.round((Date.now() - startedAt) / 1000)}s, final ${words} 字, status=${after && after.status}`)
  console.log('--- 开头 400 字 ---')
  console.log(String(after && after.content || '').slice(0, 400))
}

main().then(() => setTimeout(() => process.exit(0), 100)).catch((e) => { console.error(e); setTimeout(() => process.exit(1), 100) })
