import { describe, expect, it } from 'vitest'
import { formatChapterVoice } from './chapter-voice'

describe('formatChapterVoice', () => {
  it('states the craft note once and keeps each scene to its job', () => {
    const text = formatChapterVoice({
      scenes: [
        { segmentOrder: 1, pov: '陈舟', sceneGoal: '检查系船绳', obstacle: '河水暴涨', resultState: '换上新绳' },
        { segmentOrder: 2, pov: '邱账房', sceneGoal: '核对客账' },
      ],
    })

    expect(text.match(/按各场自己的视角写/gu)).toHaveLength(1)
    expect(text).toContain('场景1；视角：陈舟；要完成：检查系船绳；阻碍：河水暴涨；场末状态：换上新绳')
    expect(text).toContain('场景2；视角：邱账房；要完成：核对客账')
    expect(text).not.toContain('场末不要解释主题')
  })

  it('keeps at most three book-specific repetitions', () => {
    const text = formatChapterVoice({
      scenes: [{ pov: '陈舟', sceneGoal: '检查系船绳' }],
      recurringAvoids: ['深吸一口气', '心头一紧', '阳光洒在', '第四条不该出现'],
    })

    expect(text).toContain('深吸一口气；心头一紧；阳光洒在')
    expect(text).not.toContain('第四条不该出现')
  })

  it('returns nothing when no scene has a job and no repetition was recorded', () => {
    expect(formatChapterVoice({ scenes: [] })).toBe('')
    expect(formatChapterVoice({ scenes: [{ segmentOrder: 3 }] })).toBe('')
  })

  it('appends a fact only to the matching scene line', () => {
    const text = formatChapterVoice({
      scenes: [
        { segmentOrder: 1, pov: '陈舟', sceneGoal: '检查系船绳' },
        { segmentOrder: 2, pov: '邱账房', sceneGoal: '核对客账' },
      ],
      sceneFacts: [
        { sceneOrder: 2, text: '客账少了三两银' },
        { sceneOrder: 2, text: '  ' },
      ],
    })

    expect(text.match(/按各场自己的视角写/gu)).toHaveLength(1)
    expect(text).toContain('场景1；视角：陈舟；要完成：检查系船绳')
    expect(text).toContain('场景2；视角：邱账房；要完成：核对客账；本场已知：客账少了三两银')
    expect(text.match(/客账少了三两银/gu)).toHaveLength(1)
    expect(text).not.toMatch(/场景1.*客账少了三两银/)
  })

  it('leaves the fact out when no scene uses that order', () => {
    const text = formatChapterVoice({
      scenes: [
        { segmentOrder: 1, pov: '陈舟', sceneGoal: '检查系船绳' },
      ],
      sceneFacts: [{ sceneOrder: 9, text: '北仓少了整袋盐' }],
    })

    expect(text).toContain('场景1；视角：陈舟；要完成：检查系船绳')
    expect(text).not.toContain('北仓少了整袋盐')
    expect(text).not.toContain('本场已知')
  })

  it('puts a fact on a matching scene even when that scene has no other job', () => {
    const text = formatChapterVoice({
      scenes: [
        { segmentOrder: 3 },
        { segmentOrder: 4, pov: '陈舟', sceneGoal: '检查系船绳' },
      ],
      sceneFacts: [{ sceneOrder: 3, text: '库房钥匙在柜底' }],
    })

    expect(text).toContain('场景3；本场已知：库房钥匙在柜底')
    expect(text).toContain('场景4；视角：陈舟；要完成：检查系船绳')
    expect(text).not.toContain('场景4；视角：陈舟；要完成：检查系船绳；本场已知')
    expect(text.match(/库房钥匙在柜底/gu)).toHaveLength(1)
  })
})
