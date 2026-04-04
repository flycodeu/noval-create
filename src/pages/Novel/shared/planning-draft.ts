import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanningDraftPageKey, PlanningDraftRecord } from '../../../types'

interface UsePlanningDraftOptions<T extends object> {
  novelId: number
  pageKey: PlanningDraftPageKey
  applyDraft: (data: Partial<T>) => void
}

interface PlanningDraftSaveMetadata {
  inputSummary?: string
  lintWarnings?: string[]
  rawOutputs?: string[]
  rejectionReason?: string
}

export function usePlanningDraft<T extends object>({
  novelId,
  pageKey,
  applyDraft,
}: UsePlanningDraftOptions<T>) {
  const [draft, setDraft] = useState<PlanningDraftRecord | null>(null)
  const restoredTaskIdRef = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    void window.electron.planningDraft.getLatest(novelId, pageKey).then((latest) => {
      if (!active) return
      setDraft(latest)
      if (latest?.status === 'applied' && restoredTaskIdRef.current !== latest.taskId) {
        applyDraft(latest.data as Partial<T>)
        restoredTaskIdRef.current = latest.taskId
      }
    }).catch(console.error)

    return () => {
      active = false
    }
  }, [applyDraft, novelId, pageKey])

  const saveAppliedDraft = useCallback(async (
    data: Partial<T>,
    warnings: string[] = [],
    sourcePage?: string,
    metadata?: PlanningDraftSaveMetadata,
  ) => {
    const saved = await window.electron.planningDraft.save({
      novelId,
      pageKey,
      data: data as Record<string, unknown>,
      warnings,
      sourcePage,
      inputSummary: metadata?.inputSummary,
      lintWarnings: metadata?.lintWarnings,
      rawOutputs: metadata?.rawOutputs,
      rejectionReason: metadata?.rejectionReason,
    })
    await window.electron.planningDraft.markApplied(saved.taskId)
    const appliedDraft: PlanningDraftRecord = {
      ...saved,
      status: 'applied',
      appliedAt: new Date().toISOString(),
    }
    restoredTaskIdRef.current = appliedDraft.taskId
    setDraft(appliedDraft)
    return appliedDraft
  }, [novelId, pageKey])

  const finalizeDraft = useCallback(async (finalData: Partial<T>) => {
    const taskId = draft?.taskId
    if (!taskId) return null
    const finalized = await window.electron.planningDraft.finalize(taskId, finalData as Record<string, unknown>)
    if (finalized) setDraft(finalized)
    return finalized
  }, [draft?.taskId])

  const clearDraft = useCallback(async () => {
    await window.electron.planningDraft.clear(novelId, pageKey)
    restoredTaskIdRef.current = null
    setDraft(null)
  }, [novelId, pageKey])

  return {
    draft,
    clearDraft,
    finalizeDraft,
    saveAppliedDraft,
  }
}
