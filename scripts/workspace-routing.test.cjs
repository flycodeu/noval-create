const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const originalResolveFilename = Module._resolveFilename
Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  if ((request.startsWith('./') || request.startsWith('../')) && !path.extname(request)) {
    const baseDir = parent && parent.filename ? path.dirname(parent.filename) : process.cwd()
    const directCandidates = ['.ts', '.tsx', '.js', '.json'].map((ext) => path.resolve(baseDir, request + ext))
    for (const candidate of directCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }

    const indexCandidates = ['.ts', '.tsx', '.js'].map((ext) => path.resolve(baseDir, request, 'index' + ext))
    for (const candidate of indexCandidates) {
      if (fs.existsSync(candidate)) return candidate
    }
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}

function compileTs(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  })

  module._compile(outputText, filename)
}

require.extensions['.ts'] = compileTs
require.extensions['.tsx'] = compileTs

const navigation = require(path.resolve(__dirname, '../src/pages/Novel/shared/workspace-navigation.ts'))
const observability = require(path.resolve(__dirname, '../src/pages/Novel/shared/planning-observability.ts'))

const tests = [
  {
    name: 'revision targets keep entity context in the destination url',
    run() {
      const writingPath = navigation.buildRevisionTaskTargetPath(42, {
        id: 8,
        taskType: 'continuity',
        relatedPage: 'writing',
        entityType: 'chapter',
        entityId: 17,
        chapterId: 17,
        title: '需要同步上下文',
      })
      const characterPath = navigation.buildRevisionTaskTargetPath(42, {
        id: 9,
        taskType: 'character',
        relatedPage: 'characters',
        entityType: 'character',
        entityId: 23,
        title: '人物动机偏空',
      })
      const mapPath = navigation.buildRevisionTaskTargetPath(42, {
        id: 10,
        taskType: 'map',
        relatedPage: 'map',
        entityType: 'map',
        entityId: 51,
        title: '地点层级错误',
      })

      assert.match(writingPath, /\/novels\/42\/writing\/editor\?/u)
      assert.match(writingPath, /chapterId=17/u)
      assert.match(writingPath, /insight=health/u)
      assert.match(characterPath, /characterId=23/u)
      assert.match(mapPath, /nodeId=51/u)
    },
  },
  {
    name: 'task recovery distinguishes paused workflows from recoverable drafts',
    run() {
      const pausedWorkflow = navigation.buildTaskRecoveryAction({
        id: 1,
        novelId: 7,
        type: 'map_auto_generate',
        runnerType: 'workflow',
        status: 'paused',
      })
      const planningDraft = navigation.buildTaskRecoveryAction({
        id: 2,
        novelId: 7,
        type: 'planning_draft',
        runnerType: 'workflow',
        status: 'success',
        progressJson: JSON.stringify({
          kind: 'planning_draft',
          draft: { pageKey: 'timeline' },
        }),
      })
      const premiseDraft = navigation.buildTaskRecoveryAction({
        id: 3,
        novelId: 7,
        type: 'premise_generate',
        runnerType: 'workflow',
        status: 'success',
        progressJson: JSON.stringify({
          kind: 'premise_draft',
          draft: { taskId: 3 },
        }),
      })

      assert.equal(pausedWorkflow.kind, 'resume')
      assert.equal(planningDraft.kind, 'recover_draft')
      assert.match(planningDraft.path, /\/novels\/7\/timeline/u)
      assert.equal(premiseDraft.kind, 'recover_draft')
      assert.match(premiseDraft.path, /\/novels\/7\/core-settings/u)
    },
  },
  {
    name: 'planning observability summarizes diffs and lint warnings',
    run() {
      const diffs = observability.buildPlanningDiffSummary(
        { title: '旧标题', outline: '旧目标', tags: ['a'] },
        { title: '新标题', outline: '旧目标', tags: ['a', 'b'] },
      )
      const lintWarnings = observability.buildPlanningLintWarnings([
        {
          title: '角色#12在地点#7的冲突',
          outline: '他们两人不过是宿敌关系，压迫感在心底蔓延。',
        },
      ], '末世')

      assert.ok(diffs.some((line) => /title/u.test(line)))
      assert.ok(diffs.some((line) => /tags/u.test(line)))
      assert.ok(lintWarnings.some((line) => /ID|内部/u.test(line)))
      assert.ok(lintWarnings.some((line) => /关系/u.test(line)))
    },
  },
]

let failed = 0
for (const test of tests) {
  try {
    test.run()
    console.log(`PASS ${test.name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${test.name}`)
    console.error(error)
  }
}

if (failed > 0) {
  process.exitCode = 1
}
