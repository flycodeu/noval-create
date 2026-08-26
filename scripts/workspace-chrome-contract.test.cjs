const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pagesRoot = path.join(root, 'src/pages/Novel')

function assertPass(label, condition) {
  if (!condition) throw new Error(`FAIL ${label}`)
  console.log(`PASS ${label}`)
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(absolute)
    return entry.name.endsWith('.tsx') ? [absolute] : []
  })
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

// Extract only the opening JSX tag. Curly-braced props can contain nested JSX,
// so a plain `/<WorkspacePage[^>]*>/` would stop at the first nested element.
function extractWorkspacePageOpenTags(source) {
  const tags = []
  let cursor = 0
  while (cursor < source.length) {
    const start = source.indexOf('<WorkspacePage', cursor)
    if (start < 0) break
    let index = start + '<WorkspacePage'.length
    let braceDepth = 0
    let quote = null
    for (; index < source.length; index += 1) {
      const char = source[index]
      if (quote) {
        if (char === quote && source[index - 1] !== '\\') quote = null
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (char === '{') {
        braceDepth += 1
        continue
      }
      if (char === '}') {
        braceDepth = Math.max(0, braceDepth - 1)
        continue
      }
      if (char === '>' && braceDepth === 0) {
        tags.push(source.slice(start, index + 1))
        cursor = index + 1
        break
      }
    }
    if (index >= source.length) break
  }
  return tags
}

const files = walk(pagesRoot)
const calls = files.flatMap((absolutePath) => extractWorkspacePageOpenTags(fs.readFileSync(absolutePath, 'utf8')).map((tag) => ({
  file: path.relative(root, absolutePath).replaceAll('\\', '/'),
  tag,
})))
const sharedCalls = calls.filter(({ tag }) => /\bchrome\s*=\s*["']shared["']/.test(tag))
const sharedFiles = new Set(sharedCalls.map(({ file }) => file))
const approvedSharedFiles = new Set([
  'src/pages/Novel/ProjectBrief/index.tsx',
  'src/pages/Novel/Premise/index.tsx',
  'src/pages/Novel/ThemeVoice/index.tsx',
  'src/pages/Novel/StyleLab/index.tsx',
  'src/pages/Novel/WorldRules/index.tsx',
  'src/pages/Novel/MapExplorer/MapExplorerPage.tsx',
  'src/pages/Novel/ItemsWorkspace/index.tsx',
])
const invalidLegacyContracts = calls.filter(({ tag }) => !/\bchrome\s*=\s*["']shared["']/.test(tag) && /\bactionContract\s*=/.test(tag))
const sharedWithoutContract = sharedCalls.filter(({ tag }) => !/\bactionContract\s*=/.test(tag))

assertPass('WorkspacePage call inventory is non-empty', calls.length > 0)
assertPass(
  'Approved shared chrome migrations are explicit',
  sharedCalls.length === approvedSharedFiles.size
    && [...approvedSharedFiles].every((file) => sharedFiles.has(file)),
)
assertPass('Shared chrome requires an action contract', sharedWithoutContract.length === 0)
assertPass('Legacy/default pages cannot pass actionContract', invalidLegacyContracts.length === 0)

const shell = read('src/pages/Novel/components/WorkspaceShell.tsx')
const router = read('src/pages/Novel/index.tsx')
const topbar = read('src/components/novel/layout/ProjectTopbar.tsx')
assertPass('WorkspacePage exposes runtime chrome markers for acceptance', shell.includes('data-workspace-chrome={chrome}') && shell.includes('data-workspace-information-mounted={usesSharedChrome'))
assertPass('Portal provider wraps the route shell', router.indexOf('<WorkspaceChromePortalContext.Provider') < router.indexOf('<ProjectTopbar') && router.indexOf('</WorkspaceChromePortalContext.Provider>') > router.indexOf('<ProjectTopbar'))
assertPass('Topbar owns both portal target callbacks', topbar.includes('onPageActionsTargetChange?:') && topbar.includes('onInformationTargetChange?:') && topbar.includes('ref={onPageActionsTargetChange}') && topbar.includes('ref={onInformationTargetChange}'))

console.log(`Workspace chrome contract tests passed (${calls.length} WorkspacePage calls; ${sharedCalls.length} shared).`)
