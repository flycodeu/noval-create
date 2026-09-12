import { describe, expect, it } from 'vitest'
import type { ChapterWritabilitySummary } from '../../../shared/novel-workspace'
import {
  buildEditorHeaderViewModel,
  buildGenerationPreflight,
} from './writing-chapter-presentation'

const writability: ChapterWritabilitySummary = {
  ready: true,
  score: 92,
  label: '高',
  summary: '可以开始写作',
  risks: [],
  suggestions: [],
  checks: [],
}

describe('writing chapter presentation', () => {
  it('builds the editor title and status from the selected chapter', () => {
    const chapter = {
      id: 7,
      chapterNum: 3,
      title: '',
      status: 'draft',
      segmentCount: 2,
    } as Parameters<typeof buildEditorHeaderViewModel>[0]['chapter']

    expect(buildEditorHeaderViewModel({
      chapter,
    })).toEqual({
      title: '未命名章节',
      statusLabel: '草稿',
    })
  })

  it('keeps writeback blocking in generation preflight', () => {
    const result = buildGenerationPreflight({
      chapter: { id: 7 } as Parameters<typeof buildGenerationPreflight>[0]['chapter'],
      writability,
      writebackStatus: {
        phase: 'ready',
        blockedGeneration: true,
        canonApplied: false,
      } as Parameters<typeof buildGenerationPreflight>[0]['writebackStatus'],
    })

    expect(result.ready).toBe(false)
    expect(result.messages[0]).toContain('候选已生成·待正典确认')
  })

  it('does not treat leftover writability risks as generate blockers when ready', () => {
    const result = buildGenerationPreflight({
      chapter: { id: 7 } as Parameters<typeof buildGenerationPreflight>[0]['chapter'],
      writability: {
        ...writability,
        ready: true,
        risks: ['伏笔尚未回收'],
      },
      writebackStatus: null,
    })

    expect(result.ready).toBe(true)
    expect(result.messages).toEqual([])
  })
})
