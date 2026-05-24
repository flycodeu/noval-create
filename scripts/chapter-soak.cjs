const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.join(workspaceRoot, '.tmp-tests')

function readText(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8')
}

function parseArgs(argv) {
  const options = {
    chapters: 12,
    targetWords: 1200000,
    chapterTargetWords: 800,
    json: false,
    realModel: false,
    reportPath: '',
    outPath: path.join(tempRoot, 'chapter-soak-report.json'),
  }

  argv.forEach((arg, index) => {
    if (arg === '--json') options.json = true
    if (arg === '--real-model' || arg === '--real') options.realModel = true
    if (arg.startsWith('--chapters=')) options.chapters = Math.max(1, Number(arg.slice('--chapters='.length)) || options.chapters)
    if (arg.startsWith('--targetWords=')) options.targetWords = Math.max(1, Number(arg.slice('--targetWords='.length)) || options.targetWords)
    if (arg.startsWith('--chapterTargetWords=')) options.chapterTargetWords = Math.max(1, Number(arg.slice('--chapterTargetWords='.length)) || options.chapterTargetWords)
    if (arg.startsWith('--report=')) options.reportPath = path.resolve(process.cwd(), arg.slice('--report='.length))
    if (arg === '--report' && argv[index + 1]) options.reportPath = path.resolve(process.cwd(), argv[index + 1])
    if (arg.startsWith('--out=')) options.outPath = path.resolve(process.cwd(), arg.slice('--out='.length))
  })

  return options
}

function assertIncludes(text, needle, label) {
  assert.ok(text.includes(needle), `${label} should include ${needle}`)
}

function assertMatches(text, pattern, label) {
  assert.match(text, pattern, `${label} should match ${pattern}`)
}

function buildThresholds(options) {
  return {
    requestedChapters: options.chapters,
    minSuccessRate: 1,
    maxFailedChapters: 0,
    minWordRatio: 0.6,
    minContextHitRate: 0.9,
    minAliasHitRate: 0.85,
    minContractAssetHitRate: 0.95,
    maxRecallFallbackRate: 0.2,
    dryRunChapterP95Ms: 15000,
    realChapterP95Ms: 12 * 60 * 1000,
    realTotalTimeoutMs: options.chapters * 15 * 60 * 1000,
    maxRecallFallbackStreak: 2,
    requiredPipelineRoles: ['planner', 'writer', 'critic', 'rewriter', 'canonizer', 'finalize'],
  }
}

function buildDryRunReport(options) {
  const chapterService = readText('electron/services/chapter.service.ts')
  const batchWorkflow = readText('electron/services/batch-workflow.service.ts')
  const contextService = readText('electron/services/context.service.ts')
  const promptLibrary = readText('src/shared/prompt-library.ts')
  const thresholds = buildThresholds(options)
  const checks = []

  function check(name, run) {
    run()
    checks.push({ name, status: 'pass' })
  }

  check('chapter pipeline has six role checkpoints', () => {
    thresholds.requiredPipelineRoles.forEach((role) => {
      assertMatches(chapterService, new RegExp(`${role}:\\s*createPipelineRoleState`, 'u'), `pipeline role ${role}`)
    })
    assertIncludes(chapterService, 'createInitialChapterPipelineSnapshot', 'chapter pipeline')
  })

  check('chapter pipeline persists draft, gate, canon and finalize stages', () => {
    assertIncludes(chapterService, 'runChapterPublishCheck(chapterId)', 'publish gate')
    assertIncludes(chapterService, 'prepareChapterWritebackRunWithRetry', 'canonizer')
    assertIncludes(chapterService, 'finalizeGeneratedChapterContent', 'finalize')
    assertIncludes(chapterService, 'generateChapterEmbeddings', 'embedding refresh')
  })

  check('batch workflow waits for real chapter generation children', () => {
    assertIncludes(batchWorkflow, 'generateChapterContent', 'batch chapter generation')
    assertIncludes(batchWorkflow, 'consecutiveRecallFallbackChapters', 'recall fallback guard')
    assertIncludes(batchWorkflow, 'runChapterPublishCheck', 'batch publish gate')
  })

  check('context retrieval is alias and scene-contract aware', () => {
    assertIncludes(contextService, 'collectMentionedEntityMatchesFromCandidates', 'alias mention collector')
    assertIncludes(contextService, 'mentionValidationCharacters', 'alias validation terms')
    assertIncludes(contextService, 'buildFactionMentionCandidates', 'faction alias mention collector')
    assertIncludes(contextService, 'mentionedFactions', 'faction mention propagation')
    assertIncludes(contextService, 'contractContext?.sceneContracts', 'scene contract signal text')
    assertIncludes(contextService, 'requiredAssetRefs', 'contract asset refs')
  })

  check('longform prompts carry review and continuity schemas', () => {
    assertIncludes(promptLibrary, 'context_drift_risks', 'review schema')
    assertIncludes(promptLibrary, 'realism_risks', 'review schema')
    assertIncludes(promptLibrary, 'continuity', 'continuity prompt')
  })

  return {
    mode: 'dry-run',
    invokedAt: new Date().toISOString(),
    realModelCalled: false,
    fixture: {
      targetWords: options.targetWords,
      chapters: options.chapters,
      chapterTargetWords: options.chapterTargetWords,
      profile: 'million-word multi-entity chapter soak',
    },
    thresholds,
    checks,
    metrics: {
      requestedChapters: options.chapters,
      completedChapters: options.chapters,
      failedChapters: 0,
      successRate: 1,
      p95ChapterDurationMs: 1,
      consecutiveRecallFallbackChapters: 0,
      minWordRatio: 1,
      contextHitRate: 1,
      aliasHitRate: 1,
      contractAssetHitRate: 1,
      recallFallbackRate: 0,
      publishGateFailures: 0,
      blockedWritebacks: 0,
      pipelineRolesCovered: thresholds.requiredPipelineRoles,
    },
    notes: [
      'Dry-run validates the production code hooks and the report schema only.',
      'Use --report=<path> to validate metrics exported by a real app/Electron chapter batch run.',
      'Use --real-model only as a manual/nightly gate with explicit provider credentials and cost limits.',
    ],
  }
}

function readReport(reportPath) {
  assert.ok(reportPath, '--report requires a JSON report path')
  const raw = fs.readFileSync(reportPath, 'utf8')
  return JSON.parse(raw)
}

function asOptionalText(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function validateRealReport(report, thresholds) {
  const failures = []
  const metrics = report.metrics || report
  const provenance = report.provenance || metrics.provenance || {}
  const requestedChapters = Number(metrics.requestedChapters ?? thresholds.requestedChapters)
  const completedChapters = Number(metrics.completedChapters ?? 0)
  const failedChapters = Number(metrics.failedChapters ?? 0)
  const successRate = requestedChapters > 0 ? completedChapters / requestedChapters : 0
  const p95ChapterDurationMs = Number(metrics.p95ChapterDurationMs ?? 0)
  const consecutiveRecallFallbackChapters = Number(metrics.consecutiveRecallFallbackChapters ?? 0)
  const minWordRatio = Number(metrics.minWordRatio ?? 0)
  const contextHitRate = Number(metrics.contextHitRate ?? 0)
  const aliasHitRate = Number(metrics.aliasHitRate ?? 0)
  const contractAssetHitRate = Number(metrics.contractAssetHitRate ?? 0)
  const recallFallbackRate = Number(metrics.recallFallbackRate
    ?? (requestedChapters > 0 ? Number(metrics.recallFallbackChapters ?? 0) / requestedChapters : 0))
  const publishGateFailures = Number(metrics.publishGateFailures ?? 0)
  const blockedWritebacks = Number(metrics.blockedWritebacks ?? 0)
  const pipelineRolesCovered = Array.isArray(metrics.pipelineRolesCovered) ? metrics.pipelineRolesCovered : []
  const realModelCalled = report.realModelCalled === true || metrics.realModelCalled === true
  const modelProvider = asOptionalText(provenance.provider || metrics.modelProvider || report.modelProvider)
  const model = asOptionalText(provenance.model || metrics.model || metrics.modelName || report.model)
  const modelConfigId = asOptionalText(provenance.modelConfigId || metrics.modelConfigId || report.modelConfigId)
  const runId = asOptionalText(provenance.runId || metrics.runId || report.runId)

  if (!realModelCalled) failures.push('realModelCalled must be true for report validation')
  if (!modelProvider) failures.push('missing model provenance: provider')
  if (!model) failures.push('missing model provenance: model')
  if (!modelConfigId && !runId) failures.push('missing model provenance: modelConfigId or runId')
  if (successRate < thresholds.minSuccessRate) failures.push(`successRate ${successRate} < ${thresholds.minSuccessRate}`)
  if (failedChapters > thresholds.maxFailedChapters) failures.push(`failedChapters ${failedChapters} > ${thresholds.maxFailedChapters}`)
  if (minWordRatio < thresholds.minWordRatio) failures.push(`minWordRatio ${minWordRatio} < ${thresholds.minWordRatio}`)
  if (contextHitRate < thresholds.minContextHitRate) failures.push(`contextHitRate ${contextHitRate} < ${thresholds.minContextHitRate}`)
  if (aliasHitRate < thresholds.minAliasHitRate) failures.push(`aliasHitRate ${aliasHitRate} < ${thresholds.minAliasHitRate}`)
  if (contractAssetHitRate < thresholds.minContractAssetHitRate) failures.push(`contractAssetHitRate ${contractAssetHitRate} < ${thresholds.minContractAssetHitRate}`)
  if (recallFallbackRate > thresholds.maxRecallFallbackRate) failures.push(`recallFallbackRate ${recallFallbackRate} > ${thresholds.maxRecallFallbackRate}`)
  if (p95ChapterDurationMs > thresholds.realChapterP95Ms) failures.push(`p95ChapterDurationMs ${p95ChapterDurationMs} > ${thresholds.realChapterP95Ms}`)
  if (consecutiveRecallFallbackChapters > thresholds.maxRecallFallbackStreak) failures.push(`consecutiveRecallFallbackChapters ${consecutiveRecallFallbackChapters} > ${thresholds.maxRecallFallbackStreak}`)
  if (publishGateFailures > 0) failures.push(`publishGateFailures ${publishGateFailures} > 0`)
  if (blockedWritebacks > 0) failures.push(`blockedWritebacks ${blockedWritebacks} > 0`)
  thresholds.requiredPipelineRoles.forEach((role) => {
    if (!pipelineRolesCovered.includes(role)) failures.push(`missing pipeline role ${role}`)
  })

  return {
    mode: 'report-validation',
    invokedAt: new Date().toISOString(),
    realModelCalled,
    provenance: {
      provider: modelProvider,
      model,
      modelConfigId,
      runId,
    },
    thresholds,
    metrics: {
      requestedChapters,
      completedChapters,
      failedChapters,
      successRate,
      p95ChapterDurationMs,
      consecutiveRecallFallbackChapters,
      minWordRatio,
      contextHitRate,
      aliasHitRate,
      contractAssetHitRate,
      recallFallbackRate,
      publishGateFailures,
      blockedWritebacks,
      pipelineRolesCovered,
    },
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
  }
}

function buildRealModeManifest(options) {
  const missingEnv = [
    'NOVELFORGE_SOAK_PROVIDER',
    'NOVELFORGE_SOAK_MODEL',
    'NOVELFORGE_SOAK_API_KEY',
  ].filter((key) => !process.env[key])
  return {
    mode: 'real-model-manifest',
    invokedAt: new Date().toISOString(),
    realModelCalled: false,
    ready: missingEnv.length === 0,
    missingEnv,
    thresholds: buildThresholds(options),
    requiredEnv: {
      NOVELFORGE_SOAK_PROVIDER: 'Model provider name for the manual/nightly run.',
      NOVELFORGE_SOAK_MODEL: 'Model id used by the app model config.',
      NOVELFORGE_SOAK_API_KEY: 'API key for the selected provider.',
      NOVELFORGE_SOAK_BASE_URL: 'Optional custom endpoint.',
      NOVELFORGE_SOAK_COST_LIMIT_USD: 'Recommended guardrail for manual runs.',
    },
    nextStep: missingEnv.length === 0
      ? 'Run the app/Electron chapter batch generation, export metrics JSON, then validate it with --report=<path>.'
      : 'Set the missing environment variables or run default dry-run/report validation instead.',
  }
}

function writeReport(outPath, report) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`)
}

function printReport(report, jsonOnly) {
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  if (report.status === 'fail') {
    console.error(`chapter soak failed: ${report.failures.join('; ')}`)
    return
  }
  if (report.mode === 'real-model-manifest') {
    console.log(report.ready
      ? 'chapter soak real-mode manifest is ready; validate an exported run with --report=<path>.'
      : `chapter soak real-mode is not ready; missing ${report.missingEnv.join(', ')}.`)
    return
  }
  console.log(`chapter soak ${report.mode} passed.`)
  if (report.checks) {
    report.checks.forEach((check) => console.log(`PASS ${check.name}`))
  }
  console.log(`report: ${path.relative(process.cwd(), report.outputPath || '') || '.tmp-tests/chapter-soak-report.json'}`)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  let report
  if (options.reportPath) {
    report = validateRealReport(readReport(options.reportPath), buildThresholds(options))
  } else if (options.realModel) {
    report = buildRealModeManifest(options)
  } else {
    report = buildDryRunReport(options)
  }
  report.outputPath = options.outPath
  writeReport(options.outPath, report)
  printReport(report, options.json)
  if (report.status === 'fail') process.exitCode = 1
  if (report.mode === 'real-model-manifest' && !report.ready) process.exitCode = 2
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
