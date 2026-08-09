const assert = require('node:assert/strict')

const {
  assertDryRunEvidenceIsNonObservational,
  buildDryRunReport,
  buildThresholds,
  parseArgs: parseSoakArgs,
  validateRealReport,
} = require('./chapter-soak.cjs')
const {
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
  const options = parseExportArgs(['--db', 'fixture.db', '--list-novels', '--json'])
  assert.equal(options.listNovels, true)
  assert.equal(options.json, true)
  assert.match(options.dbPath, /fixture\.db$/u)
}

testDryRunEvidenceCannotPassAsObserved()
testNormalizationDoesNotPromoteDryRunEvidence()
testInventoryUsesReadonlyDatabaseAndSelectOnlyQueries()
testInventoryFlagParsing()

console.log('chapter soak contract tests passed')
