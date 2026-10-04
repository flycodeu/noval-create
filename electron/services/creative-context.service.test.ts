import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileCreativeContext, resolveCreativeChapterPosition } from './creative-context.service'
import { creativeProjectSources } from './creative-chapter-context'
import { queryStoryAtlas } from './story-atlas.service'
import type { CreativeStage } from '../../src/shared/creative-workflow'

const mock = vi.hoisted(() => ({ novel: {} as Record<string, unknown>, artifact: {} as Record<string, unknown>, atlas: { entities: [] as Array<Record<string, unknown>>, relations: [] as Array<Record<string, unknown>> }, chapters: [] as Array<Record<string, unknown>>, facts: [] as Array<Record<string, unknown>>, contract: {} as Record<string, unknown>, model: { maxTokens: 393216, maxContextTokens: 1048576 } }))
vi.mock('../database/db', () => ({ getSqlite: () => ({ prepare: (sql: string) => ({ all: () => sql.includes('story_volumes') ? [{ id: 11, title: '渡口卷', summary: '卷概要' }] : sql.includes('story_parts') ? [{ id: 12, volumeId: 11, title: '渡船单元', summary: '单元概要' }] : [{ id: 13, title: '旧绳秘密', summary: '事实概要', protagonistKnownChapterId: 3 }] }) }) }))
vi.mock('./novel.service', () => ({ getNovel: () => mock.novel }))
vi.mock('./chapter.service', () => ({ listChapters: () => mock.chapters }))
vi.mock('./story-atlas.service', () => ({ queryStoryAtlas: vi.fn(() => mock.atlas) }))
vi.mock('./model.service', () => ({ resolveModelRuntimeBudget: () => mock.model }))
vi.mock('./artifact.service', () => ({ requireArtifact: () => mock.artifact }))
vi.mock('./endgame-asset.service', () => ({ getChapterContract: () => ({ chapterGoal: '保留的章节目标', ...mock.contract }), listSceneContracts: () => [{ sceneGoal: '保留的现场安排' }] }))
vi.mock('./creative-facts', () => ({ queryCreativeFacts: () => mock.facts }))

describe('creative project context budget and saved constraints', () => {
  beforeEach(() => {
    vi.mocked(queryStoryAtlas).mockClear()
    mock.atlas = { entities: [], relations: [] }; mock.chapters = []
    mock.facts = [{ id: 13, title: '旧绳秘密', summary: '事实概要', protagonistKnownChapterId: 3 }]
    mock.model = { maxTokens: 393216, maxContextTokens: 1048576 }
    mock.contract = {}
    mock.novel = {
      userBackground: '渡口故事', contextVersion: 1,
      worldRulesJson: JSON.stringify({ powerSystems: [{ name: '观灯', cost: '伤眼', limitations: '不能复生' }], writingConstraints: { extraRules: ['旅途需要时间'] }, hidden: '未登记秘密' }),
      settingsJson: JSON.stringify({ premise: { constraints: '主角是凡人' }, story_design: { story_goal: '查清渡口旧案', main_plot: '未来谋划' }, writing_rules: { common_sense_rules: '伤势不能突然痊愈' } }),
      themeVoiceJson: JSON.stringify({ pov: 'third_limited', style_rules: '对白克制' }),
    }
    mock.artifact = { novelId: 1, kind: 'generic_draft', content: { schemaVersion: 'generic-asset-draft-v1', output: '需要保留的修订原稿' } }
  })
  it.each(['world_rules', 'style', 'story'] as const)('compiles global %s at the real chapter without requiring oversized current-scene people or edges', async stage => {
    mock.chapters = [{ id: 21, chapterNum: 3, title: '系绳', outline: '陈舟与周河在河村检查旧绳', content: '已写正文' }]
    mock.atlas.entities = [
      { id: 'character:1', kind: 'character', name: '陈舟', parentId: null, attributes: { roleType: 'protagonist', background: '不相关人物长史'.repeat(10000) } },
      { id: 'location:1', kind: 'location', name: '河村', parentId: null, attributes: {} },
    ]
    mock.atlas.relations = [{ id: 'presence:long', kind: 'presence', fromId: 'character:1', toId: 'location:1', attributes: { locationRole: 'residence', description: '不相关住址长记'.repeat(10000) } }]
    const report = await compileCreativeContext({ ...input(stage), request: '只补充全书的纪年和时间显示规则', atChapter: 3 })
    expect(queryStoryAtlas).toHaveBeenCalledWith({ novelId: 1, atChapter: 3, includePlanned: true })
    expect(report.text).not.toContain('不相关人物长史')
    expect(report.text).not.toContain('不相关住址长记')
    expect(report.omittedSources).toContain(`character:1:outside_${stage}_scope`)
    expect(report.omittedSources).toContain(`relation:presence:long:outside_${stage}_scope`)
    expect(report.maxInputTokens).toBe(24000)
  })
  it('keeps a specifically requested global-task entity mandatory instead of silently dropping it to fit', async () => {
    mock.atlas.entities = [{ id: 'character:1', kind: 'character', name: '陈舟', parentId: null, attributes: { background: '当前人物原记录'.repeat(10000) } }]
    await expect(compileCreativeContext({ ...input('world_rules'), request: '检查陈舟的能力是否符合世界规则', atChapter: 3 })).rejects.toThrow('必要资料 character:1 超出')
  })
  it('retains chapter participants for the built-in outline prerequisite request with spaced chapter numbers', async () => {
    mock.chapters = [{ id: 24, chapterNum: 4, title: '客至', outline: '检查旧绳', summary: '陈舟在河村检查旧绳' }]
    mock.atlas.entities = [
      { id: 'character:1', kind: 'character', name: '陈舟', parentId: null, attributes: { roleType: 'protagonist', publicSummary: '巡河人' } },
      { id: 'location:1', kind: 'location', name: '河村', parentId: null, attributes: { terrain: '河岸' } },
    ]
    mock.atlas.relations = [{ id: 'presence:1', kind: 'presence', fromId: 'character:1', toId: 'location:1', attributes: { locationRole: 'current' } }]
    const request = '仅补齐第 4 章的章节目标和场景安排。已有章节ID 24，章名客至，大纲：检查旧绳。现有安排：无。必须保留有效安排、已锁定约束和全部已有场景，不改变既定事件或事实揭示边界。需补齐：缺少场景。用户要求：续写下一章。'
    const report = await compileCreativeContext({ ...input('outline'), request, atChapter: 4 })
    expect(report.sources).toEqual(expect.arrayContaining(['chapter:24:target', 'character:1', 'location:1', 'relation:presence:1']))
    expect(report.text).toContain('巡河人')
    expect(report.omittedSources).not.toContain('character:1:outside_outline_scope')
    mock.chapters[0].summary = '陈舟在河村检查旧绳'.repeat(30000)
    await expect(compileCreativeContext({ ...input('outline'), request, atChapter: 4 })).rejects.toThrow('必要资料 chapter:24:target 超出')
  })
  const input = (stage: CreativeStage = 'map') => ({ novelId: 1, stage, request: '补充已有资料', idempotencyKey: 'fixture' })
  it.each(['world_rules', 'story', 'style', 'characters', 'map', 'outline'] as CreativeStage[])('includes saved rules, story and voice in %s', async stage => {
    const report = await compileCreativeContext(input(stage))
    for (const text of ['不能复生', '主角是凡人', '伤势不能突然痊愈', ...(stage === 'map' ? [] : ['对白克制'])]) expect(report.text).toContain(text)
    expect(report).toMatchObject({ maxInputTokens: 24000, outputReserve: ['characters', 'map', 'outline'].includes(stage) ? 28000 : 12000 })
    expect(report.estimatedTokens).toBeLessThanOrEqual(report.maxInputTokens)
  })
  it('reserves reasoning and complete structured output by batch size while bounding large batches', async () => {
    const single = await compileCreativeContext({ ...input(), count: 1 })
    const batch = await compileCreativeContext({ ...input(), count: 4 })
    const large = await compileCreativeContext({ ...input('events'), count: 1000 })
    expect(single.outputReserve).toBe(20000)
    expect(batch.outputReserve).toBe(32000)
    expect(large.outputReserve).toBe(64000)
    expect((await compileCreativeContext({ ...input('style'), count: 1000 })).outputReserve).toBe(12000)
  })
  it('honors user output limits and keeps input plus candidate and review inside a small model window', async () => {
    mock.model = { maxTokens: 4000, maxContextTokens: 1000000 }
    expect((await compileCreativeContext({ ...input(), count: 4 })).outputReserve).toBe(4000)
    mock.model = { maxTokens: 393216, maxContextTokens: 32768 }
    const report = await compileCreativeContext({ ...input(), count: 1000 })
    expect(report.outputReserve).toBe(Math.floor(32768 * 0.22))
    expect(report.maxInputTokens + report.outputReserve * 2 + 2000).toBeLessThanOrEqual(Math.floor(32768 * 0.85))
  })
  it('compiles a local map task inside a small model budget despite large unrelated voices and resident profiles', async () => {
    mock.model = { maxTokens: 8000, maxContextTokens: 32768 }
    mock.novel.themeVoiceJson = JSON.stringify({ dialogue_rules: '无关对白文风'.repeat(3000) })
    mock.atlas.entities = [
      { id: 'location:1', kind: 'location', name: '南岭', parentId: null, attributes: { geography: { mapFrame: { widthKm: 1000, heightKm: 800 } } } },
      { id: 'location:2', kind: 'location', name: '河村', parentId: 'location:1', attributes: { terrain: '既有水网', savedConstraint: '旧桥不可移动' } },
      { id: 'character:1', kind: 'character', name: '陈舟', attributes: { privateHistory: '住民长档案'.repeat(6000) } },
    ]
    mock.atlas.relations = [{ id: 'home', kind: 'presence', fromId: 'character:1', toId: 'location:2', attributes: { locationRole: 'residence' } }]
    const report = await compileCreativeContext({ ...input(), request: '完善南岭下辖地区的地图' })
    expect(report.text).toContain('旧桥不可移动')
    expect(report.text).not.toContain('住民长档案')
    expect(report.text).not.toContain('无关对白文风')
    for (const source of ['character:1:outside_map_scope', 'relation:home:outside_map_scope', 'voice:dialogueRules:outside_map_scope']) expect(report.omittedSources).toContain(source)
    expect(report.estimatedTokens).toBeLessThan(report.maxInputTokens)
  })
  it('never omits a required map target, geographic constraints or revision just to make an asset request fit', async () => {
    mock.atlas.entities = [{ id: 'location:1', kind: 'location', name: '南岭', parentId: null, attributes: { terrain: '原地区事实'.repeat(30000) } }]
    await expect(compileCreativeContext({ ...input(), request: '完善南岭' })).rejects.toThrow('必要资料 location:1 超出')
    mock.atlas.entities = []
    mock.novel.worldRulesJson = JSON.stringify({ mapBlueprint: { constraints: '已有边界不可改变'.repeat(30000) } })
    await expect(compileCreativeContext(input())).rejects.toThrow('必要资料 world_rules:mapBlueprint:constraints 超出')
  })
  it('keeps sibling geometry mandatory while excluding its unrelated long dossier from a local boundary edit', async () => {
    mock.model = { maxTokens: 8000, maxContextTokens: 32768 }
    mock.atlas.entities = [
      { id: 'country', kind: 'location', name: '江国', parentId: null, attributes: {} },
      { id: 'west', kind: 'location', name: '西郡', parentId: 'country', attributes: {} },
      { id: 'east', kind: 'location', name: '东郡', parentId: 'country', summary: '无关地方长史'.repeat(10000), attributes: { geography: { boundary: [{ x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 100 }] }, history: '无关地方档案'.repeat(10000) } },
    ]
    const report = await compileCreativeContext({ ...input(), request: '调整西郡的边界' })
    expect(report.sources).toContain('east:boundary_constraint')
    expect(report.text).toContain('"x":50')
    expect(report.text).not.toContain('无关地方长史')
    expect(report.text).not.toContain('无关地方档案')
    expect(report.omittedSources).toContain('east:non_geographic_fields')
    const neighbour = mock.atlas.entities[2]
    mock.atlas.entities.push(...Array.from({ length: 150 }, (_, index) => ({ ...neighbour, id: `east:${index}`, name: `相邻地区${index}` })))
    await expect(compileCreativeContext({ ...input(), request: '调整西郡的边界' })).rejects.toThrow(/必要资料 east:\d+:boundary_constraint 超出/u)
  })
  it('excludes unscoped secrets and future plot from chapter project material', () => {
    const sources = JSON.stringify(creativeProjectSources(mock.novel, true))
    expect(sources).toContain('不能复生')
    expect(sources).toContain('对白克制')
    expect(sources).not.toContain('未登记秘密')
    expect(sources).not.toContain('未来谋划')
  })
  it('counts revision source as required and rejects wrong-project or oversized sources', async () => {
    const params = { ...input(), sourceArtifactId: 'candidate' }
    expect((await compileCreativeContext(params)).text).toContain('需要保留的修订原稿')
    mock.artifact.novelId = 2
    await expect(compileCreativeContext(params)).rejects.toThrow('当前项目')
    mock.artifact.novelId = 1
    mock.artifact.content = { schemaVersion: 'generic-asset-draft-v1', output: '修订原文'.repeat(30_000) }
    await expect(compileCreativeContext(params)).rejects.toThrow('必要资料 revision:candidate 超出')
  })
  it('does not drop oversized hard rules or fill missing world rules with genre defaults', async () => {
    expect(creativeProjectSources({})).toEqual([])
    mock.novel.worldRulesJson = JSON.stringify({ writingConstraints: { extraRules: ['硬规则'.repeat(30_000)] } })
    await expect(compileCreativeContext(input())).rejects.toThrow('必要资料 world_rules:writingConstraints:extraRules 超出')
  })
  it('keeps distinct constraint names even when their saved values are identical', async () => {
    mock.novel.worldRulesJson = JSON.stringify({ writingConstraints: { antiConceptSlogans: true, antiSymmetricLines: true } })
    const report = await compileCreativeContext(input())
    expect(report.sources).toContain('world_rules:writingConstraints:antiConceptSlogans')
    expect(report.sources).toContain('world_rules:writingConstraints:antiSymmetricLines')
  })
  it('keeps direct relation facts while a large optional name catalog can be omitted', async () => {
    mock.atlas.entities = Array.from({ length: 3000 }, (_, i) => ({ id: `character:${i}`, kind: 'character', name: i === 0 ? '陈舟' : `路人${i}${'长名字'.repeat(50)}`, attributes: {}, summary: '档案描述', parentId: null }))
    mock.atlas.relations = [{ id: 'known-bond', fromId: 'character:0', toId: 'character:1', kind: 'relationship', label: '互不信任' }]
    const report = await compileCreativeContext({ ...input('characters'), request: '优化陈舟' })
    expect(report.text).toContain('互不信任')
    expect(report.sources).toContain('character:1')
    expect(report.omittedSources.some(source => source.startsWith('identities:'))).toBe(true)
    expect(report.estimatedTokens).toBeLessThanOrEqual(report.maxInputTokens)
  })
  it('keeps narrative facts while excluding verbose import and review provenance from model context', async () => {
    mock.atlas.entities = [{ id: 'character:1', kind: 'character', name: '陈舟', summary: '住在河边', attributes: {}, source: { kind: 'reviewed_model_canon', note: '候选SHA256与流程备注'.repeat(2000) } }]
    mock.atlas.relations = [{ id: 'home', kind: 'presence', fromId: 'character:1', toId: 'location:1', label: '陈舟住在河边', attributes: { locationRole: 'residence' }, source: { kind: 'reviewed_model_canon', note: '来源文件和模型流程'.repeat(2000) } }]
    mock.atlas.entities.push({ id: 'location:1', kind: 'location', name: '河边', attributes: {} })
    const report = await compileCreativeContext({ ...input('outline'), request: '补齐第 4 章陈舟的场景安排', atChapter: 4 })
    expect(report.sources).toContain('relation:home')
    expect(report.text).toContain('陈舟住在河边')
    expect(report.text).toContain('"locationRole":"residence"')
    expect(report.text).not.toContain('候选SHA256与流程备注')
    expect(report.text).not.toContain('来源文件和模型流程')
  })
  it('reserves the actual existing prose size for a review and fails before exceeding a small model window', async () => {
    mock.model = { maxTokens: 8000, maxContextTokens: 32768 }
    mock.chapters = [{ chapterNum: 1, content: '既有正文'.repeat(30_000) }]
    await expect(compileCreativeContext({ ...input('chapter'), operation: 'review', atChapter: 1 })).rejects.toThrow('窗口不足')
  })
  it('reserves a formal asset snapshot in the same model window instead of appending it outside the budget', async () => {
    mock.model = { maxTokens: 8000, maxContextTokens: 32768 }
    const base = await compileCreativeContext({ ...input('items'), operation: 'review', atChapter: 0 })
    const bounded = await compileCreativeContext({ ...input('items'), operation: 'review', atChapter: 0 }, undefined, undefined, 10000)
    expect(bounded.maxInputTokens).toBeLessThan(base.maxInputTokens)
    expect(bounded.estimatedTokens + 10000 + bounded.outputReserve + 2000).toBeLessThan(32768)
    await expect(compileCreativeContext({ ...input('items'), operation: 'review', atChapter: 0 }, undefined, undefined, 30000)).rejects.toThrow('窗口不足')
  })
  it('gives planning stable volume, part and fact IDs instead of inventing references', async () => {
    const report = await compileCreativeContext(input('outline'))
    expect(report.text).toContain('"volumeId":11')
    for (const key of ['volume:11:planning', 'part:12:planning', 'fact:13:planning']) expect(report.sources).toContain(key)
  })
  it('keeps the previous ending and recent knowledge ahead of oversized optional global plots', async () => {
    mock.novel.settingsJson = JSON.stringify({ story_design: { main_plot: '远期长线'.repeat(30000) } })
    mock.chapters = [
      { id: 23, chapterNum: 3, title: '验绳', summary: '灯未点燃', content: '先前正文。\n'.repeat(3000) + '灯未点燃，试验尚未开始。' },
      { id: 24, chapterNum: 4, volumeId: 11, partId: 12, title: '夜试', outline: '观察干湿处差异', allowedFactIdsJson: '[14]', revealedFactIdsJson: '[14]' },
    ]
    mock.facts = [
      { id: 13, title: '绳痕', summary: '第三章已经观察到的绳痕', protagonistKnownChapterId: 23, characterKnowledge: [], plannedRevealChapterNum: null },
      { id: 14, title: '干湿边界', summary: '第四章待验证的计划', characterKnowledge: [], plannedRevealChapterNum: 4 },
    ]
    const report = await compileCreativeContext({ ...input('outline'), request: '补齐第 4 章', atChapter: 4 })
    expect(report.sources).toEqual(expect.arrayContaining(['chapter:24:target', 'chapter:23:handoff', 'fact:13:planning', 'fact:14:planning', 'volume:11:planning', 'part:12:planning']))
    expect(report.text).toContain('灯未点燃，试验尚未开始。')
    expect(report.text).not.toContain('先前正文'.repeat(501))
    const handoff = JSON.parse(report.text.match(/<source id="chapter:23:handoff">\n(.*?)\n<\/source>/u)![1])
    expect(handoff.endingExcerpt.length).toBeLessThanOrEqual(1000)
    expect(handoff.endingExcerpt.startsWith('先前正文。')).toBe(true)
    expect(handoff.omittedCharacters).toBeGreaterThan(0)
    expect(report.text).toContain('本章大纲是计划，不能视为已发生')
    expect(report.omittedSources).toContain('story_design:mainPlot')
    expect(report.estimatedTokens).toBeLessThanOrEqual(24000)
  })
  it('selects explicitly referenced information by exact stable ID and blocks oversized mandatory handoffs', async () => {
    mock.facts = [{ id: 13, title: '短绳', summary: '要求核验的信息'.repeat(30000) }, { id: 130, title: '远期秘密', summary: '不应误匹配' }]
    await expect(compileCreativeContext({ ...input('outline'), request: '核验 fact:13', atChapter: 4 })).rejects.toThrow('必要资料 fact:13:planning 超出')
    mock.facts = []
    mock.model = { maxTokens: 8000, maxContextTokens: 32768 }
    mock.chapters = [{ id: 23, chapterNum: 3, summary: '已写交接'.repeat(30000), content: '结尾' }, { id: 24, chapterNum: 4 }]
    await expect(compileCreativeContext({ ...input('outline'), request: '补齐第 4 章', atChapter: 4 })).rejects.toThrow('必要资料 chapter:23:handoff 超出')
  })
  it('references duplicate participation data but preserves different observations and participant actions', async () => {
    mock.chapters = [{ id: 24, chapterNum: 4, outline: '陈舟检查旧绳' }]
    mock.atlas.entities = [
      { id: 'character:1', kind: 'character', name: '陈舟', attributes: {} },
      { id: 'event:1', kind: 'event', name: '验绳', summary: '已发生的检查', attributes: { evidenceQuote: '旧绳上有刀口。', eventResult: '刀口仍须核验' } },
    ]
    mock.atlas.relations = [{ id: 'witness', kind: 'participation', fromId: 'character:1', toId: 'event:1', attributes: {
      eventTitle: '验绳', evidenceQuote: '旧绳上有刀口。', eventResult: '证人自称绳子已断', protagonistAction: '保护刀口',
    } }]
    const report = await compileCreativeContext({ ...input('outline'), request: '补齐第 4 章', atChapter: 4 })
    const edge = JSON.parse(report.text.match(/<source id="relation:witness">\n(.*?)\n<\/source>/u)![1])
    expect(edge.sharedAttributes).toEqual({ sourceId: 'event:1', keys: ['eventTitle', 'evidenceQuote'] })
    expect(edge.attributes).toEqual({ eventResult: '证人自称绳子已断', protagonistAction: '保护刀口' })
    expect(report.text.match(/旧绳上有刀口。/gu)).toHaveLength(1)
  })
  it('does not repeat stale native event snapshots for every local-outline participant', async () => {
    mock.chapters = [{ id: 24, chapterNum: 4, outline: '陈舟核对渡口账目' }]
    mock.atlas.entities = [
      { id: 'character:1', kind: 'character', name: '陈舟', attributes: {} },
      { id: 'event:7', kind: 'event', name: '核对账目', summary: '现行记录', attributes: { eventResult: '账目仍须核查' } },
    ]
    mock.atlas.relations = [{
      id: 'participation:timeline_events:7:1', kind: 'participation', fromId: 'character:1', toId: 'event:7', label: '参与',
      attributes: { eventTitle: '旧标题', eventResult: '过时结论'.repeat(2000), notes: '整份旧事件快照'.repeat(2000) },
    }]
    const report = await compileCreativeContext({ ...input('outline'), request: '补齐第 4 章陈舟的场景安排', atChapter: 4 })
    const edge = JSON.parse(report.text.match(/<source id="relation:participation:timeline_events:7:1">\n(.*?)\n<\/source>/u)![1])
    expect(edge).toMatchObject({ fromId: 'character:1', toId: 'event:7', label: '参与' })
    expect(edge.attributes).toBeUndefined()
    expect(report.text).toContain('账目仍须核查')
    expect(report.text).not.toContain('过时结论')
    expect(report.omittedSources).toContain('participation:timeline_events:7:1:duplicated_event_snapshot')
  })
  it('loads scope-selected records and existing arrangements even when the request contains no names', async () => {
    mock.atlas.entities = [{ id: 'item:1', kind: 'item', name: '铜铃', attributes: { risk: '已有裂纹' } }]
    const asset = await compileCreativeContext({ ...input('items'), request: '完善已有物品', changeScope: { existingEntityIds: ['item:1'], newEntityCount: 0 } })
    expect(asset.sources).toContain('item:1')
    expect(asset.text).toContain('已有裂纹')
    mock.chapters = [{ id: 24, chapterNum: 4, title: '夜试', outline: '保留旧绳试验' }]
    const outline = await compileCreativeContext({ ...input('outline'), request: '完善已登记安排', atChapter: 4, changeScope: { chapterIds: [24] } })
    expect(outline.sources).toContain('chapter:24:arrangement')
    expect(outline.text).toContain('保留的章节目标')
    expect(outline.text).toContain('保留的现场安排')
    await expect(compileCreativeContext({ ...input('outline'), changeScope: { chapterIds: [999] } })).rejects.toThrow('不属于当前项目')
  })
  it('keeps current chapter people, parent geography and route evidence for a request with no names', async () => {
    mock.chapters = [{ id: 21, chapterNum: 1, title: '系绳', outline: '陈舟在河村检查旧绳', content: '既有正文' }]
    mock.atlas.entities = [
      { id: 'character:1', kind: 'character', name: '陈舟', parentId: null, attributes: { goals: '修船', roleType: 'protagonist' } },
      { id: 'location:1', kind: 'location', name: '南岭', parentId: null, attributes: { terrain: '低山' } },
      { id: 'location:2', kind: 'location', name: '河村', parentId: 'location:1', attributes: { livelihood: '摆渡' } },
      { id: 'location:3', kind: 'location', name: '东岸', parentId: null, attributes: {} },
    ]
    mock.atlas.relations = [{ id: 'home', kind: 'presence', fromId: 'character:1', toId: 'location:2', attributes: { locationRole: 'residence' } }, { id: 'river', kind: 'route', fromId: 'location:2', toId: 'location:3', attributes: { travelHours: 2 } }]
    const report = await compileCreativeContext({ ...input('map'), request: '完善本章活动地点，保持人物职业和已有行程。', atChapter: 1 })
    for (const id of ['chapter:21:target', 'character:1', 'location:1', 'relation:river', 'atlas_coverage']) expect(report.sources).toContain(id)
    expect(report.text).toContain('"travelHours":2')
    expect(report.text).toContain('"locationRole":"residence"')
    expect(report.text).toContain('location_current')
  })
  it('derives an omitted outline position from its single scoped chapter and preserves explicit global position zero', async () => {
    mock.chapters = [
      { id: 23, chapterNum: 3, content: '第三章实际交接。', summary: '试验尚未开始' },
      { id: 24, chapterNum: 4, volumeId: 11, partId: 12, targetWords: 3200, outline: '试验' },
    ]
    const params = { ...input('outline'), request: '完善已有安排', changeScope: { chapterIds: [24] } }
    const report = await compileCreativeContext(params)
    expect(queryStoryAtlas).toHaveBeenCalledWith({ novelId: 1, atChapter: 4, includePlanned: true })
    expect(report.sources).toContain('chapter:23:handoff')
    expect(report.text).toContain('第三章实际交接。')
    expect(report.text).toContain('"targetWords":3200')
    expect(report.text).toContain('"partId":12')
    expect(report.sources).not.toContain('chapter:23:plan')
    expect(resolveCreativeChapterPosition({ ...params, atChapter: 0 })).toBe(0)
    await expect(compileCreativeContext({ ...params, changeScope: { chapterIds: [999] } })).rejects.toThrow('不属于当前项目')
  })
  it('uses whole final paragraphs and preserves an unbroken mandatory passage instead of cutting evidence in half', async () => {
    const ending = '完整的最后观察：灯仍未点燃。\n干布尚未落下，住客未经过湿处。'
    mock.chapters = [
      { id: 23, chapterNum: 3, content: '此前长段。'.repeat(1000) + '\n' + ending },
      { id: 24, chapterNum: 4, outline: '做试验' },
    ]
    const params = { ...input('outline'), request: '补齐第4章', atChapter: 4 }
    const report = await compileCreativeContext(params)
    const handoff = JSON.parse(report.text.match(/<source id="chapter:23:handoff">\n(.*?)\n<\/source>/u)![1])
    expect(handoff.endingExcerpt).toBe(ending)
    expect(String(mock.chapters[0].content).slice(handoff.excerptStart)).toBe(ending)
    mock.chapters[0].content = '不能截断的一条现场原句'.repeat(3000)
    await expect(compileCreativeContext(params)).rejects.toThrow('必要资料 chapter:23:handoff 超出')
  })
  it('keeps all structured revision evidence while normalizing only JSON formatting', async () => {
    const draft = { chapters: [{ id: 24, outline: '未点燃不等于不能点燃。\n试验必须有对照。', scenes: [{ resultState: '只记录可见观察，不确认成因。' }] }] }
    mock.artifact.content = { schemaVersion: 'generic-asset-draft-v1', output: JSON.stringify(draft, null, 40) }
    const report = await compileCreativeContext({ ...input('outline'), sourceArtifactId: 'candidate' })
    const source = report.text.match(/<source id="revision:candidate">\n(.*?)\n<\/source>/u)![1]
    expect(JSON.parse(source)).toEqual(draft)
    expect(source).toBe(JSON.stringify(draft))
  })
  it('removes adapter bookkeeping and blank arrangement fields without dropping evidence or authored prohibitions', async () => {
    mock.chapters = [{ id: 24, chapterNum: 4, outline: '陈舟查验现场' }]
    mock.contract = { chapterGoal: null, forbiddenActionsJson: '["不可点燃"]', targetCharacterArcIdsJson: '[]' }
    mock.atlas.entities = [{ id: 'character:1', kind: 'character', name: '陈舟', attributes: { sortOrder: 3, recordStatus: 'confirmed', evidenceQuote: '他没有点燃旧灯。', limitations: '不可凭光影确认成因。', customConstraint: { sortOrder: '作者指定顺序，须保留' } } }]
    const report = await compileCreativeContext({ ...input('outline'), request: '补齐第4章陈舟的场景安排', atChapter: 4 })
    expect(report.text).toContain('他没有点燃旧灯。')
    expect(report.text).toContain('不可凭光影确认成因。')
    expect(report.text).toContain('作者指定顺序，须保留')
    expect(report.text).toContain('不可点燃')
    expect(report.text).not.toContain('"chapterGoal":null')
    expect(report.text).not.toContain('"recordStatus":"confirmed"')
    expect(report.omittedSources).toContain('character:1:sortOrder:storage_metadata')
  })
  it('references identical formal-review values inside the budgeted snapshot and retains differing evidence', async () => {
    const rule = '原有能力限制：不可以复生，借感会付出代价。'.repeat(80)
    mock.novel.worldRulesJson = JSON.stringify({ powerSystems: [{ name: '观灯', limitations: rule }] })
    const snapshot = { stage: 'world_rules', assets: { worldRules: { powerSystems: [{ name: '观灯', limitations: rule }] } } }
    mock.atlas.entities = [{ id: 'character:1', kind: 'character', name: '陈舟', attributes: { abilityLimits: rule + '另有个人约束。' } }]
    const params = { ...input('world_rules'), operation: 'review' as const, request: '核对陈舟的限制与世界规则' }
    const report = await compileCreativeContext(params, undefined, undefined, 0, snapshot)
    expect(report.sources).toContain('world_rules:powerSystems:0')
    expect(report.text).toContain('reviewSnapshotReference')
    expect(report.text).toContain('另有个人约束。')
    const source = JSON.parse(report.text.match(/<source id="world_rules:powerSystems:0">\n(.*?)\n<\/source>/u)![1])
    expect(source.reviewSnapshotReference).toBe('$["assets"]["worldRules"]["powerSystems"]["0"]')
    expect(report.text.match(/原有能力限制/g)).toHaveLength(80)
    mock.model = { maxTokens: 8000, maxContextTokens: 32768 }
    await expect(compileCreativeContext(params, undefined, undefined, 0, { huge: rule.repeat(100) })).rejects.toThrow('窗口不足')
  })
})
