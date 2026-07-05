// One-off patch-up: regenerate story items for the goal0705c baiyao novel
// (item generation failed mid-run before normalizeGeneratedItemArray landed),
// then repair item-character links.
//   npx electron scripts/patch-items-goal0705c.cjs
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

async function main() {
  await app.whenReady()
  const { initDb, getSqlite } = require(path.join(workspaceRoot, 'electron/database/db.ts'))
  initDb()
  const rawDb = getSqlite()
  const novel = rawDb.prepare("SELECT id, title FROM novels WHERE title LIKE '%百妖谱（goal0705c%' ORDER BY id DESC LIMIT 1").get()
  if (!novel) throw new Error('goal0705c baiyao novel not found')
  console.log('patching items for', novel.id, novel.title)

  const itemService = require(path.join(workspaceRoot, 'electron/services/item.service.ts'))
  const before = rawDb.prepare("SELECT COUNT(*) AS c FROM story_items WHERE novel_id = ? AND item_kind = 'instance'").get(novel.id).c
  console.log('instance items before:', before)
  if (before < 5) {
    const ids = await itemService.generateStoryItems(novel.id, {
      count: 5 - before,
      batchSize: 5 - before,
      refreshTemplates: false,
      templateOnly: false,
      focus: '病帖、药囊、妖骨针、行路符、旧病簿残页等病例线索物。\n不得使用桃夭、磨牙、滚滚、柳公子、桃都、百妖谱、鬼医等专名；不得复刻原作单元妖怪、病例和主角团关系。',
    })
    console.log('generated item ids:', JSON.stringify(ids))
  }
  const repair = itemService.repairItemCharacterLinks(novel.id)
  console.log('link repair:', JSON.stringify(repair))
  const after = rawDb.prepare("SELECT COUNT(*) AS c FROM story_items WHERE novel_id = ? AND item_kind = 'instance'").get(novel.id).c
  const names = rawDb.prepare("SELECT item_name FROM story_items WHERE novel_id = ? AND item_kind = 'instance'").all(novel.id).map((row) => row.item_name)
  console.log('instance items after:', after, names.join('、'))
}

main().then(() => {
  process.exitCode = 0
  setTimeout(() => process.exit(0), 100)
}).catch((error) => {
  console.error('patch failed:', error)
  setTimeout(() => process.exit(1), 100)
})
