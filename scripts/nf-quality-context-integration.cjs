'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.join(workspaceRoot, '.tmp-tests', 'nf-quality-context')
const cases = new Map([
  ['NF-00', require('./nf-quality-context-cases/NF-00.cjs')],
  ['NF-02', require('./nf-quality-context-cases/NF-02.cjs')],
  ['NF-03', require('./nf-quality-context-cases/NF-03.cjs')],
  ['NF-04', require('./nf-quality-context-cases/NF-04.cjs')],
  ['NF-05', require('./nf-quality-context-cases/NF-05.cjs')],
])

function parseCase(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--case') return argv[index + 1] || null
    if (argument.startsWith('--case=')) return argument.slice('--case='.length) || null
  }
  return null
}

function describeRuntime() {
  return {
    node: process.version,
    electron: process.versions.electron || null,
    abi: process.versions.modules || 'unknown',
  }
}

function getHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unavailable'
  }
}

function isAbiMismatchError(error) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('NODE_MODULE_VERSION') || message.includes('better_sqlite3.node')
}

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3')
  } catch (error) {
    if (isAbiMismatchError(error)) {
      const guidance = [
        '[nf-quality-context] better-sqlite3 ABI 与当前 Electron 不匹配。',
        `当前运行时: ${JSON.stringify(describeRuntime())}`,
        '请使用 npm run rebuild:native 后重新执行本卡 Electron 命令。',
        `原始错误: ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n')
      throw new Error(guidance, { cause: error })
    }
    throw error
  }
}

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

function withTypeScriptRequireHook(load) {
  const originalResolveFilename = Module._resolveFilename
  const originalTsLoader = require.extensions['.ts']
  const originalTsxLoader = require.extensions['.tsx']

  Module._resolveFilename = function resolveFilenameWithTs(request, parent, isMain, options) {
    if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
      const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
      const directCandidates = ['.ts', '.tsx', '.js', '.json'].map((extension) => path.resolve(baseDir, request + extension))
      for (const candidate of directCandidates) {
        if (fs.existsSync(candidate)) return candidate
      }

      const indexCandidates = ['.ts', '.tsx', '.js'].map((extension) => path.resolve(baseDir, request, `index${extension}`))
      for (const candidate of indexCandidates) {
        if (fs.existsSync(candidate)) return candidate
      }
    }
    return originalResolveFilename.call(this, request, parent, isMain, options)
  }
  require.extensions['.ts'] = compileTs
  require.extensions['.tsx'] = compileTs

  try {
    return load()
  } finally {
    Module._resolveFilename = originalResolveFilename
    if (originalTsLoader) require.extensions['.ts'] = originalTsLoader
    else delete require.extensions['.ts']
    if (originalTsxLoader) require.extensions['.tsx'] = originalTsxLoader
    else delete require.extensions['.tsx']
  }
}

function loadMigrationRunner() {
  return withTypeScriptRequireHook(() => {
    const databaseModule = require(path.join(workspaceRoot, 'electron', 'database', 'db.ts'))
    if (typeof databaseModule.runMigrations !== 'function') {
      throw new Error('NF00_EXPECTED_RUN_MIGRATIONS_EXPORT')
    }
    return databaseModule.runMigrations
  })
}

function loadTypeScriptModule(relativePath) {
  return withTypeScriptRequireHook(() => require(path.join(workspaceRoot, relativePath)))
}

function loadBaselineMigrationRunner() {
  return withTypeScriptRequireHook(() => {
    const filename = path.join(workspaceRoot, 'electron', 'database', 'db.ts')
    const migrationIntroduction = execFileSync('git', [
      'log', '--format=%H', '-S', '0065_model_request_attempts', '--', 'electron/database/db.ts',
    ], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split(/\r?\n/u).filter(Boolean).at(-1)
    const baselineRevision = migrationIntroduction ? `${migrationIntroduction}^` : getHead()
    const source = execFileSync('git', ['show', `${baselineRevision}:electron/database/db.ts`], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: filename,
    })
    const baselineModule = new Module(filename)
    baselineModule.filename = filename
    baselineModule.paths = Module._nodeModulePaths(path.dirname(filename))
    baselineModule._compile(outputText, filename)
    if (typeof baselineModule.exports.runMigrations !== 'function') {
      throw new Error('NF_EXPECTED_BASELINE_RUN_MIGRATIONS_EXPORT')
    }
    return baselineModule.exports.runMigrations
  })
}

function printSummary(summary) {
  console.log(JSON.stringify(summary, null, 2))
}

async function runCase(caseName) {
  const selected = cases.get(caseName)
  if (!selected) {
    const error = new Error(`NF_UNKNOWN_CASE: ${caseName || '(missing)'}`)
    error.exitCode = 2
    throw error
  }
  if (typeof selected.run !== 'function') {
    throw new Error(`NF_INVALID_CASE: ${caseName}`)
  }

  const Database = loadBetterSqlite3()
  const runMigrations = loadMigrationRunner()
  const baselineRunMigrations = loadBaselineMigrationRunner()
  return selected.run({
    workspaceRoot,
    tempRoot,
    Database,
    runMigrations,
    baselineRunMigrations,
    loadTypeScriptModule,
  })
}

async function main() {
  const caseName = parseCase(process.argv.slice(2))
  const { app } = require('electron')
  await app.whenReady()

  let exitCode = 0
  try {
    const result = await runCase(caseName)
    printSummary({
      harness: 'nf-quality-context-integration',
      case: caseName,
      status: 'PASS',
      runtime: describeRuntime(),
      head: getHead(),
      tempRoot: path.resolve(tempRoot),
      commandExitCode: 0,
      ...result,
    })
  } catch (error) {
    exitCode = Number(error && error.exitCode) || 1
    console.error(`[nf-quality-context] ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof Error && error.stack) console.error(error.stack)
    printSummary({
      harness: 'nf-quality-context-integration',
      case: caseName,
      status: 'FAIL',
      runtime: describeRuntime(),
      head: getHead(),
      tempRoot: path.resolve(tempRoot),
      commandExitCode: exitCode,
    })
  } finally {
    app.exit(exitCode)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = Number(error && error.exitCode) || 1
})
