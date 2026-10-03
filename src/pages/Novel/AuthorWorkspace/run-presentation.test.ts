import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CreativeRun } from '../../../shared/creative-workflow'
import { RunProgress } from './shared'
import { hasSavedRunResult, runChapterLabel, runResultPresentation, runStatusLabel } from './run-presentation'

function run(patch: Partial<CreativeRun> = {}): CreativeRun {
  return {
    runId: 3172, novelId: 292, stage: 'items', request: '只生成两项 upsert_entity，count=2。<chapter_one_evidence>正文证据</chapter_one_evidence>',
    atChapter: 1, count: 2, status: 'success', step: 'completed', message: '本阶段完成，可继续扩展或推进下一阶段。',
    modelConfigId: 1, artifactId: 'draft-items', reviewArtifactId: 'review-items', reviewStatus: 'passed',
    result: { artifactId: 'draft-items', chapterIds: [], contextVersion: 89, appliedIds: ['item:lamp', 'item:book'], savedEntities: [
      { id: 'item:lamp', kind: 'item', name: '旧铜灯' }, { id: 'item:book', kind: 'item', name: '陆闻薄册' },
    ] }, events: [], createdAt: null, updatedAt: null, ...patch,
  }
}

describe('creative run result presentation', () => {
  it('uses confirmed writeback ids, not requested count, to describe what was saved', () => {
    const item = run({ count: 99 })
    expect(runStatusLabel(item)).toBe('已保存')
    expect(runResultPresentation(item)).toEqual({ title: '物品 · 2 项变更已保存', summary: '旧铜灯、陆闻薄册', saved: true })
    expect(runResultPresentation(item).title).not.toContain('99')
  })

  it('does not treat completion, a passed review or an unrelated artifact result as a writeback', () => {
    for (const result of [undefined, {}, { artifactId: 'other', chapterIds: [], contextVersion: 1 }, { artifactId: 'draft-items', chapterId: 682, status: 'passed' }]) {
      const item = run({ result })
      expect(hasSavedRunResult(item)).toBe(false)
      expect(runStatusLabel(item)).toBe('候选待确认')
    }
    expect(runStatusLabel(run({ result: undefined, artifactId: undefined, reviewStatus: undefined }))).toBe('已结束 · 保存未确认')
  })

  it('separates review-only completion, a blocked candidate and execution failure', () => {
    const reviewed = run({ operation: 'review', stage: 'chapter', reviewStatus: 'blocked' })
    expect(runStatusLabel(reviewed)).toBe('仅评审完成')
    expect(runResultPresentation(reviewed).summary).toBe('评审发现待处理问题，正文未修改。')
    expect(hasSavedRunResult(reviewed)).toBe(false)
    expect(runStatusLabel(run({ result: undefined, status: 'blocked', step: 'needs_attention', reviewStatus: 'needs_revision' }))).toBe('已阻断')
    expect(runStatusLabel(run({ result: undefined, status: 'failed', step: 'needs_attention' }))).toBe('运行失败')
  })

  it('only names applied records and deduplicates repeated result ids', () => {
    const item = run({ result: { ...run().result, appliedIds: ['item:lamp', 'item:lamp'], idMap: { lamp: 'item:lamp', future: 'item:future' } } })
    const presentation = runResultPresentation(item, { output: JSON.stringify({ changes: [
      { clientId: 'lamp', name: '旧铜灯' }, { clientId: 'future', name: '未应用的物品' },
    ] }) }, { 'item:lamp': '旧铜灯', 'item:future': '未应用的物品' })
    expect(presentation.title).toBe('物品 · 1 项变更已保存')
    expect(presentation.summary).toBe('旧铜灯')
    expect(runChapterLabel(run({ atChapter: 0 }))).toBe('初始设定')
  })

  it('keeps technical instructions in closed details and shows results in the default card', () => {
    const html = renderToStaticMarkup(React.createElement(RunProgress, { run: run(), active: false }))
    const visible = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    expect(visible).toContain('2 项变更已保存')
    expect(visible).toContain('旧铜灯、陆闻薄册')
    expect(visible).not.toContain('upsert_entity')
    expect(visible).not.toContain('chapter_one_evidence')
    expect(visible).not.toContain('本阶段完成')
    expect(visible).not.toContain('author-run__steps')
    expect(html).toContain('原始请求')
    expect(html).toContain('upsert_entity')
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/)
  })
})
