// Generate and persist project briefs (项目立项表) for novels 29/31.
//   npx electron scripts/fill-project-briefs.cjs
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

const TARGETS = [
  { novelId: 29, note: '诡异修仙双现实题材，读者承诺聚焦“清醒即痛苦、力量即污染”的压迫感与代价链。' },
  { novelId: 31, note: '单元志怪公路题材，读者承诺聚焦“一地一妖病、病例照人心”的余味与债务寓言。' },
]

async function main() {
  await app.whenReady()
  const { initDb } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const projectBriefService = require(path.join(workspaceRoot, 'electron/services/project-brief.service.ts'))
  const novelService = require(path.join(workspaceRoot, 'electron/services/novel.service.ts'))

  for (const target of TARGETS) {
    const novel = novelService.getNovel(target.novelId)
    if (!novel) {
      console.log(`skip ${target.novelId}: not found`)
      continue
    }
    console.log(`\n=== ${target.novelId} ${novel.title}`)
    const result = await projectBriefService.generateProjectBrief({
      novelId: target.novelId,
      mode: 'fill_empty',
      requirements: [
        target.note,
        '只做原创对照测试定位，不复刻对照作品；参考作品一栏写类型方向而不是具体书名照抄卖点。',
      ].join('\n'),
    })
    const document = {
      platformMode: result.platformMode,
      targetAudience: result.targetAudience,
      targetReader: result.targetReader,
      readerPromise: result.readerPromise,
      sellingPoints: result.sellingPoints,
      compTitles: result.compTitles,
      tabooRules: result.tabooRules,
      deliveryRhythm: result.deliveryRhythm,
    }
    novelService.updateNovel(target.novelId, { projectBriefJson: JSON.stringify(document) })
    console.log('saved. warnings:', result.warnings.length ? result.warnings.join('；') : '无')
    Object.entries(document).forEach(([key, value]) => {
      console.log(`  ${key}: ${(String(value || '')).replace(/\s+/g, ' ').slice(0, 80) || '(空)'}`)
    })
  }
}

main().then(() => setTimeout(() => process.exit(0), 100)).catch((e) => { console.error(e); setTimeout(() => process.exit(1), 100) })
