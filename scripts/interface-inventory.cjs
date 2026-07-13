const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_SOURCE_FILES = Object.freeze({
  mainIpc: 'electron/main.ts',
  preload: 'electron/preload.ts',
  localWebBackend: 'scripts/local-web-backend.cjs',
  webBridge: 'src/runtime/web-electron-bridge.ts',
})

// These are platform capabilities, not business APIs. Window controls have no
// meaningful Web equivalent; the Web app exposes its real-backend capability
// probe explicitly, while desktop uses the native window/runtime surface.
const DESKTOP_WEB_PLATFORM_ONLY = new Set([
  'window.close',
  'window.isMaximized',
  'window.minimize',
  'window.toggleMaximize',
])
const LOCAL_WEB_PLATFORM_ONLY = new Set(['app.getCapabilities'])

function readSource(workspaceRoot, relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8')
}

function unique(values) {
  return [...new Set(values)].sort()
}

function duplicates(values) {
  const seen = new Set()
  const repeated = new Set()
  values.forEach((value) => {
    if (seen.has(value)) repeated.add(value)
    seen.add(value)
  })
  return [...repeated].sort()
}

function difference(left, right) {
  const rightSet = new Set(right)
  return unique(left).filter((value) => !rightSet.has(value))
}

function hashSource(source) {
  return crypto.createHash('sha256').update(source).digest('hex')
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

function countByPrefix(channels, separator) {
  return channels.reduce((result, channel) => {
    const prefix = channel.split(separator)[0]
    result[prefix] = (result[prefix] || 0) + 1
    return result
  }, {})
}

function parseMainIpcChannels(source) {
  return [...stripComments(source).matchAll(/\bhandle\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function parsePreloadIpcChannels(source) {
  return [...source.matchAll(/\binvokeIpc(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
}

function parseBackendHandlerPairs(source) {
  const start = source.indexOf('const handlers = {')
  const end = source.indexOf('\n\n  return { handlers', start)
  if (start < 0 || end < 0) {
    throw new Error('Unable to locate local web backend handler registry')
  }

  const pairs = []
  let currentGroup = null
  const handlerBlock = source.slice(start, end)
  for (const line of handlerBlock.split(/\r?\n/)) {
    const groupMatch = line.match(/^    ([A-Za-z][A-Za-z0-9]*): \{$/)
    if (groupMatch) {
      currentGroup = groupMatch[1]
      continue
    }

    const methodMatch = line.match(/^      ([A-Za-z][A-Za-z0-9]*)(?::|,\s*$)/)
    if (methodMatch && currentGroup) {
      pairs.push(`${currentGroup}.${methodMatch[1]}`)
    }
  }
  return pairs
}

function parseWebBridgeHandlerPairs(source, backendPairs = []) {
  const explicitPairs = [...source.matchAll(
    /withLocalBackend(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/gs,
  )].map((match) => `${match[1]}.${match[2]}`)
  const proxiedServices = [...source.matchAll(/createService\(\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g)]
    .map((match) => match[1])
  const proxiedPairs = backendPairs.filter((pair) => proxiedServices.includes(pair.split('.')[0]))
  return unique([...explicitPairs, ...proxiedPairs])
}

function buildPairInventory(left, right, leftLabel, rightLabel, separator) {
  return {
    counts: {
      [leftLabel]: left.length,
      [rightLabel]: right.length,
    },
    prefixes: {
      [leftLabel]: countByPrefix(left, separator),
      [rightLabel]: countByPrefix(right, separator),
    },
    duplicates: {
      [leftLabel]: duplicates(left),
      [rightLabel]: duplicates(right),
    },
    missing: {
      [`${leftLabel}Only`]: difference(left, right),
      [`${rightLabel}Only`]: difference(right, left),
    },
    entries: {
      [leftLabel]: unique(left),
      [rightLabel]: unique(right),
    },
  }
}

function normalizeDesktopWebPair(pair) {
  return pair.startsWith('agentTool.') ? `agentTools.${pair.slice('agentTool.'.length)}` : pair
}

function buildCrossSurfaceInventory(desktopChannels, localWebPairs) {
  const desktopBusinessPairs = unique(desktopChannels.map((channel) => normalizeDesktopWebPair(channel.replace(':', '.'))))
  const localWebBusinessPairs = unique(localWebPairs.filter((pair) => !LOCAL_WEB_PLATFORM_ONLY.has(pair)))
  const desktopOnly = difference(desktopBusinessPairs, localWebBusinessPairs)
    .filter((pair) => !DESKTOP_WEB_PLATFORM_ONLY.has(pair))
  const localWebOnly = difference(localWebBusinessPairs, desktopBusinessPairs)

  return {
    expectedWebBusinessApis: desktopBusinessPairs.length - DESKTOP_WEB_PLATFORM_ONLY.size,
    mirroredBusinessApis: desktopBusinessPairs.filter((pair) => localWebBusinessPairs.includes(pair)).length,
    desktopOnly,
    localWebOnly,
    platformExceptions: {
      desktopOnly: [...DESKTOP_WEB_PLATFORM_ONLY].sort(),
      localWebOnly: [...LOCAL_WEB_PLATFORM_ONLY].sort(),
    },
  }
}

function buildInterfaceInventory(workspaceRoot = path.resolve(__dirname, '..')) {
  const sources = Object.fromEntries(
    Object.entries(DEFAULT_SOURCE_FILES).map(([key, relativePath]) => [
      key,
      readSource(workspaceRoot, relativePath),
    ]),
  )

  const mainChannels = parseMainIpcChannels(sources.mainIpc)
  const preloadChannels = parsePreloadIpcChannels(sources.preload)
  const backendPairs = parseBackendHandlerPairs(sources.localWebBackend)
  const bridgePairs = parseWebBridgeHandlerPairs(sources.webBridge, backendPairs)

  const inventory = {
    schemaVersion: 1,
    sourceFiles: Object.fromEntries(
      Object.entries(DEFAULT_SOURCE_FILES).map(([key, relativePath]) => [key, {
        path: relativePath,
        sha256: hashSource(sources[key]),
      }]),
    ),
    desktop: buildPairInventory(mainChannels, preloadChannels, 'main', 'preload', ':'),
    localWeb: buildPairInventory(backendPairs, bridgePairs, 'backend', 'bridge', '.'),
  }
  inventory.crossSurface = buildCrossSurfaceInventory(preloadChannels, bridgePairs)
  return inventory
}

function collectInterfaceInventoryIssues(inventory) {
  const issues = []
  for (const [surface, details] of Object.entries({
    desktop: inventory.desktop,
    localWeb: inventory.localWeb,
  })) {
    for (const [side, values] of Object.entries(details.duplicates)) {
      if (values.length > 0) issues.push(`${surface}.${side} has duplicate entries: ${values.join(', ')}`)
    }
    for (const [side, values] of Object.entries(details.missing)) {
      if (values.length > 0) issues.push(`${surface}.${side} entries are not mirrored: ${values.join(', ')}`)
    }
  }
  if (inventory.crossSurface.desktopOnly.length > 0) {
    issues.push(`crossSurface.desktopOnly entries are not mirrored: ${inventory.crossSurface.desktopOnly.join(', ')}`)
  }
  if (inventory.crossSurface.localWebOnly.length > 0) {
    issues.push(`crossSurface.localWebOnly entries are not mirrored: ${inventory.crossSurface.localWebOnly.join(', ')}`)
  }
  return issues
}

function printCheckSummary(inventory, issues) {
  console.log(
    `[interface-inventory] desktop ${inventory.desktop.counts.main}/${inventory.desktop.counts.preload}; `
    + `local-web ${inventory.localWeb.counts.backend}/${inventory.localWeb.counts.bridge}; `
    + `cross-surface ${inventory.crossSurface.mirroredBusinessApis}/${inventory.crossSurface.expectedWebBusinessApis}`,
  )
  if (issues.length === 0) {
    console.log('[interface-inventory] PASS all interface maps are mirrored and duplicate-free')
    return
  }
  issues.forEach((issue) => console.error(`[interface-inventory] FAIL ${issue}`))
}

if (require.main === module) {
  const inventory = buildInterfaceInventory()
  const issues = collectInterfaceInventoryIssues(inventory)
  if (process.argv.includes('--check')) {
    printCheckSummary(inventory, issues)
  } else {
    console.log(JSON.stringify(inventory, null, 2))
  }
  if (issues.length > 0) process.exitCode = 1
}

module.exports = {
  DEFAULT_SOURCE_FILES,
  buildInterfaceInventory,
  collectInterfaceInventoryIssues,
  parseBackendHandlerPairs,
  parseMainIpcChannels,
  parsePreloadIpcChannels,
  parseWebBridgeHandlerPairs,
}
