import { describe, expect, it } from 'vitest'
import {
  BUILTIN_RHYTHM_TEMPLATES,
  buildRhythmConstraintSection,
  findRhythmBeatForChapter,
  getRhythmTemplateByKey,
  listRhythmTemplatesForGenre,
} from './rhythm-templates'

describe('rhythm-templates', () => {
  it('ships templates with contiguous beat spans covering 0-100', () => {
    for (const template of BUILTIN_RHYTHM_TEMPLATES) {
      expect(template.beats.length).toBeGreaterThanOrEqual(3)
      expect(template.beats[0].spanPercent[0]).toBe(0)
      expect(template.beats[template.beats.length - 1].spanPercent[1]).toBe(100)
      for (let index = 1; index < template.beats.length; index += 1) {
        expect(template.beats[index].spanPercent[0]).toBe(template.beats[index - 1].spanPercent[1])
      }
    }
  })

  it('filters templates by genre hints while keeping universal ones', () => {
    const fantasy = listRhythmTemplatesForGenre('玄幻修真')
    expect(fantasy.some((template) => template.key === 'powerup_slap_cycle')).toBe(true)
    expect(fantasy.some((template) => template.key === 'golden_three_chapters')).toBe(true)
    expect(fantasy.some((template) => template.key === 'romance_pull_push')).toBe(false)

    expect(listRhythmTemplatesForGenre(null)).toHaveLength(BUILTIN_RHYTHM_TEMPLATES.length)
  })

  it('materializes beats into concrete chapter ranges', () => {
    const template = getRhythmTemplateByKey('golden_three_chapters')!
    const section = buildRhythmConstraintSection(template, { chapterStart: 1, chapterEnd: 3 })

    expect(section).toContain('第1章')
    expect(section).toContain('第2章')
    expect(section).toContain('第3章')
    expect(section).toContain('必须落地')
    expect(section).toContain('优先级高于全书三段占比')
  })

  it('returns empty section for invalid ranges', () => {
    const template = BUILTIN_RHYTHM_TEMPLATES[0]
    expect(buildRhythmConstraintSection(template, { chapterStart: 5, chapterEnd: 3 })).toBe('')
  })

  it('locates the beat for a chapter and clamps range edges', () => {
    const template = getRhythmTemplateByKey('powerup_slap_cycle')!
    const range = { chapterStart: 10, chapterEnd: 29 }

    expect(findRhythmBeatForChapter(template, range, 10)?.phase).toBe('压制期')
    expect(findRhythmBeatForChapter(template, range, 29)?.phase).toBe('兑现期')
    expect(findRhythmBeatForChapter(template, range, 9)).toBeNull()

    for (let chapter = 10; chapter <= 29; chapter += 1) {
      expect(findRhythmBeatForChapter(template, range, chapter)).not.toBeNull()
    }
  })
})
