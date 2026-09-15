export { estimateTokens, truncateToTokens } from '../../src/shared/token-budget'
import { estimateTokens } from '../../src/shared/token-budget'
import type { ContextPackSource } from '../../src/shared/context-pack'

export function renderOriginalSources(sources: ContextPackSource[], original?: string): string {
  const kept = sources.filter((source) => source.included)
  if (!kept.length) return ''
  if (original !== undefined && kept.length === sources.length) return original.trim()
  return kept.map((source) => source.text).join('\n\n')
}

/** Allocate whole paragraphs, preserving dependency atoms and chronological order. */
export function selectOriginalSources(sources: ContextPackSource[], budget: number, original?: string) {
  const selected = sources.map((source) => ({ ...source }))
  const requiredTokens = estimateTokens(renderOriginalSources(selected.filter((source) => source.required)))
  const overflow = requiredTokens > budget || selected.some((source) => source.required && !source.included)
  if (estimateTokens(renderOriginalSources(selected, original)) <= budget) {
    selected.forEach((source) => {
      if (source.included && !source.required) source.projectionKind = 'full_text'
    })
  } else {
    selected.forEach((source) => {
      if (source.included && !source.required) { source.included = false; source.reason = 'budget_insufficient' }
    })
    for (const source of selected) {
      if (source.reason !== 'budget_insufficient') continue
      source.included = true
      if (estimateTokens(renderOriginalSources(selected)) > budget) source.included = false
      else source.reason = 'budget_fit'
    }
  }
  return { sources: selected, text: renderOriginalSources(selected, original), requiredTokens, overflow }
}
