import { describe, expect, it } from 'vitest'
import {
  getCharacterBatchPreset,
  getFactionGenerationPreset,
  getItemGenerationProfile,
  getStoryThreadGenerationPreset,
  getTimelineGenerationPreset,
  scaleMapLayerCounts,
} from './creation-tools'

describe('creation-tools scale presets', () => {
  it('scales character roster size by operating mode and genre complexity', () => {
    const shortPreset = getCharacterBatchPreset('都市', ['人类'], {
      launchMode: 'fast_launch',
      targetWords: 80000,
    })
    const millionPreset = getCharacterBatchPreset('仙侠', ['人族', '妖族', '灵兽'], {
      launchMode: 'professional_longform',
      targetWords: 1000000,
      mapDepth: 5,
      factionCount: 8,
      speciesCount: 4,
      powerSystemCount: 2,
    })

    expect(shortPreset.totalCount).toBeLessThan(millionPreset.totalCount)
    expect(shortPreset.totalCount).toBeLessThanOrEqual(14)
    expect(millionPreset.totalCount).toBeGreaterThanOrEqual(42)
    expect(millionPreset.batchSize).toBeGreaterThan(shortPreset.batchSize)
    expect(millionPreset.rationale).toContain('百万字规模')
  })

  it('scales item, timeline, and thread generation targets for million-word projects', () => {
    const standardInput = {
      launchMode: 'professional_longform',
      targetWords: 200000,
    }
    const millionInput = {
      launchMode: 'professional_longform',
      targetWords: 1000000,
      mapDepth: 5,
      factionCount: 8,
    }

    expect(getItemGenerationProfile('科幻', standardInput).defaultBatch)
      .toBeLessThan(getItemGenerationProfile('科幻', millionInput).defaultBatch)
    expect(getFactionGenerationPreset('科幻', standardInput).count)
      .toBeLessThan(getFactionGenerationPreset('科幻', millionInput).count)
    expect(getTimelineGenerationPreset('悬疑', standardInput).count)
      .toBeLessThan(getTimelineGenerationPreset('悬疑', millionInput).count)
    expect(getStoryThreadGenerationPreset('悬疑', standardInput).count)
      .toBeLessThan(getStoryThreadGenerationPreset('悬疑', millionInput).count)
  })

  it('preserves map layer originals while increasing longform recommendations', () => {
    const levels = [
      { depth: 1, suggestedCount: 3 },
      { depth: 2, suggestedCount: 5 },
    ]

    const scaled = scaleMapLayerCounts(levels, '玄幻', {
      launchMode: 'professional_longform',
      targetWords: 1000000,
      mapDepth: 5,
    })

    expect(scaled[0].originalCount).toBe(3)
    expect(scaled[1].originalCount).toBe(5)
    expect(scaled[0].suggestedCount).toBeGreaterThan(3)
    expect(scaled[1].suggestedCount).toBeGreaterThan(5)
    expect(scaled[0].rationale).toContain('百万字规模')
  })

  it('allows complex million-word projects to exceed legacy fixed recommendations', () => {
    const scaleInput = {
      launchMode: 'professional_longform',
      targetWords: 1600000,
      mapDepth: 6,
      factionCount: 12,
      speciesCount: 8,
      powerSystemCount: 5,
    }

    const characters = getCharacterBatchPreset('仙侠', ['人族', '妖族', '灵族', '魔族'], scaleInput)
    const items = getItemGenerationProfile('科幻', scaleInput)
    const factions = getFactionGenerationPreset('仙侠', scaleInput)
    const timeline = getTimelineGenerationPreset('仙侠', scaleInput)
    const threads = getStoryThreadGenerationPreset('悬疑', scaleInput)
    const mapLayers = scaleMapLayerCounts([
      { depth: 1, suggestedCount: 15 },
      { depth: 2, suggestedCount: 19 },
    ], '仙侠', scaleInput)

    expect(characters.totalCount).toBeGreaterThan(64)
    expect(items.defaultBatch).toBeGreaterThan(48)
    expect(factions.count).toBeGreaterThan(48)
    expect(timeline.count).toBeGreaterThanOrEqual(60)
    expect(threads.count).toBeGreaterThan(48)
    expect(mapLayers[0].suggestedCount).toBe(16)
    expect(mapLayers[1].suggestedCount).toBe(20)
  })
})
