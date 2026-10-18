import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { describe, expect, it } from 'vitest'
import { ContextOverflowError, HardConstraintOverflowError } from './context.service'
import {
  buildPipelineFailureOutput,
  ChapterPipelineStageError,
  classifyChapterPipelineFailure,
} from './chapter-pipeline-errors'

describe('chapter pipeline errors', () => {
  it('preserves explicit stage failure metadata and cause', () => {
    const cause = new Error('upstream failure')
    const error = new ChapterPipelineStageError('gate_rewrite_required', formatUserFacingMessage('services.test.pipelineRewriteNeeded'), {
      blocked: true,
      rewriteScope: 'scene_rewrite',
      targetSegmentId: 7,
      outputText: 'structured output',
      cause,
    })

    expect(error.cause).toBe(cause)
    expect(classifyChapterPipelineFailure('rewriter', error)).toEqual({
      code: 'gate_rewrite_required',
      blocked: true,
      rewriteScope: 'scene_rewrite',
      targetSegmentId: 7,
      outputText: 'structured output',
    })
  })

  it.each([
    new ContextOverflowError(formatUserFacingMessage('services.test.contextFull'), {} as never, {} as never),
    new HardConstraintOverflowError(formatUserFacingMessage('services.test.hardConstraintFull'), {} as never, {} as never),
  ])('classifies context budget failures as blocking', (error) => {
    expect(classifyChapterPipelineFailure('writer', error)).toEqual({
      code: 'context_overflow',
      blocked: true,
      outputText: buildPipelineFailureOutput('context_overflow', error.message),
    })
  })

  it('classifies contract validation failures as a contract replan', () => {
    const result = classifyChapterPipelineFailure('writer', new Error(formatUserFacingMessage('services.test.plannerScenePlanMissing')))

    expect(result).toEqual({
      code: 'contract_blocked',
      blocked: true,
      rewriteScope: 'contract_replan',
      outputText: [
        'exit_code: contract_blocked',
        'detail: 缺少 Planner 产出的场景计划',
        'rewrite_scope: contract_replan',
      ].join('\n'),
    })
  })

  it('treats canonizer failures as blocking even without a Canon message', () => {
    expect(classifyChapterPipelineFailure('canonizer', new Error(formatUserFacingMessage('services.test.draftEmpty')))).toEqual({
      code: 'canon_failed',
      blocked: true,
      outputText: 'exit_code: canon_failed\ndetail: 草案为空',
    })
  })

  it('leaves unrelated failures unclassified', () => {
    expect(classifyChapterPipelineFailure('critic', new Error('network unavailable'))).toEqual({
      blocked: false,
    })
  })

  it('omits absent optional failure output fields', () => {
    expect(buildPipelineFailureOutput('empty_output', '正文为空', {
      targetSegmentId: null,
    })).toBe('exit_code: empty_output\ndetail: 正文为空')
  })
})
