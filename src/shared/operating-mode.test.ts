import { describe, expect, it } from 'vitest'
import {
  deriveOperatingMode,
  readOperatingModeLock,
  resolveOperatingMode,
  writeOperatingModeSettings,
} from './operating-mode'

describe('operating-mode', () => {
  it('derives shortform and longform tiers from target words and chapter count', () => {
    expect(deriveOperatingMode({ launchMode: 'fast_launch', targetWords: 80000, chapterCount: 0 })).toBe('shortform')
    expect(deriveOperatingMode({ launchMode: 'professional_longform', targetWords: 200000, chapterCount: 20 })).toBe('standard_longform')
    expect(deriveOperatingMode({ launchMode: 'professional_longform', targetWords: 420000, chapterCount: 30 })).toBe('epic_longform')
    expect(deriveOperatingMode({ launchMode: 'professional_longform', targetWords: 900000, chapterCount: 120 })).toBe('million_longform')
  })

  it('falls back to launchMode when the project has not started yet', () => {
    expect(deriveOperatingMode({ launchMode: 'fast_launch', targetWords: 0, chapterCount: 0 })).toBe('shortform')
    expect(deriveOperatingMode({ launchMode: 'professional_longform', targetWords: 0, chapterCount: 0 })).toBe('standard_longform')
  })

  it('reads and preserves explicit operating mode locks from settings json', () => {
    const settingsJson = writeOperatingModeSettings(undefined, 'epic_longform', true)

    expect(readOperatingModeLock(settingsJson)).toEqual({
      mode: 'epic_longform',
      locked: true,
    })

    expect(resolveOperatingMode({
      launchMode: 'fast_launch',
      targetWords: 60000,
      chapterCount: 12,
      settingsJson,
    })).toBe('epic_longform')
  })
})
