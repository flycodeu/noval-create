import { useCallback, useRef, useState } from 'react'
import type { OutlineChapterBatchGenerationResult } from '../../../types'

export interface OutlineBatchProgress {
  phase: 'idle' | 'running' | 'failed' | 'done'
  arcId: number | null
  /** Chapters generated in the current run. */
  generated: number
  target: number
  batchIndex: number
  errorMessage: string | null
  lastResult: OutlineChapterBatchGenerationResult | null
  /** Design gate result of the latest batch, if the backend produced one. */
  designGate: OutlineChapterBatchGenerationResult['designGate'] | null
  cancelRequested: boolean
}

const IDLE_STATE: OutlineBatchProgress = {
  phase: 'idle',
  arcId: null,
  generated: 0,
  target: 0,
  batchIndex: 0,
  errorMessage: null,
  lastResult: null,
  designGate: null,
  cancelRequested: false,
}

export interface OutlineBatchOptions {
  batchSize: number
  targetCount: number
}

/**
 * Cancellable batched chapter-outline generation. Each batch is persisted by
 * the backend, so cancel simply stops at a batch boundary and a failed run can
 * be resumed by starting again — already generated outlines are kept.
 */
export function useChapterOutlineBatch(onRunFinished?: () => Promise<void> | void) {
  const [progress, setProgress] = useState<OutlineBatchProgress>(IDLE_STATE)
  const cancelRef = useRef(false)

  const cancel = useCallback(() => {
    cancelRef.current = true
    setProgress((current) => (current.phase === 'running' ? { ...current, cancelRequested: true } : current))
  }, [])

  const reset = useCallback(() => {
    cancelRef.current = false
    setProgress(IDLE_STATE)
  }, [])

  const start = useCallback(async (arcId: number, options: OutlineBatchOptions): Promise<OutlineBatchProgress> => {
    const safeBatchSize = Math.max(1, Math.min(options.batchSize, 6))
    const safeTargetCount = Math.max(1, Math.min(options.targetCount, 24))
    cancelRef.current = false

    let generated = 0
    let batchIndex = 0
    let lastResult: OutlineChapterBatchGenerationResult | null = null
    let designGate: OutlineBatchProgress['designGate'] = null

    setProgress({
      ...IDLE_STATE,
      phase: 'running',
      arcId,
      target: safeTargetCount,
    })

    try {
      while (generated < safeTargetCount && !cancelRef.current) {
        batchIndex += 1
        const currentBatchSize = Math.min(safeBatchSize, safeTargetCount - generated)
        const result = await window.electron.outline.generateChapterOutlines(arcId, { batchSize: currentBatchSize }) as OutlineChapterBatchGenerationResult
        lastResult = result
        generated += result.generatedCount || 0
        if (result.designGate) designGate = result.designGate
        setProgress((current) => ({
          ...current,
          generated,
          batchIndex,
          lastResult: result,
          designGate: result.designGate || current.designGate,
        }))
        if (result.completed || (result.generatedCount || 0) <= 0) break
      }

      const finished: OutlineBatchProgress = {
        phase: 'done',
        arcId,
        generated,
        target: safeTargetCount,
        batchIndex,
        errorMessage: null,
        lastResult,
        designGate,
        cancelRequested: cancelRef.current,
      }
      setProgress(finished)
      await onRunFinished?.()
      return finished
    } catch (error) {
      const failed: OutlineBatchProgress = {
        phase: 'failed',
        arcId,
        generated,
        target: safeTargetCount,
        batchIndex,
        errorMessage: error instanceof Error ? error.message : '生成失败',
        lastResult,
        designGate,
        cancelRequested: cancelRef.current,
      }
      setProgress(failed)
      // Batches already persisted are kept; refresh so the user sees them.
      await onRunFinished?.()
      return failed
    }
  }, [onRunFinished])

  return { progress, start, cancel, reset }
}
