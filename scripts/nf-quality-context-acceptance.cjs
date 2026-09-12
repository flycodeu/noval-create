'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const workspaceRoot = path.resolve(__dirname, '..')
const evidenceRoot = path.join(workspaceRoot, 'docs', 'implementation', 'novelforge-quality-context-v1', 'evidence', 'NF-20')
const integrationScript = path.join(workspaceRoot, 'scripts', 'nf-quality-context-integration.cjs')
const evaluationFixture = path.join(workspaceRoot, 'docs', 'implementation', 'novelforge-quality-context-v1', 'evidence', 'NF-19', 'fixture.json')
const electronBinary = require('electron')

function parseArgs(argv) {
  if (argv.length !== 1 || argv[0] !== '--local-only') {
    throw new Error('NF20_LOCAL_ONLY_REQUIRED: use --local-only; real-model execution requires a separate authorized stage')
  }
  return { localOnly: true }
}

function parseLastJson(output) {
  const starts = []
  for (let index = output.indexOf('{'); index >= 0; index = output.indexOf('{', index + 1)) starts.push(index)
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(output.slice(starts[index]).trim())
    } catch { /* keep searching for the outermost final JSON object */ }
  }
  return null
}

function readUiSummary(reportPath, startedAt) {
  const summary = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  if (!Number.isFinite(Date.parse(summary.date)) || Date.parse(summary.date) < startedAt) throw new Error('NF20_STALE_UI_REPORT')
  const required = ['18-01', '18-02', '18-03', '18-04', '18-05', '18-06']
  if (!Array.isArray(summary.cases) || summary.cases.length !== required.length
    || !required.every((id) => summary.cases.some((item) => item.id === id && item.result === 'PASS'))) {
    throw new Error('NF20_INCOMPLETE_UI_REPORT')
  }
  return summary
}

function validateStepSummary(step, summary, startedAt) {
  if (step.uiReport) return readUiSummary(step.uiReport, startedAt)
  if (step.caseName) {
    if (summary?.harness !== 'nf-quality-context-integration' || summary.case !== step.caseName
      || summary.status !== 'PASS' || summary.commandExitCode !== 0
      || summary.databaseMode !== (step.databaseMode || 'fresh')) throw new Error('NF20_INVALID_INTEGRATION_REPORT')
    const checks = Object.values(summary.checks || summary.cases || {})
    if (Object.values(summary.cases || {}).includes('FAIL')) throw new Error('NF20_FAILED_CASE')
    if (!checks.length || checks.some((check) => (typeof check === 'string' ? check : check.status) !== 'PASS')) {
      throw new Error('NF20_FAILED_OR_MISSING_CHECKS')
    }
  } else if (summary?.mode !== 'prepare' || summary.remoteRequests !== 0 || summary.databaseWrites !== 0 || !(summary.samples > 0)) {
    throw new Error('NF20_INVALID_OFFLINE_REPORT')
  }
  return summary
}

function runStep(step) {
  const startedAt = Date.now()
  const env = { ...process.env, NOVELFORGE_DISABLE_LEGACY_DB_COPY: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NOVELFORGE_REAL_MODEL_ACCEPTANCE
  delete env.NOVELFORGE_CONTEXT_COMPILER_MODE
  const result = spawnSync(step.command, step.args, {
    cwd: workspaceRoot,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: step.timeoutMs || 180_000,
    maxBuffer: 20 * 1024 * 1024,
  })
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  let summary = parseLastJson(stdout)
  let validationError = result.error?.message || null
  try {
    summary = validateStepSummary(step, summary, startedAt)
  } catch (error) {
    validationError ||= error instanceof Error ? error.message : String(error)
  }
  return {
    id: step.id,
    command: [step.command, ...step.args].join(' '),
    status: result.status === 0 && !result.signal && !validationError ? 'PASS' : 'FAIL',
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    summary,
    validationError,
    stdoutTail: stdout.slice(-4000),
    stderrTail: stderr.slice(-4000),
  }
}

function buildSteps() {
  const integrationCases = ['NF-00', 'NF-02', 'NF-03', 'NF-04', 'NF-12', 'NF-13', 'NF-14']
  return [
    ...integrationCases.map((caseName) => ({
      id: caseName,
      caseName,
      command: electronBinary,
      args: [integrationScript, '--case', caseName],
    })),
    {
      id: 'NF-20-fresh',
      caseName: 'NF-20',
      databaseMode: 'fresh',
      command: electronBinary,
      args: [integrationScript, '--case', 'NF-20', '--database-mode', 'fresh'],
    },
    {
      id: 'NF-20-upgrade',
      caseName: 'NF-20',
      databaseMode: 'upgrade',
      command: electronBinary,
      args: [integrationScript, '--case', 'NF-20', '--database-mode', 'upgrade'],
    },
    {
      id: 'NF-18-ui',
      uiReport: path.join(evidenceRoot, '..', 'NF-18', 'ui-results.json'),
      command: process.execPath,
      args: [path.join(workspaceRoot, 'scripts', 'ui-acceptance', 'capture-nf-writing-state.cjs')],
      timeoutMs: 240_000,
    },
    {
      id: 'NF-19-offline',
      command: process.execPath,
      args: [path.join(workspaceRoot, 'scripts', 'nf-evaluation.cjs'), '--prepare', '--fixture', evaluationFixture],
    },
  ]
}

function buildReport(steps, expectedSteps) {
  const failed = steps.filter((step) => step.status !== 'PASS')
  const counted = steps.filter((step) => step.status === 'PASS' && Number.isInteger(step.summary?.remoteRequests) && step.summary.remoteRequests >= 0)
  return {
    schemaVersion: 1,
    runAt: new Date().toISOString(),
    mode: 'local-only',
    statusScope: 'local_checks',
    status: failed.length > 0 ? 'FAIL' : steps.length === expectedSteps ? 'PASS' : 'IN_PROGRESS',
    remoteModelAuthorized: false,
    remoteRequests: counted.length === expectedSteps ? counted.reduce((sum, step) => sum + step.summary.remoteRequests, 0) : null,
    remoteRequestCoverage: { reportedSteps: counted.length, expectedSteps, source: 'child_report', missingSteps: steps.filter((step) => !counted.includes(step)).map((step) => step.id) },
    engineeringStatus: 'UNVERIFIED',
    productionPipeline: 'UNVERIFIED',
    realModelEffect: 'UNVERIFIED',
    releaseAccepted: false,
    steps,
    failures: failed.map((step) => step.id),
    skippedSteps: expectedSteps - steps.length,
  }
}

function main(argv = process.argv.slice(2)) {
  parseArgs(argv)
  fs.mkdirSync(evidenceRoot, { recursive: true })
  const planned = buildSteps()
  const steps = []
  let report = buildReport(steps, planned.length)
  fs.writeFileSync(path.join(evidenceRoot, 'machine-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  for (const step of planned) {
    const result = runStep(step)
    steps.push(result)
    report = buildReport(steps, planned.length)
    fs.writeFileSync(path.join(evidenceRoot, 'machine-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    if (result.status !== 'PASS') break
  }
  process.stdout.write(`${JSON.stringify({
    harness: 'nf-quality-context-acceptance',
    status: report.status,
    steps: steps.map((step) => ({ id: step.id, status: step.status, durationMs: step.durationMs })),
    remoteRequests: report.remoteRequests,
    remoteRequestCoverage: report.remoteRequestCoverage,
    engineeringStatus: report.engineeringStatus,
    productionPipeline: report.productionPipeline,
    realModelEffect: 'UNVERIFIED',
    report: path.join(evidenceRoot, 'machine-report.json'),
  }, null, 2)}\n`)
  if (report.status !== 'PASS') process.exitCode = 1
  return report
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { buildReport, buildSteps, main, parseArgs, parseLastJson, runStep }
