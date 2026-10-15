const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
// This launcher may start a stateless bridge only after the installed desktop is open.
const override = process.env.NOVELFORGE_USER_DATA_DIR
const formal = path.join(process.env.APPDATA || path.join(require('node:os').homedir(), '.config'), 'NovelForge')
const isolated = override && path.resolve(override).toLowerCase() !== path.resolve(formal).toLowerCase()
async function main() {
  if (isolated) throw new Error('MCP 不接受临时数据目录。')
  const install = JSON.parse(fs.readFileSync(path.join(formal, 'desktop-install.json'), 'utf8'))
  const executable = install.executable
  if (!path.isAbsolute(executable) || !fs.statSync(executable).isFile()) throw new Error('安装路径无效。')
  const conn = JSON.parse(fs.readFileSync(path.join(formal, 'novelforge-runtime.json'), 'utf8'))
  const url = new URL(conn.url)
  if (conn.protocol !== 1 || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || !/^[a-f0-9]{64}$/.test(conn.token)) throw new Error('服务连接信息无效。')
  const response = await fetch(new URL('/health', url), { headers: { Authorization: `Bearer ${conn.token}` }, signal: AbortSignal.timeout(3000) })
  const health = await response.json()
  const same = (a, b) => typeof a === 'string' && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  if (!response.ok || health.instanceId !== conn.instanceId || health.version !== install.version || health.storage !== 'ready'
    || !health.desktopOpen || health.identity?.environment !== 'formal' || health.identity?.source !== 'installed'
    || !same(health.identity?.executable, executable) || !same(health.identity?.dataDirectory, formal)) throw new Error('未发现对应安装版的正式桌面实例。')
  const child = spawn(executable, ['--mcp'], { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'inherit', windowsHide: true })
  child.on('error', (error) => { console.error(error); process.exitCode = 1 })
  child.on('exit', (code) => { process.exitCode = code || 0 })
  process.on('SIGINT', () => child.kill())
  process.on('SIGTERM', () => child.kill())
}
main().catch(() => {
  console.error('请先手动打开已安装的 NovelForge 正式实例，再重新连接 MCP。MCP 不会自动启动后台服务或临时实例。')
  process.exitCode = 1
})
