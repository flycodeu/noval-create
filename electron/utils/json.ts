export type AiJsonRoot = 'object' | 'array' | 'any'

function trimCodeFence(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}

function buildParseError(message: string, text: string): SyntaxError {
  const preview = text.replace(/\s+/g, ' ').slice(0, 220)
  return new SyntaxError(`${message}。输出片段：${preview}`)
}

function findBalancedEnd(text: string, startIdx: number, openChar: '{' | '[', closeChar: '}' | ']'): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = startIdx; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === openChar) {
      depth += 1
      continue
    }

    if (char === closeChar) {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

export function extractBalancedJson(text: string, expectedRoot: AiJsonRoot = 'any'): string {
  const cleaned = trimCodeFence(text)
  const candidates = expectedRoot === 'object'
    ? [{ openChar: '{' as const, closeChar: '}' as const }]
    : expectedRoot === 'array'
      ? [{ openChar: '[' as const, closeChar: ']' as const }]
      : [
          { openChar: '{' as const, closeChar: '}' as const },
          { openChar: '[' as const, closeChar: ']' as const },
        ]

  let bestMatch: { startIdx: number; endIdx: number } | null = null

  for (const candidate of candidates) {
    let startIdx = cleaned.indexOf(candidate.openChar)
    while (startIdx !== -1) {
      const endIdx = findBalancedEnd(cleaned, startIdx, candidate.openChar, candidate.closeChar)
      if (endIdx !== -1) {
        if (!bestMatch || startIdx < bestMatch.startIdx) {
          bestMatch = { startIdx, endIdx }
        }
        break
      }
      startIdx = cleaned.indexOf(candidate.openChar, startIdx + 1)
    }
  }

  if (!bestMatch) {
    throw buildParseError('AI 返回内容中未找到完整 JSON', cleaned)
  }

  return cleaned.slice(bestMatch.startIdx, bestMatch.endIdx + 1)
}

function removeTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, '$1')
}

function normalizeAiJsonText(text: string, expectedRoot: AiJsonRoot): string {
  const cleaned = trimCodeFence(text)
  const extracted = extractBalancedJson(cleaned, expectedRoot)
  return removeTrailingCommas(extracted)
}

/**
 * Parse AI output that is expected to contain JSON, allowing mild wrapper text
 * and simple formatting mistakes such as trailing commas.
 */
export function safeParseAiJson<T = unknown>(text: string, expectedRoot: AiJsonRoot = 'any'): T {
  const cleaned = trimCodeFence(text)

  try {
    return JSON.parse(cleaned) as T
  } catch {
    const normalized = normalizeAiJsonText(cleaned, expectedRoot)

    try {
      return JSON.parse(normalized) as T
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'JSON parse failed'
      throw buildParseError(`AI JSON 解析失败：${rawMessage}`, normalized)
    }
  }
}

/**
 * Backward-compatible helper for existing call sites.
 */
export function safeParseJson<T = unknown>(text: string): T {
  return safeParseAiJson<T>(text, 'any')
}
