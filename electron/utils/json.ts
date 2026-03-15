/**
 * 安全解析 AI 返回的 JSON —— AI 有时会用 ```json ... ``` 包裹
 */
export function safeParseJson<T = unknown>(text: string): T {
  let cleaned = text.trim()

  // 去除最外层 markdown 代码块（```json ... ``` 或 ``` ... ```）
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  // 尝试直接解析
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // 尝试提取第一个完整 JSON 对象或数组
    const firstBrace = cleaned.indexOf('{')
    const firstBracket = cleaned.indexOf('[')

    let startIdx = -1
    let endChar = ''

    if (firstBrace === -1 && firstBracket === -1) {
      throw new SyntaxError(`AI 返回内容中未找到 JSON：${cleaned.slice(0, 100)}`)
    }

    if (firstBrace === -1) {
      startIdx = firstBracket
      endChar = ']'
    } else if (firstBracket === -1) {
      startIdx = firstBrace
      endChar = '}'
    } else {
      startIdx = Math.min(firstBrace, firstBracket)
      endChar = startIdx === firstBrace ? '}' : ']'
    }

    const lastIdx = cleaned.lastIndexOf(endChar)
    if (lastIdx <= startIdx) {
      throw new SyntaxError(`AI 返回的 JSON 不完整：${cleaned.slice(0, 100)}`)
    }

    const extracted = cleaned.slice(startIdx, lastIdx + 1)
    return JSON.parse(extracted) as T
  }
}
