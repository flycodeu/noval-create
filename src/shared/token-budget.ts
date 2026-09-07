/**
 * Conservative token estimate shared by context assembly, planning payloads,
 * and the final model-request budget gate.
 *
 * This is intentionally an estimate rather than a provider tokenizer. Chinese
 * characters are close to one token, ASCII text is roughly four characters per
 * token, and punctuation receives a smaller weight.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const punctuation = (text.match(/[\u3000-\u303f\uff00-\uffef，。！？；：、""''（）【】《》…—\s]/g) || []).length
  const asciiChars = text.length - chineseChars - punctuation
  const rawEstimate = chineseChars + asciiChars * 0.25 + punctuation * 0.5
  return Math.ceil(rawEstimate * 1.1)
}

/**
 * Truncate a value without exceeding the shared estimate. Keeping this helper
 * beside the estimator prevents planning and runtime context from inventing
 * slightly different token semantics.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const safeMaxTokens = Math.max(0, Math.floor(maxTokens))
  if (!text || safeMaxTokens <= 0) return ''
  if (estimateTokens(text) <= safeMaxTokens) return text

  const suffix = '…'
  if (estimateTokens(suffix) > safeMaxTokens) return ''
  let low = 0
  let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = `${text.slice(0, middle)}${suffix}`
    if (estimateTokens(candidate) <= safeMaxTokens) low = middle
    else high = middle - 1
  }
  return low > 0 ? `${text.slice(0, low)}${suffix}` : suffix
}
