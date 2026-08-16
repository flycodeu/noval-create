import { describe, expect, it } from 'vitest'
import type { ChapterWritabilitySummary } from '../../../shared/novel-workspace'
import {
  buildChapterHeaderViewModel,
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
  it('builds chapter hero and editor copy from one status source', () => {
    const chapter = {
      id: 7,
      chapterNum: 3,
      title: '',
      status: 'draft',
      segmentCount: 2,
    } as Parameters<typeof buildChapterHeaderViewModel>[0]['chapter']

    expect(buildChapterHeaderViewModel({
      chapter,
      volumeName: '第一卷',
      wordCount: 1800,
      versionCount: 2,
      writability,
    })).toMatchObject({
      title: '第3章 · 未命名章节',
      description: '当前卷：第一卷 · 状态：草稿 · 1800 字',
      statusLabel: '草稿',
    })
    expect(buildEditorHeaderViewModel({
      chapter,
      generating: false,
      refreshing: false,
      hasMultiSegments: true,
    })).toMatchObject({
      title: '第3章',
      subtitle: expect.stringContaining('已拆成 2 个场景'),
      primaryStatusText: '自动保存开启 · 草稿',
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
})
