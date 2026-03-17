export function stripMarkdown(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*_]{3,}$/gm, '')
    .replace(/^```[\w-]*\n?/gm, '')
    .replace(/^```$/gm, '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/\*([^\n*]+?)\*/g, '$1')
    .replace(/_([^\n_]+?)_/g, '$1')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/\[(.+?)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function stripQuoteEmphasis(text: string): string {
  return text
    .replace(/“([^“”\n，。！？：；]{1,14})”/g, '$1')
    .replace(/"([^"\n，。！？：；]{1,14})"/g, '$1')
    .replace(/「([^「」\n，。！？：；]{1,14})」/g, '$1')
    .replace(/『([^『』\n，。！？：；]{1,14})』/g, '$1')
    .replace(/《([^《》\n，。！？：；]{1,14})》/g, '$1')
}

const AI_FILLER_RULES: Array<[RegExp, string]> = [
  [/所谓的?/g, ''],
  [/某种意义上/g, ''],
  [/在这一刻/g, '这时'],
  [/不由得/g, ''],
  [/无法言说/g, '说不清'],
  [/命运般的?/g, ''],
  [/真正的成长/g, '变化'],
  [/承载着?/g, '关联'],
]

export function cleanAiFieldText(text: string): string {
  let cleaned = stripQuoteEmphasis(stripMarkdown(text))

  for (const [pattern, replacement] of AI_FILLER_RULES) {
    cleaned = cleaned.replace(pattern, replacement)
  }

  return cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([，。！？；：])/g, '$1')
    .replace(/([，。！？；：]){2,}/g, '$1')
    .replace(/^[，。！？；：、\s]+/g, '')
    .trim()
}

export function cleanAiStringArray(values: string[]): string[] {
  return values
    .map((value) => cleanAiFieldText(value))
    .filter(Boolean)
}

export function cleanAiValue<T = unknown>(value: T): T {
  if (typeof value === 'string') {
    return cleanAiFieldText(value) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => cleanAiValue(item)) as T
  }

  if (value && typeof value === 'object') {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = cleanAiValue(item)
    }
    return next as T
  }

  return value
}

export function parseSections(text: string, ...sectionNames: string[]): Record<string, string> {
  const normalized = stripMarkdown(text).replace(/\r/g, '')
  const result: Record<string, string> = {}

  for (let index = 0; index < sectionNames.length; index += 1) {
    const current = sectionNames[index]
    const next = sectionNames[index + 1]
    const startPattern = new RegExp(`【${current}】`)
    const startMatch = normalized.match(startPattern)
    if (!startMatch?.index && startMatch?.index !== 0) {
      result[current] = ''
      continue
    }

    const startIndex = startMatch.index + startMatch[0].length
    const tail = normalized.slice(startIndex)
    if (!next) {
      result[current] = tail.trim()
      continue
    }

    const nextPattern = new RegExp(`【${next}】`)
    const nextMatch = tail.match(nextPattern)
    result[current] = (nextMatch?.index !== undefined ? tail.slice(0, nextMatch.index) : tail).trim()
  }

  return result
}
