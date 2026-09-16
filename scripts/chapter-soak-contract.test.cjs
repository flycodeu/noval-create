const assert = require('node:assert/strict')

const {
  assertDryRunEvidenceIsNonObservational,
  buildDryRunReport,
  buildThresholds,
  parseArgs: parseSoakArgs,
  validateRealReport,
} = require('./chapter-soak.cjs')
const {
  inspectNovelQuality,
  listNovelInventory,
  normalizeInputReport,
  openReadonlyDb,
  parseArgs: parseExportArgs,
} = require('./export-chapter-soak-report.cjs')

function testDryRunEvidenceCannotPassAsObserved() {
  const options = parseSoakArgs(['--chapters=100'])
  const report = buildDryRunReport(options)

  assertDryRunEvidenceIsNonObservational(report)
  assert.equal(report.staticEvidence.productionHooksInspected, true)
  assert.deepEqual(
    report.checks.map((check) => check.status),
    Array(report.checks.length).fill('pass'),
  )

  const validation = validateRealReport(report, buildThresholds(options))
  assert.equal(validation.status, 'fail')
  assert.ok(validation.failures.includes('realModelCalled must be true for report validation'))
  assert.ok(validation.failures.includes('metrics.observed must be true for report validation'))
  assert.ok(validation.failures.includes('missing pipeline role planner'))
}

function testNormalizationDoesNotPromoteDryRunEvidence() {
  const normalized = normalizeInputReport({
    mode: 'dry-run',
    realModelCalled: false,
    metrics: {
      observed: false,
      completedChapters: null,
      successRate: null,
      pipelineRolesCovered: [],
    },
  }, {
    realModelCalled: true,
    provider: 'fixture-provider',
    model: 'fixture-model',
    modelConfigId: 'fixture-config',
    runId: 'fixture-run',
  })

  assert.equal(normalized.realModelCalled, true)
  assert.equal(normalized.metrics.observed, false)
}

function testFixedLongformWindowAndInvalidObservations() {
  const thresholds = buildThresholds(parseSoakArgs(['--chapters=20']))
  // Schema fixture, not actual model/reader evidence.
  const report = { realModelCalled: true, provenance: { provider: 'fixture', model: 'fixture', runId: 'fixture' },
    metrics: { observed: true, requestedChapters: 20, completedChapters: 20, failedChapters: 0,
      p95ChapterDurationMs: 1000, consecutiveRecallFallbackChapters: 0, minWordRatio: 1,
      contextHitRate: 1, aliasHitRate: 1, contractAssetHitRate: 1, recallFallbackRate: 0,
      publishGateFailures: 0, blockedWritebacks: 0, pipelineRolesCovered: thresholds.requiredPipelineRoles } }
  const validate = (patch) => validateRealReport({ ...report, metrics: { ...report.metrics, ...patch } }, thresholds)
  assert.equal(validate({}).status, 'pass')
  assert.equal(validate({ requestedChapters: 1, completedChapters: 1 }).status, 'fail')
  assert.equal(validate({ completedChapters: 21 }).status, 'fail')
  for (const field of ['requestedChapters', 'completedChapters', 'failedChapters', 'p95ChapterDurationMs',
    'consecutiveRecallFallbackChapters', 'minWordRatio', 'contextHitRate', 'aliasHitRate',
    'contractAssetHitRate', 'recallFallbackRate', 'publishGateFailures', 'blockedWritebacks']) {
    for (const value of [null, undefined, 'invalid', -1, Infinity]) {
      assert.equal(validate({ [field]: value }).status, 'fail', `${field}=${value} cannot pass`)
    }
  }
  assert.equal(validate({ failedChapters: 0.5 }).status, 'fail')
  assert.equal(validate({ contextHitRate: 2 }).status, 'fail')
}

function testInventoryUsesReadonlyDatabaseAndSelectOnlyQueries() {
  let openedPath = ''
  let openedOptions
  class FakeDatabase {
    constructor(dbPath, options) {
      openedPath = dbPath
      openedOptions = options
    }
  }

  openReadonlyDb('inventory-fixture.db', FakeDatabase)
  assert.equal(openedPath, 'inventory-fixture.db')
  assert.deepEqual(openedOptions, { readonly: true, fileMustExist: true })

  const sqlStatements = []
  const db = {
    prepare(sql) {
      sqlStatements.push(sql)
      return {
        all() {
          return [{
            id: 7,
            title: 'Fixture',
            targetWords: 1000000,
            launchMode: 'mega',
            contextVersion: 4,
            chapterCount: 2,
            latestChapterNum: 3,
            totalWords: 1900,
            summaryChapterCount: 1,
            continuityChapterCount: 2,
            chapterTaskCount: 2,
            successfulChapterTaskCount: 1,
          }]
        },
      }
    },
  }

  const report = listNovelInventory(db, 'inventory-fixture.db')
  assert.equal(report.source.readonly, true)
  assert.equal(report.novels[0].summaryCoverageRate, 0.5)
  assert.equal(report.novels[0].continuityCoverageRate, 1)
  assert.ok(sqlStatements.length > 0)
  sqlStatements.forEach((sql) => assert.match(sql.trim(), /^SELECT\b/u))
}

function testInventoryFlagParsing() {
  const options = parseExportArgs([
    '--db',
    'fixture.db',
    '--list-novels',
    '--inspect-novel',
    '--sample-chapters',
    '12',
    '--json',
  ])
  assert.equal(options.listNovels, true)
  assert.equal(options.inspectNovel, true)
  assert.equal(options.sampleChapters, 10)
  assert.equal(options.json, true)
  assert.match(options.dbPath, /fixture\.db$/u)
}

function testQualityInspectionUsesBoundedReadonlyQueries() {
  const sqlStatements = []
  const db = {
    prepare(sql) {
      sqlStatements.push(sql)
      if (sql.includes('FROM novels AS novel')) {
        return {
          get() {
            return {
              id: 7,
              title: 'Fixture',
              targetWords: 1000000,
              launchMode: 'professional_longform',
              contextVersion: 4,
              chapterCount: 2,
              totalWords: 1900,
              contentChapterCount: 2,
              outlineChapterCount: 2,
              summaryChapterCount: 1,
              continuityChapterCount: 2,
              reviewNotesChapterCount: 1,
              aiScoreChapterCount: 1,
              qualityScoreChapterCount: 1,
              writebackStatusChapterCount: 2,
            }
          },
        }
      }
      if (sql.includes('FROM chapters')) {
        return {
          all(novelId, limit) {
            assert.equal(novelId, 7)
            assert.equal(limit, 2)
            return [{
              id: 71,
              chapterNum: 1,
              title: '第一章',
              status: 'draft',
              targetWords: 1000,
              wordCount: 900,
              outline: '目标、冲突、转折、钩子',
              content: '正文',
              summary: '摘要',
              continuityStateJson: '{"ready":true}',
              reviewNotesJson: '{"issues":[]}',
              aiScoreJson: '{"overall":80}',
              qualityScoresJson: '{"humanFlavor":82}',
              writebackStatusJson: '{"readyForNextChapter":true}',
            }]
          },
        }
      }
      if (sql.includes('FROM tasks')) {
        return {
          get() {
            return {
              totalTaskCount: 3,
              modelBackedTaskCount: 2,
              successfulTaskCount: 2,
              chapterWorkflowTaskCount: 1,
            }
          },
        }
      }
      if (sql.includes('FROM artifacts')) {
        return {
          get() {
            return {
              totalArtifactCount: 4,
              qualityReportCount: 1,
              reviewedQualityReportCount: 1,
              qualityRepairReviewCount: 1,
              modelBackedArtifactCount: 3,
            }
          },
        }
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }

  const report = inspectNovelQuality(db, 'fixture.db', 7, 2)
  assert.equal(report.source.readonly, true)
  assert.equal(report.novel.averageWordsPerChapter, 950)
  assert.equal(report.novel.summaryCoverageRate, 0.5)
  assert.equal(report.novel.qualityScoreCoverageRate, 0.5)
  assert.equal(report.workflowEvidence.reviewedQualityReportCount, 1)
  assert.deepEqual(report.chapters[0].qualityScores, { humanFlavor: 82 })
  sqlStatements.forEach((sql) => assert.match(sql.trim(), /^SELECT\b/u))
}

testDryRunEvidenceCannotPassAsObserved()
testNormalizationDoesNotPromoteDryRunEvidence()
testFixedLongformWindowAndInvalidObservations()
testInventoryUsesReadonlyDatabaseAndSelectOnlyQueries()
testInventoryFlagParsing()
testQualityInspectionUsesBoundedReadonlyQueries()

console.log('chapter soak contract tests passed')
