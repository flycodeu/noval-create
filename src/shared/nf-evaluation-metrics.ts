export type EvaluationRequestKind = 'chat' | 'stream' | 'embedding' | 'auth' | 'cli'
export type EvaluationAttemptStatus = 'started' | 'success' | 'failed' | 'cancelled' | 'interrupted'

export interface EvaluationMeasurement {
  value: number | null
  source: 'provider' | 'estimated' | 'unknown'
}

export interface EvaluationUsage {
  input: EvaluationMeasurement
  cachedInput: EvaluationMeasurement
  output: EvaluationMeasurement
  reasoningOutput: EvaluationMeasurement
}

export interface EvaluationPricing {
  currency: string
  inputPerMillion: number | null
  cachedInputPerMillion: number | null
  outputPerMillion: number | null
  reasoningOutputPerMillion: number | null
}

export interface EvaluationAttempt {
  requestId: string
  taskId: number | null
  kind: EvaluationRequestKind
  provider: string
  modelId: string
  attemptIndex: number
  status: EvaluationAttemptStatus
  durationMs: number | null
  usage: EvaluationUsage
  pricing: EvaluationPricing
}

export interface EvaluationSample {
  sampleId: string
  chapterId: number
  chapterNum: number
  content: string
  wordCount: number
  expectedRequiredFactIds: string[]
  recalledRequiredFactIds: string[]
  includedSourceKeys: string[]
  forbiddenSourceKeys: string[]
}

export interface EvaluationVariant {
  variantId: 'A' | 'B' | 'C' | 'D'
  sourceRevision: string
  contractsVersion: string
  promptHash: string
  fixtureHash: string
  model: { provider: string; modelId: string }
  generation: Record<string, string | number | boolean | null>
  outputScope: { chapterIds: number[]; target: string }
  requestIds: string[]
  safetyBaseline: {
    knowledgeFiltering: true
    requiredConstraints: true
    requestBudgeting: true
    requestLedger: true
  }
  strategy: {
    styleRevision: boolean
    optionalContextSelection: boolean
    optionalRelationRecall: boolean
  }
  samples: EvaluationSample[]
}

export interface EvaluationFixture {
  schemaVersion: 1
  fixtureHash: string
  sourceRevision: string
  contractsVersion: string
  createdAt: string
  expectedRequests: Array<{ requestId: string; kind: EvaluationRequestKind }>
  variants: EvaluationVariant[]
  attempts: EvaluationAttempt[]
}

export interface HumanReviewResult {
  anonymousId: string
  variantId?: EvaluationVariant['variantId']
  sampleId?: string
  scores: Record<string, number | null>
  manualEditMinutes: number | null
  notes?: string
}

interface MetricFraction {
  numerator: number
  denominator: number
  value: number | null
}

const REQUEST_KINDS = new Set<EvaluationRequestKind>(['chat', 'stream', 'embedding', 'auth', 'cli'])
const ATTEMPT_STATUSES = new Set<EvaluationAttemptStatus>(['started', 'success', 'failed', 'cancelled', 'interrupted'])
const VARIANT_STRATEGIES: Record<EvaluationVariant['variantId'], EvaluationVariant['strategy']> = {
  A: { styleRevision: false, optionalContextSelection: false, optionalRelationRecall: false },
  B: { styleRevision: true, optionalContextSelection: false, optionalRelationRecall: false },
  C: { styleRevision: false, optionalContextSelection: true, optionalRelationRecall: false },
  D: { styleRevision: false, optionalContextSelection: false, optionalRelationRecall: true },
}

function fail(path: string, message: string): never {
  throw new Error(`NF_EVALUATION_INVALID ${path}: ${message}`)
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object')
  return value as Record<string, unknown>
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected array')
  return value
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'expected non-empty string')
  return value
}

function numberAt(value: unknown, path: string, options: { integer?: boolean; nullable?: boolean } = {}): number | null {
  if (value === null && options.nullable) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(path, 'expected non-negative finite number')
  if (options.integer && !Number.isInteger(value)) fail(path, 'expected integer')
  return value
}

function stringArrayAt(value: unknown, path: string): string[] {
  return arrayAt(value, path).map((entry, index) => stringAt(entry, `${path}[${index}]`))
}

function unique(values: string[], path: string): string[] {
  if (new Set(values).size !== values.length) fail(path, 'duplicate value')
  return values
}

function measurementAt(value: unknown, path: string): EvaluationMeasurement {
  const input = objectAt(value, path)
  const source = input.source
  if (!['provider', 'estimated', 'unknown'].includes(String(source))) fail(`${path}.source`, 'unsupported source')
  const measuredValue = numberAt(input.value, `${path}.value`, { nullable: true })
  if (source === 'unknown' && measuredValue !== null) fail(path, 'unknown source must have null value')
  return { value: measuredValue, source: source as EvaluationMeasurement['source'] }
}

function sampleAt(value: unknown, path: string): EvaluationSample {
  const input = objectAt(value, path)
  const chapterId = numberAt(input.chapterId, `${path}.chapterId`, { integer: true })
  const chapterNum = numberAt(input.chapterNum, `${path}.chapterNum`, { integer: true })
  if (!chapterId || !chapterNum) fail(path, 'chapterId and chapterNum must be positive')
  return {
    sampleId: stringAt(input.sampleId, `${path}.sampleId`),
    chapterId,
    chapterNum,
    content: stringAt(input.content, `${path}.content`),
    wordCount: numberAt(input.wordCount, `${path}.wordCount`, { integer: true }) as number,
    expectedRequiredFactIds: unique(stringArrayAt(input.expectedRequiredFactIds, `${path}.expectedRequiredFactIds`), `${path}.expectedRequiredFactIds`),
    recalledRequiredFactIds: unique(stringArrayAt(input.recalledRequiredFactIds, `${path}.recalledRequiredFactIds`), `${path}.recalledRequiredFactIds`),
    includedSourceKeys: stringArrayAt(input.includedSourceKeys, `${path}.includedSourceKeys`),
    forbiddenSourceKeys: unique(stringArrayAt(input.forbiddenSourceKeys, `${path}.forbiddenSourceKeys`), `${path}.forbiddenSourceKeys`),
  }
}

function attemptAt(value: unknown, path: string): EvaluationAttempt {
  const input = objectAt(value, path)
  const kind = stringAt(input.kind, `${path}.kind`) as EvaluationRequestKind
  const status = stringAt(input.status, `${path}.status`) as EvaluationAttemptStatus
  if (!REQUEST_KINDS.has(kind)) fail(`${path}.kind`, 'unsupported request kind')
  if (!ATTEMPT_STATUSES.has(status)) fail(`${path}.status`, 'unsupported attempt status')
  const usage = objectAt(input.usage, `${path}.usage`)
  const pricing = objectAt(input.pricing, `${path}.pricing`)
  const taskId = numberAt(input.taskId, `${path}.taskId`, { integer: true, nullable: true })
  const attemptIndex = numberAt(input.attemptIndex, `${path}.attemptIndex`, { integer: true })
  if (!attemptIndex) fail(`${path}.attemptIndex`, 'must be positive')
  return {
    requestId: stringAt(input.requestId, `${path}.requestId`),
    taskId,
    kind,
    provider: stringAt(input.provider, `${path}.provider`),
    modelId: stringAt(input.modelId, `${path}.modelId`),
    attemptIndex,
    status,
    durationMs: numberAt(input.durationMs, `${path}.durationMs`, { nullable: true }),
    usage: {
      input: measurementAt(usage.input, `${path}.usage.input`),
      cachedInput: measurementAt(usage.cachedInput, `${path}.usage.cachedInput`),
      output: measurementAt(usage.output, `${path}.usage.output`),
      reasoningOutput: measurementAt(usage.reasoningOutput, `${path}.usage.reasoningOutput`),
    },
    pricing: {
      currency: stringAt(pricing.currency, `${path}.pricing.currency`),
      inputPerMillion: numberAt(pricing.inputPerMillion, `${path}.pricing.inputPerMillion`, { nullable: true }),
      cachedInputPerMillion: numberAt(pricing.cachedInputPerMillion, `${path}.pricing.cachedInputPerMillion`, { nullable: true }),
      outputPerMillion: numberAt(pricing.outputPerMillion, `${path}.pricing.outputPerMillion`, { nullable: true }),
      reasoningOutputPerMillion: numberAt(pricing.reasoningOutputPerMillion, `${path}.pricing.reasoningOutputPerMillion`, { nullable: true }),
    },
  }
}

function variantAt(value: unknown, path: string): EvaluationVariant {
  const input = objectAt(value, path)
  const variantId = stringAt(input.variantId, `${path}.variantId`) as EvaluationVariant['variantId']
  if (!(variantId in VARIANT_STRATEGIES)) fail(`${path}.variantId`, 'expected A, B, C, or D')
  const safety = objectAt(input.safetyBaseline, `${path}.safetyBaseline`)
  for (const field of ['knowledgeFiltering', 'requiredConstraints', 'requestBudgeting', 'requestLedger']) {
    if (safety[field] !== true) fail(`${path}.safetyBaseline.${field}`, 'must remain true for every variant')
  }
  const strategy = objectAt(input.strategy, `${path}.strategy`)
  for (const field of Object.keys(VARIANT_STRATEGIES.A)) {
    if (typeof strategy[field] !== 'boolean') fail(`${path}.strategy.${field}`, 'expected explicit boolean')
  }
  const normalizedStrategy = {
    styleRevision: strategy.styleRevision === true,
    optionalContextSelection: strategy.optionalContextSelection === true,
    optionalRelationRecall: strategy.optionalRelationRecall === true,
  }
  if (JSON.stringify(normalizedStrategy) !== JSON.stringify(VARIANT_STRATEGIES[variantId])) {
    fail(`${path}.strategy`, `does not match controlled variant ${variantId}`)
  }
  const model = objectAt(input.model, `${path}.model`)
  const outputScope = objectAt(input.outputScope, `${path}.outputScope`)
  const generation = objectAt(input.generation, `${path}.generation`)
  for (const [key, entry] of Object.entries(generation)) {
    if (entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)) fail(`${path}.generation.${key}`, 'expected scalar')
    if (typeof entry === 'number' && !Number.isFinite(entry)) fail(`${path}.generation.${key}`, 'expected finite number')
  }
  const chapterIds = arrayAt(outputScope.chapterIds, `${path}.outputScope.chapterIds`).map((entry, index) => {
    const id = numberAt(entry, `${path}.outputScope.chapterIds[${index}]`, { integer: true })
    if (!id) fail(`${path}.outputScope.chapterIds[${index}]`, 'must be positive')
    return id
  })
  const samples = arrayAt(input.samples, `${path}.samples`).map((sample, index) => sampleAt(sample, `${path}.samples[${index}]`))
  unique(samples.map((sample) => sample.sampleId), `${path}.samples.sampleId`)
  for (const sample of samples) {
    if (!chapterIds.includes(sample.chapterId)) fail(`${path}.samples.${sample.sampleId}`, 'chapter outside outputScope')
  }
  return {
    variantId,
    sourceRevision: stringAt(input.sourceRevision, `${path}.sourceRevision`),
    contractsVersion: stringAt(input.contractsVersion, `${path}.contractsVersion`),
    promptHash: stringAt(input.promptHash, `${path}.promptHash`),
    fixtureHash: stringAt(input.fixtureHash, `${path}.fixtureHash`),
    model: {
      provider: stringAt(model.provider, `${path}.model.provider`),
      modelId: stringAt(model.modelId, `${path}.model.modelId`),
    },
    generation: generation as EvaluationVariant['generation'],
    outputScope: { chapterIds, target: stringAt(outputScope.target, `${path}.outputScope.target`) },
    requestIds: unique(stringArrayAt(input.requestIds, `${path}.requestIds`), `${path}.requestIds`),
    safetyBaseline: safety as EvaluationVariant['safetyBaseline'],
    strategy: normalizedStrategy,
    samples,
  }
}

export function validateEvaluationFixture(value: unknown): EvaluationFixture {
  const input = objectAt(value, 'fixture')
  if (input.schemaVersion !== 1) fail('fixture.schemaVersion', 'expected 1')
  const fixtureHash = stringAt(input.fixtureHash, 'fixture.fixtureHash')
  const expectedRequests = arrayAt(input.expectedRequests, 'fixture.expectedRequests').map((value, index) => {
    const request = objectAt(value, `fixture.expectedRequests[${index}]`)
    const kind = stringAt(request.kind, `fixture.expectedRequests[${index}].kind`) as EvaluationRequestKind
    if (!REQUEST_KINDS.has(kind)) fail(`fixture.expectedRequests[${index}].kind`, 'unsupported request kind')
    return { requestId: stringAt(request.requestId, `fixture.expectedRequests[${index}].requestId`), kind }
  })
  unique(expectedRequests.map((request) => request.requestId), 'fixture.expectedRequests.requestId')
  const variants = arrayAt(input.variants, 'fixture.variants').map((variant, index) => variantAt(variant, `fixture.variants[${index}]`))
  const variantIds = variants.map((variant) => variant.variantId)
  if (variantIds.length !== 4 || new Set(variantIds).size !== 4 || !['A', 'B', 'C', 'D'].every((id) => variantIds.includes(id as EvaluationVariant['variantId']))) {
    fail('fixture.variants', 'must contain A, B, C, and D exactly once')
  }
  const expectedIds = new Set(expectedRequests.map((request) => request.requestId))
  const assignedIds = new Set(variants.flatMap((variant) => variant.requestIds))
  for (const request of expectedRequests) {
    if (!assignedIds.has(request.requestId)) fail('fixture.expectedRequests', `unassigned requestId ${request.requestId}`)
  }
  const attempts = arrayAt(input.attempts, 'fixture.attempts').map((attempt, index) => attemptAt(attempt, `fixture.attempts[${index}]`))
  const expectedKinds = new Map(expectedRequests.map((request) => [request.requestId, request.kind]))
  for (const attempt of attempts) {
    if (expectedKinds.get(attempt.requestId) !== attempt.kind) fail(`fixture.attempts.${attempt.requestId}`, 'unlisted request or mismatched kind')
  }
  for (const variant of variants) {
    if (variant.fixtureHash !== fixtureHash) fail(`fixture.variants.${variant.variantId}.fixtureHash`, 'must match fixtureHash')
    for (const requestId of variant.requestIds) {
      if (!expectedIds.has(requestId)) fail(`fixture.variants.${variant.variantId}.requestIds`, `unknown requestId ${requestId}`)
    }
  }
  return {
    schemaVersion: 1,
    fixtureHash,
    sourceRevision: stringAt(input.sourceRevision, 'fixture.sourceRevision'),
    contractsVersion: stringAt(input.contractsVersion, 'fixture.contractsVersion'),
    createdAt: stringAt(input.createdAt, 'fixture.createdAt'),
    expectedRequests,
    variants,
    attempts,
  }
}

export function dedupeEvaluationAttempts(attempts: EvaluationAttempt[]): EvaluationAttempt[] {
  const byRequest = new Map<string, EvaluationAttempt>()
  for (const attempt of attempts) {
    const existing = byRequest.get(attempt.requestId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(attempt)) {
      fail(`attempts.${attempt.requestId}`, 'conflicting duplicate request ledger rows')
    }
    byRequest.set(attempt.requestId, attempt)
  }
  return [...byRequest.values()].sort((left, right) => left.requestId.localeCompare(right.requestId))
}

function fraction(numerator: number, denominator: number): MetricFraction {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : null }
}

export function calculateRetrievalMetrics(samples: EvaluationSample[]) {
  let requiredFound = 0
  let requiredTotal = 0
  let forbiddenIncluded = 0
  let includedTotal = 0
  let duplicateSources = 0
  for (const sample of samples) {
    const expected = new Set(sample.expectedRequiredFactIds)
    requiredTotal += expected.size
    requiredFound += sample.recalledRequiredFactIds.filter((id) => expected.has(id)).length
    const forbidden = new Set(sample.forbiddenSourceKeys)
    includedTotal += sample.includedSourceKeys.length
    forbiddenIncluded += sample.includedSourceKeys.filter((key) => forbidden.has(key)).length
    duplicateSources += sample.includedSourceKeys.length - new Set(sample.includedSourceKeys).size
  }
  return {
    requiredFactRecall: fraction(requiredFound, requiredTotal),
    forbiddenSourceRate: fraction(forbiddenIncluded, includedTotal),
    duplicateSourceKeyRate: fraction(duplicateSources, includedTotal),
  }
}

function isInputPricedEmbedding(attempt: EvaluationAttempt): boolean {
  return attempt.kind === 'embedding' && attempt.pricing.outputPerMillion === null && attempt.pricing.reasoningOutputPerMillion === null
}

function billingMeasurements(attempt: EvaluationAttempt): EvaluationMeasurement[] {
  if (!isInputPricedEmbedding(attempt)) return Object.values(attempt.usage)
  const discounted = attempt.pricing.cachedInputPerMillion !== null && attempt.pricing.cachedInputPerMillion !== attempt.pricing.inputPerMillion
  return discounted ? [attempt.usage.input, attempt.usage.cachedInput] : [attempt.usage.input]
}

function inputEmbeddingCost(attempt: EvaluationAttempt): number | null {
  const { input, cachedInput } = attempt.usage
  const pricing = attempt.pricing
  if (billingMeasurements(attempt).some((value) => value.value === null) || pricing.inputPerMillion === null) return null
  const cached = pricing.cachedInputPerMillion === null ? 0 : cachedInput.value ?? 0
  if (cached > input.value!) return null
  return ((input.value! - cached) * pricing.inputPerMillion + cached * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion)) / 1_000_000
}

function attemptCost(attempt: EvaluationAttempt): number | null {
  if (isInputPricedEmbedding(attempt)) return inputEmbeddingCost(attempt)
  const { usage, pricing } = attempt
  const values = [usage.input.value, usage.cachedInput.value, usage.output.value, usage.reasoningOutput.value]
  if (values.some((value) => value === null)) return null
  const [input, cached, output, reasoning] = values as number[]
  if (cached > input || reasoning > output) return null
  const inputPrice = pricing.inputPerMillion
  const cachedPrice = pricing.cachedInputPerMillion
  const outputPrice = pricing.outputPerMillion
  const reasoningPrice = pricing.reasoningOutputPerMillion
  if ((input - cached > 0 && inputPrice === null)
    || (cached > 0 && cachedPrice === null)
    || (output - reasoning > 0 && outputPrice === null)
    || (reasoning > 0 && reasoningPrice === null)) return null
  return ((input - cached) * (inputPrice ?? 0)
    + cached * (cachedPrice ?? 0)
    + (output - reasoning) * (outputPrice ?? 0)
    + reasoning * (reasoningPrice ?? 0)) / 1_000_000
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function summarizeReviews(reviews: HumanReviewResult[]) {
  const scoreValues = new Map<string, number[]>()
  const editValues: number[] = []
  for (const review of reviews) {
    for (const [key, value] of Object.entries(review.scores)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        const values = scoreValues.get(key) ?? []
        values.push(value)
        scoreValues.set(key, values)
      }
    }
    if (typeof review.manualEditMinutes === 'number' && Number.isFinite(review.manualEditMinutes)) editValues.push(review.manualEditMinutes)
  }
  return {
    scores: Object.fromEntries([...scoreValues].map(([key, values]) => [key, round(values.reduce((sum, value) => sum + value, 0) / values.length)])),
    manualEditMinutes: editValues.length > 0 ? round(editValues.reduce((sum, value) => sum + value, 0) / editValues.length) : null,
    totalManualEditMinutes: editValues.length > 0 ? round(editValues.reduce((sum, value) => sum + value, 0)) : null,
    editTimeSamples: editValues.length,
    reviewedSamples: new Set(reviews.filter((review) => Object.values(review.scores).some((value) => value !== null)).map((review) => review.anonymousId)).size,
  }
}

export function aggregateEvaluationFixture(fixture: EvaluationFixture, reviews: HumanReviewResult[] = []) {
  fixture = validateEvaluationFixture(fixture)
  const deduped = dedupeEvaluationAttempts(fixture.attempts)
  const attemptById = new Map(deduped.map((attempt) => [attempt.requestId, attempt]))
  const expectedById = new Map(fixture.expectedRequests.map((request) => [request.requestId, request]))
  const variants = fixture.variants.map((variant) => {
    const attempts = variant.requestIds.map((requestId) => attemptById.get(requestId)).filter((attempt): attempt is EvaluationAttempt => Boolean(attempt))
    const usageComplete = attempts.filter((attempt) => billingMeasurements(attempt).every((entry) => entry.value !== null))
    const costs = attempts.map(attemptCost)
    const requestsComplete = variant.requestIds.length > 0 && attempts.length === variant.requestIds.length
    const currency = attempts.length > 0 && new Set(attempts.map((attempt) => attempt.pricing.currency)).size === 1 ? attempts[0].pricing.currency : null
    const costComplete = requestsComplete && currency !== null && costs.every((cost) => cost !== null)
    const estimated = attempts.some((attempt) => billingMeasurements(attempt).some((entry) => entry.source === 'estimated'))
    const totalCost = costComplete ? round((costs as number[]).reduce((sum, cost) => sum + cost, 0)) : null
    const providerCost = estimated ? null : totalCost
    const input = attempts.reduce((sum, attempt) => sum + (attempt.usage.input.value ?? 0), 0)
    const output = attempts.reduce((sum, attempt) => sum + (attempt.usage.output.value ?? 0), 0)
    const inputComplete = requestsComplete && attempts.every((attempt) => attempt.usage.input.value !== null)
    const outputComplete = requestsComplete && attempts.every((attempt) => attempt.usage.output.value !== null)
    const words = variant.samples.reduce((sum, sample) => sum + sample.wordCount, 0)
    const chapters = new Set(variant.samples.map((sample) => sample.chapterId)).size
    const perChapter = (value: number | null) => value !== null && chapters > 0 ? round(value / chapters) : null
    const perTenThousandWords = (value: number | null) => value !== null && words > 0 ? round(value * 10_000 / words) : null
    const latencyTotal = requestsComplete && attempts.every((attempt) => attempt.durationMs !== null)
      ? attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0) : null
    const variantReviews = reviews.filter((review) => review.variantId === variant.variantId)
    const humanReview = summarizeReviews(variantReviews)
    const editTotal = variant.samples.length > 0 && humanReview.editTimeSamples === variant.samples.length ? humanReview.totalManualEditMinutes : null
    const kinds = [...new Set(variant.requestIds.map((requestId) => expectedById.get(requestId)?.kind).filter(Boolean))] as EvaluationRequestKind[]
    return {
      variantId: variant.variantId,
      samples: variant.samples.length,
      chapters,
      words,
      requests: {
        expected: variant.requestIds.length,
        ledgerRows: attempts.length,
        usageComplete: usageComplete.length,
        pricingComplete: costs.filter((cost) => cost !== null).length,
        retries: null,
        retryMeasurement: 'unavailable: attemptIndex orders task requests; it does not identify retries',
        attemptsAfterFirstInTask: attempts.filter((attempt) => attempt.attemptIndex > 1).length,
        statuses: Object.fromEntries([...ATTEMPT_STATUSES].map((status) => [status, attempts.filter((attempt) => attempt.status === status).length])),
        kinds: Object.fromEntries(kinds.map((kind) => {
          const expected = variant.requestIds.filter((requestId) => expectedById.get(requestId)?.kind === kind).length
          const present = attempts.filter((attempt) => attempt.kind === kind).length
          return [kind, { expected, present, complete: expected === present }]
        })),
      },
      usage: {
        inputTokens: inputComplete ? input : null,
        outputTokens: outputComplete ? output : null,
        knownInputTokens: input,
        knownOutputTokens: output,
        estimatedRequests: attempts.filter((attempt) => Object.values(attempt.usage).some((entry) => entry.source === 'estimated')).length,
        perChapter: inputComplete && outputComplete ? perChapter(input + output) : null,
        perTenThousandWords: inputComplete && outputComplete ? perTenThousandWords(input + output) : null,
      },
      cost: {
        currency,
        total: providerCost,
        estimatedTotal: estimated ? totalCost : null,
        basis: totalCost === null ? 'unknown' : estimated ? 'estimated_usage' : 'provider_usage',
        perChapter: perChapter(providerCost),
        perTenThousandWords: perTenThousandWords(providerCost),
        coverage: fraction(costs.filter((cost) => cost !== null).length, variant.requestIds.length),
      },
      latency: {
        totalMs: latencyTotal,
        perChapterMs: perChapter(latencyTotal),
        perTenThousandWordsMs: perTenThousandWords(latencyTotal),
        knownMs: attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0),
        coverage: fraction(attempts.filter((attempt) => attempt.durationMs !== null).length, variant.requestIds.length),
      },
      retrieval: calculateRetrievalMetrics(variant.samples),
      humanReview: {
        ...humanReview,
        coverage: fraction(humanReview.reviewedSamples, variant.samples.length),
        editTimeCoverage: fraction(humanReview.editTimeSamples, variant.samples.length),
        perChapterEditMinutes: perChapter(editTotal),
        perTenThousandWordsEditMinutes: perTenThousandWords(editTotal),
        samples: variantReviews,
      },
    }
  })
  return {
    schemaVersion: 1,
    fixtureHash: fixture.fixtureHash,
    sourceRevision: fixture.sourceRevision,
    contractsVersion: fixture.contractsVersion,
    generatedFrom: { variants: fixture.variants.length, expectedRequests: fixture.expectedRequests.length, uniqueLedgerRequests: deduped.length },
    variants,
    humanReview: summarizeReviews(reviews),
    limitations: [
      'Null cost means requests, usage, prices or a single currency are unavailable, or usage is estimated (see estimatedTotal).',
      'Retry counts are unavailable from attemptIndex alone; estimated usage is explicitly labeled.',
      'Automated source metrics do not represent human reading preference.',
    ],
  }
}
