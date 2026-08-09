const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const generatorPath = path.resolve(__dirname, 'generate-app-icon.py')
const requiredIcons = [
  path.resolve(projectRoot, 'build', 'icon.ico'),
  path.resolve(projectRoot, 'build', 'installerIcon.ico'),
  path.resolve(projectRoot, 'build', 'uninstallerIcon.ico'),
]

function iconsReady() {
  return requiredIcons.every((file) => fs.existsSync(file) && fs.statSync(file).size > 0)
}

function runPython(command, args) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
  })
}

function printResult(result) {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

if (iconsReady()) {
  process.stdout.write('[build-icons] Required Windows icons are ready.\n')
  process.exit(0)
}

const candidates = process.env.PYTHON
  ? [[process.env.PYTHON, []]]
  : process.platform === 'win32'
    ? [['python', []], ['py', ['-3']]]
    : [['python3', []], ['python', []]]

let lastResult = null
for (const [command, prefixArgs] of candidates) {
  const result = runPython(command, [...prefixArgs, generatorPath])
  lastResult = result
  if (result.status === 0 && iconsReady()) {
    printResult(result)
    process.stdout.write('[build-icons] Generated icon.ico, installerIcon.ico, and uninstallerIcon.ico.\n')
    process.exit(0)
  }
}

if (lastResult) printResult(lastResult)
process.stderr.write(
  '[build-icons] Unable to generate packaging icons. Install Python 3 with Pillow, '
  + 'or provide build/icon.ico, build/installerIcon.ico, and build/uninstallerIcon.ico.\n',
)
process.exit(1)
