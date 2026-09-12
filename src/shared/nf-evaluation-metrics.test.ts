import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  aggregateEvaluationFixture,
  calculateRetrievalMetrics,
  validateEvaluationFixture,
  type EvaluationFixture,
  type EvaluationMeasurement,
} from './nf-evaluation-metrics'

const cli = resolve(process.cwd(), 'scripts/nf-evaluation.cjs')

function measurement(value: number | null): EvaluationMeasurement {
  return { value, source: value === null ? 'unknown' : 'provider' }
}

function createFixture(): EvaluationFixture {
  const ids = ['A', 'B', 'C', 'D'] as const
  const strategies = {
    A: { styleRevision: false, optionalContextSelection: false, optionalRelationRecall: false },
    B: { styleRevision: true, optionalContextSelection: false, optionalRelationRecall: false },
    C: { styleRevision: false, optionalContextSelection: true, optionalRelationRecall: false },
    D: { styleRevision: false, optionalContextSelection: false, optionalRelationRecall: true },
  }
  const expectedRequests = ids.flatMap((id) => [
    { requestId: `${id}-chat`, kind: 'chat' as const },
    { requestId: `${id}-embedding`, kind: 'embedding' as const },
  ])
  const attempts = expectedRequests.map((request, index) => ({
    requestId: request.requestId,
    taskId: index + 1,
    kind: request.kind,
    provider: 'fixture-provider',
    modelId: 'fixture-model',
    attemptIndex: request.kind === 'chat' ? 2 : 1,
    status: 'success' as const,
    durationMs: 100 + index,
    usage: {
      input: measurement(100),
      cachedInput: measurement(40),
      output: measurement(50),
      reasoningOutput: measurement(10),
    },
    pricing: {
      currency: 'USD',
      inputPerMillion: 10,
      cachedInputPerMillion: 2,
      outputPerMillion: 20,
      reasoningOutputPerMillion: 30,
    },
  }))
  return {
    schemaVersion: 1,
    fixtureHash: 'sha256:nf19-fixture',
    sourceRevision: 'eda157d4',
    contractsVersion: 'quality-context-v1',
    createdAt: '2026-09-11T00:00:00.000Z',
    expectedRequests,
    variants: ids.map((variantId, index) => ({
      variantId,
      sourceRevision: 'eda157d4',
      contractsVersion: 'quality-context-v1',
      promptHash: `sha256:prompt-${variantId}`,
      fixtureHash: 'sha256:nf19-fixture',
      model: { provider: 'fixture-provider', modelId: 'fixture-model' },
      generation: { temperature: 0, maxTokens: 512 },
      outputScope: { chapterIds: [901 + index], target: 'chapter-content' },
      requestIds: [`${variantId}-chat`, `${variantId}-embedding`],
      safetyBaseline: {
        knowledgeFiltering: true,
        requiredConstraints: true,
        requestBudgeting: true,
        requestLedger: true,
      },
      strategy: strategies[variantId],
      samples: [{
        sampleId: `sample-${variantId}`,
        chapterId: 901 + index,
        chapterNum: index + 1,
        content: `${variantId} 匿名正文。`,
        wordCount: 1000,
        expectedRequiredFactIds: ['fact:allowed'],
        recalledRequiredFactIds: ['fact:allowed'],
        includedSourceKeys: ['fact:allowed', 'thread:1'],
        forbiddenSourceKeys: ['fact:future'],
      }],
    })),
    attempts,
  }
}

function writeFixture(value: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'nf19-evaluation-'))
  const filename = join(directory, 'fixture.json')
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return { directory, filename }
}

describe('NF-19 offline evaluation', () => {
  it('prices input-only embeddings without inventing output or cached usage', () => {
    const fixture = createFixture()
    for (const attempt of fixture.attempts) {
      if (attempt.kind !== 'embedding') continue
      attempt.usage.cachedInput = measurement(null)
      attempt.usage.output = measurement(null)
      attempt.usage.reasoningOutput = measurement(null)
      attempt.pricing.cachedInputPerMillion = null
      attempt.pricing.outputPerMillion = null
      attempt.pricing.reasoningOutputPerMillion = null
    }
    const report = aggregateEvaluationFixture(fixture)
    expect(report.variants[0].cost.total).toBe(0.00278)
    expect(report.variants[0].cost.coverage.value).toBe(1)
    expect(report.variants[0].usage.outputTokens).toBeNull()
    fixture.attempts[1].usage.input = measurement(null)
    expect(aggregateEvaluationFixture(fixture).variants[0].cost.total).toBeNull()
  })

  it('19-01 prepares anonymous materials and a report with only local file output', () => {
    const { directory, filename } = writeFixture(createFixture())
    const stdout = execFileSync(process.execPath, [cli, '--prepare', '--fixture', filename], { encoding: 'utf8' })
    expect(JSON.parse(stdout)).toMatchObject({ mode: 'prepare', remoteRequests: 0, databaseWrites: 0, samples: 4 })
    const report = JSON.parse(readFileSync(join(directory, 'prepared/evaluation-report.json'), 'utf8'))
    expect(report.generatedFrom).toEqual({ variants: 4, expectedRequests: 8, uniqueLedgerRequests: 8 })
    expect(report.humanReview).toMatchObject({ scores: {}, manualEditMinutes: null, reviewedSamples: 0 })
  })

  it.each([
    ['fixtureHash', (fixture: Record<string, unknown>) => { delete fixture.fixtureHash }],
    ['model', (fixture: Record<string, unknown>) => { delete (fixture.variants as Array<Record<string, unknown>>)[0].model }],
    ['sourceRevision', (fixture: Record<string, unknown>) => { delete (fixture.variants as Array<Record<string, unknown>>)[0].sourceRevision }],
  ])('19-02 rejects missing %s instead of guessing metadata', (_field, mutate) => {
    const fixture = structuredClone(createFixture()) as unknown as Record<string, unknown>
    mutate(fixture)
    expect(() => validateEvaluationFixture(fixture)).toThrow(/NF_EVALUATION_INVALID/)
  })

  it('19-03 counts a request once when parent and child reference the same ledger row', () => {
    const fixture = createFixture()
    fixture.attempts.push(structuredClone(fixture.attempts[0]))
    const report = aggregateEvaluationFixture(fixture)
    expect(report.generatedFrom.uniqueLedgerRequests).toBe(8)
    expect(report.variants[0].requests.ledgerRows).toBe(2)
  })

  it('19-04 leaves total cost null for failed unknown usage and exposes coverage', () => {
    const fixture = createFixture()
    fixture.attempts[0] = {
      ...fixture.attempts[0],
      status: 'failed',
      usage: {
        input: measurement(null), cachedInput: measurement(null), output: measurement(null), reasoningOutput: measurement(null),
      },
    }
    const variant = aggregateEvaluationFixture(fixture).variants[0]
    expect(variant.cost.total).toBeNull()
    expect(variant.cost.coverage).toEqual({ numerator: 1, denominator: 2, value: 0.5 })
    expect(variant.requests.statuses.failed).toBe(1)
  })

  it('19-05 treats cached and reasoning tokens as input/output subsets', () => {
    const report = aggregateEvaluationFixture(createFixture()).variants[0]
    expect(report.usage).toMatchObject({ inputTokens: 200, outputTokens: 100 })
    expect(report.cost.total).toBe(0.00356)
  })

  it('19-06 separates blind text from the variant and model mapping', () => {
    const { directory, filename } = writeFixture(createFixture())
    execFileSync(process.execPath, [cli, '--prepare', '--fixture', filename])
    const blind = readFileSync(join(directory, 'prepared/blind-review.json'), 'utf8')
    const mapping = readFileSync(join(directory, 'prepared/variant-map.json'), 'utf8')
    expect(blind).not.toContain('fixture-provider')
    expect(blind).not.toMatch(/"variantId"/)
    expect(mapping).toMatch(/"variantId": "[ABCD]"/)
  })

  it('19-07 reports null when retrieval metric denominators are zero', () => {
    const metrics = calculateRetrievalMetrics([{
      sampleId: 'empty', chapterId: 1, chapterNum: 1, content: '空样本', wordCount: 0,
      expectedRequiredFactIds: [], recalledRequiredFactIds: [], includedSourceKeys: [], forbiddenSourceKeys: [],
    }])
    expect(metrics.requiredFactRecall.value).toBeNull()
    expect(metrics.forbiddenSourceRate.value).toBeNull()
    expect(metrics.duplicateSourceKeyRate.value).toBeNull()
  })

  it('19-08 rejects --run-real without an explicit experiment configuration', () => {
    const { filename } = writeFixture(createFixture())
    const result = spawnSync(process.execPath, [cli, '--run-real', '--fixture', filename], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('NF_EVALUATION_REAL_CONFIG_REQUIRED --experiment-config')
  })

  it.each(['cachedInputPerMillion', 'reasoningOutputPerMillion'] as const)('19-04 does not guess a missing %s price', (field) => {
    const fixture = createFixture()
    fixture.attempts[0].pricing[field] = null
    const report = aggregateEvaluationFixture(fixture).variants[0]
    expect(report.cost.total).toBeNull()
    expect(report.cost.coverage.value).toBe(0.5)
  })

  it('19-04 keeps mixed currencies and estimated usage out of provider-usage totals', () => {
    const fixture = createFixture()
    fixture.attempts[0].pricing.currency = 'CNY'
    const mixed = aggregateEvaluationFixture(fixture).variants[0]
    expect(mixed.cost).toMatchObject({ currency: null, total: null, estimatedTotal: null })
    fixture.attempts[0].pricing.currency = 'USD'
    fixture.attempts[0].usage.input.source = 'estimated'
    const estimated = aggregateEvaluationFixture(fixture).variants[0]
    expect(estimated.cost).toMatchObject({ total: null, estimatedTotal: 0.00356, basis: 'estimated_usage' })
    expect(estimated.usage.estimatedRequests).toBe(1)
  })

  it('19-04 retains known input/output when optional usage breakdown is unavailable', () => {
    const fixture = createFixture()
    fixture.attempts[0].usage.cachedInput = measurement(null)
    const report = aggregateEvaluationFixture(fixture).variants[0]
    expect(report.usage).toMatchObject({ inputTokens: 200, outputTokens: 100, knownInputTokens: 200 })
    expect(report.cost.total).toBeNull()
  })

  it('19-07 does not report zero cost, usage or latency for a sample with no request measurements', () => {
    const fixture = createFixture()
    fixture.attempts = fixture.attempts.filter((attempt) => !attempt.requestId.startsWith('A-'))
    fixture.expectedRequests = fixture.expectedRequests.filter((request) => !request.requestId.startsWith('A-'))
    fixture.variants[0].requestIds = []
    const report = aggregateEvaluationFixture(fixture).variants[0]
    expect(report.cost.total).toBeNull()
    expect(report.usage.inputTokens).toBeNull()
    expect(report.latency.totalMs).toBeNull()
  })

  it('19-03 does not mislabel a second ordinary task request as a retry', () => {
    const fixture = createFixture()
    fixture.attempts[0].attemptIndex = 2
    expect(aggregateEvaluationFixture(fixture).variants[0].requests.retries).toBeNull()
  })

  it.each([
    ['unlisted attempt', (fixture: EvaluationFixture) => { fixture.attempts[0].requestId = 'not-in-manifest' }],
    ['kind mismatch', (fixture: EvaluationFixture) => { fixture.attempts[0].kind = 'embedding' }],
    ['unassigned request', (fixture: EvaluationFixture) => { fixture.variants[0].requestIds.pop() }],
    ['chapter outside scope', (fixture: EvaluationFixture) => { fixture.variants[0].samples[0].chapterId = 99999 }],
    ['missing strategy', (fixture: EvaluationFixture) => { Reflect.deleteProperty(fixture.variants[0].strategy, 'styleRevision') }],
  ] as const)('19-02 rejects %s rather than silently omitting data', (_label, mutate) => {
    const fixture = createFixture()
    mutate(fixture)
    expect(() => aggregateEvaluationFixture(fixture)).toThrow(/NF_EVALUATION_INVALID/)
  })

  it('19-06 imports reviews into the matching variant and keeps an empty sheet unreviewed', () => {
    const { directory, filename } = writeFixture(createFixture())
    execFileSync(process.execPath, [cli, '--fixture', filename])
    const output = join(directory, 'prepared')
    const sheetPath = join(output, 'review-sheet.json')
    const runImport = () => execFileSync(process.execPath, [cli, '--fixture', filename, '--import-results', sheetPath])
    runImport()
    expect(JSON.parse(readFileSync(join(output, 'evaluation-report.json'), 'utf8')).humanReview.reviewedSamples).toBe(0)
    const mapping = JSON.parse(readFileSync(join(output, 'variant-map.json'), 'utf8'))
    const sheet = JSON.parse(readFileSync(sheetPath, 'utf8'))
    for (const rating of sheet.ratings) {
      const entry = mapping.entries.find((entry: { anonymousId: string }) => entry.anonymousId === rating.anonymousId)
      rating.scores.overall = entry.variantId === 'A' ? 5 : 1
      rating.manualEditMinutes = entry.variantId === 'A' ? 3 : null
    }
    writeFileSync(sheetPath, JSON.stringify(sheet), 'utf8')
    runImport()
    const report = JSON.parse(readFileSync(join(output, 'evaluation-report.json'), 'utf8'))
    expect(report.variants[0].humanReview).toMatchObject({ scores: { overall: 5 }, reviewedSamples: 1, perChapterEditMinutes: 3, perTenThousandWordsEditMinutes: 30 })
    expect(report.variants[1].humanReview).toMatchObject({ scores: { overall: 1 }, manualEditMinutes: null })
    expect(report.variants[0].cost.perTenThousandWords).toBe(0.0356)
  })

  it.each(['fixtureHash', 'mapping', 'dimension'] as const)('19-06 rejects mismatched %s without overwriting the report', (invalidField) => {
    const { directory, filename } = writeFixture(createFixture())
    execFileSync(process.execPath, [cli, '--fixture', filename])
    const output = join(directory, 'prepared')
    const sheetPath = join(output, 'review-sheet.json')
    const mappingPath = join(output, 'variant-map.json')
    const reportPath = join(output, 'evaluation-report.json')
    const before = readFileSync(reportPath, 'utf8')
    const sheet = JSON.parse(readFileSync(sheetPath, 'utf8'))
    if (invalidField === 'fixtureHash') sheet.fixtureHash = 'another-experiment'
    if (invalidField === 'dimension') sheet.ratings[0].scores.modelPreference = 5
    if (invalidField === 'mapping') {
      const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'))
      mapping.entries[0].variantId = 'unknown'
      writeFileSync(mappingPath, JSON.stringify(mapping), 'utf8')
    }
    writeFileSync(sheetPath, JSON.stringify(sheet), 'utf8')
    const result = spawnSync(process.execPath, [cli, '--fixture', filename, '--import-results', sheetPath], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/NF_EVALUATION_(RESULTS|MAPPING)_INVALID/)
    expect(readFileSync(reportPath, 'utf8')).toBe(before)
  })
})
