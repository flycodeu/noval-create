/**
 * Conservative token estimate used by context allocation and recall-query
 * planning. Chinese characters are close to one token each, while ASCII text
 * is estimated at roughly four characters per token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const punctuation = (text.match(/[\u3000-\u303f\uff00-\uffef，。！？；：、""''（）【】《》…—\s]/g) || []).length
  const asciiChars = text.length - chineseChars - punctuation
  const rawEstimate = chineseChars + asciiChars * 0.25 + punctuation * 0.5
  return Math.ceil(rawEstimate * 1.1)
}

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
