const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const workspaceRoot = path.resolve(__dirname, '..')

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

const prompt = require(path.resolve(workspaceRoot, 'src/shared/prompt-library.ts'))
const genre = require(path.resolve(workspaceRoot, 'src/shared/genre-system.ts'))
const guardrails = require(path.resolve(workspaceRoot, 'src/shared/content-guardrails.ts'))
const workflow = require(path.resolve(workspaceRoot, 'src/shared/workflow-resilience.ts'))

const args = new Set(process.argv.slice(2))
const realMode = args.has('--real')
  || process.env.LONGFORM_SOAK_REAL === '1'
  || process.env.NOVAL_LONGFORM_SOAK_REAL === '1'
const jsonOnly = args.has('--json') || process.env.LONGFORM_SOAK_JSON === '1'

function buildWorldRulesSummary(genreName) {
  return genre.buildWorldRulesSummary(genre.getBuiltinGenreRules(genreName))
}

function assertIncludes(text, needle, label) {
  assert.match(text, new RegExp(escapeRegExp(needle), 'u'), `${label} should include ${needle}`)
}

function assertMatches(text, pattern, label) {
  assert.match(text, pattern, `${label} should match ${pattern}`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildLongformFixture() {
  const worldRules = buildWorldRulesSummary('末世')
  const longTermMemory = [
    '第37章：主角承诺避难所不再按亲疏分配抗生素，违背该规则会引发旧队员抵制。',
    '第118章：北桥车队只剩两辆可运行货车，油料必须优先给冷链药箱。',
    '第203章：周衡疑似感染被公开澄清，但他的发热记录仍会影响后来收容投票。',
    '第276章：高架桥下的救援点已经暴露，任何大规模噪声都会吸引旧城区尸群。',
  ].join('\n')

  return {
    novelTitle: '封锁线',
    genreName: '末世',
    totalWords: 1200000,
    totalChapters: 480,
    targetChapterNum: 317,
    worldRules,
    storyGoal: '带着三十名幸存者穿过封锁城区，建立可持续据点，并在外部救援失效后维持基本秩序。',
    coreConflict: '药品、燃料和收容名额都不够，队伍内部对分配、公平和救援顺序持续分裂。',
    mainPlot: '主角把旧城区诊所、高架桥补给线和临时收容点接进避难所体系，但每条线都要求牺牲另一条线的安全余量。',
    subPlots: '旧诊所药品线；车队纪律线；临时收容筛查线；周衡发热后续线。',
    ending: '队伍守住据点，但必须承认有些人救不回来，并把这条规则写进新的收容制度。',
    rhythmSummary: '前160章守点与找药，中段160章迁移与内部分裂，后段160章清算、收束和制度化代价。',
    background: '灾变后第三个月，旧城区停电，感染通过伤口和体液传播，医院体系已崩，冷链药品正在失效。',
    arcName: '北桥转移线',
    arcGoal: '把高架桥下救援点转移到新据点，同时处理收容投票、燃料耗尽和周衡旧记录的反噬。',
    arcSummary: '队伍先用旧诊所药品争取三天窗口，再冒险穿过高架桥，把可移动人员和冷链箱分批撤走。',
    arcGrowthLedger: '主角从临时救火转向明确制度，开始要求每次救援都写清代价、优先级和责任人。',
    arcCostLedger: '两名旧队员留下断后；北桥车辆暴露；周衡失去一部分收容投票资格。',
    chapterTitle: '冷链箱',
    chapterGoal: '主角必须决定最后一辆车先运发热儿童还是先运冷链药箱，并公开承担被反对的后果。',
    plotPoints: '投票僵持；冷链温度上升；桥下尸群被噪声吸引；主角要求周衡交出发热记录；车队只能走一次。',
    characterStates: '主角左臂旧伤未愈；周衡被要求回避投票；唐静守着车门但反对放弃儿童；老罗掌握最后半桶油。',
    itemSummary: '抗生素十九支；柴油半桶；冷链箱温度接近上限；路障钉三袋。',
    previousSummaries: '前五章连续处理北桥撤离，已确认桥上堵死，只剩维修匝道可以低速通行。',
    lastChapterEnding: '冷链箱的温度灯从绿色跳到黄色，车外有人喊孩子又烧起来了。',
    styleTemplate: '冷硬、克制、动作优先，不用口号替代选择。',
    continuitySummary: '药品余量、车辆油量、主角旧伤、周衡发热记录和收容投票资格都要持续追踪。',
    openLoops: '周衡是否还能参与车队决策；桥下尸群是否已锁定救援点；冷链箱是否还能撑过下一段路。',
    continuityNotes: '不能忘记队伍第203章已公开承诺发热记录必须进入收容投票；不能让车辆突然多出油料或路线。',
    timelineSummary: '灾变后第九十二天 18:40，日落前最后一次转移窗口。',
    timelineOpenThreads: '若本章拖到天黑，维修匝道会被桥下尸群堵死。',
    longTermMemory,
    consistencyNotes: '必须追踪谁承担风险、谁失去资格、谁被留下，以及每次资源使用造成的后果。',
    scenePlan: '场景1：冷链箱温度报警；场景2：收容投票僵持；场景3：桥下噪声逼近；场景4：主角公开决定并安排代价。',
    draftContent: '冷链箱报警后，车队围在维修匝道口争执。孩子在车厢里发热，药箱温度也在上升。主角要求先核对油量和路线。',
    protagonistReference: '主角',
    protagonistRule: '涉及主角时只用“主角”，不要改名。',
  }
}

function buildPromptSuite(fixture) {
  const arcPrompt = prompt.buildStoryArcPlanningPrompt({
    novelTitle: fixture.novelTitle,
    genre: fixture.genreName,
    storyGoal: fixture.storyGoal,
    coreConflict: fixture.coreConflict,
    mainPlot: fixture.mainPlot,
    subPlots: fixture.subPlots,
    ending: fixture.ending,
    totalChapters: fixture.totalChapters,
    rhythmSummary: fixture.rhythmSummary,
    background: fixture.background,
    protagonistReference: fixture.protagonistReference,
    protagonistRule: fixture.protagonistRule,
  })

  const outlinePrompt = prompt.buildChapterOutlinePlanningPrompt({
    novelTitle: fixture.novelTitle,
    genre: fixture.genreName,
    storyGoal: fixture.storyGoal,
    coreConflict: fixture.coreConflict,
    mainPlot: fixture.mainPlot,
    arcName: fixture.arcName,
    arcGoal: fixture.arcGoal,
    arcSummary: fixture.arcSummary,
    arcGrowthLedger: fixture.arcGrowthLedger,
    arcCostLedger: fixture.arcCostLedger,
    chapterStart: 313,
    chapterEnd: 320,
    previousSummary: fixture.previousSummaries,
    characterStates: fixture.characterStates,
    continuitySummary: fixture.continuitySummary,
    openLoops: fixture.openLoops,
    worldRulesSummary: fixture.worldRules,
    protagonistReference: fixture.protagonistReference,
    protagonistRule: fixture.protagonistRule,
  })

  const scenePrompt = prompt.buildScenePlanPrompt({
    novelTitle: fixture.novelTitle,
    genre: fixture.genreName,
    chapterNum: fixture.targetChapterNum,
    chapterTitle: fixture.chapterTitle,
    chapterGoal: fixture.chapterGoal,
    plotPoints: fixture.plotPoints,
    emotionTone: '压迫、克制、公开承担后果',
    targetWords: 6500,
    storyCore: fixture.storyGoal,
    currentArc: fixture.arcSummary,
    worldRules: fixture.worldRules,
    characterStates: fixture.characterStates,
    itemSummary: fixture.itemSummary,
    previousSummaries: fixture.previousSummaries,
    lastChapterEnding: fixture.lastChapterEnding,
    continuitySummary: fixture.continuitySummary,
    openLoops: fixture.openLoops,
    continuityNotes: fixture.continuityNotes,
    timelineSummary: fixture.timelineSummary,
    timelineOpenThreads: fixture.timelineOpenThreads,
    longTermMemory: fixture.longTermMemory,
    consistencyNotes: fixture.consistencyNotes,
    protagonistReference: fixture.protagonistReference,
    protagonistRule: fixture.protagonistRule,
  })

  const writingPrompt = prompt.buildChapterWritingPrompt({
    novelTitle: fixture.novelTitle,
    genre: fixture.genreName,
    chapterNum: fixture.targetChapterNum,
    chapterTitle: fixture.chapterTitle,
    chapterGoal: fixture.chapterGoal,
    plotPoints: fixture.plotPoints,
    emotionTone: '压迫、克制、公开承担后果',
    targetWords: 6500,
    storyCore: fixture.storyGoal,
    currentArc: fixture.arcSummary,
    worldRules: fixture.worldRules,
    characterStates: fixture.characterStates,
    itemSummary: fixture.itemSummary,
    previousSummaries: fixture.previousSummaries,
    lastChapterEnding: fixture.lastChapterEnding,
    styleTemplate: fixture.styleTemplate,
    continuitySummary: fixture.continuitySummary,
    openLoops: fixture.openLoops,
    continuityNotes: fixture.continuityNotes,
    timelineSummary: fixture.timelineSummary,
    timelineOpenThreads: fixture.timelineOpenThreads,
    longTermMemory: fixture.longTermMemory,
    consistencyNotes: fixture.consistencyNotes,
    protagonistReference: fixture.protagonistReference,
    protagonistRule: fixture.protagonistRule,
  })

  const reviewPrompt = prompt.buildChapterReviewPrompt({
    novelTitle: fixture.novelTitle,
    genre: fixture.genreName,
    chapterNum: fixture.targetChapterNum,
    chapterTitle: fixture.chapterTitle,
    chapterGoal: fixture.chapterGoal,
    storyCore: fixture.storyGoal,
    currentArc: fixture.arcSummary,
    worldRules: fixture.worldRules,
    characterStates: fixture.characterStates,
    itemSummary: fixture.itemSummary,
    continuitySummary: fixture.continuitySummary,
    openLoops: fixture.openLoops,
    timelineSummary: fixture.timelineSummary,
    longTermMemory: fixture.longTermMemory,
    consistencyNotes: fixture.consistencyNotes,
    scenePlan: fixture.scenePlan,
    draftContent: fixture.draftContent,
    protagonistReference: fixture.protagonistReference,
    protagonistRule: fixture.protagonistRule,
  })

  const continuityPrompt = prompt.buildContinuityStatePrompt({
    novelTitle: fixture.novelTitle,
    genre: fixture.genreName,
    chapterNum: fixture.targetChapterNum,
    chapterTitle: fixture.chapterTitle,
    chapterContent: fixture.draftContent,
    previousSummary: fixture.previousSummaries,
    existingContinuity: fixture.continuitySummary,
    openLoops: fixture.openLoops,
    characterStates: fixture.characterStates,
    worldRules: fixture.worldRules,
  })

  return {
    arcPrompt,
    outlinePrompt,
    scenePrompt,
    writingPrompt,
    reviewPrompt,
    continuityPrompt,
  }
}

function runDryRunChecks(fixture, prompts) {
  const checks = []

  function check(name, run) {
    run(name)
    checks.push(name)
  }

  check('arc prompt keeps longform realism and ledger hooks', (name) => {
    assertIncludes(prompts.arcPrompt, '本轮任务焦点', name)
    assertIncludes(prompts.arcPrompt, '真实度=严格写实', name)
    assertMatches(prompts.arcPrompt, /growth_ledger|成长账本/u, name)
    assertMatches(prompts.arcPrompt, /cost_ledger|代价账本/u, name)
    assert.doesNotMatch(prompts.arcPrompt, /Each arc must deepen/u)
  })

  check('outline prompt carries chapter-window continuity context', (name) => {
    assertIncludes(prompts.outlinePrompt, fixture.arcGrowthLedger, name)
    assertIncludes(prompts.outlinePrompt, fixture.arcCostLedger, name)
    assertIncludes(prompts.outlinePrompt, '连续性', name)
    assertIncludes(prompts.outlinePrompt, fixture.openLoops, name)
  })

  check('scene prompt includes memory, timeline, and hard constraints', (name) => {
    assertIncludes(prompts.scenePrompt, '第317章', name)
    assertIncludes(prompts.scenePrompt, fixture.longTermMemory.split('\n')[1], name)
    assertIncludes(prompts.scenePrompt, fixture.timelineOpenThreads, name)
    assertIncludes(prompts.scenePrompt, '场景', name)
  })

  check('writing prompt keeps high-word-count output and no model side effects', (name) => {
    assertIncludes(prompts.writingPrompt, '6500', name)
    assertIncludes(prompts.writingPrompt, '本轮任务焦点', name)
    assertIncludes(prompts.writingPrompt, '伤病恢复', name)
    assertIncludes(prompts.writingPrompt, '补给分配', name)
    assert.doesNotMatch(prompts.writingPrompt, /Write only what the current outline/u)
  })

  check('review prompt exposes risk schema for longform acceptance', (name) => {
    assertIncludes(prompts.reviewPrompt, '上下文护栏', name)
    assertIncludes(prompts.reviewPrompt, '真实度护栏', name)
    assertIncludes(prompts.reviewPrompt, 'context_drift_risks', name)
    assertIncludes(prompts.reviewPrompt, 'realism_risks', name)
    assertIncludes(prompts.reviewPrompt, 'rewrite_required', name)
  })

  check('continuity extraction prompt stays JSON-shaped', (name) => {
    assertIncludes(prompts.continuityPrompt, 'JSON', name)
    assertMatches(prompts.continuityPrompt, /角色状态|character/u, name)
    assertMatches(prompts.continuityPrompt, /伏笔|open/i, name)
  })

  check('quality guardrails still flag longform realism regressions', () => {
    const findings = guardrails.collectQualityGuardrailFindings(
      '冷链箱报警后，所有人立刻恢复冷静并全票同意，没有人承担代价，车辆油料也刚好够用。',
      fixture.genreName,
    )
    const codes = findings.map((item) => item.code)
    assert.ok(codes.includes('zero_cost_resolution'), 'should catch zero-cost longform resolution')
    assert.equal(guardrails.shouldForceRepair(findings), true)
  })

  check('paused longform workflow checkpoint is recognized as resumable', () => {
    assert.equal(workflow.hasResumableWorkflowCheckpoint({
      runnerType: 'workflow',
      type: 'chapter_batch_generate',
      progressJson: JSON.stringify({
        resumeCursor: 316,
        totalBatches: 480,
        requestedCount: 480,
        generatedCount: 316,
        acceptedIds: Array.from({ length: 6 }, (_, index) => 311 + index),
        completed: false,
      }),
    }), true)
  })

  return checks
}

function buildAcceptancePrompt(fixture, prompts) {
  return [
    '# 长篇真实/半真实验收提示',
    '',
    '目的：验证 120 万字、480 章长篇工程在第 317 章附近仍能保持上下文、现实约束、资源账本、人物状态和伏笔连续性。',
    '',
    '执行要求：',
    '1. 不要跳过已有长期记忆、时间线、开放伏笔和收容投票规则。',
    '2. 生成结果必须能解释资源消耗、路线限制、谁承担风险，以及选择造成的后果。',
    '3. 若外部执行器或人工评审接入真实模型，只运行一次正文生成、一次审校、一次连续性提取；本脚本不会调用模型。',
    '4. 验收失败条件包括：突然多出油料或路线、周衡发热记录失效、冷链箱没有代价地解决、儿童/药箱选择被口号化处理。',
    '',
    '长任务输入摘要：',
    `- 书名：${fixture.novelTitle}`,
    `- 体裁：${fixture.genreName}`,
    `- 规模：${fixture.totalWords} 字 / ${fixture.totalChapters} 章`,
    `- 目标章节：第 ${fixture.targetChapterNum} 章《${fixture.chapterTitle}》`,
    `- 本章目标：${fixture.chapterGoal}`,
    '',
    '正文生成 Prompt：',
    '```text',
    prompts.writingPrompt,
    '```',
    '',
    '审校 Prompt：',
    '```text',
    prompts.reviewPrompt,
    '```',
    '',
    '连续性提取 Prompt：',
    '```text',
    prompts.continuityPrompt,
    '```',
  ].join('\n')
}

function buildReport(mode, fixture, prompts, checks) {
  return {
    mode,
    invokedAt: new Date().toISOString(),
    realModelCalled: false,
    fixture: {
      novelTitle: fixture.novelTitle,
      genre: fixture.genreName,
      totalWords: fixture.totalWords,
      totalChapters: fixture.totalChapters,
      targetChapterNum: fixture.targetChapterNum,
      targetWords: 6500,
    },
    promptLengths: Object.fromEntries(Object.entries(prompts).map(([key, value]) => [key, value.length])),
    checks,
    acceptance: {
      command: 'npm run test:longform-soak -- --real',
      envCommand: 'LONGFORM_SOAK_REAL=1 npm run test:longform-soak',
      failureSignals: [
        '上下文护栏缺失',
        '真实度护栏缺失',
        '长期记忆未进入正文/审校提示',
        '资源、路线、伤病或投票约束被无代价解决',
        '恢复检查点无法识别为可续跑',
      ],
    },
  }
}

function main() {
  const fixture = buildLongformFixture()
  const prompts = buildPromptSuite(fixture)
  const checks = runDryRunChecks(fixture, prompts)
  const report = buildReport(realMode ? 'real-prompt' : 'dry-run', fixture, prompts, checks)

  if (realMode && !jsonOnly) {
    console.log(buildAcceptancePrompt(fixture, prompts))
    console.log('\nJSON 报告：')
  }

  if (realMode || jsonOnly) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    for (const check of checks) {
      console.log(`PASS ${check}`)
    }
    console.log(`longform soak dry-run passed (${checks.length} checks, no real model calls).`)
  }
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
