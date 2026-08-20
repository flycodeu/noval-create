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
const projectTopbarCss = read('src/components/novel/layout/ProjectTopbar.css')
const globalCss = read('src/styles/global.css')
const qualityDashboardCss = read('src/pages/Novel/QualityDashboard/index.css')
const foreshadowLedgerCss = read('src/pages/Novel/ForeshadowLedger/index.css')
const outlinePage = read('src/pages/Novel/Outline/index.tsx')
const workspaceShell = read('src/pages/Novel/components/WorkspaceShell.tsx')
const workspaceChrome = read('src/components/novel/workspace-layout/workspace-chrome.tsx')
const workspaceChromeCss = read('src/components/novel/workspace-layout/workspace-chrome.css')
const projectBriefPage = read('src/pages/Novel/ProjectBrief/index.tsx')
const destructiveActionPages = [
  read('src/pages/Novel/Factions/index.tsx'),
  read('src/pages/Novel/Glossary/index.tsx'),
  read('src/pages/Novel/GrowthSystem/index.tsx'),
  read('src/pages/Novel/RevisionCenter/index.tsx'),
  read('src/pages/Novel/SceneTemplates/index.tsx'),
  read('src/pages/Novel/ThemeVoice/index.tsx'),
]

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
assertPass(
  'project topbar mode switch keeps its width on narrow screens',
  /@media \(max-width: 767px\)[\s\S]*?\.project-topbar__mode-switch\s*\{[\s\S]*?flex:\s*0 0 auto;/.test(projectTopbarCss),
)
assertPass(
  'workspace child content can shrink below its min-content width',
  globalCss.includes('.novel-workspace__main > *') && globalCss.includes('.novel-workspace__aside > *'),
)
assertPass(
  'quality filter number inputs stay compact on narrow screens',
  qualityDashboardCss.includes('.app-layout .novel-workspace .quality-dashboard-page__filter-bar .ant-input-number')
    && qualityDashboardCss.includes('width: 96px'),
)
assertPass(
  'foreshadow board cards fit the available narrow width',
  foreshadowLedgerCss.includes('minmax(min(100%, 280px), 1fr)'),
)
assertPass(
  'outline pagination keeps drag indices local to the rendered page',
  outlinePage.includes('const sourceIndex = expandedChapterPageStart + result.source.index')
    && outlinePage.includes('const destinationIndex = expandedChapterPageStart + result.destination.index')
    && outlinePage.includes('index={index}')
    && !outlinePage.includes('index={expandedChapterPageStart + index}'),
)
assertPass(
  'workspace step guide renders supplied descriptions',
  workspaceShell.includes('{step.description ? <span>{step.description}</span> : null}'),
)
assertPass(
  'destructive workspace actions require confirmation',
  destructiveActionPages.every((page) => page.includes('Modal.confirm(') && page.includes("okType: 'danger'")),
)
assertPass(
  'tautological guided metrics do not carry redundant hints',
  !read('src/pages/Novel/GuidedStep/index.tsx').includes('hint="显示当前累计字数。"')
    && !read('src/pages/Novel/GuidedStep/index.tsx').includes('hint="显示基础信息状态。"')
    && !read('src/pages/Novel/GuidedStep/index.tsx').includes('hint="显示背景信息状态。"')
    && !read('src/pages/Novel/GuidedStep/index.tsx').includes('hint="显示项目立项状态。"')
    && !read('src/pages/Novel/GuidedStep/index.tsx').includes('hint="显示基础设定状态。"'),
)
assertPass(
  'shared workspace chrome is explicit and legacy actions stay isolated (P0-01)',
  workspaceShell.includes("chrome = 'legacy'")
    && workspaceShell.includes("chrome: 'shared'")
    && workspaceShell.includes('actions?: never')
    && workspaceShell.includes('usesSharedChrome && portal?.informationTarget')
    && !workspaceShell.includes('dispatch.setActions')
    && projectTopbarCss.includes('.project-topbar__page-actions')
    && read('src/components/novel/layout/ProjectTopbar.tsx').includes('project-topbar__information-slot'),
)
assertPass(
  'workspace action contract limits visible secondary actions and keeps compact overflow (P0-01)',
  workspaceChrome.includes('MAX_VISIBLE_SECONDARY_ACTIONS = 2')
    && workspaceChrome.includes('secondary.slice(0, MAX_VISIBLE_SECONDARY_ACTIONS)')
    && workspaceChrome.includes('workspace-contract-actions__more--compact')
    && workspaceChromeCss.includes('@media (max-width: 1200px)')
    && workspaceChromeCss.includes('.workspace-contract-actions__secondary'),
)
assertPass(
  'project brief is the explicit shared chrome migration pilot (P0-01)',
  projectBriefPage.includes('chrome="shared"')
    && projectBriefPage.includes('actionContract={{')
    && !projectBriefPage.includes('actions={(\n        <Space wrap>'),
)

console.log('layout governance tests passed')
