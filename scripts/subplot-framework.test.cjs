const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

function loadTsModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  })

  const mod = new Module.Module(filePath, module)
  mod.filename = filePath
  mod.paths = Module.Module._nodeModulePaths(path.dirname(filePath))
  mod._compile(outputText, filePath)
  return mod.exports
}

const subplot = loadTsModule(path.resolve(__dirname, '../src/shared/subplot-framework.ts'))

const sampleSubplot = {
  name: 'clinic_supply',
  characters: 'LinWu,ZhouHeng',
  conflict: 'The team finds scarce medicine and the protagonist must choose between saving the wounded or trading for passage.',
  mainlineLink: 'The decision turns logistics allies into rivals and pushes the main resource conflict forward.',
  endChapter: 18,
}

const tests = [
  {
    name: 'parses direct JSON arrays without repair metadata',
    run() {
      const result = subplot.parseSubPlotFrameworkResponseDetailed(JSON.stringify([sampleSubplot]))
      assert.equal(result.mode, 'direct_json')
      assert.equal(result.repaired, false)
      assert.equal(result.notes.length, 0)
      assert.deepEqual(result.subplots, [{ ...sampleSubplot, endChapter: '18' }])
    },
  },
  {
    name: 'extracts JSON fragments from surrounding prose',
    run() {
      const raw = `Use the following result.\n\n${JSON.stringify({ subPlots: [sampleSubplot] }, null, 2)}\n\nThanks.`
      const result = subplot.parseSubPlotFrameworkResponseDetailed(raw)
      assert.equal(result.mode, 'json_fragment')
      assert.equal(result.repaired, true)
      assert.match(result.notes[0], /JSON/)
      assert.equal(result.subplots[0].name, sampleSubplot.name)
    },
  },
  {
    name: 'recovers loose JSON with bare field values',
    run() {
      const raw = `[
  {
    "name": "clinic_supply",
    "characters": "LinWu,ZhouHeng",
    "conflict": The team finds scarce medicine and the protagonist must choose between saving the wounded or trading for passage,
    "mainlineLink": The decision turns logistics allies into rivals and pushes the main resource conflict forward,
    "endChapter": 18,
  }
]`
      const result = subplot.parseSubPlotFrameworkResponseDetailed(raw)
      assert.equal(result.mode, 'field_recovery')
      assert.equal(result.repaired, true)
      assert.match(result.notes[0], /JSON/)
      assert.ok(result.subplots[0].conflict.startsWith('The team finds scarce medicine'))
      assert.ok(result.subplots[0].mainlineLink.startsWith('The decision turns logistics allies into rivals'))
      assert.equal(result.subplots[0].endChapter, '18')
    },
  },
  {
    name: 'recovers loose JSON with full-width punctuation and preserves arrays',
    run() {
      const raw = `[
  {
    "name"\uFF1A "old_list",
    "characters"\uFF1A ["Hero"\uFF0C"AuntChen"],
    "conflict"\uFF1A The hero finds a missing-person ledger and must decide whether to expose it now or trace the source first\uFF0C
    "mainlineLink"\uFF1A The ledger connects the disappearance case to the base leadership\uFF0C
    "endChapter"\uFF1A 24
  }
]`
      const result = subplot.parseSubPlotFrameworkResponseDetailed(raw)
      assert.equal(result.subplots.length, 1)
      assert.equal(result.subplots[0].characters, 'Hero,AuntChen')
      assert.equal(result.subplots[0].endChapter, '24')
    },
  },
  {
    name: 'supports common alias keys during normalization',
    run() {
      const parsed = subplot.parseSubPlotFrameworkResponse(JSON.stringify([
        {
          title: 'old_list',
          character: 'Hero,AuntChen',
          core_conflict: 'The hero must decide whether to publish the ledger or trace its origin first.',
          mainline_link: 'The ledger ties the disappearance case to the leadership deal line.',
          end_chapter: 24,
        },
      ]))
      assert.deepEqual(parsed, [{
        name: 'old_list',
        characters: 'Hero,AuntChen',
        conflict: 'The hero must decide whether to publish the ledger or trace its origin first.',
        mainlineLink: 'The ledger ties the disappearance case to the leadership deal line.',
        endChapter: '24',
      }])
    },
  },
  {
    name: 'validation rejects duplicates and overlong fields with readable reasons',
    run() {
      const validation = subplot.validateGeneratedSubplots([
        {
          name: 'clinic_supply',
          characters: 'LinWu,ZhouHeng',
          conflict: 'A duplicate subplot should be rejected.',
          mainlineLink: 'It still duplicates by name.',
          endChapter: '20',
        },
        {
          name: 'distribution_conflict',
          characters: 'LinWu,ZhouHeng',
          conflict: 'This conflict is intentionally too long so the validator rejects it and returns a readable reason for the calling service.',
          mainlineLink: 'This subplot also gets checked.',
          endChapter: '22',
        },
      ], {
        existingSubplots: [{ ...sampleSubplot, endChapter: '18' }],
        expectedCount: 2,
        maxConflictLength: 40,
        maxMainlineLinkLength: 60,
      })
      assert.equal(validation.accepted.length, 0)
      assert.match(validation.fatalMessage, /\u540d\u79f0\u91cd\u590d/u)
      assert.match(validation.fatalMessage, /\u6838\u5fc3\u51b2\u7a81\u8fc7\u957f/u)
    },
  },
  {
    name: 'throws a preview-rich error when no recoverable subplot object exists',
    run() {
      assert.throws(
        () => subplot.parseSubPlotFrameworkResponseDetailed('Model only said it could not rewrite this batch.'),
        /\u652f\u7ebf JSON \u89e3\u6790\u5931\u8d25\uff1a\u672a\u627e\u5230\u53ef\u6062\u590d\u7684\u652f\u7ebf\u5bf9\u8c61/u,
      )
    },
  },
]

let failed = 0
for (const entry of tests) {
  try {
    entry.run()
    console.log(`PASS ${entry.name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${entry.name}`)
    console.error(error)
  }
}

if (failed > 0) {
  process.exitCode = 1
} else {
  console.log(`All ${tests.length} subplot parser tests passed.`)
}
