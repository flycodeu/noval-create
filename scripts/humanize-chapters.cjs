// One-off humanization rewrite for showcase chapters (novels 29/31, chapters 1-2).
// Rewrites rhythm/dialogue texture without changing plot facts, then re-scans anti-AI hits.
//   npx electron scripts/humanize-chapters.cjs
// Optional: NOVELFORGE_HUMANIZE_MODEL_ID=<modelConfigId> 用另一家模型做润色
// （跨模型改写能改变 token 分布，是降低 AI 检测率相对有效的正当手段）。
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

const TABOO = {
  29: /李火旺|白灵淼|丹阳子|大傩|大晏|白玉京|司命|坐忘道|心猿|无生老母|杨娜|道诡异仙/u,
  31: /桃夭|磨牙|滚滚|柳公子|桃都|百妖谱|司狂澜|司静渊|鬼医/u,
}

function countHanzi(text) {
  return (String(text || '').match(/[一-龥]/g) || []).length
}

async function main() {
  await app.whenReady()
  const { initDb, getSqlite } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const rawDb = getSqlite()
  const chapterService = require(path.join(workspaceRoot, 'electron/services/chapter.service.ts'))
  const antiAi = require(path.join(workspaceRoot, 'electron/services/anti-ai-rule.service.ts'))
  const { runChatTask } = require(path.join(workspaceRoot, 'electron/services/task.service.ts'))

  const rows = rawDb.prepare('SELECT c.id, c.novel_id AS novelId, c.chapter_num AS num, c.title, c.content, n.title AS novelTitle, n.genre_id, n.model_config_id AS modelConfigId FROM chapters c JOIN novels n ON n.id = c.novel_id WHERE c.novel_id IN (29, 31) AND c.chapter_num <= 2 ORDER BY c.novel_id, c.chapter_num').all()
  const genreByNovel = { 29: '诡异修仙', 31: '神话脑洞志怪' }

  for (const row of rows) {
    const original = String(row.content || '')
    if (!original.trim()) {
      console.log(`skip novel=${row.novelId} ch${row.num}: empty`)
      continue
    }
    const originalCount = countHanzi(original)
    const beforeHits = antiAi.collectAntiAiRuntimeHits(original, genreByNovel[row.novelId])
    console.log(`\n=== novel=${row.novelId} ch${row.num}《${row.title}》 ${originalCount}字 anti-ai命中 ${beforeHits.length}`)

    const prompt = [
      '你是中文小说改稿人。任务：在不改变剧情事实、人物行为、对白信息量和事件顺序的前提下，把下面的连载章节改得更像人手写的稿子。',
      '当前问题：句子节奏均匀（几乎全是等长短句连排）、每一段都收在干净的动作点上、对白一问一答句句高效像笔录、文本过度洁净没有人的顿挫。',
      '改法要求：',
      '- 长短句交错：把一部分连续短句合并成一口气的长句（四五十字，写完一个动作链或一段心绪），紧跟一两个极短句；让句子随人物注意力自然走偏。',
      '- 段落参差：允许一两段只有一句话，也允许一段跑七八行；不要每段都以动作点收束，允许停在半截、被岔开。',
      '- 对白加人味：少量答非所问、重复对方的词、迟疑改口、被动作或环境打断；拆掉过于工整的一问一答。',
      '- 按人物口吻保留少量口语顿挫（倒是、竟、偏偏、横竖之类），一章三五处，不堆砌。',
      '- 同一种微动作细节（指尖、掌心、喉结、抬头）一章最多两次，多余的删掉或换成有推进性的内容。',
      '- 不加新情节、不改人名地名、不改章节结尾钩子。总字数保持在原文的 90% 到 115% 之间。',
      '只输出改写后的正文，不要解释，不要 Markdown。',
      '',
      '【正文】',
      original,
    ].join('\n')

    let rewritten = ''
    try {
      const overrideModelId = Number(process.env.NOVELFORGE_HUMANIZE_MODEL_ID) || 0
      rewritten = String(await runChatTask({
        type: 'review',
        novelId: row.novelId,
        modelConfigId: overrideModelId > 0 ? overrideModelId : (row.modelConfigId || undefined),
        retryable: true,
        messages: [{ role: 'user', content: prompt }],
      }) || '').trim()
    } catch (error) {
      console.log(`  rewrite failed: ${String(error && error.message || error).slice(0, 160)}`)
      continue
    }

    const newCount = countHanzi(rewritten)
    const taboo = TABOO[row.novelId]
    if (newCount < Math.round(originalCount * 0.85)) {
      console.log(`  rejected: too short ${newCount}/${originalCount}`)
      continue
    }
    if (taboo && taboo.test(rewritten)) {
      console.log('  rejected: taboo hit')
      continue
    }
    chapterService.updateChapter(row.id, { content: rewritten })
    const afterHits = antiAi.collectAntiAiRuntimeHits(rewritten, genreByNovel[row.novelId])
    console.log(`  applied: ${originalCount} -> ${newCount} 字, anti-ai 命中 ${beforeHits.length} -> ${afterHits.length}`)
    afterHits.slice(0, 5).forEach((hit) => console.log(`   - ${hit.ruleCode}(${hit.severity})`))
  }
}

main().then(() => setTimeout(() => process.exit(0), 100)).catch((e) => { console.error(e); setTimeout(() => process.exit(1), 100) })
