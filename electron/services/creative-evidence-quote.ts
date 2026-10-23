/** Whitespace serialization may differ; wording, punctuation and order may not. */
export function matchesCreativeEvidenceQuote(prose: string, quote: string): boolean {
  const submitted = quote.trim()
  const compact = submitted.replace(/\s/gu, '')
  if (compact.length < 4) return false
  return prose.includes(submitted) || prose.replace(/\s/gu, '').includes(compact)
}
