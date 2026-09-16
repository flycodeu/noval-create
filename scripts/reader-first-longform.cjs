// RF-17 preparation only. This never generates prose or promotes declarations to evidence.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { buildThresholds, parseArgs } = require('./chapter-soak.cjs')

function prepareLongform({ root, identity }) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`
  const output = path.join(root, 'docs/implementation/reader-first-v1/evidence/RF-17', runId)
  const manifest = {
    schemaVersion: 1, runId, source: identity, mode: 'preparation-only', modelCalls: 0,
    actualContinuousChapters: 0, actualReaders: 0, ready: false,
    prerequisites: ['Accepted RF-16 short-window work and original model/reader evidence',
      'Fixed provider, model snapshot, parameters, policy, overrides and voice source',
      'Fixed cumulative call/token/cost and revision limits including failures/retries',
      'Isolated userData/database and formal generateChapterContent/resumeChapterPipeline execution'],
    fixedConditions: { shortWindowEvidence: null, novelId: null, provider: null, modelSnapshotDigest: null,
      parameters: null, policy: null, overrideDigest: null, styleSourceDigest: null,
      inputSourceDigest: null, maxCalls: null, maxTokens: null, maxCost: null, revisionBudget: null },
    thresholds: buildThresholds(parseArgs(['--chapters=20'])),
    chapters: Array.from({ length: 20 }, (_, index) => ({ chapter: index + 1, status: 'UNVERIFIED',
      attempts: [], acceptedAttemptId: null, previousChapterAttemptId: null,
      sourceVersion: null, firstDraftPath: null, finalDraftPath: null, authorEdits: [], contextOmissions: [] })),
    attemptFields: ['id', 'retryOf/resumeOf', 'rootTaskId', 'batchId', 'conditionDigest', 'inputDigest',
      'rawRequestPath/Sha256', 'rawResponsePath/Sha256', 'status', 'finishReason', 'startedAt', 'durationMs',
      'actualCallsIncludingRoleRetries', 'actualTokensIncludingFailures', 'actualCostIncludingFailures'],
    continuityReview: { status: 'UNVERIFIED', records: [], requiredFields: [
      'sourceChapter/sourceVersion/exactPassage', 'laterChapter/laterVersion/exactPassage',
      'qualification/ability/clue/promise', 'established/progress/used/responded/unresolved',
      'sourceStillValid', 'reviewer', 'rawReason'] },
    sceneReview: { status: 'UNVERIFIED', records: [], requiredFields: [
      'chapterPair/exactPassages', 'characterGoals', 'solutions', 'relationshipBeforeAfter',
      'emptyRepetition/intentionalEcho/undecided', 'evidenceAndSuggestedChange'] },
    recoveryReview: { status: 'UNVERIFIED', records: [], requiredFields: [
      'interruptedTask/snapshot', 'resumedTask/snapshot', 'conditionDigestBeforeAfter',
      'sourceEditAndAffectedChapters', 'invalidationObserved', 'cumulativeBudgetBeforeAfter', 'stopReason'] },
    readerReview: { status: 'UNVERIFIED', records: [], requiredFields: [
      'readerId/readerOrAuthor', 'consecutiveChapterRange/textVersion', 'voiceDriftExactPassage',
      'earliestLossOfInterestExactPassage', 'continueReading', 'rawOpinion', 'scope', 'active/revoked'] },
    boundaries: [
      'Empty arrays are missing observations, not successful checks.',
      'Changed source/policy/voice/override/model/budget requires a separate run; preserve preceding history.',
      'Progress is not payoff. Similar words alone cannot classify repetition or intentional echo.',
      'Aggregate chapter-soak pass does not prove contiguous identities, literary quality or reader acceptance.',
      'This template is not a generator, importer or runtime budget guard; validate records independently.',
      'Pause on limits; retain all drafts, snapshots, failures and rejected/revoked feedback.',
    ],
  }
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ output, ready: false, modelCalls: 0, actualContinuousChapters: 0, readerStatus: 'UNVERIFIED' }))
  return manifest
}
module.exports = { prepareLongform }
