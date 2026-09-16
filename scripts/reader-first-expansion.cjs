// RF-16 evidence preparation/import only. Never opens production data or calls a provider.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { expansionGroups } = require('./reader-first-fixtures.cjs')
const stable = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)
const digest = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex')
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

function createPlan(config = {}, source = {}) {
  const conditions = {
    provider: config.provider || null, model: config.model || null,
    parameters: config.parameters || null, modelSnapshotDigest: config.modelSnapshotDigest || null,
    maxCalls: config.maxCalls ?? null, maxTokens: config.maxTokens ?? null,
    maxCost: config.maxCost ?? null, revisionBudget: config.revisionBudget ?? null,
    overrideDigest: config.overrideDigest || null, styleSourceDigest: config.styleSourceDigest || null,
    policies: config.policies || { legacy: { version: 'legacy', revision: '0' }, readerFirst: { version: 'reader-first-v1', revision: '1' } },
  }
  const missing = Object.entries(conditions).filter(([, value]) => value === null).map(([key]) => key)
  for (const key of ['maxCalls', 'maxTokens', 'maxCost', 'revisionBudget']) {
    if (conditions[key] !== null) requireValue(Number.isFinite(conditions[key]) && conditions[key] >= 0, `Invalid ${key}`)
  }
  requireValue(conditions.policies.legacy?.version === 'legacy' && conditions.policies.readerFirst?.version === 'reader-first-v1', 'Both fixed policies required')
  const conditionDigest = digest({ conditions, groups: expansionGroups, source })
  const experimentId = `rf16-${conditionDigest.slice(0, 20)}`
  const slots = expansionGroups.flatMap((group) => ['legacy', 'readerFirst'].flatMap((arm) => group.chapters.map((scene, index) => ({
    id: `${group.id}/${arm}/${index + 1}`, group: group.id, genre: group.genre, arm, chapter: index + 1,
    scene, facts: group.facts, voice: group.voice, targetReader: group.reader,
    factsDigest: digest({ facts: group.facts, voice: group.voice, chapters: group.chapters }),
    policy: conditions.policies[arm],
  }))))
  return { schemaVersion: 1, experimentId, conditionDigest, conditions, source, missing, ready: missing.length === 0,
    expectedChapters: 36, rf11Credit: 'Only matching real-model attempts with original provenance can count; loopback samples count zero.', slots }
}

function analyze(plan, attempts = [], feedback = [], blindKey = crypto.randomBytes(32).toString('hex')) {
  const expected = createPlan(plan.conditions, plan.source)
  requireValue(digest(expected) === digest(plan), 'Manifest changed: create a new experiment')
  requireValue(Array.isArray(attempts) && Array.isArray(feedback), 'Attempts/feedback must be arrays')
  requireValue(!attempts.length || plan.ready, 'Configure fixed model, source identities and budgets before importing results')
  const ids = new Set()
  let tokens = 0; let cost = 0
  const normalized = []
  const ledger = attempts.map((attempt) => {
    const slot = plan.slots.find((item) => item.id === attempt.slotId)
    requireValue(slot && attempt.experimentId === plan.experimentId && attempt.conditionDigest === plan.conditionDigest, 'Mixed input/policy/model identity; keep separate experiments')
    requireValue(typeof attempt.id === 'string' && attempt.id && !ids.has(attempt.id), 'Duplicate/missing attempt id')
    requireValue(['first', 'final'].includes(attempt.stage), 'First/final must be separate')
    requireValue(['success', 'failed', 'empty', 'over_budget'].includes(attempt.status), 'Invalid status')
    requireValue(attempt.inputDigest && attempt.rawRequestPath && attempt.rawResponsePath && attempt.finishedAt
      && Number.isFinite(attempt.durationMs) && typeof attempt.finishReason === 'string', 'Missing raw request/response or runtime evidence')
    requireValue(attempt.provenance?.kind === 'real_model' && attempt.provenance.runId, 'Loopback/development samples cannot count as real prose')
    requireValue(Array.isArray(attempt.authorEdits), 'Author edits must be retained, including an empty list')
    requireValue(Number.isFinite(attempt.tokens) && attempt.tokens >= 0 && Number.isFinite(attempt.cost) && attempt.cost >= 0, 'Missing actual token/cost accounting')
    const earlier = attempts.slice(0, attempts.indexOf(attempt))
    if (attempt.retryOf) requireValue(earlier.some((item) => item.id === attempt.retryOf && item.slotId === attempt.slotId && item.stage === attempt.stage), 'Retry must reference earlier same-slot attempt')
    if (attempt.stage === 'first') {
      requireValue(attempt.authorEdits.length === 0, 'Edited text is not a first draft')
      requireValue(!earlier.some((item) => item.slotId === attempt.slotId && item.stage === 'first') || attempt.retryOf, 'Repeated first draft requires retry provenance')
    } else {
      requireValue(earlier.some((item) => item.id === attempt.parentAttemptId && item.slotId === attempt.slotId), 'Final requires its preceding draft')
    }
    if (slot.chapter > 1) requireValue(normalized.some((item) => item.id === attempt.previousChapterAttemptId
      && item.slotId === `${slot.group}/${slot.arm}/${slot.chapter - 1}` && item.status === 'success'), 'Missing continuous preceding chapter identity')
    ids.add(attempt.id); tokens += attempt.tokens; cost += attempt.cost
    const over = ids.size > plan.conditions.maxCalls || tokens > plan.conditions.maxTokens || cost > plan.conditions.maxCost
    const revisions = earlier.filter((item) => item.slotId === attempt.slotId && item.stage === 'final').length
    const status = over || (attempt.stage === 'final' && revisions >= plan.conditions.revisionBudget) ? 'over_budget'
      : !attempt.text?.trim() && attempt.status === 'success' ? 'empty' : attempt.status
    const recorded = { ...attempt, status, outputDigest: digest(attempt.text || '') }
    normalized.push(recorded)
    return recorded
  })
  // Unsuccessful first attempts never disappear behind successful retries.
  const first = (slot) => ledger.find((item) => item.slotId === slot && item.stage === 'first')
  const final = (slot) => ledger.filter((item) => item.slotId === slot && item.stage === 'final').at(-1)
  const blind = []; const key = []
  for (const group of expansionGroups) for (const stage of ['first', 'final']) {
    const get = stage === 'first' ? first : final
    const arms = ['legacy', 'readerFirst'].map((arm) => [1, 2, 3].map((chapter) => get(`${group.id}/${arm}/${chapter}`)))
    if (!arms.every((chapters) => chapters.every((item) => item?.status === 'success'))) continue
    const mask = crypto.createHmac('sha256', blindKey).update(`${plan.experimentId}/${group.id}/${stage}/${digest(arms.map((chapters) => chapters.map((item) => item.outputDigest)))}`).digest('hex')
    const reverse = parseInt(mask.slice(0, 2), 16) % 2 === 1
    const order = reverse ? [1, 0] : [0, 1]
    const id = mask.slice(0, 16)
    blind.push({ id, genre: group.genre, targetReader: group.reader,
      A: arms[order[0]].map((item) => item.text), B: arms[order[1]].map((item) => item.text) })
    key.push({ id, group: group.id, stage, A: order[0] === 0 ? 'legacy' : 'readerFirst',
      attempts: arms.map((chapters) => chapters.map((item) => item.id)) })
  }
  const reviewIds = new Set()
  const readerSamples = new Set()
  for (const item of feedback) {
    const sample = blind.find((sample) => sample.id === item.sampleId)
    requireValue(item.id && !reviewIds.has(item.id), 'Duplicate feedback identity')
    reviewIds.add(item.id)
    requireValue(sample && item.readerId && item.genre === sample.genre && ['reader', 'author'].includes(item.role), 'Feedback must identify sample, target genre and role')
    requireValue(['A', 'B', 'both_bad', 'both_good', 'undecided'].includes(item.choice), 'Both-bad and both-good choices must remain valid')
    requireValue(['active', 'revoked'].includes(item.status) && item.scope === 'sample', 'Feedback scope/status required; never infer global preferences')
    const readerSample = `${item.readerId}/${item.role}/${item.sampleId}`
    if (item.status === 'active') {
      requireValue(!readerSamples.has(readerSample), 'One active response per reader and sample')
      readerSamples.add(readerSample)
    }
    for (const field of ['continueA', 'continueB', 'earliestStopA', 'earliestStopB', 'characterIntent', 'characterMemory', 'mechanicalNote', 'rawOpinion']) {
      requireValue(typeof item[field] === 'string', `Missing raw feedback: ${field}`)
    }
  }
  const feedbackCounts = expansionGroups.map((group) => ({ group: group.id, genre: group.genre,
    stages: ['first', 'final'].map((stage) => {
      const sample = key.find((item) => item.group === group.id && item.stage === stage)
      const rows = feedback.filter((item) => item.sampleId === sample?.id && item.status === 'active')
      return { stage, readers: new Set(rows.filter((item) => item.role === 'reader').map((item) => item.readerId)).size,
        authors: rows.filter((item) => item.role === 'author').length,
        choices: Object.fromEntries(['A', 'B', 'both_bad', 'both_good', 'undecided'].map((choice) => [choice, rows.filter((item) => item.role === 'reader' && item.choice === choice).length])) }
    }) }))
  const coverage = plan.slots.map((slot) => ({ slotId: slot.id, first: first(slot.id)?.status || 'missing', final: final(slot.id)?.status || 'missing', attempts: ledger.filter((item) => item.slotId === slot.id).length }))
  return { experimentId: plan.experimentId, coverage, ledger, blind, privateKey: key, feedback,
    feedbackCounts, usage: { calls: attempts.length, tokens, cost },
    realModelChapters: coverage.filter((item) => item.first === 'success').length,
    reusedRF11Attempts: ledger.filter((item) => item.provenance.sourceCard === 'RF-11').map((item) => item.id),
    engineering: 'Import validation only', provenanceVerification: 'Declared provenance and immutable raw file hashes; independently review provider execution before crediting samples',
    literaryAcceptance: 'UNVERIFIED: human review of facts, voice and raw opinions required',
    missingReaders: feedbackCounts.flatMap((group) => group.stages.filter((stage) => stage.readers < 3).map((stage) => `${group.group}/${stage.stage}`)) }
}

function runExpansion({ root, identity, configPath, resultsPath, feedbackPath }) {
  const read = (file, fallback) => file ? JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) : fallback
  const plan = createPlan(read(configPath, {}), identity)
  // Reusing the same experiment gives stable blinded identities; never place this key in reader material.
  const output = path.join(root, 'docs/implementation/reader-first-v1/evidence/RF-16', plan.experimentId)
  fs.mkdirSync(output, { recursive: true })
  const keyPath = path.join(output, 'private-blind-key.txt')
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('hex'), { flag: 'wx' })
  const run = path.join(output, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`)
  fs.mkdirSync(run)
  fs.writeFileSync(path.join(run, 'manifest.json'), JSON.stringify(plan, null, 2))
  const incoming = { attempts: read(resultsPath, []), feedback: read(feedbackPath, []) }
  // Preserve even rejected imports. Earlier failures cannot be omitted by a later import.
  fs.writeFileSync(path.join(run, 'import-original.json'), JSON.stringify(incoming, null, 2))
  const statePath = path.join(output, 'ledger-private.json')
  const previous = fs.existsSync(statePath) ? read(statePath) : { attempts: [], feedback: [] }
  const merge = (old, next, revocable = false) => {
    const all = new Map(old.map((item) => [item.id, item]))
    for (const item of next) {
      const prior = all.get(item.id)
      if (prior) requireValue(digest(prior) === digest(item)
        || (revocable && prior.status === 'active' && item.status === 'revoked' && digest({ ...prior, status: 'revoked' }) === digest(item)), 'Evidence is immutable; use new attempt ids, or explicit feedback revocation')
      all.set(item.id, item)
    }
    return [...all.values()]
  }
  try {
    const attempts = merge(previous.attempts, incoming.attempts)
    const feedback = merge(previous.feedback, incoming.feedback, true)
    for (const attempt of attempts) for (const field of ['rawRequestPath', 'rawResponsePath']) {
      requireValue(typeof attempt[field] === 'string' && fs.statSync(path.resolve(attempt[field])).isFile(), `Missing evidence file: ${field}`)
      const actual = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(attempt[field]))).digest('hex')
      requireValue(attempt[`${field}Sha256`] === actual, `Raw evidence changed: ${field}`)
    }
    const report = analyze(plan, attempts, feedback, fs.readFileSync(keyPath, 'utf8'))
    fs.writeFileSync(statePath, JSON.stringify({ attempts, feedback }, null, 2))
  fs.writeFileSync(path.join(run, 'report-private.json'), JSON.stringify(report, null, 2))
  fs.mkdirSync(path.join(run, 'blind'))
  fs.writeFileSync(path.join(run, 'blind/samples.json'), JSON.stringify(report.blind, null, 2))
  fs.writeFileSync(path.join(run, 'blind/response-template.json'), JSON.stringify({ id: 'unique-response-id', readerId: 'anonymous-reader-id', role: 'reader', genre: '', sampleId: '', choice: 'undecided', scope: 'sample', status: 'active', continueA: '', continueB: '', earliestStopA: '', earliestStopB: '', characterIntent: '', characterMemory: '', mechanicalNote: '', rawOpinion: '' }, null, 2))
  console.log(JSON.stringify({ output: run, ready: plan.ready, missingConfiguration: plan.missing, realModelChapters: report.realModelChapters, missingSlots: report.coverage.filter((item) => item.first === 'missing').length, readerStatus: 'UNVERIFIED', modelCalls: 0 }))
  } catch (error) {
    fs.writeFileSync(path.join(run, 'rejected.json'), JSON.stringify({ status: 'REJECTED', message: error.message }, null, 2))
    throw error
  }
}
module.exports = { createPlan, analyze, runExpansion }
