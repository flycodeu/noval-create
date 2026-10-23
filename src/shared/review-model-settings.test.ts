import { describe, expect, it } from 'vitest'
import { buildStorySettingsPayload, parseStorySettingsDocument } from './story-settings'
describe('project reviewer settings', () => {
  it('preserves story and engine extensions while selecting and clearing a reviewer', () => {
    const original = JSON.stringify({ custom: '保留', story_design: { story_goal: '查明旧案' }, ai_engine: { private_flag: true, default_mode: 'balanced' } })
    const saved = buildStorySettingsPayload({ aiEngine: { reviewModelConfigId: 8 } }, original)
    expect(parseStorySettingsDocument(JSON.stringify(saved)).aiEngine.reviewModelConfigId).toBe(8)
    expect(saved.custom).toBe('保留')
    expect(saved.ai_engine).toMatchObject({ private_flag: true, review_model_config_id: 8 })
    const clear = buildStorySettingsPayload({ aiEngine: { reviewModelConfigId: null } }, JSON.stringify(saved))
    expect(parseStorySettingsDocument(JSON.stringify(clear)).aiEngine.reviewModelConfigId).toBeNull()
    expect(parseStorySettingsDocument(JSON.stringify(clear)).storyDesign.storyGoal).toBe('查明旧案')
  })
})
