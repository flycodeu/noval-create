const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { registerProjectTsRuntime } = require('./register-project-ts.cjs')

const workspaceRoot = path.resolve(__dirname, '..')
const tempRoot = path.resolve(workspaceRoot, '.tmp-tests', 'fast-launch-bootstrap')
if (!tempRoot.startsWith(`${workspaceRoot}${path.sep}`)) {
  throw new Error(`Refusing to use a temp directory outside the workspace: ${tempRoot}`)
}

fs.rmSync(tempRoot, { recursive: true, force: true })
fs.mkdirSync(tempRoot, { recursive: true })
process.env.NOVELFORGE_DISABLE_LEGACY_DB_COPY = '1'
app.setName('NovelForge Fast Launch Bootstrap Test')
app.setPath('userData', tempRoot)
app.commandLine.appendSwitch('disable-gpu')
registerProjectTsRuntime(workspaceRoot)

function project(relativePath) {
  return require(path.join(workspaceRoot, relativePath))
}

async function main() {
  await app.whenReady()

  const { closeDb, getDb, initDb } = project('electron/database/db.ts')
  const schema = project('electron/database/schema.ts')
  const novelService = project('electron/services/novel.service.ts')
  const characterService = project('electron/services/character.service.ts')
  const chapterService = project('electron/services/chapter.service.ts')
  const storyThreadService = project('electron/services/story-thread.service.ts')
  const storyStructureService = project('electron/services/story-structure.service.ts')
  const endgameAssetService = project('electron/services/endgame-asset.service.ts')
  const { buildFastLaunchBootstrapPlan } = project('src/pages/NovelList/fast-launch.ts')
  const { buildChapterWritingPrompt } = project('src/shared/prompts/writing-prompts.ts')
  const { validateChapterContractsForGeneration } = project('electron/services/context-impact.service.ts')
  const { buildStoryProfile, buildChapterContext } = project('electron/services/context.service.ts')

  initDb()
  const plan = buildFastLaunchBootstrapPlan({
    genreLabel: '末世求生',
    protagonistStart: '被逐出避难所的维修员',
    coreHook: '旧终端突然出现主城求救信号',
    coreConflict: '想救人就必须回到曾经背叛过他的主城',
    tabooRules: '禁止全知旁白；禁止无代价逆转',
    endgameDirection: '主角救下主城，但失去回归旧秩序的资格',
    targetWords: 80000,
  })

  try {
    const novelId = novelService.createNovel({
      title: plan.novel.title,
      synopsis: plan.novel.synopsis,
      launchMode: 'fast_launch',
      targetWords: plan.novel.targetWords,
    })
    novelService.updateNovel(novelId, {
      projectBriefJson: plan.novel.projectBriefJson,
      settingsJson: plan.novel.settingsJson,
      themeVoiceJson: plan.novel.themeVoiceJson,
      userBackground: plan.novel.userBackground,
      expandedBackground: plan.novel.expandedBackground,
    })

    const volumeId = storyStructureService.createStoryVolume(novelId, plan.volume)
    const arcInsert = getDb().insert(schema.storyArcs).values({ novelId, ...plan.outlineArc }).run()
    const arcId = Number(arcInsert.lastInsertRowid)
    const threadId = storyThreadService.createStoryThread(novelId, {
      threadType: 'main',
      title: plan.thread.title,
      summary: plan.thread.summary,
      premise: plan.thread.premise,
      status: 'planned',
      priority: 'high',
    })

    const chapterIds = plan.chapters.map((chapter) => chapterService.createChapter(novelId, {
      ...chapter,
      status: 'outline',
      volumeId,
      arcId,
    }))
    const chapterIdByNum = new Map(plan.chapters.map((chapter, index) => [chapter.chapterNum, chapterIds[index]]))

    for (const contract of plan.chapterContracts) {
      const chapterId = chapterIdByNum.get(contract.chapterNum)
      endgameAssetService.upsertChapterContract(chapterId, {
        chapterGoal: contract.chapterGoal,
        servedThreadIds: [threadId],
        forbiddenActions: contract.forbiddenActions,
        status: 'ready',
      })
    }
    const db = getDb()
    const count = (table) => db.select().from(table).all().length
    assert.equal(count(schema.characters), 0)
    assert.equal(count(schema.storyThreads), 1)
    assert.equal(count(schema.characterArcs), 0)
    assert.equal(count(schema.relationshipArcs), 0)
    assert.equal(count(schema.resistanceTracks), 0)
    assert.equal(count(schema.timelineEvents), 0)
    assert.equal(count(schema.chapterContracts), 3)
    assert.equal(count(schema.sceneContracts), 0)
    assert.equal(count(schema.chapterSegments), 3)
    const firstChapterProfile = await buildStoryProfile(novelId)
    assert.equal(firstChapterProfile.hasProtagonist, false)
    assert.equal(firstChapterProfile.protagonistName, '')
    assert.doesNotMatch(firstChapterProfile.protagonistRule, /唯一合法姓名|只能使用“主角”/)
    const firstChapterContext = await buildChapterContext(novelId, 1)
    assert.equal(JSON.stringify(firstChapterContext).includes('主角（待命名）'), false)
    const firstChapterPrompt = buildChapterWritingPrompt({
      ...firstChapterContext,
      novelTitle: firstChapterProfile.novelTitle,
      genre: firstChapterProfile.genre,
      chapterNum: 1,
      chapterTitle: plan.chapters[0].title,
      plotPoints: plan.chapters[0].outline,
      emotionTone: '',
      targetWords: plan.chapters[0].targetWords,
      protagonistReference: firstChapterProfile.protagonistReference,
      protagonistRule: firstChapterProfile.protagonistRule,
    })
    assert.doesNotMatch(firstChapterPrompt, /主角（待命名）|唯一合法姓名为“主角/)
    assert.match(firstChapterPrompt, /主角命名规则：主角尚未命名/)
    assert.throws(
      () => validateChapterContractsForGeneration(chapterIds[0]),
      /场景合同状态仍是草稿/,
    )

    // Test author confirmation after creation; the launcher itself must not supply this decision.
    const firstSegmentId = storyStructureService.listChapterSegments(chapterIds[0])[0]?.id
    assert.equal(typeof firstSegmentId, 'number')
    endgameAssetService.upsertSceneContract(chapterIds[0], firstSegmentId, {
      pov: '维修员',
      sceneGoal: '主角核查旧终端上的主城求救信号',
      obstacle: plan.outlineArc.arcGoal,
      resultState: '主角确认信号真实并决定继续核查',
      status: 'ready',
    })
    assert.doesNotThrow(() => validateChapterContractsForGeneration(chapterIds[0]))

    // Old fast-launch drafts may already contain this placeholder character.
    // It must not become the canonical name or leak into the first chapter context.
    characterService.createCharacter(novelId, {
      fullName: '主角（待命名）',
      roleType: 'protagonist',
      background: '被逐出避难所的维修员',
    })
    endgameAssetService.upsertSceneContract(chapterIds[0], firstSegmentId, {
      pov: '主角（待命名）',
      sceneGoal: '主角核查旧终端上的主城求救信号',
      obstacle: plan.outlineArc.arcGoal,
      resultState: '主角确认信号真实并决定继续核查',
      status: 'ready',
    })
    assert.equal(db.select().from(schema.sceneContracts).all()[0].pov, '主角（待命名）')
    const legacyProfile = await buildStoryProfile(novelId)
    assert.equal(legacyProfile.hasProtagonist, false)
    assert.equal(legacyProfile.protagonistName, '')
    assert.equal(JSON.stringify(await buildChapterContext(novelId, 1)).includes('主角（待命名）'), false)
    console.log('PASS fast launch bootstrap: draft blocks generation until the author confirms the first scene contract')
  } finally {
    closeDb()
    await app.quit()
  }
}

main().catch((error) => {
  console.error('[fast-launch-bootstrap] failed:', error.stack || error.message || error)
  process.exit(1)
})
