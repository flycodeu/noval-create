const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPlan, analyze } = require('./reader-first-expansion.cjs')
const config = { provider: 'test-only', model: 'test-only', parameters: { temperature: 0.7 }, modelSnapshotDigest: 'fixed-test', maxCalls: 100, maxTokens: 10000, maxCost: 10, revisionBudget: 2, overrideDigest: 'none', styleSourceDigest: 'none' }
const plan = createPlan(config, { digest: 'unit-fixture' })
const attempt = (id, slotId, extra = {}) => ({ id, slotId, experimentId: plan.experimentId, conditionDigest: plan.conditionDigest,
  stage: 'first', status: 'success', inputDigest: 'test-input', rawRequestPath: 'test-only/request.json', rawResponsePath: 'test-only/response.json', finishedAt: '2026-09-16', durationMs: 1, finishReason: 'stop', provenance: { kind: 'real_model', runId: 'unit-test-schema-only' }, authorEdits: [], tokens: 10, cost: 0, text: '仅用于验证导入约束的测试字符串', ...extra })

test('36 distinct slots, matched facts, distinct genres and no fabricated evidence', () => {
  const pending = createPlan()
  assert.equal(pending.ready, false)
  assert.equal(pending.slots.length, 36)
  assert.equal(new Set(pending.slots.map((slot) => slot.id)).size, 36)
  for (const slot of plan.slots) {
    const pair = plan.slots.find((item) => item.group === slot.group && item.chapter === slot.chapter && item.arm !== slot.arm)
    assert.equal(slot.factsDigest, pair.factsDigest)
  }
  const report = analyze(pending)
  assert.equal(report.realModelChapters, 0)
  assert.equal(report.blind.length, 0)
  assert.equal(report.coverage.filter((item) => item.first === 'missing').length, 36)
})
test('changed conditions produce separate experiments and reject mixed attempts', () => {
  const next = createPlan({ ...config, model: 'changed' }, plan.source)
  assert.notEqual(next.experimentId, plan.experimentId)
  assert.throws(() => analyze(next, [attempt('1', 'mystery-1/legacy/1')]), /identity/)
  assert.throws(() => analyze({ ...plan, conditions: { ...plan.conditions, maxCost: 1000 } }), /Manifest changed/)
})
test('failed original first draft survives a successful retry and final rewrite', () => {
  const rows = [attempt('1', 'mystery-1/legacy/1', { status: 'failed', text: '' }),
    attempt('2', 'mystery-1/legacy/1', { retryOf: '1' }),
    attempt('3', 'mystery-1/legacy/1', { stage: 'final', parentAttemptId: '2', authorEdits: ['删去重复解释'] })]
  const result = analyze(plan, rows)
  assert.equal(result.coverage[0].first, 'failed')
  assert.equal(result.coverage[0].final, 'success')
  assert.equal(result.coverage[0].attempts, 3)
  assert.equal(result.usage.calls, 3)
})
test('empty, budget exhaustion and absent replies remain visible', () => {
  const rows = [attempt('1', 'mystery-1/legacy/1', { text: '' }), attempt('2', 'mystery-1/readerFirst/1', { tokens: 20000 })]
  const result = analyze(plan, rows)
  assert.equal(result.coverage[0].first, 'empty')
  assert.equal(result.coverage[3].first, 'over_budget')
  assert.equal(result.missingReaders.length, 12)
})
test('rejects loopback credit, duplicate attempts, edited first drafts and broken chapter chain', () => {
  const row = attempt('1', 'mystery-1/legacy/1')
  assert.throws(() => analyze(plan, [row, row]), /Duplicate/)
  assert.throws(() => analyze(plan, [{ ...row, provenance: { kind: 'loopback' } }]), /Loopback/)
  assert.throws(() => analyze(plan, [{ ...row, authorEdits: ['edit'] }]), /first draft/)
  assert.throws(() => analyze(plan, [attempt('2', 'mystery-1/legacy/2')]), /preceding chapter/)
})
test('blind materials hide arms; both-bad, authors and revocations remain separate', () => {
  const rows = ['legacy', 'readerFirst'].flatMap((arm) => [1, 2, 3].map((chapter) => attempt(`${arm}-${chapter}`, `mystery-1/${arm}/${chapter}`, { previousChapterAttemptId: chapter > 1 ? `${arm}-${chapter - 1}` : undefined })))
  const sample = analyze(plan, rows, [], 'fixed-test-key').blind[0]
  assert.equal(JSON.stringify(sample).includes('legacy'), false)
  const review = { id: 'r1', readerId: 'reader-1', role: 'reader', genre: '现实悬疑', sampleId: sample.id, choice: 'both_bad', scope: 'sample', status: 'active', continueA: '否', continueB: '否', earliestStopA: '第一段', earliestStopB: '第二段', characterIntent: '不清楚', characterMemory: '无', mechanicalNote: '重复', rawOpinion: '两版都不想继续' }
  const report = analyze(plan, rows, [review, { ...review, id: 'a1', role: 'author', choice: 'A' }, { ...review, id: 'r2', readerId: 'reader-2', status: 'revoked' }], 'fixed-test-key')
  assert.equal(report.feedback.length, 3)
  assert.equal(report.feedbackCounts[0].stages[0].readers, 1)
  assert.equal(report.feedbackCounts[0].stages[0].authors, 1)
  assert.equal(report.feedbackCounts[0].stages[0].choices.both_bad, 1)
  assert.match(report.literaryAcceptance, /UNVERIFIED/)
})

test('CLI import keeps omitted failures and rejects changed raw evidence without losing the rejected input', () => {
  const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os'); const crypto = require('node:crypto')
  const { runExpansion } = require('./reader-first-expansion.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf16-import-test-'))
  const configPath = path.join(root, 'config.json'); const resultsPath = path.join(root, 'results.json')
  const request = path.join(root, 'request.json'); const response = path.join(root, 'response.json')
  fs.writeFileSync(configPath, JSON.stringify(config))
  fs.writeFileSync(request, JSON.stringify({ messages: [] }))
  fs.writeFileSync(response, JSON.stringify({ error: 'synthetic fixture failure' }))
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const row = attempt('preserved-failure', 'mystery-1/legacy/1', { status: 'failed', text: '',
    rawRequestPath: request, rawResponsePath: response, rawRequestPathSha256: sha(request), rawResponsePathSha256: sha(response) })
  fs.writeFileSync(resultsPath, JSON.stringify([row]))
  const options = { root, identity: plan.source, configPath, resultsPath }
  runExpansion(options)
  fs.writeFileSync(resultsPath, '[]')
  runExpansion(options)
  const output = path.join(root, 'docs/implementation/reader-first-v1/evidence/RF-16', plan.experimentId)
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'ledger-private.json'))).attempts.length, 1)
  fs.writeFileSync(resultsPath, JSON.stringify([{ ...row, status: 'success', text: 'rewritten' }]))
  assert.throws(() => runExpansion(options), /immutable/)
  fs.writeFileSync(resultsPath, '[]'); fs.writeFileSync(response, 'changed')
  assert.throws(() => runExpansion(options), /Raw evidence changed/)
  const rejected = fs.readdirSync(output, { withFileTypes: true }).filter((item) => item.isDirectory() && fs.existsSync(path.join(output, item.name, 'rejected.json')))
  assert.equal(rejected.length, 2)
  assert.ok(rejected.every((item) => fs.existsSync(path.join(output, item.name, 'import-original.json'))))
})
