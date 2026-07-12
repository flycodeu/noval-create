const path = require('node:path')
const { spawnSync } = require('node:child_process')

const workspaceRoot = path.resolve(__dirname, '..')
const launcher = path.join(workspaceRoot, 'scripts', 'run-novelforge-mcp.cjs')
const codexCommand = process.platform === 'win32' ? 'codex.cmd' : 'codex'
const executable = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : codexCommand
const argumentPrefix = process.platform === 'win32' ? ['/d', '/s', '/c', codexCommand] : []

function run(args, stdio = 'inherit') {
  return spawnSync(executable, [...argumentPrefix, ...args], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    stdio,
    windowsHide: true,
  })
}

const commandCheck = process.platform === 'win32'
  ? spawnSync('where.exe', [codexCommand], { stdio: 'ignore', windowsHide: true })
  : spawnSync('sh', ['-lc', 'command -v codex'], { stdio: 'ignore' })
if (commandCheck.status !== 0) {
  console.error('未找到 Codex CLI。请先安装 Codex，再重新运行 npm run mcp:install:codex。')
  process.exit(1)
}

const existing = run(['mcp', 'get', 'novelforge'], 'pipe')
if (existing.status === 0) {
  process.stdout.write(existing.stdout || '')
  console.log('Codex 用户配置中已存在 novelforge；未覆盖现有条目。')
  process.exit(0)
}

const added = run(['mcp', 'add', 'novelforge', '--', 'node', launcher])
if (added.error || added.status !== 0) {
  console.error('Codex MCP 安装失败。')
  process.exit(added.status || 1)
}

const verified = run(['mcp', 'get', 'novelforge'])
if (verified.error || verified.status !== 0) {
  console.error('Codex MCP 已写入，但验证失败；请运行 codex mcp get novelforge 检查。')
  process.exit(verified.status || 1)
}
