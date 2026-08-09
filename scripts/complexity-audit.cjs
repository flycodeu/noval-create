const path = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const eslintEntry = path.resolve(projectRoot, 'node_modules', 'eslint', 'bin', 'eslint.js')
const strict = process.argv.includes('--strict')
const baselineFindingCount = 257
const result = spawnSync(process.execPath, [
  eslintEntry,
  'src',
  'electron',
  'scripts',
  '--ext',
  '.ts,.tsx,.js,.cjs,.mjs',
  '--rule',
  'complexity: [warn, 25]',
  '--rule',
  'max-lines-per-function: [warn, {max: 250, skipBlankLines: true, skipComments: true}]',
  '--format',
  'json',
], {
  cwd: projectRoot,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})

if (result.error) throw result.error
if (result.status !== 0 && result.status !== 1) {
  process.stderr.write(result.stderr || result.stdout)
  process.exit(result.status || 1)
}

const reports = JSON.parse(result.stdout || '[]')
const findings = reports.flatMap((report) => report.messages
  .filter((message) => message.ruleId === 'complexity' || message.ruleId === 'max-lines-per-function')
  .map((message) => ({
    file: path.relative(projectRoot, report.filePath),
    line: message.line,
    rule: message.ruleId,
    message: message.message,
    score: Number(message.message.match(/(?:complexity of|too many lines \()(\d+)/u)?.[1] || 0),
  })))

const complexityCount = findings.filter((finding) => finding.rule === 'complexity').length
const longFunctionCount = findings.length - complexityCount
process.stdout.write(
  `Complexity audit: ${findings.length} findings `
  + `(${complexityCount} complexity, ${longFunctionCount} function-length); `
  + `baseline ${baselineFindingCount}.\n`,
)

findings
  .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))
  .slice(0, 25)
  .forEach((finding) => {
    process.stdout.write(`${finding.file}:${finding.line} [${finding.rule}] ${finding.message}\n`)
  })

if (strict && findings.length > 0) process.exit(1)
if (findings.length > baselineFindingCount) process.exit(1)
