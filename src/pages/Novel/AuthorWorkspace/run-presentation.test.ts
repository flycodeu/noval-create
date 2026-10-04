import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CreativeRun } from '../../../shared/creative-workflow'
import { RunProgress } from './shared'
import { canApplyRunCandidate, hasSavedRunResult, runChapterLabel, runRecoveryAction, runResultPresentation, runStatusLabel, formalReviewPresentation, reviewReportTitle } from './run-presentation'
import { ContentDocument } from './ContentDocument'

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
  it('shows an interrupted workflow as resumable rather than as a saved or rejected candidate', () => {
    const recovered = run({ status: 'paused', step: 'reviewing', recoveryPending: true, artifactId: undefined, result: undefined })
    expect(runRecoveryAction(recovered)).toBe('resume')
    expect(runStatusLabel(recovered)).toBe('已暂停 · 可继续')
    const html = renderToStaticMarkup(React.createElement(RunProgress, { run: recovered, active: false, onResume: () => {} }))
    expect(html).toContain('继续任务')
    expect(html).not.toContain('重试任务')
  })
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
  it('renders formal asset reviews with Chinese labels and excludes execution metadata', () => {
    const reviewed = run({ operation: 'review', result: undefined })
    expect(runResultPresentation(reviewed).title).toBe('第 1 章 · 物品评审')
    expect(runResultPresentation(reviewed).summary).toBe('模型评审通过，正式资料未修改。')
    const report = { schemaVersion: 'atlas-review-v1', status: 'passed', summary: '用途有据', contentHash: 'private-hash', context: { maxInputTokens: 24000 }, snapshot: { stage: 'items', atChapter: 1, entities: [{ id: 'item:1', kind: 'item', name: '薄册', summary: '记录观察' }] }, review: { summary: '内容符合原文' } }
    const html = renderToStaticMarkup(React.createElement(ContentDocument, { value: formalReviewPresentation(report) }))
    expect(html).toContain('本次评审的正式资料')
    expect(html).toContain('复核章位')
    expect(html).toContain('物品')
    expect(html).toContain('薄册')
    expect(html).not.toMatch(/snapshot|atChapter|items|private-hash|maxInputTokens/)
  })

  it('only offers apply for the current draft awaiting confirmation, never its report or a discarded version', () => {
    const pending = run({ status: 'paused', step: 'needs_attention', result: undefined })
    const draft = { id: 'draft-items', kind: 'generic_draft', status: 'reviewed' as const, reviewArtifactId: 'review-items' }
    expect(canApplyRunCandidate(pending, draft)).toBe(true)
    for (const artifact of [
      { ...draft, id: 'review-items', kind: 'quality_report' },
      { ...draft, id: 'older-draft' },
      { ...draft, status: 'rejected' as const },
      { ...draft, status: 'superseded' as const },
      { ...draft, status: 'committed' as const },
      { ...draft, reviewArtifactId: 'older-review' },
    ]) expect(canApplyRunCandidate(pending, artifact)).toBe(false)
    expect(canApplyRunCandidate(run(), draft)).toBe(false)
    expect(canApplyRunCandidate({ ...pending, status: 'failed' }, draft)).toBe(false)
    expect(canApplyRunCandidate({ ...pending, operation: 'review' }, draft)).toBe(false)
    expect(canApplyRunCandidate({ ...pending, result: { supersededByArtifactId: 'newer-source-revision' } }, draft)).toBe(false)
  })

  it('routes a pending candidate to inspection, while stopped and failed tasks can retry', () => {
    const pending = run({ status: 'paused', step: 'needs_attention', result: undefined })
    expect(runRecoveryAction(pending)).toBe('inspect')
    expect(runRecoveryAction({ ...pending, status: 'failed' })).toBe('retry')
    expect(runRecoveryAction({ ...pending, status: 'cancelled', step: 'cancelled' })).toBe('retry')
    expect(runRecoveryAction({ ...pending, status: 'failed', reviewStatus: 'needs_revision' })).toBe('retry')
    expect(runRecoveryAction(run())).toBeNull()
    const html = renderToStaticMarkup(React.createElement(RunProgress, { run: pending, active: false, onCancel: () => {}, onResume: () => {}, onOpenResult: () => {} }))
    expect(html).toContain('查看候选')
    expect(html).toContain('停止候选')
    expect(html).toContain('模型评审通过')
    expect(html).not.toContain('确认保存候选')
    expect(html).not.toContain('重试任务')
  })

  it('does not present synthetic skipped review content as an actual model review', () => {
    const report = { schemaVersion: 'generic-asset-review-v1', status: 'blocked', summary: '结构校验未通过', modelReview: {
      stage: 'rejected', failureStage: 'contract', initialModelReviewSkipped: true,
      review: { summary: '这不是实际模型返回的审校' }, contractValidation: { initialIssues: ['changes 缺失'], finalIssues: ['changes 仍缺失'] }, warnings: [],
    } }
    expect(reviewReportTitle(report)).toBe('结构校验未通过')
    const html = renderToStaticMarkup(React.createElement(ContentDocument, { value: formalReviewPresentation(report) }))
    expect(html).toContain('首次结构问题')
    expect(html).toContain('初次模型审校未执行')
    expect(html).not.toContain('这不是实际模型返回的审校')
    expect(html).not.toMatch(/failureStage|contractValidation|initialModelReviewSkipped/)
    const blocked = run({ status: 'blocked', step: 'needs_attention', reviewStatus: 'needs_revision', result: { reviewFailureStage: 'contract' } })
    expect(runStatusLabel(blocked)).toBe('结构校验未通过')
    expect(runResultPresentation(blocked).title).toBe('物品 · 结构校验未通过')
    expect(runResultPresentation(blocked).summary).not.toContain('模型评审通过')
  })

  it('renders formal background, rule and outline reports without provider metadata', () => {
    const report = { schemaVersion: 'creative-assets-review-v1', status: 'passed', summary: '规则与已有正文一致', stage: 'world_rules', atChapter: 3,
      snapshot: { stage: 'world_rules', atChapter: 3, worldRules: { commonSenseRules: ['干处阻断湿路'] } },
      review: { summary: '本轮模型评审完成' }, contentHash: 'internal-hash', context: { maxInputTokens: 24000 } }
    const html = renderToStaticMarkup(React.createElement(ContentDocument, { value: formalReviewPresentation(report) }))
    expect(html).toContain('本次评审的正式资料')
    expect(html).toContain('规则与限制')
    expect(html).toContain('干处阻断湿路')
    expect(html).not.toMatch(/creative-assets-review-v1|internal-hash|maxInputTokens|world_rules/)
  })

  it('labels a revised ancestor as historical even when its legacy status still says passed', () => {
    const ancestor = run({ status: 'paused', step: 'needs_attention', result: { supersededByArtifactId: 'new-candidate' } })
    expect(runStatusLabel(ancestor)).toBe('已有修订版')
    expect(runResultPresentation(ancestor).summary).toContain('后续修订版')
    expect(runResultPresentation(ancestor).summary).not.toContain('待确认保存')
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
