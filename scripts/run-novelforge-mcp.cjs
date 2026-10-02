const path = require('node:path')
const { spawn } = require('node:child_process')
const child = spawn(require('electron'), [path.join(__dirname, 'novelforge-mcp.cjs'), '--mcp'], {
  cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'inherit', windowsHide: true,
})
child.on('error', (error) => { console.error(error); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code || 0 })
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
