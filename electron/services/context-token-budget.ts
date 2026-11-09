export { estimateTokens, truncateToTokens } from '../../src/shared/token-budget'
import { estimateTokens } from '../../src/shared/token-budget'
import type { ContextPackSource } from '../../src/shared/context-pack'

export function renderOriginalSources(sources: ContextPackSource[], original?: string): string {
  const kept = sources.filter((source) => source.included)
  if (!kept.length) return ''
  if (original !== undefined && kept.length === sources.length) return original.trim()
  return kept.map((source) => source.text).join('\n\n')
}

export interface OriginalSourceSelection {
  sources: ContextPackSource[]
  text: string
  requiredTokens: number
  missingRequiredSources: ContextPackSource[]
  budgetOverflow: boolean
  overflow: boolean
}

/** Allocate whole paragraphs, preserving dependency atoms and chronological order. */
export function selectOriginalSources(sources: ContextPackSource[], budget: number, original?: string): OriginalSourceSelection {
  const selected = sources.map((source) => ({ ...source }))
  const missingRequiredSources = selected.filter((source) => source.required && !source.included)
  // Selection may trim visible optional prose, but must not reverse an earlier visibility decision.
  const budgetCandidates = selected.filter((source) => source.included && !source.required)
  const requiredTokens = estimateTokens(renderOriginalSources(selected.filter((source) => source.required)))
  const budgetOverflow = requiredTokens > budget
  const overflow = budgetOverflow || missingRequiredSources.length > 0
  if (estimateTokens(renderOriginalSources(selected, original)) <= budget) {
    selected.forEach((source) => {
      if (source.included && !source.required) source.projectionKind = 'full_text'
    })
  } else {
    budgetCandidates.forEach((source) => {
      source.included = false
      source.reason = 'budget_insufficient'
    })
    for (const source of budgetCandidates) {
      source.included = true
      if (estimateTokens(renderOriginalSources(selected)) > budget) source.included = false
      else source.reason = 'budget_fit'
    }
  }
  return { sources: selected, text: renderOriginalSources(selected, original), requiredTokens, missingRequiredSources, budgetOverflow, overflow }
}
