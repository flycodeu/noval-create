const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')
const root = path.resolve(__dirname, '..')
const temp = fs.mkdtempSync(path.join(root, '.tmp-tests', 'review-request-boundary-'))
app.setPath('userData', temp)
app.disableHardwareAcceleration()
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
registerProjectTsRuntime(root)
async function main() {
  await app.whenReady()
  const { initDb, closeDb, getSqlite } = require('../electron/database/db.ts')
  const { createArtifact } = require('../electron/services/artifact.service.ts')
  const { recordCreativeReviewIssues, recordCreativeQualityIssues } = require('../electron/services/creative-review-issues.ts')
  initDb()
  try {
    const db = getSqlite()
    const novelId = Number(db.prepare('INSERT INTO novels(title) VALUES(?)').run('请求错误边界').lastInsertRowid)
    const input = { novelId, stage: 'style', atChapter: 0, request: '检查文风', idempotencyKey: 'request-boundary' }
    const clean = { summary: '通过', severity: 'low', rejectRequired: false, rewriteRequired: false, topFixes: [], issues: [] }
    const fallback = { ...clean, summary: '审校请求失败', severity: 'high', rejectRequired: true }
    const failed = { stage: 'rejected', review: fallback, failureStage: 'review', warnings: ['length'] }
    const report = (quality, key) => createArtifact({ novelId, kind: 'quality_report', status: 'reviewed', content: { schemaVersion: 'generic-asset-review-v1', modelReview: quality }, contextVersion: 1, producerType: 'system', producerId: 'fixture', producerClient: 'fixture', idempotencyKey: key })
    const old = report(failed, 'failed-review')
    assert.deepEqual(recordCreativeQualityIssues(input, 10, old.id, failed, ['审校请求失败']), [])
    assert.equal(db.prepare('SELECT COUNT(*) n FROM revision_tasks WHERE novel_id=?').get(novelId).n, 0)
    // Simulate reports persisted by old releases. A later successful request clears only
    // this run's pure request error, while semantic issues and other runs remain open.
    const legacy = recordCreativeReviewIssues(input, 10, old.id, fallback, ['审校请求失败'])
    const other = recordCreativeReviewIssues(input, 11, old.id, fallback, ['另一任务请求失败'])
    const semanticQuality = { stage: 'rejected', review: { ...clean, summary: '纸片位置有矛盾', rewriteRequired: true }, warnings: [] }
    const semantic = report(semanticQuality, 'semantic-review')
    const real = recordCreativeReviewIssues(input, 10, semantic.id, semanticQuality.review, ['纸片位置与原文不符'])
    const nextQuality = { stage: 'accepted', review: clean, warnings: [] }
    const next = report(nextQuality, 'completed-review')
    recordCreativeQualityIssues(input, 10, next.id, nextQuality)
    const status = id => db.prepare('SELECT status FROM revision_tasks WHERE id=?').get(id).status
    assert.equal(status(legacy[0]), 'resolved')
    assert.equal(status(other[0]), 'open')
    assert.equal(status(real[0]), 'open')
    const rewrite = { ...semanticQuality, failureStage: 'rewrite' }
    const rewriteReport = report(rewrite, 'failed-rewrite')
    const retained = recordCreativeQualityIssues(input, 12, rewriteReport.id, rewrite, ['修订请求断网'])
    assert.equal(retained.length, 1)
    assert.equal(db.prepare('SELECT title FROM revision_tasks WHERE id=?').get(retained[0]).title, '纸片位置有矛盾')
    console.log('PASS creative review request boundary: no invented prose issues, scoped legacy recovery, real semantic findings retained')
  } finally {
    closeDb()
    if (!path.resolve(temp).startsWith(path.resolve(root, '.tmp-tests') + path.sep)) throw new Error('unsafe cleanup')
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
