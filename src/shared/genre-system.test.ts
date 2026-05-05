import { describe, expect, it } from 'vitest'
import { getBuiltinGenreRules, parseWorldRulesJson } from './genre-system'

describe('genre-system historical packs', () => {
  it('maps historical aliases to the historical capability pack', () => {
    expect(getBuiltinGenreRules('历史正剧').genreProfile.key).toBe('historical')
    expect(getBuiltinGenreRules('架空历史').genreProfile.key).toBe('historical')
    expect(getBuiltinGenreRules('类历史奇幻').genreProfile.key).toBe('historical')
  })

  it('keeps historical world rules when parsing empty or invalid payloads', () => {
    expect(parseWorldRulesJson(undefined, '历史正剧').genreProfile.key).toBe('historical')
    expect(parseWorldRulesJson('{broken', '架空历史').genreProfile.key).toBe('historical')
  })
})
