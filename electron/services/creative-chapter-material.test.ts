import { describe, expect, it } from 'vitest'
import { compileContextPack } from '../../src/shared/context-pack'
import { chapterMaterialPriority, compactChapterScenes } from './creative-chapter-material'

describe('chapter material selection', () => {
  it('retains distinct constraints while removing exact scene/segment aliases without mutating canon', () => {
    const scenes = [{ segmentId: 7, segmentOrder: 2, pov: '陈舟', sceneGoal: '查账', segmentPurpose: '查账', resultState: '账册交给掌柜', segmentOutputState: '账册交给掌柜', obstacle: '证词不同', segmentInputState: '先前借感已停止' },
      { sceneGoal: '核对姓名', segmentPurpose: '保留住客隐私', resultState: '只能确定有人翻信', segmentOutputState: '尚不能指认凶手' }]
    const compact = compactChapterScenes(scenes)
    expect(compact[0]).toEqual({ segmentId: 7, segmentOrder: 2, pov: '陈舟', sceneGoal: '查账', resultState: '账册交给掌柜', obstacle: '证词不同', segmentInputState: '先前借感已停止' })
    expect(compact[1]).toEqual(scenes[1])
    expect(scenes[0].segmentPurpose).toBe('查账')
  })

  it('keeps facts, social relations and voice ahead of abundant prose while rendering retained prose chronologically', async () => {
    const sources = [
      { key: 'task', text: '本章合同', required: true },
      { key: 'fact:35', text: '只能确认有人看过信' },
      { key: 'relation:7', text: '掌柜欠账房的人情' },
      { key: 'voice:emotionalCore', text: '想留住人又不敢开口' },
      { key: 'previous:256', sourceKind: 'previous_chapter_original', sourceId: '3', start: 256, text: '随后收起账册' },
      { key: 'previous:26', sourceKind: 'previous_chapter_original', sourceId: '3', start: 26, text: '先核对旧账' },
    ].map(source => ({ ...source, selectionPriority: chapterMaterialPriority(source), estimatedTokens: 10 }))
    const input = { novelId: 1, chapterId: 4, chapterNum: 4, stage: 'draft' as const, contextVersion: 1, sources }
    const constrained = await compileContextPack({ ...input, budget: 40 })
    expect(constrained.pack.sources.filter(source => source.included).map(source => source.key)).toEqual(['task', 'fact:35', 'relation:7', 'voice:emotionalCore'])
    const full = await compileContextPack({ ...input, budget: 60 })
    expect(full.rendered.indexOf('先核对旧账')).toBeLessThan(full.rendered.indexOf('随后收起账册'))
  })
  it('keeps the immediate handoff ahead of optional setting detail', async () => {
    const sources = [
      { key: 'world_rules:worldDynamics:economyLoops', text: '河港以运粮为业' },
      { key: 'chapter:3:original:0', sourceKind: 'previous_chapter_original', start: 0, end: 30, text: '早晨核对姓名' },
      { key: 'chapter:3:original:3500', sourceKind: 'previous_chapter_original', start: 3500, end: 3530, text: '干布还未落下，借感尚未开始' },
    ].map(source => ({ ...source, selectionPriority: chapterMaterialPriority(source, 4000), estimatedTokens: 10 }))
    const result = await compileContextPack({ novelId: 1, chapterId: 4, chapterNum: 4, stage: 'draft', contextVersion: 1, budget: 10, sources })
    expect(result.pack.sources.filter(source => source.included).map(source => source.text)).toEqual(['干布还未落下，借感尚未开始'])
  })
})
