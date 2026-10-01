const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const testRoot = fs.realpathSync(path.resolve(workspaceRoot, '.tmp-tests'))
const userDataDir = fs.realpathSync(path.resolve(process.env.NOVELFORGE_USER_DATA_DIR || ''))
const relative = path.relative(testRoot, userDataDir)
if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
  throw new Error(`Refusing to seed outside the test directory: ${userDataDir}`)
}

process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setPath('userData', userDataDir)
app.disableHardwareAcceleration()
registerProjectTsRuntime(workspaceRoot)

app.whenReady().then(() => {
  const { initDb, closeDb, getSqlite } = require('../electron/database/db.ts')
  initDb()
  try {
    getSqlite().prepare('INSERT INTO novels (title, status, context_version) VALUES (?, ?, ?)')
      .run('安装版 MCP 验收', 'draft', 1)
  } finally {
    closeDb()
    app.exit(0)
  }
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
