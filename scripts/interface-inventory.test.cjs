const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { LOCAL_WEB_BACKEND_VERSION } = require('./local-web-contract.cjs')
const {
  buildInterfaceInventory,
  collectInterfaceInventoryIssues,
} = require('./interface-inventory.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const devWebSource = fs.readFileSync(path.join(workspaceRoot, 'scripts/dev-web-full.cjs'), 'utf8')
const localBackendSource = fs.readFileSync(path.join(workspaceRoot, 'scripts/local-web-backend.cjs'), 'utf8')
const inventory = buildInterfaceInventory(workspaceRoot)
const issues = collectInterfaceInventoryIssues(inventory)

assert.equal(inventory.schemaVersion, 1)
assert.ok(inventory.desktop.counts.main > 0, 'main IPC inventory must not be empty')
assert.ok(inventory.localWeb.counts.backend > 0, 'local web backend inventory must not be empty')
assert.equal(inventory.desktop.counts.main, inventory.desktop.counts.preload)
assert.equal(inventory.localWeb.counts.backend, inventory.localWeb.counts.bridge)
assert.deepEqual(issues, [])
assert.equal(LOCAL_WEB_BACKEND_VERSION, 5)
assert.match(devWebSource, /expectedBackendVersion\s*=\s*LOCAL_WEB_BACKEND_VERSION/u)
assert.match(localBackendSource, /BACKEND_VERSION\s*=\s*LOCAL_WEB_BACKEND_VERSION/u)
assert.doesNotMatch(devWebSource, /expectedBackendVersion\s*=\s*\d+/u)
assert.doesNotMatch(localBackendSource, /BACKEND_VERSION\s*=\s*\d+/u)

for (const source of Object.values(inventory.sourceFiles)) {
  assert.match(source.sha256, /^[a-f0-9]{64}$/u)
}

console.log(
  `PASS interface inventory: desktop=${inventory.desktop.counts.main}, `
  + `local-web=${inventory.localWeb.counts.backend}`,
)
