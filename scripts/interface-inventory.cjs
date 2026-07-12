const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_SOURCE_FILES = Object.freeze({
  mainIpc: 'electron/main.ts',
  preload: 'electron/preload.ts',
  localWebBackend: 'scripts/local-web-backend.cjs',
  webBridge: 'src/runtime/web-electron-bridge.ts',
})

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

function countByPrefix(channels, separator) {
  return channels.reduce((result, channel) => {
    const prefix = channel.split(separator)[0]
    result[prefix] = (result[prefix] || 0) + 1
    return result
  }, {})
}

function parseMainIpcChannels(source) {
  return [...source.matchAll(/\bhandle\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
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

function parseWebBridgeHandlerPairs(source) {
  return [...source.matchAll(
    /withLocalBackend(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/gs,
  )].map((match) => `${match[1]}.${match[2]}`)
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
  const bridgePairs = parseWebBridgeHandlerPairs(sources.webBridge)

  return {
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
  return issues
}

function printCheckSummary(inventory, issues) {
  console.log(
    `[interface-inventory] desktop ${inventory.desktop.counts.main}/${inventory.desktop.counts.preload}; `
    + `local-web ${inventory.localWeb.counts.backend}/${inventory.localWeb.counts.bridge}`,
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
