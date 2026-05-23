import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('../utils/user-facing-error', () => ({
  throwUserFacingError: vi.fn((key: string) => {
    throw new Error(key)
  }),
}))

import { getDb } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  characterArcs,
  characters,
  foreshadowLedger,
  novels,
  relationshipArcs,
  sceneContracts,
  storyThreads,
} from '../database/schema'
import { validateChapterContractDelivery } from './chapter-contract-validator.service'

type TableRows = Map<unknown, Array<Record<string, unknown>>>

function createQuery(rowsByTable: TableRows, table: unknown) {
  const query: {
    where: () => typeof query
    orderBy: () => typeof query
    all: () => Array<Record<string, unknown>>
  } = {
    where: () => query,
    orderBy: () => query,
    all: () => rowsByTable.get(table) || [],
  }
  return query
}

function createDbMock(rowsByTable: TableRows) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => createQuery(rowsByTable, table)),
    })),
  }
}

function createBaseRows(content: string) {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [chapters, [{
      id: 10,
      novelId: 1,
      chapterNum: 12,
      title: '第十二章',
      content,
      scenePlanJson: JSON.stringify([{ exit_hook: '门外传来急促脚步声' }]),
    }]],
    [novels, [{
      id: 1,
      themeVoiceJson: '',
    }]],
    [chapterContracts, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
      chapterGoal: '让主线再向前推进一步',
      servedThreadIdsJson: JSON.stringify([100]),
      requiredForeshadowIdsJson: JSON.stringify([200]),
      requiredCharacterArcIdsJson: JSON.stringify([]),
      requiredRelationshipArcIdsJson: JSON.stringify([]),
      hookType: 'suspense',
    }]],
    [chapterSegments, [{
      id: 1001,
      novelId: 1,
      chapterId: 10,
      segmentOrder: 1,
      title: '场景一',
      purpose: '推进主线',
      outputState: '线索升级',
    }]],
    [sceneContracts, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
      segmentId: 1001,
      sceneGoal: '推进主线',
      obstacle: '守卫追查',
      resultState: '线索升级',
    }]],
    [storyThreads, [{
      id: 100,
      novelId: 1,
      title: '失窃药箱',
      currentState: '正在追查去向',
      payoffCondition: '确认药箱被转移',
      summary: '药箱失踪真相',
    }]],
    [foreshadowLedger, [{
      id: 200,
      novelId: 1,
      title: '旧仓暗门',
      detail: '旧仓藏着另一条出路',
      plantMethod: '门缝漏风',
      targetPayoffChapter: 14,
      payoffMethod: '追查时发现',
      payoffSceneAction: '推开暗门进入旧仓',
      requiredEvidence: '门后残留新脚印',
      readerVisibleOutcome: '药箱确实被转入旧仓',
      allowedDelayReason: '旧仓被封锁无法进入',
    }]],
    [characters, []],
    [characterArcs, []],
    [relationshipArcs, []],
  ])
}

describe('validateChapterContractDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes when chapter content provides direct evidence for goal, scene, thread, foreshadow, and hook', () => {
    const rows = createBaseRows(
      '夜晚的北门外，林远继续追查失窃药箱。守卫追查他的来路，两人险些动手。林远趁乱发现旧仓暗门，还确认药箱被转去旧仓，主线因此向前推进一步，线索也随之升级。\n\n他正要离开，门外忽然传来急促脚步声。',
    )
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.status).toBe('pass')
    expect(result.itemResults.every((item) => item.verdict === 'pass')).toBe(true)
    expect(result.rewriteHints).toHaveLength(0)
  })

  it('downgrades to warning when thread and foreshadow are only mentioned without actual progress', () => {
    const rows = createBaseRows(
      '夜晚的北门外，守卫追查林远的来路，两人险些动手。林远被迫改走小巷，但至少让主线向前推进一步，也让线索升级到西巷附近。\n\n他想起密封账册和窗棂刻痕，只是扫过这个念头，没有再看第二眼。门外忽然一阵风响，他只把这件事压回心里。',
    )
    Object.assign((rows.get(chapters) || [])[0], {
      scenePlanJson: JSON.stringify([]),
    })
    Object.assign((rows.get(storyThreads) || [])[0], {
      title: '密封账册',
      currentState: '账册下落不明',
      payoffCondition: '找到账册去向',
      summary: '账册藏着走私名单',
    })
    Object.assign((rows.get(foreshadowLedger) || [])[0], {
      title: '窗棂刻痕',
      detail: '窗框上留下异常刻痕',
      plantMethod: '镜头掠过',
      payoffMethod: '比对刻痕来源',
      payoffSceneAction: '拆下窗框比对刀口',
      requiredEvidence: '刻痕与旧案凶器一致',
      readerVisibleOutcome: '刻痕来自同一把刀',
      allowedDelayReason: '现场仍有人盯梢',
    })
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: ['章尾承接偏弱'] },
    })

    expect(result.status).toBe('warning')
    expect(result.itemResults.find((item) => item.contractItemType === 'chapter_hook')?.verdict).toBe('weak')
    expect(result.itemResults.find((item) => item.contractItemType === 'story_thread_progress')?.verdict).toBe('weak')
    expect(result.itemResults.find((item) => item.contractItemType === 'foreshadow_delivery')?.verdict).toBe('weak')
    expect(result.itemResults.find((item) => item.contractItemType === 'foreshadow_delivery')?.semanticState).toBe('mentioned')
    expect(result.rewriteHints.some((item) => item.includes('章尾'))).toBe(true)
  })

  it('treats overdue foreshadow with explicit delay reason as pass', () => {
    const rows = createBaseRows(
      '夜晚的北门外，林远继续追查失窃药箱。守卫追查他的来路，两人险些动手。林远确认药箱被转去旧仓，主线因此向前推进一步，线索也随之升级。\n\n他想起铜铃暗号，却发现城门封锁，暂时不能处理，只能押后到天亮后再查。门外忽然传来急促脚步声。',
    )
    Object.assign((rows.get(foreshadowLedger) || [])[0], {
      title: '铜铃暗号',
      detail: '守夜人的铜铃会泄露内应身份',
      targetPayoffChapter: 10,
      payoffMethod: '对照铃声节奏锁定内应',
      payoffSceneAction: '重听铜铃并比对值夜名单',
      requiredEvidence: '铃声节奏与值夜名单吻合',
      readerVisibleOutcome: '内应范围被缩小',
      allowedDelayReason: '城门封锁',
    })
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.status).toBe('pass')
    expect(result.itemResults.find((item) => item.contractItemType === 'foreshadow_delivery')?.verdict).toBe('pass')
    expect(result.itemResults.find((item) => item.contractItemType === 'foreshadow_delivery')?.semanticState).toBe('blocked')
  })

  it('blocks overdue foreshadow when chapter only mentions it without payoff or delay reason', () => {
    const rows = createBaseRows(
      '夜晚的北门外，林远继续追查失窃药箱。守卫追查他的来路，两人险些动手。林远确认药箱被转去旧仓，主线因此向前推进一步，线索也随之升级。\n\n他又想起铜铃暗号，却没有继续动作，也没有解释为何停下。门外忽然传来急促脚步声。',
    )
    Object.assign((rows.get(foreshadowLedger) || [])[0], {
      title: '铜铃暗号',
      detail: '守夜人的铜铃会泄露内应身份',
      targetPayoffChapter: 10,
      payoffMethod: '对照铃声节奏锁定内应',
      payoffSceneAction: '重听铜铃并比对值夜名单',
      requiredEvidence: '铃声节奏与值夜名单吻合',
      readerVisibleOutcome: '内应范围被缩小',
      allowedDelayReason: '城门封锁',
    })
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.status).toBe('blocker')
    expect(result.itemResults.find((item) => item.contractItemType === 'foreshadow_delivery')?.verdict).toBe('missing')
    expect(result.itemResults.find((item) => item.contractItemType === 'foreshadow_delivery')?.semanticState).toBe('stale')
  })

  it('passes theme response, character scene payoff, and relationship arc gates when all evidence is visible', () => {
    const rows = createBaseRows(
      [
        '夜晚的北门外，林远继续追查失窃药箱。守卫追查他的来路，赵临因为发现他隐瞒线索，当场质问他是不是又想一个人扛下去。',
        '林远选择把暗门钥匙交给赵临，承认自己怕拖累同伴，却仍要守住不牺牲无辜人的底线。赵临沉默片刻，挡在他身前，说这次由两个人一起进旧仓。',
        '两人推开旧仓暗门进入旧仓，确认药箱被转去旧仓，门后残留新脚印，药箱确实被转入旧仓，线索也随之升级，让主线再向前推进一步。这个决定让林远失去独自行动的退路，也让赵临开始重新信任他。',
        '他正要离开，门外忽然传来急促脚步声，脚步声逼近得太快，他还没来得及关门。',
      ].join('\n\n'),
    )
    Object.assign((rows.get(novels) || [])[0], {
      themeVoiceJson: JSON.stringify({
        theme: '权力面前是否守住底线',
        theme_chapter_test: '每章冲突必须迫使角色在利益和底线之间做选择，并写出代价。',
      }),
    })
    Object.assign((rows.get(chapterContracts) || [])[0], {
      requiredCharacterArcIdsJson: JSON.stringify([300]),
      requiredRelationshipArcIdsJson: JSON.stringify([400]),
    })
    rows.set(characters, [
      { id: 1, novelId: 1, fullName: '林远' },
      { id: 2, novelId: 1, fullName: '赵临' },
    ])
    rows.set(characterArcs, [{
      id: 300,
      novelId: 1,
      characterId: 1,
      surfaceWant: '找回药箱',
      deepNeed: '守住底线',
      coreFear: '拖累同伴',
      misbelief: '只能独自行动',
      changeEvent: '把暗门钥匙交给赵临',
      endState: '开始信任同伴',
    }])
    rows.set(relationshipArcs, [{
      id: 400,
      novelId: 1,
      charAId: 1,
      charBId: 2,
      relationLabelSnapshot: '师徒互疑',
      startState: '彼此隐瞒',
      crackPoint: '赵临当场质问',
      changeEvent: '林远交出钥匙',
      endState: '重新信任',
    }])
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.itemResults.filter((item) => item.verdict !== 'pass')).toEqual([])
    expect(result.status).toBe('pass')
    expect(result.itemResults.find((item) => item.contractItemType === 'theme_chapter_response')?.verdict).toBe('pass')
    expect(result.itemResults.find((item) => item.contractItemType === 'character_scene_payoff')?.verdict).toBe('pass')
    expect(result.itemResults.find((item) => item.contractItemType === 'relationship_arc_gate')?.verdict).toBe('pass')
  })

  it('blocks relationship arc gate when a registered relationship change lacks trigger, interaction, and consequence', () => {
    const rows = createBaseRows(
      [
        '夜晚的北门外，林远继续追查失窃药箱。守卫追查他的来路，两人险些动手。林远确认药箱被转去旧仓，主线因此向前推进一步，线索也随之升级。',
        '他想起赵临，也想起两人的关系有所变化，但这一切暂时没有展开。门外忽然传来急促脚步声。',
      ].join('\n\n'),
    )
    Object.assign((rows.get(chapterContracts) || [])[0], {
      requiredRelationshipArcIdsJson: JSON.stringify([400]),
    })
    rows.set(characters, [
      { id: 1, novelId: 1, fullName: '林远' },
      { id: 2, novelId: 1, fullName: '赵临' },
    ])
    rows.set(relationshipArcs, [{
      id: 400,
      novelId: 1,
      charAId: 1,
      charBId: 2,
      relationLabelSnapshot: '师徒互疑',
      startState: '彼此隐瞒',
      crackPoint: '赵临质问',
      changeEvent: '交出钥匙',
      endState: '重新信任',
    }])
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.status).toBe('warning')
    expect(result.itemResults.find((item) => item.contractItemType === 'relationship_arc_gate')?.verdict).toBe('weak')
    expect(result.rewriteHints.some((item) => item.includes('触发事件'))).toBe(true)
  })

  it('does not count unrelated action markers as character scene payoff evidence', () => {
    const rows = createBaseRows(
      [
        '林远站在北门外，账册的线索还没处理，心里只剩一个模糊念头。门外忽然传来急促脚步声。',
        '守卫选择交出钥匙，因此开始信任旁人，但这一段和旁人的旧困境没有产生现场关系。',
      ].join('\n\n'),
    )
    Object.assign((rows.get(chapterContracts) || [])[0], {
      requiredCharacterArcIdsJson: JSON.stringify([300]),
    })
    rows.set(characters, [
      { id: 1, novelId: 1, fullName: '林远' },
    ])
    rows.set(characterArcs, [{
      id: 300,
      novelId: 1,
      characterId: 1,
      surfaceWant: '找回账册',
      deepNeed: '学会求助',
      coreFear: '牵连同伴',
      misbelief: '只能独自承担',
      changeEvent: '向赵临求助',
      endState: '愿意共享线索',
    }])
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.itemResults.find((item) => item.contractItemType === 'character_scene_payoff')?.verdict).toBe('weak')
  })

  it('does not pass character scene payoff for abstract belief words without concrete action', () => {
    const rows = createBaseRows(
      [
        '林远站在北门外，想起账册和赵临。他选择相信自己还能撑住，也开始怀疑独自承担这件事是否正确。',
        '门外忽然传来急促脚步声，旧仓那边的守卫追了过来。',
      ].join('\n\n'),
    )
    Object.assign((rows.get(chapterContracts) || [])[0], {
      requiredCharacterArcIdsJson: JSON.stringify([300]),
    })
    rows.set(characters, [
      { id: 1, novelId: 1, fullName: '林远' },
    ])
    rows.set(characterArcs, [{
      id: 300,
      novelId: 1,
      characterId: 1,
      surfaceWant: '找回账册',
      deepNeed: '学会求助',
      coreFear: '牵连同伴',
      misbelief: '只能独自承担',
      changeEvent: '向赵临求助',
      endState: '愿意共享线索',
    }])
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.itemResults.find((item) => item.contractItemType === 'character_scene_payoff')?.verdict).toBe('weak')
  })

  it('does not pass theme response when theme words and conflict are only scattered across the chapter', () => {
    const rows = createBaseRows(
      [
        '夜晚的北门外，守卫追查林远的来路，逼他交出旧仓线索，双方僵持了很久。',
        '林远绕开街口，确认药箱被转去旧仓，线索也随之升级，让主线再向前推进一步。',
        '门外忽然传来急促脚步声。',
        '他想起底线、代价和选择这些词，却没有在现场做出任何会改变局面的判断。',
      ].join('\n\n'),
    )
    Object.assign((rows.get(novels) || [])[0], {
      themeVoiceJson: JSON.stringify({
        theme: '权力面前是否守住底线',
        theme_chapter_test: '每章冲突必须迫使角色在利益和底线之间做选择，并写出代价。',
      }),
    })
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.itemResults.find((item) => item.contractItemType === 'theme_chapter_response')?.verdict).toBe('weak')
  })

  it('does not pass relationship arc gate when trigger, interaction, and consequence markers are scattered outside the arc evidence', () => {
    const rows = createBaseRows(
      [
        '因为守卫发现暗门，林远继续追查失窃药箱，确认药箱被转去旧仓，主线因此向前推进一步，线索也随之升级。',
        '路人说巷口开始封锁，守卫看了一眼旧仓，又问旁人是否见过药箱。',
        '林远想起赵临和师徒互疑，但没有与赵临见面，也没有让这段关系产生新的后果。门外忽然传来急促脚步声。',
      ].join('\n\n'),
    )
    Object.assign((rows.get(chapterContracts) || [])[0], {
      requiredRelationshipArcIdsJson: JSON.stringify([400]),
    })
    rows.set(characters, [
      { id: 1, novelId: 1, fullName: '林远' },
      { id: 2, novelId: 1, fullName: '赵临' },
    ])
    rows.set(relationshipArcs, [{
      id: 400,
      novelId: 1,
      charAId: 1,
      charBId: 2,
      relationLabelSnapshot: '师徒互疑',
      startState: '彼此隐瞒',
      crackPoint: '赵临质问',
      changeEvent: '交出钥匙',
      endState: '重新信任',
    }])
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.itemResults.find((item) => item.contractItemType === 'relationship_arc_gate')?.verdict).toBe('weak')
  })

  it('does not pass relationship arc gate when trigger, interaction, and consequence are scattered without a shared relation event', () => {
    const rows = createBaseRows(
      [
        '林远因为守卫发现暗门，只能继续追查失窃药箱，确认药箱被转去旧仓。',
        '赵临问路人是否见过药箱，又看了一眼旧仓门口的脚印。',
        '林远和赵临后来开始重新信任对方，但正文没有写出这次信任变化由哪次互动触发。',
        '门外忽然传来急促脚步声。',
      ].join('\n\n'),
    )
    Object.assign((rows.get(chapterContracts) || [])[0], {
      requiredRelationshipArcIdsJson: JSON.stringify([400]),
    })
    rows.set(characters, [
      { id: 1, novelId: 1, fullName: '林远' },
      { id: 2, novelId: 1, fullName: '赵临' },
    ])
    rows.set(relationshipArcs, [{
      id: 400,
      novelId: 1,
      charAId: 1,
      charBId: 2,
      relationLabelSnapshot: '师徒互疑',
      startState: '彼此隐瞒',
      crackPoint: '赵临质问',
      changeEvent: '交出钥匙',
      endState: '重新信任',
    }])
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.itemResults.find((item) => item.contractItemType === 'relationship_arc_gate')?.verdict).toBe('weak')
  })
})
