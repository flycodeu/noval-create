'use strict'

const assert = require('node:assert/strict')

async function run({ loadTypeScriptModule }) {
  const briefModule = loadTypeScriptModule('src/shared/scene-writing-brief.ts')
  const promptModule = loadTypeScriptModule('src/shared/prompt-library.ts')
  const brief = briefModule.buildSceneWritingBrief({
    scene_order: 1,
    scene_title: '冲突场',
    purpose: '拿到账册',
    conflict: '主角要求查账，管事拒绝',
    hidden_agendas: ['主角想找内鬼', '管事想保住亲属'],
    irony_gap: '读者知道账册已被调包，角色不知道',
    theme_cost: '失去队内信任',
  }, {
    targetWorkSampleGuide: '短句，保留现场物件。',
    humanStyleSampleLock: '他把账册压在膝上。\n\n门外有人敲了两下。\n\n第三段不应进入。',
  }, { chapterNum: 3, knownFacts: ['账册缺页'] })

  assert.equal(brief.scene.purpose, '拿到账册')
  assert.equal(brief.scene.hiddenAgendas.length, 2)
  assert.equal(brief.authorStyle.samples.length, 2)
  assert.ok(brief.authorStyle.estimatedTokens <= 600)
  assert.ok(brief.sourceKeys.includes('ScenePlanStep.theme_cost'))
  assert.ok(brief.sourceKeys.includes('ThemeVoice.targetWorkSampleGuide'))

  const formatted = briefModule.formatSceneWritingBrief(brief)
  assert.match(formatted, /不补造人物动机、经历、物件或关系/)
  assert.match(formatted, /作者说明（非正文样稿）/)
  assert.match(formatted, /作者样稿正文1/)

  const prompt = promptModule.buildScenePlanPrompt({
    novelTitle: 'NF-10 fixture', genre: '悬疑', chapterNum: 3, chapterTitle: '冲突场',
    chapterGoal: '拿到账册', plotPoints: '查账', emotionTone: '紧张', targetWords: 1200,
    storyCore: '追查内鬼', currentArc: '查账弧', worldRules: '', characterStates: '',
    itemSummary: '', previousSummaries: '', previousChapterContext: '', lastChapterEnding: '',
    continuitySummary: '', openLoops: '', continuityNotes: '', timelineSummary: '',
    timelineOpenThreads: '', longTermMemory: '', consistencyNotes: '', protagonistReference: '主角',
    protagonistRule: '沿用已有称呼', sceneWritingBrief: formatted,
  })
  assert.match(prompt, /场景写作材料/)
  assert.match(prompt, /作者样稿正文1/)
  return {
    cases: {
      '10-01': 'PASS', '10-02': 'PASS', '10-03': 'PASS',
      '10-04': 'PASS', '10-05': 'PASS', '10-06': 'PASS',
    },
    assertions: ['explicit scene fields and source keys', 'empty inputs stay empty', 'complete samples <=600 tokens', 'prompt contains one brief section'],
  }
}

module.exports = { run }
