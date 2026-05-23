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

const promptLibraryPath = path.resolve(__dirname, '../src/shared/prompt-library.ts')
const promptLibrarySource = fs.readFileSync(promptLibraryPath, 'utf8')
const storyPromptsSource = fs.readFileSync(path.resolve(__dirname, '../electron/services/story-prompts.ts'), 'utf8')
const prompt = require(promptLibraryPath)
const genre = require(path.resolve(__dirname, '../src/shared/genre-system.ts'))
const guardrails = require(path.resolve(__dirname, '../src/shared/content-guardrails.ts'))

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildWorldRulesSummary(genreName) {
  return genre.buildWorldRulesSummary(genre.getBuiltinGenreRules(genreName))
}

const removedEnglishGuardrailSnippets = [
  'Only extend the opening foundation, daily rules, and first-wave conflict seeds.',
  'Titles and synopsis must stay inside the same background instead of quietly advertising a different story.',
  'Character identity, goals, weaknesses, faction ties, and abilities must all be usable inside the existing story.',
  'Do not build a profile that works only as a concept sheet; it must survive real scenes and real pressure.',
  'Every generated character must fill a distinct story function under the existing world structure.',
  'Do not mass-produce near-duplicate personalities, names, or roles just to meet the count.',
  'Keep the same character identity, role, and name while fixing weak logic and weak fit.',
  'The regenerated profile must still connect to the same relationship web and world slot.',
  'Only keep relationships that could materially affect scenes, choices, leverage, trust, or conflict.',
  'Social distance, rank, duty, and shared history should feel believable for the current setting.',
  'Space, hierarchy, travel logic, and plot function must all stay consistent with the current world.',
  'Geography, distance, transport, and territorial control should feel physically and socially plausible for this genre.',
  'Do not create beautiful names with no strategic, social, or plot function behind them.',
  'Each arc must deepen the same story instead of quietly switching themes, stakes, or world logic.',
  'Arc turns should come from concrete decisions, pressures, and consequences rather than abstract momentum words.',
  'Chapter goals, bridges, and plot points must line up with existing character state, world rules, and open loops.',
  'Do not assign impossible logistics, impossible travel, or out-of-character behavior just to balance pacing.',
  'Timeline events must preserve chronology, travel logic, resource logic, and world-rule legality.',
  'If an event needs an extraordinary cause, make that cause explicit inside the existing rules instead of sneaking it in.',
  'Scene order must preserve continuity, character condition, object tracking, and the physical or social cost of actions.',
  'Treat continuity notes, open loops, timeline anchors, and long-term memory as hard constraints, not soft inspiration.',
  'If the chapter is survival-oriented, explicitly respect fatigue, supplies, noise, injury, distance, and group discipline.',
  'Write only what the current outline, continuity, and world rules can support.',
  'Continuity notes, open loops, and previous summaries are binding context for what characters know and do.',
  'If a reaction, recovery, travel hop, or combat outcome would be expensive or dangerous in this setup, write that cost on the page.',
  'Draft only what the current scene plan and context can support; do not bypass consequences or invent missing systems.',
  'Scene plan must_cover items are hard requirements.',
  'Resource use, wounds, movement, noise, and social fallout must match what this chapter actually shows.',
  'Extract only durable facts that later chapters must remember.',
  'Do not upgrade guesses into facts and do not keep thematic commentary as memory.',
  'Rewrite the paragraph without changing the same event, same meaning, or same causal outcome.',
  'Keep any genre-appropriate realism or in-world rule logic that the original paragraph already depends on.',
  'Expand only the current content type and keep it anchored to the same setup.',
  'If the genre is realistic, prefer concrete conditions and consequences over thematic packaging.',
  'The subplot must stay useful to the same main story and obey the same world logic.',
  'If the genre is realistic, keep conflict costs, risk-bearers, and decision pressure explicit.',
]

const tests = [
  {
    name: 'reality summary exposes genre realism constraints',
    run() {
      const zombie = genre.getBuiltinGenreRules('\u672b\u4e16')
      const summary = genre.buildRealityConstraintSummary(zombie.writingConstraints)
      assert.match(summary, /\u771f\u5b9e\u5ea6=/u)
      assert.match(summary, /\u79d1\u5b66\u8fb9\u754c=/u)
      assert.match(summary, /\u7269\u7406\u8fb9\u754c=/u)
      assert.match(summary, /\u5e38\u8bc6\u91cd\u70b9=/u)
      assert.match(summary, /\u4e0a\u4e0b\u6587\u91cd\u70b9=/u)
    },
  },
  {
    name: 'context alignment rules are emitted in Chinese and keep task focus',
    run() {
      const text = prompt.buildContextAlignmentRules({
        background: '\u57ce\u5e02\u505c\u7535\u4e09\u5929\uff0c\u907f\u96be\u6240\u4e0d\u518d\u63a5\u6536\u65b0\u4eba\u3002',
        storyCore: '\u6545\u4e8b\u76ee\u6807\uff1a\u5b88\u4f4f\u907f\u96be\u6240',
        worldSummary: '\u611f\u67d3\u53ef\u80fd\u901a\u8fc7\u4f24\u53e3\u4f20\u64ad\u3002',
        taskFocus: '\u53ea\u8865\u5f53\u524d\u51b2\u7a81',
      })
      assert.match(text, /\u53ea\u6cbf\u7740\u5f53\u524d\u80cc\u666f/u)
      assert.match(text, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9\uff1a\u53ea\u8865\u5f53\u524d\u51b2\u7a81/u)
      assert.match(text, /^- /m)
    },
  },
  {
    name: 'chapter review prompt carries guardrails and expanded JSON schema',
    run() {
      const text = prompt.buildChapterReviewPrompt({
        novelTitle: '\u907f\u96be\u6240',
        genre: '\u672b\u4e16',
        chapterNum: 12,
        chapterTitle: '\u65ad\u7535\u591c',
        chapterGoal: '\u5b88\u4f4f\u5b89\u68c0\u53e3\u5e76\u627e\u51fa\u9690\u7792\u4f24\u5458',
        storyCore: '\u6545\u4e8b\u76ee\u6807\uff1a\u5b88\u4f4f\u907f\u96be\u6240',
        currentArc: '\u68c0\u75ab\u538b\u529b\u6301\u7eed\u5347\u7ea7',
        worldRules: '\u611f\u67d3\u901a\u8fc7\u4f24\u53e3\u4f20\u64ad\uff0c\u8d44\u6e90\u7d27\u7f3a',
        characterStates: '\u4e3b\u89d2\u624b\u81c2\u62c9\u4f24',
        itemSummary: '\u836f\u54c1\u4ec5\u5269\u4e24\u652f',
        continuitySummary: '\u4e0a\u7ae0\u5df2\u51b3\u5b9a\u6682\u505c\u6536\u5bb9',
        openLoops: '\u95e8\u53e3\u8fd8\u6709\u4e09\u540d\u6c42\u63f4\u8005',
        timelineSummary: '\u540c\u65e5\u6df1\u591c',
        longTermMemory: '\u57fa\u5730\u5185\u90e8\u5bf9\u5206\u914d\u539f\u5219\u5b58\u5728\u5206\u6b67',
        consistencyNotes: '\u4f24\u52bf\u548c\u7269\u8d44\u8981\u6301\u7eed\u8ddf\u8e2a',
        scenePlan: '\u573a\u666f1\uff1a\u95e8\u53e3\u5bf9\u5cd9',
        draftContent: '\u6b63\u6587\u8349\u7a3f',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u53ea\u80fd\u4f7f\u7528\u300c\u4e3b\u89d2\u300d\u79f0\u547c',
      })
      assert.match(text, /\u4e0a\u4e0b\u6587\u62a4\u680f/u)
      assert.match(text, /\u771f\u5b9e\u5ea6\u62a4\u680f/u)
      assert.match(text, /context_drift_risks/u)
      assert.match(text, /realism_risks/u)
      assert.match(text, /genre_hollowing_risks/u)
      assert.match(text, /rewrite_required/u)
    },
  },
  {
    name: 'prompt schemas avoid story-specific sample entities and numbered placeholders',
    run() {
      const source = `${promptLibrarySource}\n${storyPromptsSource}`
      const forbiddenSamples = [
        '\u6797\u8fdc\u4e0e\u8d75\u4e34',
        '"required_voice_lock_character_ids":[1,2]',
        '\u6210\u957f\u53d8\u53161',
        '\u4e8b\u4ef61',
        '\u573a\u666f\u540d',
        '\u5fc5\u987b\u4ea4\u4ee31',
        '\u4fee\u6539\u5efa\u8bae1',
        '\u6700\u4f4e\u5206\u7ef4\u5ea61',
      ]

      for (const sample of forbiddenSamples) {
        assert.doesNotMatch(source, new RegExp(escapeRegExp(sample), 'u'))
      }
    },
  },
  {
    name: 'story arc and chapter outline prompts expose growth and cost ledgers',
    run() {
      const arcPrompt = prompt.buildStoryArcPlanningPrompt({
        novelTitle: '\u5c71\u95e8\u65e7\u96ea',
        genre: '\u4ed9\u4fa0\u4fee\u771f',
        storyGoal: '\u4e3b\u89d2\u8981\u4ece\u51e1\u4eba\u57ce\u8d70\u5230\u5c71\u95e8\u5185\u95e8\uff0c\u5e76\u627e\u56de\u5bb6\u65cf\u88ab\u5916\u95e8\u76d7\u8d70\u7684\u7075\u8109\u5730\u56fe\u3002',
        coreConflict: '\u4e3b\u89d2\u8d44\u8d28\u5e73\u5eb8\uff0c\u65e2\u7f3a\u8d44\u6e90\uff0c\u53c8\u88ab\u5b97\u95e8\u6743\u529b\u3001\u6563\u4fee\u4ea4\u6613\u548c\u51e1\u4eba\u5bb6\u65cf\u8fde\u5750\u540c\u65f6\u6324\u538b\u3002',
        mainPlot: '\u4e3b\u89d2\u5728\u51e1\u4eba\u57ce\u3001\u574a\u5e02\u3001\u79d8\u5883\u548c\u5c71\u95e8\u4e4b\u95f4\u79ef\u7d2f\u529f\u52b3\uff0c\u4e00\u8fb9\u4fee\u884c\u4e00\u8fb9\u5904\u7406\u5bb6\u65cf\u56e0\u679c\u3002',
        subPlots: '\u51e1\u4eba\u6751\u707e\u7ebf\uff1b\u5916\u95e8\u8003\u6838\u7ebf\uff1b\u90aa\u4fee\u5e02\u96c6\u6f5c\u5165\u7ebf\u3002',
        ending: '\u4e3b\u89d2\u7b51\u57fa\u6210\u529f\uff0c\u4f46\u8981\u5728\u5b88\u4f4f\u5bb6\u65cf\u548c\u8fdb\u5165\u5b97\u95e8\u6743\u529b\u6838\u5fc3\u4e4b\u95f4\u505a\u51fa\u9009\u62e9\u3002',
        totalChapters: 90,
        rhythmSummary: '\u524d\u671f\u79ef\u84c4\uff0c\u4e2d\u671f\u593a\u8d44\u6e90\uff0c\u540e\u671f\u7834\u5c40\u3002',
        background: '\u51e1\u4eba\u57ce\u9644\u8fd1\u7075\u8109\u6e10\u67af\uff0c\u5916\u95e8\u8bd5\u70bc\u4e0e\u6563\u4fee\u4ea4\u6613\u540c\u65f6\u53d8\u5f97\u6fc0\u70c8\u3002',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u82e5\u6d89\u53ca\u4e3b\u89d2\uff0c\u53ea\u7528\u300c\u4e3b\u89d2\u300d\u79f0\u547c\u3002',
      })
      const outlinePrompt = prompt.buildChapterOutlinePlanningPrompt({
        novelTitle: '\u5c71\u95e8\u65e7\u96ea',
        genre: '\u4ed9\u4fa0\u4fee\u771f',
        storyGoal: '\u4e3b\u89d2\u8fdb\u5165\u5185\u95e8\u5e76\u627e\u56de\u7075\u8109\u5730\u56fe',
        coreConflict: '\u8d44\u6e90\u7d27\u7f3a\u4e0e\u5b97\u95e8\u79e9\u5e8f\u6324\u538b\u5e76\u884c',
        mainPlot: '\u4e3b\u89d2\u5728\u574a\u5e02\u3001\u5916\u95e8\u548c\u79d8\u5883\u4e4b\u95f4\u7d2f\u79ef\u7834\u5883\u8d44\u672c\u3002',
        arcName: '\u5916\u95e8\u7acb\u8db3\u7ebf',
        arcGoal: '\u62ff\u5230\u5916\u95e8\u5b58\u8eab\u8d44\u683c\u5e76\u4fdd\u4f4f\u51e1\u4eba\u5bb6\u65cf\u4e0d\u88ab\u8fde\u5750',
        arcSummary: '\u4e3b\u89d2\u5148\u5728\u51e1\u4eba\u57ce\u633a\u8fc7\u7075\u7cae\u77ed\u7f3a\uff0c\u540e\u5728\u574a\u5e02\u7b79\u6389\u5165\u5c71\u95e8\u6240\u9700\u7684\u8d21\u5949\u548c\u4eba\u60c5\u3002',
        arcGrowthLedger: '\u4e3b\u89d2\u5b66\u4f1a\u5982\u4f55\u5728\u574a\u5e02\u8c08\u5224\u4e0e\u5224\u65ad\u9648\u5c40\uff1b\u5f00\u59cb\u7406\u89e3\u5b97\u95e8\u89c4\u77e9\u548c\u51e1\u4eba\u56e0\u679c\u7684\u51b2\u7a81',
        arcCostLedger: '\u4e3b\u89d2\u8d77\u6b65\u79ef\u84c4\u88ab\u8017\u7a7a\uff1b\u4e3a\u4fdd\u4f4f\u5bb6\u4eba\u6b20\u4e0b\u6563\u4fee\u4eba\u60c5',
        chapterStart: 11,
        chapterEnd: 14,
        previousSummary: '\u4e3b\u89d2\u521a\u4ece\u51e1\u4eba\u57ce\u9003\u51fa\u3002',
        characterStates: '\u4e3b\u89d2\u4f24\u52bf\u672a\u6108\uff0c\u5bb6\u4eba\u4ecd\u88ab\u6263\u5728\u57ce\u5185\u3002',
        continuitySummary: '\u9700\u8981\u8ffd\u8e2a\u8d21\u5949\u3001\u4eba\u60c5\u503a\u548c\u7834\u5883\u98ce\u9669\u3002',
        openLoops: '\u8c01\u5728\u80cc\u540e\u63a8\u52a8\u7075\u8109\u5730\u56fe\u5916\u6d41\u3002',
        worldRulesSummary: buildWorldRulesSummary('\u4ed9\u4fa0\u4fee\u771f'),
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u82e5\u6d89\u53ca\u4e3b\u89d2\uff0c\u53ea\u7528\u300c\u4e3b\u89d2\u300d\u79f0\u547c\u3002',
      })
      assert.match(arcPrompt, /growth_ledger/u)
      assert.match(arcPrompt, /cost_ledger/u)
      assert.match(outlinePrompt, /growth_ledger/u)
      assert.match(outlinePrompt, /cost_ledger/u)
      assert.match(outlinePrompt, /成长账本/u)
      assert.match(outlinePrompt, /代价账本/u)
    },
  },
  {
    name: 'genre hollowing guardrails catch xianxia zombie and wuxia drift',
    run() {
      const zombieFindings = guardrails.collectQualityGuardrailFindings('末世里尸潮逼近，丧尸在街口嘶吼，所有人都在灾变中感受绝望，只会反复喊要活下去。', '末世')
      const xianxiaFindings = guardrails.collectQualityGuardrailFindings('他仰望大道，心里只剩飞升、长生与问道，仿佛仙途尽头自有造化与天道回应。', '仙侠修真')
      const wuxiaFindings = guardrails.collectQualityGuardrailFindings('刀光一闪，剑光再起，两人交手数十招，掌风四散，决战之后各自远去。', '武侠')

      assert.ok(zombieFindings.some((item) => item.code === 'genre_hollowing'))
      assert.ok(xianxiaFindings.some((item) => item.code === 'genre_hollowing'))
      assert.ok(wuxiaFindings.some((item) => item.code === 'genre_hollowing'))
      assert.match(guardrails.formatQualityGuardrailSummary(xianxiaFindings).join('\n'), /体裁|修仙/u)
    },
  },  {
    name: 'quality guardrails catch object mismatch and zero-cost resolution',
    run() {
      const findings = guardrails.collectQualityGuardrailFindings('\u7535\u7f51\u6b7b\u4ea1\u4e4b\u540e\uff0c\u5e78\u5b58\u8005\u7acb\u523b\u6062\u590d\uff0c\u4e00\u4e0b\u5b50\u5c31\u5168\u90e8\u540c\u610f\u4e86\u8fd9\u4e2a\u51b3\u5b9a\u3002', '\u672b\u4e16')
      const codes = findings.map((item) => item.code)
      assert.ok(codes.includes('object_category_mismatch'))
      assert.ok(codes.includes('zero_cost_resolution'))
      assert.equal(guardrails.shouldForceRepair(findings), true)
      const summary = guardrails.formatQualityGuardrailSummary(findings).join('\n')
      assert.match(summary, /\[\u9ad8\]|\[\u4e2d\]/u)
      assert.match(summary, /\u4f8b\u5b50\uff1a/u)
    },
  },
  {
    name: 'quality guardrails catch id pollution relation labels and abstract packaging',
    run() {
      const findings = guardrails.collectQualityGuardrailFindings(
        '\u89d2\u8272#12\u5728\u5730\u70b9#7\u548c\u89d2\u8272#4\u78b0\u5934\uff0c\u4ed6\u4eec\u4e24\u4eba\u4e0d\u8fc7\u662f\u5bbf\u654c\u5173\u7cfb\uff0c\u538b\u8feb\u611f\u5728\u5fc3\u5e95\u8513\u5ef6\u3002',
        '\u672b\u4e16',
      )
      const codes = findings.map((item) => item.code)
      assert.ok(codes.includes('id_pollution'))
      assert.ok(codes.includes('relation_labelization'))
      assert.ok(codes.includes('abstract_emotion_packaging'))
    },
  },
  {
    name: 'prompt library taskFocus and extraLines are fully unified to Chinese',
    run() {
      for (const snippet of removedEnglishGuardrailSnippets) {
        assert.doesNotMatch(promptLibrarySource, new RegExp(escapeRegExp(snippet)))
      }
      assert.doesNotMatch(promptLibrarySource, /taskFocus:\s*'\?{3,}/)
      assert.doesNotMatch(promptLibrarySource, /extra(?:Context|Reality|Quality)Lines:\s*\['\?{3,}/)
      assert.match(promptLibrarySource, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
    },
  },
  {
    name: 'prompt library JSON examples avoid smart quote schemas',
    run() {
      assert.doesNotMatch(promptLibrarySource, /\u53ea\u8f93\u51fa JSON\uff1a\{[^\n]*[\u201c\u201d]/u)
    },
  },
  {
    name: 'zombie prompt chain keeps survival realism from planning to chapter and subplot',
    run() {
      const worldRules = buildWorldRulesSummary('\u672b\u4e16')
      const arcPrompt = prompt.buildStoryArcPlanningPrompt({
        novelTitle: '\u5c01\u9501\u7ebf',
        genre: '\u672b\u4e16',
        storyGoal: '\u5e26\u7740\u4e09\u5341\u540d\u5e78\u5b58\u8005\u7a7f\u8fc7\u5c01\u9501\u57ce\u533a\uff0c\u5efa\u7acb\u53ef\u6301\u7eed\u636e\u70b9\u3002',
        coreConflict: '\u836f\u54c1\u3001\u71c3\u6599\u548c\u6536\u5bb9\u540d\u989d\u90fd\u4e0d\u591f\uff0c\u961f\u4f0d\u5185\u90e8\u5bf9\u5206\u914d\u548c\u6551\u63f4\u987a\u5e8f\u6301\u7eed\u5206\u88c2\u3002',
        mainPlot: '\u4e3b\u89d2\u8981\u5728\u611f\u67d3\u98ce\u9669\u548c\u7ec4\u7ec7\u74e6\u89e3\u4e4b\u524d\uff0c\u628a\u65e7\u57ce\u533a\u8bca\u6240\u4e0e\u9ad8\u67b6\u6865\u8865\u7ed9\u7ebf\u90fd\u63a5\u8fdb\u907f\u96be\u6240\u4f53\u7cfb\u3002',
        subPlots: '\u65e7\u8bca\u6240\u836f\u54c1\u7ebf\uff1b\u8f66\u961f\u7eaa\u5f8b\u7ebf\uff1b\u4e34\u65f6\u6536\u5bb9\u8005\u7b5b\u67e5\u7ebf\u3002',
        ending: '\u961f\u4f0d\u5b88\u4f4f\u636e\u70b9\uff0c\u4f46\u5fc5\u987b\u627f\u8ba4\u6709\u4e9b\u4eba\u6551\u4e0d\u56de\u6765\u3002',
        totalChapters: 96,
        rhythmSummary: '\u524d\u6bb5\u5b88\u70b9\uff0c\u4e2d\u6bb5\u8fc1\u79fb\uff0c\u540e\u6bb5\u6e05\u7b97\u4e0e\u6536\u675f\u3002',
        background: '\u707e\u53d8\u540e\u7b2c\u5341\u4e8c\u5929\uff0c\u65e7\u57ce\u533a\u505c\u7535\uff0c\u611f\u67d3\u901a\u8fc7\u4f24\u53e3\u548c\u4f53\u6db2\u4f20\u64ad\uff0c\u533b\u9662\u4f53\u7cfb\u5df2\u5d29\u3002',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u6d89\u53ca\u4e3b\u89d2\u65f6\u53ea\u7528\u201c\u4e3b\u89d2\u201d\uff0c\u4e0d\u8981\u6539\u540d\u3002',
      })
      assert.match(arcPrompt, /\u771f\u5b9e\u5ea6=\u4e25\u683c\u5199\u5b9e/u)
      assert.match(arcPrompt, /\u611f\u67d3\u4f20\u64ad/u)
      assert.match(arcPrompt, /\u8d44\u6e90\u6d88\u8017/u)
      assert.match(arcPrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
      assert.doesNotMatch(arcPrompt, /Each arc must deepen/u)

      const chapterPrompt = prompt.buildChapterWritingPrompt({
        novelTitle: '\u5c01\u9501\u7ebf',
        genre: '\u672b\u4e16',
        chapterNum: 18,
        chapterTitle: '\u65e7\u8bca\u6240',
        chapterGoal: '\u62ff\u5230\u6297\u751f\u7d20\u5e76\u51b3\u5b9a\u5148\u7ed9\u8c01\u7528\uff0c\u540c\u65f6\u538b\u4f4f\u961f\u4f0d\u5206\u88c2\u3002',
        plotPoints: '\u8fdb\u5165\u65e7\u8bca\u6240\uff1b\u786e\u8ba4\u836f\u91cf\u4e0d\u8db3\uff1b\u95e8\u53e3\u5c38\u7fa4\u88ab\u566a\u58f0\u5f15\u6765\uff1b\u51b3\u5b9a\u662f\u5426\u5e26\u8d70\u9ad8\u70ed\u4f24\u5458\u3002',
        emotionTone: '\u538b\u8feb\u3001\u514b\u5236\u3001\u968f\u65f6\u4f1a\u5931\u63a7',
        targetWords: 2600,
        storyCore: '\u4e3b\u89d2\u5fc5\u987b\u5728\u73b0\u5b9e\u4ee3\u4ef7\u4e0b\u7ef4\u6301\u961f\u4f0d\u79e9\u5e8f\uff0c\u4e0d\u80fd\u9760\u70ed\u8840\u53e3\u53f7\u89e3\u51b3\u5206\u914d\u51b2\u7a81\u3002',
        currentArc: '\u8fc1\u79fb\u524d\u591c\u7684\u8d44\u6e90\u4e89\u593a',
        worldRules,
        characterStates: '\u4e3b\u89d2\u53f3\u80a9\u65e7\u4f24\u672a\u6108\uff1b\u5468\u8861\u53d1\u70ed\uff1b\u5510\u9759\u503c\u5b88\u8f66\u95e8\u3002',
        previousSummaries: '\u4e0a\u4e00\u7ae0\u521a\u786e\u8ba4\u6865\u9762\u5835\u6b7b\uff0c\u53ea\u5269\u8bca\u6240\u540e\u95e8\u53ef\u8fdb\u3002',
        lastChapterEnding: '\u95e8\u9501\u88ab\u649c\u5f00\uff0c\u91cc\u9762\u4f20\u51fa\u73bb\u7483\u5760\u5730\u58f0\u3002',
        styleTemplate: '\u51b7\u786c\u3001\u8282\u5236\u3001\u52a8\u4f5c\u4f18\u5148\u3002',
        continuitySummary: '\u836f\u54c1\u4f59\u91cf\u3001\u8f66\u8f86\u6cb9\u91cf\u548c\u4e3b\u89d2\u65e7\u4f24\u90fd\u8981\u6301\u7eed\u8ffd\u8e2a\u3002',
        openLoops: '\u5468\u8861\u5230\u5e95\u662f\u5426\u611f\u67d3\uff1b\u540e\u95e8\u58f0\u54cd\u6765\u81ea\u8c01\u3002',
        continuityNotes: '\u4e0d\u80fd\u5fd8\u8bb0\u961f\u4f0d\u5148\u524d\u5df2\u7ecf\u7ea6\u5b9a\u91cd\u4f24\u4f18\u5148\uff0c\u4f46\u8f66\u961f\u53f8\u673a\u5728\u53cd\u5bf9\u3002',
        timelineSummary: '\u707e\u53d8\u540e\u7b2c\u5341\u4e8c\u5929 19:40',
        timelineOpenThreads: '\u591c\u91cc\u5fc5\u987b\u8d76\u56de\u9ad8\u67b6\u6865\u4e0b\uff0c\u5426\u5219\u8f66\u961f\u4f1a\u88ab\u66b4\u9732\u3002',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u6d89\u53ca\u4e3b\u89d2\u65f6\u53ea\u7528\u201c\u4e3b\u89d2\u201d\uff0c\u4e0d\u8981\u6539\u540d\u3002',
      })
      assert.match(chapterPrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
      assert.doesNotMatch(chapterPrompt, /Write only what the current outline/u)
      assert.match(chapterPrompt, /\u4f24\u75c5\u6062\u590d/u)
      assert.match(chapterPrompt, /\u8865\u7ed9\u5206\u914d/u)

      const subplotPrompt = prompt.subplotExpandPrompt({
        novelTitle: '\u5c01\u9501\u7ebf',
        genreContext: '\u672b\u4e16',
        mainPlot: '\u961f\u4f0d\u8981\u5728\u8fc1\u79fb\u548c\u6536\u5bb9\u4e4b\u95f4\u7ef4\u6301\u79e9\u5e8f\uff0c\u5426\u5219\u907f\u96be\u6240\u4f1a\u5148\u4ece\u5185\u90e8\u88c2\u5f00\u3002',
        subplot: {
          name: '\u65e7\u8bca\u6240\u836f\u54c1\u7ebf',
          characters: '\u4e3b\u89d2,\u5468\u8861,\u5510\u9759',
          conflict: '\u961f\u4f0d\u5728\u65e7\u8bca\u6240\u627e\u5230\u4e00\u6279\u6297\u751f\u7d20\uff0c\u4f46\u5e26\u8d70\u836f\u54c1\u548c\u5e26\u8d70\u4f24\u5458\u4e0d\u80fd\u540c\u65f6\u5b8c\u6210\u3002',
          mainlineLink: '\u836f\u54c1\u5206\u914d\u4f1a\u628a\u907f\u96be\u6240\u5185\u90e8\u7684\u516c\u5e73\u88c2\u75d5\u63d0\u524d\u6495\u5f00\uff0c\u76f4\u63a5\u5f71\u54cd\u540e\u7eed\u8fc1\u79fb\u7eaa\u5f8b\u3002',
          endChapter: '26',
        },
        requirements: '\u5f3a\u8c03\u4f24\u53e3\u611f\u67d3\u3001\u566a\u58f0\u66b4\u9732\u3001\u8865\u7ed9\u4f18\u5148\u7ea7\u548c\u98ce\u9669\u627f\u62c5\u8005\u3002',
      })
      assert.match(subplotPrompt, /\u771f\u5b9e\u5ea6=\u4e25\u683c\u5199\u5b9e/u)
      assert.match(subplotPrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
      assert.doesNotMatch(subplotPrompt, /The subplot must stay useful/u)
      assert.match(subplotPrompt, /\u98ce\u9669\u627f\u62c5/u)
    },
  },
  {
    name: 'fantasy prompt chain keeps rank and resource logic explicit',
    run() {
      const worldRules = buildWorldRulesSummary('\u7384\u5e7b\u5347\u7ea7')
      const arcPrompt = prompt.buildStoryArcPlanningPrompt({
        novelTitle: '\u7070\u70ec\u738b\u5ea7',
        genre: '\u7384\u5e7b\u5347\u7ea7',
        storyGoal: '\u4e3b\u89d2\u8981\u5728\u77ff\u57ce\u5d29\u76d8\u524d\u62ff\u5230\u8fdb\u5165\u53e4\u6218\u573a\u7684\u8d44\u683c\u3002',
        coreConflict: '\u8840\u8109\u7b49\u7ea7\u538b\u5236\u3001\u77ff\u8109\u8d44\u6e90\u5784\u65ad\u548c\u5bb6\u65cf\u65e7\u503a\u628a\u4e3b\u89d2\u903c\u8fdb\u4e00\u6761\u9ad8\u4ee3\u4ef7\u664b\u5347\u8def\u3002',
        mainPlot: '\u4e3b\u89d2\u9760\u6b8b\u7f3a\u4f20\u627f\u548c\u77ff\u57ce\u8bd5\u70bc\u5f80\u4e0a\u722c\uff0c\u4f46\u6bcf\u6b21\u664b\u5347\u90fd\u8981\u5728\u5bb6\u65cf\u3001\u519b\u5e9c\u548c\u9057\u8ff9\u4e4b\u95f4\u505a\u53d6\u820d\u3002',
        subPlots: '\u519b\u5e9c\u62db\u52df\u7ebf\uff1b\u5bb6\u65cf\u503a\u52a1\u7ebf\uff1b\u53e4\u6218\u573a\u540d\u989d\u7ebf\u3002',
        ending: '\u4e3b\u89d2\u62ff\u5230\u66f4\u9ad8\u9636\u4f20\u627f\uff0c\u5374\u4e5f\u628a\u77ff\u57ce\u63a8\u5165\u5168\u9762\u7ad9\u961f\u3002',
        totalChapters: 120,
        rhythmSummary: '\u524d\u6bb5\u7acb\u8db3\uff0c\u4e2d\u6bb5\u593a\u8d44\u6e90\uff0c\u540e\u6bb5\u5f00\u6218\u573a\u4e0e\u56de\u6536\u65e7\u503a\u3002',
        background: '\u8fb9\u9672\u77ff\u57ce\u7531\u4e09\u5927\u52bf\u529b\u74dc\u5206\uff0c\u9057\u8ff9\u82cf\u9192\u5e26\u6765\u664b\u5347\u673a\u4f1a\uff0c\u4e5f\u653e\u5927\u7b49\u7ea7\u5dee\u8ddd\u548c\u8d44\u6e90\u4e89\u593a\u3002',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u6d89\u53ca\u4e3b\u89d2\u65f6\u53ea\u7528\u201c\u4e3b\u89d2\u201d\uff0c\u4e0d\u8981\u6539\u540d\u3002',
      })
      assert.match(arcPrompt, /\u771f\u5b9e\u5ea6=\u89c4\u5219\u5199\u5b9e/u)
      assert.match(arcPrompt, /\u7b49\u7ea7\u5dee\u8ddd/u)
      assert.match(arcPrompt, /\u6218\u6597\u4ee3\u4ef7/u)
      assert.match(arcPrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
      assert.doesNotMatch(arcPrompt, /Each arc must deepen/u)

      const chapterPrompt = prompt.buildChapterWritingPrompt({
        novelTitle: '\u7070\u70ec\u738b\u5ea7',
        chapterNum: 27,
        chapterTitle: '\u77ff\u8109\u8bd5\u950b',
        chapterGoal: '\u4e3b\u89d2\u5fc5\u987b\u62ff\u5230\u8bd5\u70bc\u540d\u989d\uff0c\u4f46\u4e0d\u80fd\u66b4\u9732\u6b8b\u7f3a\u4f20\u627f\u7684\u771f\u5b9e\u6765\u6e90\u3002',
        plotPoints: '\u8bd5\u70bc\u524d\u9a8c\u8eab\uff1b\u77ff\u8109\u4e89\u593a\uff1b\u519b\u5e9c\u63d2\u624b\uff1b\u4e3b\u89d2\u4ee5\u66f4\u9ad8\u4ee3\u4ef7\u6362\u5230\u5165\u573a\u8d44\u683c\u3002',
        emotionTone: '\u7d27\u7ef7\u3001\u514b\u5236\u3001\u6697\u6d41\u7ffb\u6d8c',
        targetWords: 3000,
        storyCore: '\u664b\u5347\u4e0d\u662f\u8bb8\u613f\uff0c\u800c\u662f\u8d44\u6e90\u3001\u7b49\u7ea7\u548c\u9635\u8425\u538b\u529b\u540c\u65f6\u6536\u7d27\u540e\u7684\u9009\u62e9\u3002',
        currentArc: '\u53e4\u6218\u573a\u8d44\u683c\u4e89\u593a',
        worldRules,
        characterStates: '\u4e3b\u89d2\u7075\u8109\u53d7\u635f\u672a\u7a33\uff1b\u97e9\u7b56\u76ef\u4e0a\u4e3b\u89d2\u7684\u529f\u6cd5\u6765\u6e90\u3002',
        previousSummaries: '\u4e0a\u4e00\u7ae0\u521a\u786e\u8ba4\u77ff\u57ce\u519b\u5e9c\u8981\u6536\u56de\u79c1\u4eba\u8bd5\u70bc\u5e2d\u4f4d\u3002',
        lastChapterEnding: '\u519b\u5e9c\u957f\u9636\u4e0b\uff0c\u4e3b\u89d2\u770b\u89c1\u672c\u8be5\u5c01\u5b58\u7684\u53e4\u7eb9\u77f3\u3002',
        styleTemplate: '\u5229\u843d\u3001\u538b\u7f29\u3001\u5c11\u7a7a\u8bdd\u3002',
        continuitySummary: '\u8bd5\u70bc\u540d\u989d\u3001\u5bb6\u65cf\u65e7\u503a\u548c\u6b8b\u7f3a\u4f20\u627f\u7684\u66b4\u9732\u98ce\u9669\u8981\u5e76\u884c\u63a8\u8fdb\u3002',
        openLoops: '\u53e4\u7eb9\u77f3\u4e3a\u4f55\u63d0\u524d\u73b0\u4e16\uff1b\u97e9\u7b56\u662f\u5426\u5df2\u7ecf\u786e\u8ba4\u4e3b\u89d2\u8eab\u4efd\u3002',
        continuityNotes: '\u4e0d\u80fd\u5fd8\u8bb0\u4e3b\u89d2\u524d\u7ae0\u5df2\u7ecf\u6d88\u8017\u4e86\u4e00\u6b21\u8d8a\u9636\u7206\u53d1\u3002',
        timelineSummary: '\u77ff\u57ce\u5386 3 \u6708\u4e0a\u65ec',
        timelineOpenThreads: '\u82e5\u672c\u7ae0\u62ff\u4e0d\u5230\u540d\u989d\uff0c\u4e0b\u7ae0\u5c31\u4f1a\u88ab\u8e22\u51fa\u53e4\u6218\u573a\u540d\u5355\u3002',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u6d89\u53ca\u4e3b\u89d2\u65f6\u53ea\u7528\u201c\u4e3b\u89d2\u201d\uff0c\u4e0d\u8981\u6539\u540d\u3002',
      })
      assert.match(chapterPrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
      assert.doesNotMatch(chapterPrompt, /Write only what the current outline/u)
      assert.match(chapterPrompt, /\u7b49\u7ea7\u5dee\u8ddd/u)
      assert.match(chapterPrompt, /\u6218\u6597\u4ee3\u4ef7/u)

      const expandPrompt = prompt.genericExpandPrompt({
        contentType: '\u529b\u91cf\u4f53\u7cfb',
        existingContent: '\u706b\u7eb9\u7075\u8109\u53ea\u5728\u53e4\u6218\u573a\u8fb9\u7f18\u82cf\u9192\uff0c\u8d8a\u9636\u5f15\u71c3\u4f1a\u53cd\u566c\u7ecf\u8109\u3002',
        novelContext: '\u8fb9\u9672\u77ff\u57ce\u7684\u664b\u5347\u79e9\u5e8f\u7531\u5bb6\u65cf\u8840\u8109\u3001\u519b\u5e9c\u8bb8\u53ef\u548c\u9057\u8ff9\u8d44\u6e90\u5171\u540c\u51b3\u5b9a\u3002',
        genreContext: '\u7384\u5e7b\u5347\u7ea7',
        requirements: '\u8865\u6e05\u7b49\u7ea7\u95e8\u69db\u3001\u8d44\u6e90\u6765\u6e90\u3001\u5931\u8d25\u4ee3\u4ef7\u548c\u52bf\u529b\u4e89\u593a\u65b9\u5f0f\u3002',
      })
      assert.match(expandPrompt, /\u771f\u5b9e\u5ea6=\u89c4\u5219\u5199\u5b9e/u)
      assert.match(expandPrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
      assert.doesNotMatch(expandPrompt, /Expand only the current content type/u)
    },
  },
  {
    name: 'xianxia prompt chain keeps realm, sect, and causality rules explicit',
    run() {
      const worldRules = buildWorldRulesSummary('\u4ed9\u4fa0\u4fee\u771f')
      const outlinePrompt = prompt.buildChapterOutlinePlanningPrompt({
        novelTitle: '\u5c71\u95e8\u65e7\u96ea',
        genre: '\u4ed9\u4fa0\u4fee\u771f',
        storyGoal: '\u4e3b\u89d2\u8981\u5728\u5916\u95e8\u88ab\u6e05\u6d17\u524d\u67e5\u6e05\u5e08\u7236\u9668\u843d\u771f\u76f8\u3002',
        coreConflict: '\u5b97\u95e8\u793c\u6cd5\u8981\u6c42\u670d\u4ece\uff0c\u5e08\u627f\u56e0\u679c\u5374\u903c\u7740\u4e3b\u89d2\u8ffd\u67e5\u88ab\u5c01\u5b58\u7684\u65e7\u6848\u3002',
        mainPlot: '\u4e3b\u89d2\u5728\u5916\u95e8\u8bd5\u70bc\u3001\u79d8\u5883\u7ebf\u7d22\u548c\u957f\u8001\u535a\u5f08\u4e4b\u95f4\u5bfb\u627e\u771f\u76f8\uff0c\u540c\u65f6\u8fd8\u8981\u7ef4\u6301\u81ea\u5df1\u7684\u4fee\u4e3a\u8fdb\u5ea6\u3002',
        arcName: '\u5916\u95e8\u8bd5\u70bc',
        arcGoal: '\u62ff\u5230\u5165\u79d8\u5883\u8d44\u683c\uff0c\u5e76\u786e\u8ba4\u65e7\u6848\u7ebf\u7d22\u6307\u5411\u54ea\u4e00\u8109\u3002',
        arcSummary: '\u4e3b\u89d2\u5148\u7a33\u4f4f\u8eab\u4efd\uff0c\u518d\u501f\u8bd5\u70bc\u63a5\u8fd1\u79d8\u5883\u4e0e\u957f\u8001\u7cfb\u8c31\u3002',
        chapterStart: 21,
        chapterEnd: 28,
        previousSummary: '\u4e3b\u89d2\u521a\u5728\u4e39\u623f\u907f\u8fc7\u4e00\u6b21\u641c\u67e5\uff0c\u4f46\u7075\u77f3\u50a8\u5907\u5df2\u7ecf\u89c1\u5e95\u3002',
        characterStates: '\u4e3b\u89d2\u7b51\u57fa\u672a\u7a33\uff1b\u987e\u5e08\u5144\u6000\u7591\u4e3b\u89d2\u79c1\u85cf\u624b\u672d\uff1b\u6267\u5f8b\u957f\u8001\u5173\u6ce8\u4e39\u623f\u5931\u7a83\u3002',
        continuitySummary: '\u624b\u672d\u6765\u6e90\u3001\u4e39\u623f\u65e7\u8d26\u548c\u4e3b\u89d2\u7075\u77f3\u652f\u51fa\u5fc5\u987b\u6301\u7eed\u8ddf\u8e2a\u3002',
        openLoops: '\u5e08\u7236\u624b\u672d\u4e3a\u4f55\u51fa\u73b0\u5728\u7981\u5e93\uff1b\u6267\u5f8b\u5802\u662f\u5426\u5df2\u7ecf\u5e03\u63a7\u5c71\u95e8\u3002',
        worldRulesSummary: worldRules,
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u6d89\u53ca\u4e3b\u89d2\u65f6\u53ea\u7528\u201c\u4e3b\u89d2\u201d\uff0c\u4e0d\u8981\u6539\u540d\u3002',
      })
      assert.match(outlinePrompt, /\u771f\u5b9e\u5ea6=\u89c4\u5219\u5199\u5b9e/u)
      assert.match(outlinePrompt, /\u5883\u754c\u5dee\u8ddd/u)
      assert.match(outlinePrompt, /\u5b97\u95e8\u793c\u6cd5/u)
      assert.match(outlinePrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
      assert.doesNotMatch(outlinePrompt, /Chapter goals, bridges, and plot points/u)

      const chapterPrompt = prompt.buildChapterWritingPrompt({
        novelTitle: '\u5c71\u95e8\u65e7\u96ea',
        genre: '\u4ed9\u4fa0\u4fee\u771f',
        chapterNum: 24,
        chapterTitle: '\u7981\u5e93\u98ce\u58f0',
        chapterGoal: '\u4e3b\u89d2\u8981\u5728\u4e0d\u60ca\u52a8\u6267\u5f8b\u5802\u7684\u524d\u63d0\u4e0b\u786e\u8ba4\u624b\u672d\u6b8b\u9875\u662f\u5426\u5728\u7981\u5e93\u3002',
        plotPoints: '\u501f\u8bd5\u70bc\u540d\u76ee\u9760\u8fd1\u7981\u5e93\uff1b\u987e\u5e08\u5144\u8bd5\u63a2\uff1b\u6b8b\u9875\u73b0\u8eab\uff1b\u4e3b\u89d2\u5fc5\u987b\u51b3\u5b9a\u8ffd\u67e5\u8fd8\u662f\u5148\u64a4\u3002',
        emotionTone: '\u514b\u5236\u3001\u9634\u51b7\u3001\u6b65\u6b65\u8bd5\u63a2',
        targetWords: 2800,
        storyCore: '\u4fee\u4e3a\u3001\u5b97\u95e8\u79e9\u5e8f\u548c\u5e08\u627f\u56e0\u679c\u540c\u65f6\u6536\u7d27\uff0c\u4e3b\u89d2\u6bcf\u4e00\u6b65\u90fd\u8981\u4ed8\u51fa\u8eab\u4efd\u548c\u8d44\u6e90\u4ee3\u4ef7\u3002',
        currentArc: '\u5916\u95e8\u8bd5\u70bc',
        worldRules,
        characterStates: '\u4e3b\u89d2\u7075\u529b\u4e0d\u8db3\uff1b\u987e\u5e08\u5144\u8868\u9762\u5e2e\u5fd9\uff0c\u5b9e\u5219\u8bd5\u63a2\uff1b\u6267\u5f8b\u5802\u5f1f\u5b50\u5728\u5de1\u5c71\u3002',
        previousSummaries: '\u4e0a\u4e00\u7ae0\u4e3b\u89d2\u786e\u8ba4\u624b\u672d\u6b8b\u9875\u66fe\u88ab\u8f6c\u5165\u7981\u5e93\uff0c\u4f46\u624b\u7eed\u5f02\u5e38\u3002',
        lastChapterEnding: '\u591c\u949f\u6572\u8fc7\u4e09\u58f0\uff0c\u7981\u5e93\u5916\u7684\u9635\u7eb9\u4eae\u4e86\u3002',
        styleTemplate: '\u6536\u675f\u3001\u514b\u5236\u3001\u8ba9\u52a8\u4f5c\u548c\u89c4\u77e9\u5148\u8bf4\u8bdd\u3002',
        continuitySummary: '\u7075\u77f3\u6d88\u8017\u3001\u4fee\u4e3a\u6ce2\u52a8\u548c\u5b97\u95e8\u89c6\u7ebf\u90fd\u8981\u6301\u7eed\u5b58\u5728\u3002',
        openLoops: '\u6b8b\u9875\u662f\u5426\u771f\u5728\u7981\u5e93\uff1b\u987e\u5e08\u5144\u7ad9\u5728\u54ea\u4e00\u8fb9\u3002',
        continuityNotes: '\u4e0d\u80fd\u5fd8\u8bb0\u4e3b\u89d2\u524d\u7ae0\u5df2\u7ecf\u627f\u8bfa\u4e24\u65e5\u540e\u53c2\u52a0\u8bd5\u70bc\u590d\u6838\u3002',
        timelineSummary: '\u5b97\u95e8\u5386 \u5bd2\u9732\u540e\u7b2c\u4e09\u591c',
        timelineOpenThreads: '\u82e5\u4eca\u665a\u66b4\u9732\uff0c\u4e0b\u7ae0\u5c31\u4f1a\u5931\u53bb\u8fdb\u5165\u79d8\u5883\u7684\u8d44\u683c\u3002',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u6d89\u53ca\u4e3b\u89d2\u65f6\u53ea\u7528\u201c\u4e3b\u89d2\u201d\uff0c\u4e0d\u8981\u6539\u540d\u3002',
      })
      assert.match(chapterPrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)
      assert.doesNotMatch(chapterPrompt, /Write only what the current outline/u)
      assert.match(chapterPrompt, /\u529f\u6cd5\u6765\u6e90/u)
      assert.match(chapterPrompt, /\u95ed\u5173\u5468\u671f/u)
      assert.match(chapterPrompt, /\u56e0\u679c\u62a5\u5e94/u)
    },
  },
  {
    name: 'wuxia prompt chain keeps jianghu order and realistic pressure explicit',
    run() {
      const worldRules = buildWorldRulesSummary('\u6b66\u4fa0\u5199\u5b9e')
      const arcPrompt = prompt.buildStoryArcPlanningPrompt({
        novelTitle: '\u6e21\u53e3\u65e7\u4e8b',
        genre: '\u6b66\u4fa0\u5199\u5b9e',
        storyGoal: '\u4e3b\u89d2\u8981\u628a\u65e7\u6848\u8d26\u518c\u9001\u51fa\u6c5f\u5357\uff0c\u5728\u5b98\u9762\u5c01\u9501\u524d\u66ff\u67d0\u5bb6\u6d17\u6389\u51a4\u540d\u3002',
        coreConflict: '\u4e3b\u89d2\u65e2\u6709\u88ab\u9010\u5e08\u95e8\u7684\u65e7\u503a\uff0c\u53c8\u88ab\u7f09\u4e8b\u673a\u6784\u548c\u65e7\u4ec7\u540c\u65f6\u8ffd\u6355\uff0c\u4f24\u52bf\u3001\u76d8\u7f20\u548c\u8bc1\u4eba\u5b89\u5371\u90fd\u5728\u7d27\u7f29\u3002',
        mainPlot: '\u4e3b\u89d2\u62a4\u9001\u8bc1\u4eba\u7a7f\u8fc7\u9547\u53e3\u3001\u6e21\u53e3\u548c\u95e8\u6d3e\u65e7\u5730\uff0c\u4e00\u8def\u8981\u5728\u62a4\u4eba\u3001\u8fd8\u503a\u548c\u81ea\u4fdd\u4e4b\u95f4\u505a\u9009\u62e9\u3002',
        subPlots: '\u5e08\u95e8\u65e7\u503a\u7ebf\uff1b\u6e21\u53e3\u7ebf\u4eba\u7ebf\uff1b\u8bc1\u4eba\u4f24\u52bf\u7ebf\u3002',
        ending: '\u4e3b\u89d2\u9001\u51fa\u8d26\u518c\uff0c\u5374\u4e5f\u56e0\u6b64\u5f7b\u5e95\u4e0e\u5e08\u95e8\u5207\u5272\u3002',
        totalChapters: 88,
        rhythmSummary: '\u524d\u6bb5\u8d76\u8def\u8fc3\u907f\uff0c\u4e2d\u6bb5\u65e7\u6848\u53cd\u54ac\uff0c\u540e\u6bb5\u6e05\u7b97\u4eba\u60c5\u4e0e\u4ed8\u4ef7\u3002',
        background: '\u67d0\u671d\u672b\u5e74\uff0c\u5dde\u53bf\u6df7\u4e71\uff0c\u95e8\u6d3e\u3001\u9556\u5c40\u548c\u7f09\u4e8b\u623f\u90fd\u5728\u4e89\u4e00\u672c\u65e7\u8d26\u518c\u3002',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u6d89\u53ca\u4e3b\u89d2\u65f6\u53ea\u7528\u201c\u4e3b\u89d2\u201d\uff0c\u4e0d\u8981\u6539\u540d\u3002',
      })
      assert.match(arcPrompt, /\u6c5f\u6e56\u89c4\u77e9/u)
      assert.match(arcPrompt, /\u4f24\u75c5\u4ee3\u4ef7/u)
      assert.match(arcPrompt, /\u672c\u8f6e\u4efb\u52a1\u7126\u70b9/u)

      const scenePrompt = prompt.buildScenePlanPrompt({
        novelTitle: '\u6e21\u53e3\u65e7\u4e8b',
        genre: '\u6b66\u4fa0\u5199\u5b9e',
        chapterNum: 9,
        chapterTitle: '\u591c\u8fc7\u65ad\u7891\u6e21',
        chapterGoal: '\u4e3b\u89d2\u8981\u62a4\u9001\u53d7\u4f24\u8bc1\u4eba\u8fc7\u6cb3\uff0c\u540c\u65f6\u8eb2\u5f00\u65e7\u4ec7\u548c\u5b98\u5dee\u76d8\u67e5\u3002',
        plotPoints: '\u6e21\u53e3\u5c01\u9501\uff1b\u8bc1\u4eba\u53d1\u70ed\uff1b\u65e7\u4ec7\u8ba4\u51fa\u4e3b\u89d2\uff1b\u4e3b\u89d2\u51b3\u5b9a\u5f03\u8239\u8fd8\u662f\u8d3f\u8d42\u8239\u5bb6\u3002',
        emotionTone: '\u538b\u6291\u3001\u8b66\u89c9\u3001\u514b\u5236',
        targetWords: 2400,
        storyCore: '\u4e3b\u89d2\u5fc5\u987b\u5728\u4eba\u547d\u3001\u65e7\u503a\u548c\u5b98\u9762\u538b\u529b\u4e4b\u95f4\u505a\u53d6\u820d\uff0c\u4e0d\u80fd\u9760\u795e\u529f\u786c\u89e3\u3002',
        currentArc: '\u62bc\u9001\u8bc1\u4eba\u4e0e\u65e7\u6848\u53cd\u54ac',
        worldRules,
        characterStates: '\u4e3b\u89d2\u5de6\u80a9\u65e7\u4f24\u672a\u6108\uff1b\u8bc1\u4eba\u5931\u8840\u8fc7\u591a\uff1b\u540c\u4f34\u53ea\u5269\u534a\u888b\u788e\u94f6\u3002',
        itemSummary: '\u8def\u5f15\u4e00\u4efd\uff1b\u65e7\u6848\u8d26\u518c\u4e00\u518c\uff1b\u6b62\u8840\u836f\u534a\u5305\u3002',
        previousSummaries: '\u4e0a\u7ae0\u521a\u5f97\u77e5\u7f09\u4e8b\u623f\u5df2\u7ecf\u5c01\u6b7b\u5b98\u9053\uff0c\u53ea\u5269\u6e21\u53e3\u53ef\u8d70\u3002',
        lastChapterEnding: '\u6cb3\u9762\u8d77\u96fe\uff0c\u6e21\u53e3\u706b\u628a\u4e00\u76cf\u76cf\u4eae\u8d77\u6765\u3002',
        continuitySummary: '\u65e7\u4f24\u3001\u76d8\u7f20\u3001\u8d26\u518c\u53bb\u5411\u548c\u5b98\u5dee\u811a\u7a0b\u90fd\u8981\u6301\u7eed\u8ffd\u8e2a\u3002',
        openLoops: '\u8239\u5bb6\u662f\u5426\u53ef\u9760\uff1b\u65e7\u4ec7\u662f\u5426\u5df2\u548c\u5b98\u5dee\u4e32\u8054\u3002',
        continuityNotes: '\u4e3b\u89d2\u7b54\u5e94\u8fc7\u8bc1\u4eba\uff0c\u53ea\u8981\u4eba\u6ca1\u6b7b\u5c31\u4e0d\u4e22\u4e0b\u5979\u3002',
        timelineSummary: '\u67d0\u671d\u67d0\u5e74 \u79cb\u672b \u591c\u534a\u524d',
        timelineOpenThreads: '\u82e5\u4eca\u591c\u8fc7\u4e0d\u4e86\u6cb3\uff0c\u5929\u4eae\u540e\u5dde\u8859\u5c31\u4f1a\u5c01\u6e21\u3002',
        longTermMemory: '\u4e3b\u89d2\u66fe\u56e0\u8bef\u6740\u6848\u88ab\u9010\u51fa\u5e08\u95e8\uff0c\u5bf9\u5b98\u5e9c\u548c\u5e08\u95e8\u90fd\u4e0d\u518d\u8f7b\u4fe1\u3002',
        consistencyNotes: '\u6ce8\u610f\u4f24\u75c5\u3001\u8def\u7a0b\u3001\u94f6\u94b1\u548c\u6e21\u53e3\u79e9\u5e8f\u3002',
        protagonistReference: '\u4e3b\u89d2',
        protagonistRule: '\u6d89\u53ca\u4e3b\u89d2\u65f6\u53ea\u7528\u201c\u4e3b\u89d2\u201d\uff0c\u4e0d\u8981\u6539\u540d\u3002',
      })
      assert.match(scenePrompt, /\u6b66\u4fa0\u9898\u6750\u8981\u8ba9\u6c5f\u6e56\u89c4\u77e9/u)
      assert.match(scenePrompt, /\u94f6\u94b1/u)
      assert.match(scenePrompt, /\u5199\u5b9e\u6b66\u4fa0\u4f18\u5148\u670d\u4ece\u53f2\u5b9e\u4e0e\u793e\u4f1a\u5e38\u8bc6/u)
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
  console.log(`All ${tests.length} prompt guardrail tests passed.`)
}


