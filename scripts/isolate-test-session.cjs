const fs = require('node:fs')
const path = require('node:path')

// Chromium 156 keeps GPUPersistentCache open until Electron exits. Keep its
// session outside the database fixture so tests can close and remove SQLite
// fixtures deterministically. Session artifacts remain in the ignored test dir.
module.exports = function isolateTestSession(app) {
  const root = path.resolve(__dirname, '..', '.tmp-tests')
  fs.mkdirSync(root, { recursive: true })
  const session = fs.mkdtempSync(path.join(root, 'electron-session-'))
  app.setPath('sessionData', session)
  return session
}
