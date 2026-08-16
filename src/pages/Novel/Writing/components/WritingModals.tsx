import React from 'react'
import type { Chapter, ChapterOptimizeResult } from '../../../../types'
import OptimizeCandidateModal from './modals/OptimizeCandidateModal'
import ParallelGenerationModal from './modals/ParallelGenerationModal'
import RewriteSelectionModal from './modals/RewriteSelectionModal'

export interface WritingModalsProps {
  novelId: number
  chapters: Chapter[]
  rewrite: {
    open: boolean
    selectedText: string
    requirements: string
    loading: boolean
    onRequirementsChange(value: string): void
    onOpenChange(open: boolean): void
    onConfirm(): Promise<void>
  }
  optimize: {
    open: boolean
    result: ChapterOptimizeResult | null
    requirements: string
    applying: boolean
    onRequirementsChange(value: string): void
    onOpenChange(open: boolean): void
    onApply(): Promise<void>
  }
}

export default function WritingModals({ chapters, novelId, optimize, rewrite }: WritingModalsProps) {
  return (
    <>
      <RewriteSelectionModal
        open={rewrite.open}
        selectedText={rewrite.selectedText}
        requirements={rewrite.requirements}
        confirmLoading={rewrite.loading}
        onRequirementsChange={rewrite.onRequirementsChange}
        onCancel={() => rewrite.onOpenChange(false)}
        onOk={() => void rewrite.onConfirm()}
      />

      <OptimizeCandidateModal
        open={optimize.open}
        result={optimize.result}
        requirements={optimize.requirements}
        applying={optimize.applying}
        onRequirementsChange={optimize.onRequirementsChange}
        onCancel={() => optimize.onOpenChange(false)}
        onApply={() => void optimize.onApply()}
      />

      <ParallelGenerationModal novelId={novelId} chapters={chapters} />
    </>
  )
}
