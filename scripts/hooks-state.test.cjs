const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')
app.setPath('userData', require('./isolate-test-session.cjs')(app))
app.disableHardwareAcceleration()

async function main() {
  const root = path.resolve(__dirname, '..')
  const fixtureRoot = fs.mkdtempSync(path.join(root, '.tmp-tests/hooks-browser-'))
  await build({
    entryPoints: [path.join(__dirname, 'browser-fixtures/hooks-state.tsx')],
    outfile: path.join(fixtureRoot, 'fixture.js'), bundle: true, platform: 'browser',
    format: 'iife', jsx: 'automatic', alias: { '@': path.join(root, 'src') },
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.css': 'empty' },
  })
  const html = path.join(fixtureRoot, 'index.html')
  fs.writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>')
  await app.whenReady()
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  try {
    await window.loadFile(html)
    const result = await Promise.race([
      window.webContents.executeJavaScript('window.runHooksStateTests()'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Hooks browser regression timeout')), 30000)),
    ])
    console.log(result)
  } finally {
    window.destroy()
  }
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
