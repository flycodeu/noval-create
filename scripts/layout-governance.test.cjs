const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertPass(label, condition) {
  if (!condition) throw new Error(`FAIL ${label}`)
  console.log(`PASS ${label}`)
}

const mapCss = read('src/pages/Novel/MapExplorer/map-explorer.css')
const characterCss = read('src/pages/Novel/Characters/character-workspace.css')
const factionCss = read('src/pages/Novel/Factions/index.css')
const writingCss = read('src/pages/Novel/Writing/index.css')

assertPass(
  'writing editor uses viewport-aware minimum height',
  writingCss.includes('.novel-writing-console-page .chapter-console-page__editor-sheet-wrap')
    && /\.chapter-console-page__editor-sheet-wrap[\s\S]*?min-height:\s*clamp\(/.test(writingCss)
    && !writingCss.includes('min-height: 960px'),
)
assertPass(
  'map graph canvas uses viewport-aware height',
  /\.map-graph-shell[\s\S]*?height:\s*clamp\(/.test(mapCss)
    && !mapCss.includes('height: 700px')
    && !mapCss.includes('min-height: 700px')
    && !mapCss.includes('min-height: 760px')
    && !mapCss.includes('min-height: 900px'),
)
assertPass(
  'character graph canvas avoids a fixed desktop height',
  !characterCss.includes('min-height: 560px') && characterCss.includes('min-height: clamp('),
)
assertPass(
  'faction graph canvas avoids a fixed desktop height',
  !factionCss.includes('min-height: 560px') && factionCss.includes('min-height: clamp('),
)

console.log('layout governance tests passed')
