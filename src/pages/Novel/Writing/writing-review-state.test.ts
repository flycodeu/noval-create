import { describe, expect, it } from 'vitest'
import type { ChapterPublishCheck } from '../../../types'
import { reduceWritingReviewGateState } from './useWritingReviewState'

const publishCheck = (gateLevel: ChapterPublishCheck['gateLevel']) => ({
  gateLevel,
}) as ChapterPublishCheck

describe('writing review gate state', () => {
  it('expands the gate report when a non-pass review arrives', () => {
    expect(reduceWritingReviewGateState({
      publishCheck: null,
      gateReportExpanded: false,
    }, {
      type: 'set-publish-check',
      update: publishCheck('warning'),
    })).toMatchObject({
      gateReportExpanded: true,
      publishCheck: { gateLevel: 'warning' },
    })
  })

  it('keeps explicit gate toggles and supports functional state updates', () => {
    const state = {
      publishCheck: publishCheck('pass'),
      gateReportExpanded: true,
    }
    expect(reduceWritingReviewGateState(state, {
      type: 'set-gate-expanded',
      update: (expanded) => !expanded,
    }).gateReportExpanded).toBe(false)
  })

  it('allows chapter refresh cleanup to clear the report explicitly', () => {
    const clearedCheck = reduceWritingReviewGateState({
      publishCheck: publishCheck('blocker'),
      gateReportExpanded: true,
    }, {
      type: 'set-publish-check',
      update: null,
    })
    expect(reduceWritingReviewGateState(clearedCheck, {
      type: 'set-gate-expanded',
      update: false,
    })).toEqual({ publishCheck: null, gateReportExpanded: false })
  })
})
