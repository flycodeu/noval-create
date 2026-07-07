// Generate one chapter through the real chapter pipeline.
// Usage:
//   NOVELFORGE_NOVEL_ID=32 NOVELFORGE_CHAPTER_NUM=2 NOVELFORGE_EXECUTION_MODE=cost_saver npx electron scripts/generate-chapter-content.cjs
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

function countHanzi(text) {
  return (String(text || '').match(/[一-龥]/g) || []).length
}

async function main() {
  await app.whenReady()
  const novelId = Number(process.env.NOVELFORGE_NOVEL_ID || 0)
  const chapterNum = Number(process.env.NOVELFORGE_CHAPTER_NUM || 0)
  const executionMode = process.env.NOVELFORGE_EXECUTION_MODE || 'cost_saver'
  const reset = process.env.NOVELFORGE_RESET_CHAPTER === '1'
  if (!novelId || !chapterNum) throw new Error('Set NOVELFORGE_NOVEL_ID and NOVELFORGE_CHAPTER_NUM.')

  const { initDb, getSqlite } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const rawDb = getSqlite()
  const taskService = require(path.join(workspaceRoot, 'electron/services/task.service.ts'))
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))
  const recovered = taskService.recoverOrphanedTasks?.() || 0
  if (recovered > 0) console.log(`recovered=${recovered}`)

  const chapter = rawDb.prepare('SELECT id, title, status, target_words FROM chapters WHERE novel_id = ? AND chapter_num = ?').get(novelId, chapterNum)
  if (!chapter) throw new Error(`Chapter not found: novel=${novelId} chapter=${chapterNum}`)
  if (reset) {
    rawDb.prepare(`
      UPDATE chapters
      SET status = 'outline', content = '', word_count = 0, review_notes_json = '', updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), chapter.id)
  }

  console.log(`generating novel=${novelId} ch${chapterNum}《${chapter.title}》 mode=${executionMode} reset=${reset}`)
  const startedAt = Date.now()
  try {
    await chapterService.generateChapterContent(chapter.id, undefined, { executionMode })
    console.log('pipeline=ok')
  } catch (error) {
    console.log(`pipeline=${String(error && error.message || error).slice(0, 500)}`)
  }
  const after = chapterService.getChapter(chapter.id)
  const words = countHanzi(after?.content || '')
  console.log(`duration=${Math.round((Date.now() - startedAt) / 1000)}s words=${words} status=${after?.status}`)
  console.log('--- preview ---')
  console.log(String(after?.content || '').slice(0, 500))
}

main()
  .then(() => setTimeout(() => process.exit(0), 100))
  .catch((error) => {
    console.error(error)
    setTimeout(() => process.exit(1), 100)
  })
