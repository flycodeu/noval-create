import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileCreativeContext } from './creative-context.service'
import { creativeProjectSources } from './creative-chapter-context'
import type { CreativeStage } from '../../src/shared/creative-workflow'

const mock = vi.hoisted(() => ({ novel: {} as Record<string, unknown>, artifact: {} as Record<string, unknown>, atlas: { entities: [] as Array<Record<string, unknown>>, relations: [] as Array<Record<string, unknown>> }, chapters: [] as Array<Record<string, unknown>>, model: { maxTokens: 393216, maxContextTokens: 1048576 } }))
vi.mock('../database/db', () => ({ getSqlite: () => ({ prepare: (sql: string) => ({ all: () => sql.includes('story_volumes') ? [{ id: 11, title: '渡口卷', summary: '卷概要' }] : sql.includes('story_parts') ? [{ id: 12, volumeId: 11, title: '渡船单元', summary: '单元概要' }] : [{ id: 13, title: '旧绳秘密', summary: '事实概要', protagonistKnownChapterId: 3 }] }) }) }))
vi.mock('./novel.service', () => ({ getNovel: () => mock.novel }))
vi.mock('./chapter.service', () => ({ listChapters: () => mock.chapters }))
vi.mock('./story-atlas.service', () => ({ queryStoryAtlas: () => mock.atlas }))
vi.mock('./model.service', () => ({ resolveModelRuntimeBudget: () => mock.model }))
vi.mock('./artifact.service', () => ({ requireArtifact: () => mock.artifact }))
vi.mock('./creative-facts', () => ({ queryCreativeFacts: () => [{ id: 13, title: '旧绳秘密', summary: '事实概要', protagonistKnownChapterId: 3 }] }))

describe('creative project context budget and saved constraints', () => {
  beforeEach(() => {
    mock.atlas = { entities: [], relations: [] }; mock.chapters = []
    mock.model = { maxTokens: 393216, maxContextTokens: 1048576 }
    mock.novel = {
      userBackground: '渡口故事', contextVersion: 1,
      worldRulesJson: JSON.stringify({ powerSystems: [{ name: '观灯', cost: '伤眼', limitations: '不能复生' }], writingConstraints: { extraRules: ['旅途需要时间'] }, hidden: '未登记秘密' }),
      settingsJson: JSON.stringify({ premise: { constraints: '主角是凡人' }, story_design: { story_goal: '查清渡口旧案', main_plot: '未来谋划' }, writing_rules: { common_sense_rules: '伤势不能突然痊愈' } }),
      themeVoiceJson: JSON.stringify({ pov: 'third_limited', style_rules: '对白克制' }),
    }
    mock.artifact = { novelId: 1, kind: 'generic_draft', content: { schemaVersion: 'generic-asset-draft-v1', output: '需要保留的修订原稿' } }
  })
  const input = (stage: CreativeStage = 'map') => ({ novelId: 1, stage, request: '补充已有资料', idempotencyKey: 'fixture' })
  it.each(['world_rules', 'story', 'style', 'characters', 'map', 'outline'] as CreativeStage[])('includes saved rules, story and voice in %s', async stage => {
    const report = await compileCreativeContext(input(stage))
    for (const text of ['不能复生', '主角是凡人', '伤势不能突然痊愈', '对白克制']) expect(report.text).toContain(text)
    expect(report).toMatchObject({ maxInputTokens: 24000, outputReserve: 12000 })
    expect(report.estimatedTokens).toBeLessThanOrEqual(report.maxInputTokens)
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
  it('keeps direct relation facts while a large optional name catalog can be omitted', async () => {
    mock.atlas.entities = Array.from({ length: 3000 }, (_, i) => ({ id: `character:${i}`, kind: 'character', name: i === 0 ? '陈舟' : `路人${i}${'长名字'.repeat(50)}`, attributes: {}, summary: '档案描述', parentId: null }))
    mock.atlas.relations = [{ id: 'known-bond', fromId: 'character:0', toId: 'character:1', kind: 'relationship', label: '互不信任' }]
    const report = await compileCreativeContext({ ...input('characters'), request: '优化陈舟' })
    expect(report.text).toContain('互不信任')
    expect(report.sources).toContain('character:1')
    expect(report.omittedSources.some(source => source.startsWith('identities:'))).toBe(true)
    expect(report.estimatedTokens).toBeLessThanOrEqual(report.maxInputTokens)
  })
  it('reserves the actual existing prose size for a review and fails before exceeding a small model window', async () => {
    mock.model = { maxTokens: 8000, maxContextTokens: 32768 }
    mock.chapters = [{ chapterNum: 1, content: '既有正文'.repeat(30_000) }]
    await expect(compileCreativeContext({ ...input('chapter'), operation: 'review', atChapter: 1 })).rejects.toThrow('窗口不足')
  })
  it('gives planning stable volume, part and fact IDs instead of inventing references', async () => {
    const report = await compileCreativeContext(input('outline'))
    expect(report.text).toContain('"volumeId":11')
    for (const key of ['volume:11:planning', 'part:12:planning', 'fact:13:planning']) expect(report.sources).toContain(key)
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
})
