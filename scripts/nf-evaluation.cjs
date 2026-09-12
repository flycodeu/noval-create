const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Module = require('node:module')
const ts = require('typescript')

const workspaceRoot = path.resolve(__dirname, '..')
const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function resolveTypeScript(request, parent, isMain, options) {
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent?.filename ? path.dirname(parent.filename) : process.cwd()
    for (const extension of ['.ts', '.js', '.json']) {
      const candidate = path.resolve(baseDir, request + extension)
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options)
}

require.extensions['.ts'] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  })
  module._compile(outputText, filename)
}

const metrics = require(path.join(workspaceRoot, 'src/shared/nf-evaluation-metrics.ts'))
const REVIEW_QUESTIONS = ['continuity', 'characterVoice', 'engagement', 'overall']

function parseArgs(argv) {
  const args = { prepare: false, runReal: false, fixture: '', output: '', importResults: '', experimentConfig: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--prepare') args.prepare = true
    else if (value === '--run-real') args.runReal = true
    else if (value === '--fixture') args.fixture = argv[++index] || ''
    else if (value === '--output') args.output = argv[++index] || ''
    else if (value === '--import-results') args.importResults = argv[++index] || ''
    else if (value === '--experiment-config') args.experimentConfig = argv[++index] || ''
    else throw new Error(`NF_EVALUATION_UNKNOWN_ARGUMENT ${value}`)
  }
  if (!args.prepare && !args.runReal && !args.importResults) args.prepare = true
  if (Number(args.prepare) + Number(args.runReal) + Number(Boolean(args.importResults)) !== 1) {
    throw new Error('NF_EVALUATION_MODE_REQUIRED choose exactly one of --prepare, --import-results, or --run-real')
  }
  if (!args.fixture) throw new Error('NF_EVALUATION_FIXTURE_REQUIRED --fixture is required')
  return args
}

function readJson(filename, label) {
  const resolved = path.resolve(filename)
  let raw
  try {
    raw = fs.readFileSync(resolved, 'utf8')
  } catch (error) {
    throw new Error(`${label}_READ_FAILED ${resolved}: ${error.message}`)
  }
  try {
    return { resolved, value: JSON.parse(raw) }
  } catch (error) {
    throw new Error(`${label}_JSON_INVALID ${resolved}: ${error.message}`)
  }
}

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function outputDirectory(args, fixturePath) {
  return path.resolve(args.output || path.join(path.dirname(fixturePath), 'prepared'))
}

function buildBlindMaterials(fixture) {
  const entries = fixture.variants.flatMap((variant) => variant.samples.map((sample) => ({ variant, sample })))
    .sort((left, right) => crypto.createHash('sha256')
      .update(`${fixture.fixtureHash}:${left.variant.variantId}:${left.sample.sampleId}`)
      .digest('hex')
      .localeCompare(crypto.createHash('sha256')
        .update(`${fixture.fixtureHash}:${right.variant.variantId}:${right.sample.sampleId}`)
        .digest('hex')))
  const mapping = []
  const samples = entries.map(({ variant, sample }, index) => {
    const anonymousId = `S${String(index + 1).padStart(3, '0')}`
    mapping.push({ anonymousId, variantId: variant.variantId, sampleId: sample.sampleId, chapterId: sample.chapterId })
    return { anonymousId, chapterNum: sample.chapterNum, content: sample.content, wordCount: sample.wordCount }
  })
  return {
    blind: {
      schemaVersion: 1,
      fixtureHash: fixture.fixtureHash,
      instructions: 'Read each sample independently. Do not infer systems or variants. Score only the supplied text.',
      questions: REVIEW_QUESTIONS,
      samples,
    },
    sheet: {
      schemaVersion: 1,
      fixtureHash: fixture.fixtureHash,
      ratings: samples.map(({ anonymousId }) => ({
        anonymousId,
        scores: { continuity: null, characterVoice: null, engagement: null, overall: null },
        manualEditMinutes: null,
        notes: '',
      })),
    },
    mapping: { schemaVersion: 1, fixtureHash: fixture.fixtureHash, entries: mapping },
  }
}

function validateReviewResults(value, mapping) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !Array.isArray(value.ratings)) {
    throw new Error('NF_EVALUATION_RESULTS_INVALID expected schemaVersion 1 and ratings array')
  }
  if (value.fixtureHash !== mapping.fixtureHash) throw new Error('NF_EVALUATION_RESULTS_INVALID fixtureHash mismatch')
  const allowed = new Set(mapping.entries.map((entry) => entry.anonymousId))
  const seen = new Set()
  return value.ratings.map((rating, index) => {
    if (!rating || typeof rating !== 'object' || !allowed.has(rating.anonymousId) || seen.has(rating.anonymousId)) {
      throw new Error(`NF_EVALUATION_RESULTS_INVALID ratings[${index}].anonymousId`)
    }
    seen.add(rating.anonymousId)
    if (!rating.scores || typeof rating.scores !== 'object' || Array.isArray(rating.scores)
      || Object.keys(rating.scores).some((key) => !REVIEW_QUESTIONS.includes(key))) {
      throw new Error(`NF_EVALUATION_RESULTS_INVALID ratings[${index}].scores`)
    }
    const scores = {}
    for (const key of REVIEW_QUESTIONS) {
      const score = rating.scores[key] ?? null
      if (score !== null && (typeof score !== 'number' || !Number.isFinite(score) || score < 1 || score > 5)) {
        throw new Error(`NF_EVALUATION_RESULTS_INVALID ratings[${index}].scores.${key}`)
      }
      scores[key] = score
    }
    const manualEditMinutes = rating.manualEditMinutes ?? null
    if (manualEditMinutes !== null && (typeof manualEditMinutes !== 'number' || !Number.isFinite(manualEditMinutes) || manualEditMinutes < 0)) {
      throw new Error(`NF_EVALUATION_RESULTS_INVALID ratings[${index}].manualEditMinutes`)
    }
    const entry = mapping.entries.find((entry) => entry.anonymousId === rating.anonymousId)
    return { anonymousId: rating.anonymousId, variantId: entry.variantId, sampleId: entry.sampleId, scores, manualEditMinutes, notes: typeof rating.notes === 'string' ? rating.notes : '' }
  })
}

function validateRealAuthorization(value) {
  const requiredStrings = ['provider', 'modelId', 'subject', 'dataCopyPath', 'approvedBy', 'approvedAt']
  if (!value || typeof value !== 'object' || value.authorized !== true) throw new Error('NF_EVALUATION_REAL_AUTHORIZATION_REQUIRED')
  for (const field of requiredStrings) {
    if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`NF_EVALUATION_REAL_CONFIG_REQUIRED ${field}`)
  }
  if (!Number.isInteger(value.chapterCount) || value.chapterCount <= 0) throw new Error('NF_EVALUATION_REAL_CONFIG_REQUIRED chapterCount')
  const hasRequestLimit = Number.isInteger(value.maxRequests) && value.maxRequests > 0
  const hasCostLimit = typeof value.maxCost === 'number' && Number.isFinite(value.maxCost) && value.maxCost > 0
  if (!hasRequestLimit && !hasCostLimit) throw new Error('NF_EVALUATION_REAL_CONFIG_REQUIRED maxRequests or maxCost')
  if (typeof value.retainText !== 'boolean') throw new Error('NF_EVALUATION_REAL_CONFIG_REQUIRED retainText')
  return {
    authorized: true,
    provider: value.provider,
    modelId: value.modelId,
    subject: value.subject,
    chapterCount: value.chapterCount,
    maxRequests: hasRequestLimit ? value.maxRequests : null,
    maxCost: hasCostLimit ? value.maxCost : null,
    dataCopyPath: path.resolve(value.dataCopyPath),
    retainText: value.retainText,
    approvedBy: value.approvedBy,
    approvedAt: value.approvedAt,
  }
}

function prepare(args, fixture, fixturePath) {
  const output = outputDirectory(args, fixturePath)
  const materials = buildBlindMaterials(fixture)
  writeJson(path.join(output, 'blind-review.json'), materials.blind)
  writeJson(path.join(output, 'review-sheet.json'), materials.sheet)
  writeJson(path.join(output, 'variant-map.json'), materials.mapping)
  writeJson(path.join(output, 'evaluation-report.json'), metrics.aggregateEvaluationFixture(fixture))
  return { mode: 'prepare', output, samples: materials.blind.samples.length, remoteRequests: 0, databaseWrites: 0 }
}

function importResults(args, fixture, fixturePath) {
  const output = outputDirectory(args, fixturePath)
  const mapping = readJson(path.join(output, 'variant-map.json'), 'NF_EVALUATION_MAPPING').value
  const expectedMapping = buildBlindMaterials(fixture).mapping
  if (!mapping || mapping.schemaVersion !== 1 || mapping.fixtureHash !== fixture.fixtureHash
    || JSON.stringify(mapping.entries) !== JSON.stringify(expectedMapping.entries)) throw new Error('NF_EVALUATION_MAPPING_INVALID')
  const results = validateReviewResults(readJson(args.importResults, 'NF_EVALUATION_RESULTS').value, mapping)
  writeJson(path.join(output, 'evaluation-report.json'), metrics.aggregateEvaluationFixture(fixture, results))
  return { mode: 'import-results', output, importedRatings: results.length, remoteRequests: 0, databaseWrites: 0 }
}

function runRealPreflight(args, fixture, fixturePath) {
  if (!args.experimentConfig) throw new Error('NF_EVALUATION_REAL_CONFIG_REQUIRED --experiment-config')
  const authorization = validateRealAuthorization(readJson(args.experimentConfig, 'NF_EVALUATION_REAL_CONFIG').value)
  const output = outputDirectory(args, fixturePath)
  writeJson(path.join(output, 'real-run-authorization.json'), {
    schemaVersion: 1,
    fixtureHash: fixture.fixtureHash,
    ...authorization,
    status: 'authorized_preflight_only',
    remoteRequests: 0,
    note: 'NF-20 owns the bounded real runner. This NF-19 command never starts a provider request.',
  })
  return { mode: 'run-real-preflight', output, remoteRequests: 0, authorization: 'accepted-for-nf20' }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const fixtureFile = readJson(args.fixture, 'NF_EVALUATION_FIXTURE')
  const fixture = metrics.validateEvaluationFixture(fixtureFile.value)
  const result = args.runReal
    ? runRealPreflight(args, fixture, fixtureFile.resolved)
    : args.importResults
      ? importResults(args, fixture, fixtureFile.resolved)
      : prepare(args, fixture, fixtureFile.resolved)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

module.exports = { buildBlindMaterials, main, parseArgs, validateRealAuthorization, validateReviewResults }
