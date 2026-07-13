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
  const characterArcService = project('electron/services/character-arc.service.ts')
  const resistanceService = project('electron/services/resistance.service.ts')
  const chapterService = project('electron/services/chapter.service.ts')
  const timelineService = project('electron/services/timeline.service.ts')
  const storyThreadService = project('electron/services/story-thread.service.ts')
  const storyStructureService = project('electron/services/story-structure.service.ts')
  const endgameAssetService = project('electron/services/endgame-asset.service.ts')
  const { buildFastLaunchBootstrapPlan } = project('src/pages/NovelList/fast-launch.ts')
  const { validateChapterContractsForGeneration } = project('electron/services/context-impact.service.ts')

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
    const protagonistId = characterService.createCharacter(novelId, plan.protagonist)
    const antagonistId = characterService.createCharacter(novelId, plan.antagonist)
    const threadId = storyThreadService.createStoryThread(novelId, {
      threadType: 'main',
      title: plan.thread.title,
      summary: plan.thread.summary,
      premise: plan.thread.premise,
      status: 'planned',
      priority: 'high',
      currentState: '前三章内必须完成主线起势。',
    })

    characterService.upsertRelation({
      novelId,
      charAId: protagonistId,
      charBId: antagonistId,
      relationType: plan.relationshipArc.relationTypeSnapshot,
      relationLabel: plan.relationshipArc.relationLabelSnapshot,
      description: plan.relationshipArc.startState,
      bilateral: 1,
      tensionLevel: 80,
    })

    const chapterIds = plan.chapters.map((chapter) => chapterService.createChapter(novelId, {
      ...chapter,
      status: 'outline',
      volumeId,
      arcId,
    }))
    const chapterIdByNum = new Map(plan.chapters.map((chapter, index) => [chapter.chapterNum, chapterIds[index]]))

    const timelineIdsByChapterNum = new Map()
    for (const event of plan.timelineEvents) {
      timelineIdsByChapterNum.set(event.sortOrder, timelineService.createTimelineEvent(novelId, {
        ...event,
        timeMode: 'relative-disaster',
        volumeId,
        isMajorEvent: 1,
        protagonistPresent: 1,
      }))
    }

    const protagonistArcPlan = plan.characterArcs.find((arc) => arc.characterRole === 'protagonist')
    const antagonistArcPlan = plan.characterArcs.find((arc) => arc.characterRole === 'antagonist')
    const protagonistArc = characterArcService.upsertCharacterArc({
      novelId,
      characterId: protagonistId,
      ...protagonistArcPlan,
      firstCrackChapterId: chapterIdByNum.get(1),
      changeTimelineEventId: timelineIdsByChapterNum.get(1),
      currentStatus: 'active',
    })
    const antagonistArc = characterArcService.upsertCharacterArc({
      novelId,
      characterId: antagonistId,
      ...antagonistArcPlan,
      firstCrackChapterId: chapterIdByNum.get(1),
      changeTimelineEventId: timelineIdsByChapterNum.get(1),
      currentStatus: 'active',
    })
    const relationshipArc = characterArcService.upsertRelationshipArc({
      novelId,
      charAId: protagonistId,
      charBId: antagonistId,
      ...plan.relationshipArc,
      changeTimelineEventId: timelineIdsByChapterNum.get(1),
      currentStatus: 'active',
      lastProgressChapterId: chapterIdByNum.get(1),
    })
    const resistanceTrack = resistanceService.upsertTrack({
      novelId,
      sourceType: 'character',
      sourceId: antagonistId,
      resistanceKind: 'antagonist',
      ...plan.resistanceTrack,
      currentStatus: 'active',
      lastActionChapterId: chapterIdByNum.get(1),
      nextEscalationChapterId: chapterIdByNum.get(2),
      linkedVolumeId: volumeId,
    })

    characterArcService.upsertCharacterArcBeat({
      novelId,
      arcId: protagonistArc.id,
      beatType: 'start',
      chapterId: chapterIdByNum.get(1),
      timelineEventId: timelineIdsByChapterNum.get(1),
      title: '主角被迫进入主线',
      summary: protagonistArcPlan.changeEvent,
      status: 'planned',
      sortOrder: 1,
    })
    characterArcService.upsertCharacterArcBeat({
      novelId,
      arcId: antagonistArc.id,
      beatType: 'crack',
      chapterId: chapterIdByNum.get(1),
      timelineEventId: timelineIdsByChapterNum.get(1),
      title: '主要阻力开始升级',
      summary: antagonistArcPlan.changeEvent,
      status: 'planned',
      sortOrder: 1,
    })
    resistanceService.upsertBeat({
      novelId,
      trackId: resistanceTrack.id,
      beatType: 'strike',
      chapterId: chapterIdByNum.get(1),
      timelineEventId: timelineIdsByChapterNum.get(1),
      title: '主要阻力第一次出手',
      summary: plan.resistanceTrack.counterMove,
      actionMode: plan.resistanceTrack.currentPressureMode,
      successLevel: '部分成功',
      counterResponse: '主角保住继续追查的资格，但失去一条安全退路。',
      protagonistImpact: '主角确认必须主动追查核心钩子。',
      status: 'logged',
      sortOrder: 1,
    })

    for (const scene of plan.sceneContracts) {
      const chapterId = chapterIdByNum.get(scene.chapterNum)
      const existingSegments = storyStructureService.listChapterSegments(chapterId)
      const segmentId = existingSegments[0]?.id || storyStructureService.createChapterSegment(chapterId, {
        title: scene.segmentTitle,
        segmentType: 'scene',
        purpose: scene.purpose,
        timeAnchor: scene.timeLocation,
        locationName: '开篇主线现场',
        presentCharacterIdsJson: JSON.stringify([protagonistId, antagonistId]),
        inputState: scene.chapterNum === 1 ? '主角仍处在原有处境' : '承接上一章尚未解决的压力',
        outputState: scene.resultState,
        summary: scene.sceneGoal,
        status: 'planned',
      })
      if (existingSegments[0]?.id) {
        storyStructureService.updateChapterSegment(segmentId, {
          title: scene.segmentTitle,
          segmentType: 'scene',
          purpose: scene.purpose,
          timeAnchor: scene.timeLocation,
          locationName: '开篇主线现场',
          presentCharacterIdsJson: JSON.stringify([protagonistId, antagonistId]),
          inputState: scene.chapterNum === 1 ? '主角仍处在原有处境' : '承接上一章尚未解决的压力',
          outputState: scene.resultState,
          summary: scene.sceneGoal,
          status: 'planned',
        })
      }
      endgameAssetService.upsertSceneContract(chapterId, segmentId, {
        pov: plan.protagonist.fullName,
        timeLocation: scene.timeLocation,
        sceneGoal: scene.sceneGoal,
        obstacle: scene.obstacle,
        conflictType: scene.conflictType,
        emotionShift: scene.emotionShift,
        resultState: scene.resultState,
        linkageMode: scene.linkageMode,
        status: 'ready',
      })
    }

    for (const contract of plan.chapterContracts) {
      const chapterId = chapterIdByNum.get(contract.chapterNum)
      endgameAssetService.upsertChapterContract(chapterId, {
        ...contract,
        servedThreadIds: [threadId],
        requiredCharacterArcIds: [protagonistArc.id, antagonistArc.id],
        requiredRelationshipArcIds: [relationshipArc.id],
        requiredResistanceTrackIds: [resistanceTrack.id],
        requiredAssetRefs: [],
        requiredEndgameCommitmentIds: [],
        requiredForeshadowIds: [],
        status: 'ready',
      })
    }

    const db = getDb()
    const count = (table) => db.select().from(table).all().length
    assert.equal(count(schema.characterArcs), 2)
    assert.equal(count(schema.relationshipArcs), 1)
    assert.equal(count(schema.resistanceTracks), 1)
    assert.equal(count(schema.chapterContracts), 3)
    assert.equal(count(schema.sceneContracts), 3)
    assert.equal(count(schema.chapterSegments), 3)
    assert.doesNotThrow(() => validateChapterContractsForGeneration(chapterIds[0]))
    console.log('PASS fast launch bootstrap: arcs, relationship, resistance, chapter/scene contracts pass generation preflight')
  } finally {
    closeDb()
    await app.quit()
  }
}

main().catch((error) => {
  console.error('[fast-launch-bootstrap] failed:', error.stack || error.message || error)
  process.exit(1)
})
