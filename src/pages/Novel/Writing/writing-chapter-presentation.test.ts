import { describe, expect, it } from 'vitest'
import type { ChapterPublishCheck, ContractAuditItem } from '../../../types'
import {
  buildEditorHeaderViewModel,
  buildGenerationPreflight,
} from './writing-chapter-presentation'

const chapter = { id: 7, chapterNum: 1 } as Parameters<typeof buildGenerationPreflight>[0]['chapter']
const chapters = [chapter!]
const auditItem = (key: string, status: ContractAuditItem['status'], detail: string): ContractAuditItem => ({
  key,
  status,
  detail,
  label: key,
  source: key.startsWith('scene_') ? 'scene' : 'chapter',
})
const validItems = [
  auditItem('chapter_contract_status', 'pass', '可执行'),
  auditItem('chapter_contract_goal', 'pass', '已填写'),
  auditItem('scene_contracts_not_applicable', 'pass', '没有场景'),
]
const publishCheck = (items: ContractAuditItem[], chapterId = 7): ChapterPublishCheck => ({
  chapterId,
  blockerCount: items.filter((item) => item.status === 'blocker').length,
  contractAudit: { items },
} as ChapterPublishCheck)

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
      chapter,
      chapters,
      publishCheck: publishCheck(validItems),
      writebackStatus: {
        phase: 'ready',
        blockedGeneration: true,
        canonApplied: false,
      } as Parameters<typeof buildGenerationPreflight>[0]['writebackStatus'],
    })

    expect(result.ready).toBe(false)
    expect(result.messages[0]).toContain('候选已生成·待正典确认')
  })

  it('blocks when the current chapter has no complete live contract audit', () => {
    expect(buildGenerationPreflight({ chapter, chapters, publishCheck: null, writebackStatus: null })).toEqual({
      ready: false,
      messages: ['当前章节的合同校验尚未完成，请刷新章节后重试。'],
    })
    expect(buildGenerationPreflight({ chapter, chapters, publishCheck: publishCheck(validItems, 8), writebackStatus: null }).ready).toBe(false)
    expect(buildGenerationPreflight({ chapter, chapters, publishCheck: publishCheck(validItems.slice(0, 2)), writebackStatus: null }).ready).toBe(false)
  })

  it('reports the same missing chapter and scene contract inputs as the generation gate', () => {
    const result = buildGenerationPreflight({
      chapter,
      chapters,
      publishCheck: publishCheck([
        auditItem('chapter_contract_exists', 'blocker', '尚未创建章节合同'),
        auditItem('chapter_contract_goal', 'blocker', '缺少本章目标'),
        auditItem('scene_status_1', 'blocker', '场景合同还是草稿'),
        auditItem('scene_fields_1', 'blocker', '缺少 POV、障碍'),
      ]),
      writebackStatus: null,
    })

    expect(result.ready).toBe(false)
    expect(result.messages).toEqual([
      'chapter_contract_exists：尚未创建章节合同',
      'chapter_contract_goal：缺少本章目标',
      'scene_status_1：场景合同还是草稿',
      'scene_fields_1：缺少 POV、障碍',
    ])
  })

  it('allows generation when only publish or post-writing audit items fail', () => {
    const result = buildGenerationPreflight({
      chapter,
      chapters,
      publishCheck: publishCheck([
        ...validItems,
        auditItem('character_arc_1', 'blocker', '尚未登记本章推进'),
        auditItem('foreshadow_2', 'blocker', '伏笔尚未回收'),
      ]),
      writebackStatus: null,
    })

    expect(result.ready).toBe(true)
    expect(result.messages).toEqual([])
  })

  it('accepts complete scene contracts without requiring the no-scene marker', () => {
    const result = buildGenerationPreflight({
      chapter,
      chapters,
      publishCheck: publishCheck([
        ...validItems.slice(0, 2),
        auditItem('scene_status_1', 'pass', '可执行'),
        auditItem('scene_fields_1', 'pass', '字段齐备'),
      ]),
      writebackStatus: null,
    })

    expect(result.ready).toBe(true)
  })

  it('blocks a later chapter until the exact previous chapter has nonblank prose', () => {
    const next = { id: 9, chapterNum: 3 } as NonNullable<typeof chapter>
    const nextCheck = publishCheck(validItems, 9)
    const evaluate = (previous: typeof chapter | null) => buildGenerationPreflight({
      chapter: next,
      chapters: previous ? [chapter!, previous, next] : [chapter!, next],
      publishCheck: nextCheck,
      writebackStatus: null,
    })

    expect(evaluate(null).messages[0]).toContain('第2章尚未创建')
    expect(evaluate({ id: 8, chapterNum: 2, content: '  ' } as typeof chapter).messages[0]).toContain('第2章尚无正文')
    expect(evaluate({ id: 8, chapterNum: 2, content: '前章已经写成的结尾。' } as typeof chapter).ready).toBe(true)
  })
})
