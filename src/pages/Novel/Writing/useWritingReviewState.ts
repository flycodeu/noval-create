import { useCallback, useReducer, useState, type Dispatch, type SetStateAction } from 'react'
import type { ChapterOptimizeResult, ChapterPublishCheck } from '../../../types'

interface ReviewGateState {
  publishCheck: ChapterPublishCheck | null
  gateReportExpanded: boolean
}

type ReviewGateAction =
  | { type: 'set-publish-check'; update: SetStateAction<ChapterPublishCheck | null> }
  | { type: 'set-gate-expanded'; update: SetStateAction<boolean> }

function resolveStateUpdate<T>(current: T, update: SetStateAction<T>): T {
  return typeof update === 'function'
    ? (update as (value: T) => T)(current)
    : update
}

export function reduceWritingReviewGateState(
  state: ReviewGateState,
  action: ReviewGateAction,
): ReviewGateState {
  if (action.type === 'set-gate-expanded') {
    return {
      ...state,
      gateReportExpanded: resolveStateUpdate(state.gateReportExpanded, action.update),
    }
  }

  const publishCheck = resolveStateUpdate(state.publishCheck, action.update)
  return {
    publishCheck,
    gateReportExpanded: publishCheck?.gateLevel !== 'pass'
      ? Boolean(publishCheck)
      : state.gateReportExpanded,
  }
}

export function useWritingReviewState() {
  const [gateState, dispatchGateState] = useReducer(reduceWritingReviewGateState, {
    publishCheck: null,
    gateReportExpanded: false,
  })
  const [rewriteModalOpen, setRewriteModalOpen] = useState(false)
  const [rewriteRequirements, setRewriteRequirements] = useState('')
  const [rewritingSelection, setRewritingSelection] = useState(false)
  const [optimizingChapter, setOptimizingChapter] = useState(false)
  const [applyingOptimizedChapter, setApplyingOptimizedChapter] = useState(false)
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false)
  const [optimizeRequirements, setOptimizeRequirements] = useState('')
  const [optimizationResult, setOptimizationResult] = useState<ChapterOptimizeResult | null>(null)

  const setPublishCheck = useCallback<Dispatch<SetStateAction<ChapterPublishCheck | null>>>((update) => {
    dispatchGateState({ type: 'set-publish-check', update })
  }, [])
  const setGateReportExpanded = useCallback<Dispatch<SetStateAction<boolean>>>((update) => {
    dispatchGateState({ type: 'set-gate-expanded', update })
  }, [])

  return {
    ...gateState,
    applyingOptimizedChapter,
    optimizationResult,
    optimizeModalOpen,
    optimizeRequirements,
    optimizingChapter,
    rewriteModalOpen,
    rewriteRequirements,
    rewritingSelection,
    setApplyingOptimizedChapter,
    setGateReportExpanded,
    setOptimizationResult,
    setOptimizeModalOpen,
    setOptimizeRequirements,
    setOptimizingChapter,
    setPublishCheck,
    setRewriteModalOpen,
    setRewriteRequirements,
    setRewritingSelection,
  }
}
