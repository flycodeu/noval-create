import { describe, expect, it } from 'vitest'
import {
  buildCreativeStagePromptSummary,
  clampChapterRange,
  formatCreativeStageRange,
} from './creative-stages'

describe('creative stages', () => {
  it('normalizes reversed chapter windows without losing the author intent', () => {
    expect(clampChapterRange(200, 101)).toEqual({ chapterStart: 101, chapterEnd: 200 })
    expect(clampChapterRange(undefined, 80)).toEqual({ chapterEnd: 80 })
  })

  it('formats open and closed chapter windows', () => {
    expect(formatCreativeStageRange({ chapterStart: 1, chapterEnd: 100 })).toBe('第 1–100 章')
    expect(formatCreativeStageRange({ chapterStart: 101 })).toBe('第 101 章起')
    expect(formatCreativeStageRange({})).toBe('全书范围')
  })

  it('keeps stage context compact and names the minimum asset boundary', () => {
    const summary = buildCreativeStagePromptSummary({
      stage: {
        id: 1,
        novelId: 1,
        sequence: 1,
        name: '第一卷起局',
        kind: 'chapter-window',
        status: 'active',
        chapterStart: 1,
        chapterEnd: 100,
        objective: '让主角第一次主动选择',
        storySummary: '港城追查失踪案',
        handoffSummary: '留下证人线索',
        contextVersion: 1,
        activeAssetCount: 1,
        plannedAssetCount: 1,
        coreAssetCount: 1,
        createdAt: '',
        updatedAt: '',
      },
      assets: [{
        id: 1,
        novelId: 1,
        stageId: 1,
        assetType: 'character',
        placeholderName: '港口税吏',
        role: 'supporting',
        detailLevel: 'outline',
        status: 'planned',
        createdAt: '',
        updatedAt: '',
      }],
    })

    expect(summary).toContain('第一卷起局')
    expect(summary).toContain('港口税吏')
    expect(summary).toContain('交接条件：留下证人线索')
  })
})
