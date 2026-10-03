import { describe, expect, it } from 'vitest'
import { parseThemeVoiceDocument } from '../../../shared/theme-voice'
import { parseStorySettingsDocument } from '../../../shared/story-settings'
import { buildStoryDesignPatch, resolveStoryDesignLocation, storyDesignParams } from './story-design-navigation'

describe('story design topic navigation and edits', () => {
  it('restores a topic from its URL and falls back when it belongs to another section', () => {
    const current = new URLSearchParams('section=world&topic=world%3AmapBlueprint&chapterId=25')
    expect(resolveStoryDesignLocation(current).topic).toBe('world:mapBlueprint')
    const next = storyDesignParams(current, 'story', 'endgameDesign')
    expect(resolveStoryDesignLocation(next).topic).toBe('endgameDesign')
    expect(next.get('chapterId')).toBe('25')
    expect(resolveStoryDesignLocation(new URLSearchParams('section=story&topic=world%3AmapBlueprint')).topic).toBe('premise')
  })

  it('editing language preserves the theme, perspective, examples and extension fields', () => {
    const latest = { themeVoiceJson: JSON.stringify({ theme: '承认代价', pov: 'third_limited', style_rules: '旧语言规则', forbidden_phrases: '旧禁用词', target_work_sample_guide: '参考首章', voice_extensions: { cadence: '缓急相间' } }) }
    const patch = buildStoryDesignPatch(latest, 'style:voice', { styleRules: '句子朴素', forbiddenPhrases: '', theme: '不应越界覆盖' })
    const document = parseThemeVoiceDocument(String(patch.themeVoiceJson))
    expect(document.styleRules).toBe('句子朴素')
    expect(document.forbiddenPhrases).toBe('')
    expect(document.theme).toBe('承认代价')
    expect(document.pov).toBe('third_limited')
    expect(document.targetWorkSampleGuide).toBe('参考首章')
    expect(JSON.parse(String(patch.themeVoiceJson)).voice_extensions).toEqual({ cadence: '缓急相间' })
  })

  it('saving a world topic leaves other world rules intact', () => {
    const world = { genreProfile: { worldviewTone: '志怪' }, powerSystems: [{ name: '灯术', cost: '耗油' }], timelineConfig: { eraName: '景朝' }, custom: '已定资料' }
    const patch = buildStoryDesignPatch({ worldRulesJson: JSON.stringify(world) }, 'world:timelineConfig', { eraName: '景朝', epochLabel: '景平元年' })
    expect(JSON.parse(String(patch.worldRulesJson))).toEqual({ ...world, timelineConfig: { eraName: '景朝', epochLabel: '景平元年' } })
  })

  it('editing the ending keeps the premise and main plot', () => {
    const original = { premise: { core_hook: '旧灯引来借宿客' }, story_design: { main_plot: '查清芦渡旧案' }, endgame_design: { final_image: '旧画面', privateExtension: '原有补充' }, customRule: '保持' }
    const patch = buildStoryDesignPatch({ settingsJson: JSON.stringify(original) }, 'endgameDesign', { finalImage: '天亮后的渡口' })
    const saved = parseStorySettingsDocument(String(patch.settingsJson))
    expect(saved.premise.coreHook).toBe('旧灯引来借宿客')
    expect(saved.storyDesign.mainPlot).toBe('查清芦渡旧案')
    expect(saved.endgameDesign.finalImage).toBe('天亮后的渡口')
    expect(JSON.parse(String(patch.settingsJson)).endgame_design.privateExtension).toBe('原有补充')
    expect(JSON.parse(String(patch.settingsJson)).customRule).toBe('保持')
  })
})
