// Generate one chapter through the real chapter pipeline.
// Usage:
//   NOVELFORGE_NOVEL_ID=32 NOVELFORGE_CHAPTER_NUM=2 NOVELFORGE_EXECUTION_MODE=cost_saver npx electron scripts/generate-chapter-content.cjs
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
app.setName('NovelForge')
registerProjectTsRuntime(workspaceRoot)

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

  // Keep the single-chapter diagnostic script aligned with the managed model
  // request controls used by the full flow audit. The short names are kept for
  // convenient one-off runs, but the adapters remain the source of truth.
  if (process.env.NOVELFORGE_REQUEST_TIMEOUT_MS && !process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS) {
    process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS = process.env.NOVELFORGE_REQUEST_TIMEOUT_MS
  }
  if (process.env.NOVELFORGE_REQUEST_RETRY_COUNT && !process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT) {
    process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT = process.env.NOVELFORGE_REQUEST_RETRY_COUNT
  }

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
