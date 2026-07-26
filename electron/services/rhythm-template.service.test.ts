import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))
vi.mock('./context-impact.service', () => ({
  markNovelContextChanged: vi.fn(),
}))

import { getDb } from '../database/db'
import { markNovelContextChanged } from './context-impact.service'
import {
  attachRhythmTemplateToArc,
  buildArcRhythmSection,
  buildChapterRhythmSection,
  getChapterRhythmSection,
  listRhythmTemplates,
} from './rhythm-template.service'

function buildArcDb(arcRow: Record<string, unknown> | undefined, capture: { setValues?: Record<string, unknown> } = {}) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ all: () => (arcRow ? [arcRow] : []) }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        capture.setValues = values
        return { where: () => ({ run: vi.fn() }) }
      },
    }),
  }
}

beforeEach(() => {
  vi.mocked(getDb).mockReset()
  vi.mocked(markNovelContextChanged).mockReset()
})

describe('listRhythmTemplates', () => {
  it('无题材时返回全部内置模板（轻量字段）', () => {
    const options = listRhythmTemplates()
    expect(options.length).toBeGreaterThanOrEqual(6)
    const golden = options.find((option) => option.key === 'golden_three_chapters')
    expect(golden?.name).toBe('黄金三章')
    expect(golden?.scope).toBe('opening')
    expect(golden?.beatCount).toBe(3)
  })

  it('按题材过滤：言情不应出现升级流打脸循环，但保留通用模板', () => {
    const keys = listRhythmTemplates('言情').map((option) => option.key)
    expect(keys).not.toContain('powerup_slap_cycle')
    expect(keys).toContain('romance_pull_push')
    expect(keys).toContain('golden_three_chapters')
  })
})

describe('attachRhythmTemplateToArc', () => {
  it('未知模板 key 直接拒绝，不触达数据库', () => {
    expect(() => attachRhythmTemplateToArc(1, 'no_such_template')).toThrow()
    expect(getDb).not.toHaveBeenCalled()
  })

  it('合法 key 写入 rhythm_template_key 并标记上下文变化', () => {
    const capture: { setValues?: Record<string, unknown> } = {}
    vi.mocked(getDb).mockReturnValue(buildArcDb({ id: 5, novelId: 2, chapterStart: 1, chapterEnd: 10 }, capture) as never)

    attachRhythmTemplateToArc(5, 'powerup_slap_cycle')
    expect(capture.setValues).toEqual({ rhythmTemplateKey: 'powerup_slap_cycle' })
    expect(markNovelContextChanged).toHaveBeenCalledWith(2, 'Story outline changed')
  })

  it('传 null 摘除模板', () => {
    const capture: { setValues?: Record<string, unknown> } = {}
    vi.mocked(getDb).mockReturnValue(buildArcDb({ id: 5, novelId: 2 }, capture) as never)

    attachRhythmTemplateToArc(5, null)
    expect(capture.setValues).toEqual({ rhythmTemplateKey: null })
  })

  it('弧不存在时抛错', () => {
    vi.mocked(getDb).mockReturnValue(buildArcDb(undefined) as never)
    expect(() => attachRhythmTemplateToArc(999, 'golden_three_chapters')).toThrow()
  })
})

describe('buildArcRhythmSection', () => {
  it('弧挂模板且区间合法时输出全节拍段（含具体章节区间）', () => {
    const section = buildArcRhythmSection({
      rhythmTemplateKey: 'powerup_slap_cycle',
      chapterStart: 11,
      chapterEnd: 20,
    })
    expect(section).toContain('升级流打脸循环')
    expect(section).toContain('压制期')
    expect(section).toContain('兑现期')
    expect(section).toContain('第11')
  })

  it('无模板 / 未知模板 / 区间非法时降级为空串', () => {
    expect(buildArcRhythmSection({ rhythmTemplateKey: null, chapterStart: 1, chapterEnd: 10 })).toBe('')
    expect(buildArcRhythmSection({ rhythmTemplateKey: 'ghost', chapterStart: 1, chapterEnd: 10 })).toBe('')
    expect(buildArcRhythmSection({ rhythmTemplateKey: 'hidden_dragon', chapterStart: 10, chapterEnd: 3 })).toBe('')
    expect(buildArcRhythmSection({ rhythmTemplateKey: 'hidden_dragon', chapterStart: null, chapterEnd: 10 })).toBe('')
  })
})

describe('buildChapterRhythmSection', () => {
  const arc = { rhythmTemplateKey: 'powerup_slap_cycle', chapterStart: 1, chapterEnd: 10 }

  it('章节落进对应节拍：首章在压制期、末章在兑现期', () => {
    const first = buildChapterRhythmSection(arc, 1)
    expect(first).toContain('压制期')
    expect(first).toContain('第1章')
    expect(first).toContain('必须落地')

    const last = buildChapterRhythmSection(arc, 10)
    expect(last).toContain('兑现期')
  })

  it('章节不在弧区间内时输出空串', () => {
    expect(buildChapterRhythmSection(arc, 99)).toBe('')
  })
})

describe('getChapterRhythmSection（DB 包装）', () => {
  it('数据库异常时静默降级为空串', () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('db unavailable')
    })
    expect(getChapterRhythmSection(1, 3, 5)).toBe('')
  })

  it('按 arcId 命中弧并输出单章节拍段', () => {
    vi.mocked(getDb).mockReturnValue(buildArcDb({
      id: 5,
      novelId: 1,
      rhythmTemplateKey: 'powerup_slap_cycle',
      chapterStart: 1,
      chapterEnd: 10,
    }) as never)
    expect(getChapterRhythmSection(1, 2, 5)).toContain('压制期')
  })

  it('无 arcId 时按章节号落区兜底查找', () => {
    const rows = [
      { id: 1, novelId: 1, rhythmTemplateKey: null, chapterStart: 1, chapterEnd: 10 },
      { id: 2, novelId: 1, rhythmTemplateKey: 'volume_finale_burst', chapterStart: 11, chapterEnd: 40 },
    ]
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({ all: () => rows }),
        }),
      }),
    } as never)
    expect(getChapterRhythmSection(1, 38, null)).toContain('爆发')
    expect(getChapterRhythmSection(1, 5, null)).toBe('')
  })
})
