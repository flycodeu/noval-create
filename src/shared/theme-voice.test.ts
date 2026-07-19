import { describe, expect, it } from 'vitest'
import { parseThemeVoiceSnapshot } from './theme-voice'

describe('theme voice snapshot progress', () => {
  it('counts the six fields used by the workflow progress contract', () => {
    const snapshot = parseThemeVoiceSnapshot(JSON.stringify({
      writing_contract_tags: ['具象线索'],
      theme: '真实与选择',
      theme_chapter_test: '每章都要验证一次主题',
      emotional_core: '克制的信任',
      pov: 'third_limited',
      tense: 'present',
      style_rules: '具体克制',
      dialogue_rules: '保留信息差',
    }))

    expect(snapshot.readyCount).toBe(6)
  })

  it('does not count optional style metadata as a seventh or eighth field', () => {
    const snapshot = parseThemeVoiceSnapshot(JSON.stringify({
      writing_contract_tags: ['具象线索'],
      theme_chapter_test: '每章都要验证一次主题',
    }))

    expect(snapshot.readyCount).toBe(0)
  })
})
