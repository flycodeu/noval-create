export type AiJsonRoot = 'object' | 'array' | 'any'

function normalizeCjkQuotes(text: string): string {
  return text
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u300c|\u300d/g, '"')
    .replace(/\uff02/g, '"')
    .replace(/\uff07/g, "'")
}

function trimCodeFence(text: string): string {
  return normalizeCjkQuotes(
    text
      .replace(/^\uFEFF/, '')
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()
  )
}

function buildParseError(message: string, text: string): SyntaxError {
  const preview = text.replace(/\s+/g, ' ').slice(0, 220)
  return new SyntaxError(`${message}。输出片段：${preview}`)
}

function findNextNonWhitespaceIndex(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) return index
  }
  return -1
}

function peekNextSignificantChar(text: string, start: number): string {
  const index = findNextNonWhitespaceIndex(text, start)
  return index === -1 ? '' : text[index]
}

function looksLikeQuotedObjectKey(text: string, start: number): boolean {
  if (start < 0 || text[start] !== '"') return false
  return /^"[^"\r\n]{1,80}"\s*:/.test(text.slice(start))
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

function stripJsonComments(text: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === '/' && next === '/') {
      index += 2
      while (index < text.length && text[index] !== '\n') index += 1
      if (index < text.length) result += text[index]
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length - 1 && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 1
      continue
    }

    result += char
  }

  return result
}

function normalizeAiJsonText(text: string, expectedRoot: AiJsonRoot): string {
  const cleaned = trimCodeFence(text)
  const extracted = extractBalancedJson(cleaned, expectedRoot)
  return removeTrailingCommas(stripJsonComments(extracted))
}

type JsonRepairFrame =
  | { type: 'object'; state: 'expect_key_or_end' | 'expect_colon' | 'expect_value' | 'expect_comma_or_end' }
  | { type: 'array'; state: 'expect_value_or_end' | 'expect_comma_or_end' }

function setFrameStateAfterInjectedComma(frame: JsonRepairFrame | undefined) {
  if (!frame) return
  if (frame.type === 'object') frame.state = 'expect_key_or_end'
  else frame.state = 'expect_value_or_end'
}

function repairCommonAiJsonIssues(text: string): string {
  const result: string[] = []
  const stack: JsonRepairFrame[] = []
  let inString = false
  let escaped = false
  let stringKind: 'key' | 'value' = 'value'

  const top = () => stack[stack.length - 1]

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const frame = top()

    if (inString) {
      if (escaped) {
        result.push(char)
        escaped = false
        continue
      }

      if (char === '\\') {
        const next = text[index + 1]
        if (next && !/["\\/bfnrtu]/.test(next)) {
          result.push('\\\\')
          continue
        }
        result.push(char)
        escaped = true
        continue
      }

      if (char === '\r') {
        result.push('\\r')
        continue
      }

      if (char === '\n') {
        result.push('\\n')
        continue
      }

      if (char === '\t') {
        result.push('\\t')
        continue
      }

      if (char === '"') {
        const nextIndex = findNextNonWhitespaceIndex(text, index + 1)
        const nextSig = peekNextSignificantChar(text, index + 1)
        const startsNextObjectKey = nextSig === '"' && looksLikeQuotedObjectKey(text, nextIndex)
        const isTerminator = stringKind === 'key'
          ? nextSig === ':'
          : nextSig === ''
            || nextSig === ','
            || nextSig === '}'
            || nextSig === ']'
            || startsNextObjectKey

        if (isTerminator) {
          result.push('"')
          inString = false
          if (frame?.type === 'object' && stringKind === 'key') frame.state = 'expect_colon'
          else if (frame) frame.state = 'expect_comma_or_end'
          if (stringKind === 'value' && startsNextObjectKey) result.push(',')
          continue
        }

        result.push('\\"')
        continue
      }

      if (char < ' ') {
        result.push(`\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
        continue
      }

      result.push(char)
      continue
    }

    if (char === '"') {
      if (frame?.state === 'expect_comma_or_end') {
        result.push(',')
        setFrameStateAfterInjectedComma(frame)
      }
      stringKind = frame?.type === 'object' && frame.state === 'expect_key_or_end' ? 'key' : 'value'
      inString = true
      result.push('"')
      continue
    }

    if (/\s/.test(char)) {
      result.push(char)
      continue
    }

    if (char === ':') {
      result.push(char)
      if (frame?.type === 'object') frame.state = 'expect_value'
      continue
    }

    if (char === ',') {
      result.push(char)
      if (frame?.type === 'object') frame.state = 'expect_key_or_end'
      else if (frame?.type === 'array') frame.state = 'expect_value_or_end'
      continue
    }

    if (char === '{') {
      if (frame?.state === 'expect_comma_or_end') {
        result.push(',')
        setFrameStateAfterInjectedComma(frame)
      }
      stack.push({ type: 'object', state: 'expect_key_or_end' })
      result.push(char)
      continue
    }

    if (char === '[') {
      if (frame?.state === 'expect_comma_or_end') {
        result.push(',')
        setFrameStateAfterInjectedComma(frame)
      }
      stack.push({ type: 'array', state: 'expect_value_or_end' })
      result.push(char)
      continue
    }

    if (char === '}') {
      result.push(char)
      stack.pop()
      const parent = top()
      if (parent) parent.state = 'expect_comma_or_end'
      continue
    }

    if (char === ']') {
      result.push(char)
      stack.pop()
      const parent = top()
      if (parent) parent.state = 'expect_comma_or_end'
      continue
    }

    if (frame?.state === 'expect_comma_or_end' && /[0-9tfn-]/i.test(char)) {
      result.push(',')
      setFrameStateAfterInjectedComma(frame)
    }

    if (frame?.type === 'object' && frame.state === 'expect_value') {
      frame.state = 'expect_comma_or_end'
    } else if (frame?.type === 'array' && frame.state === 'expect_value_or_end') {
      frame.state = 'expect_comma_or_end'
    }

    result.push(char)
  }

  if (inString) result.push('"')
  return removeTrailingCommas(result.join(''))
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
      const repaired = repairCommonAiJsonIssues(normalized)

      try {
        return JSON.parse(repaired) as T
      } catch (repairError) {
        const rawMessage = repairError instanceof Error ? repairError.message : 'JSON 解析失败'
        throw buildParseError(`AI JSON 解析失败：${rawMessage}`, repaired)
      }
    }
  }
}

/**
 * Backward-compatible helper for existing call sites.
 */
export function safeParseJson<T = unknown>(text: string): T {
  return safeParseAiJson<T>(text, 'any')
}
