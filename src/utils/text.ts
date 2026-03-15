/**
 * 去除 AI 输出中的 Markdown 格式标记，返回纯文本
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/\*([^\*\n]+?)\*/g, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/_([^_\n]+?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/^```\s*$/gm, '')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\([^)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 去除 AI 输出中的引号着重（非对话语境中的强调引号）
 * 处理范围：1-12个字的短词/短语，不处理含标点的长引号（可能是对话）
 */
export function stripQuoteEmphasis(text: string): string {
  return text
    // 「短语」→ 去掉引号（中文书名号着重，1-12字）
    .replace(/「([^」\n]{1,12})」/g, '$1')
    // "短语" → 去掉引号（1-12字，不含逗号/句号，避免误删对话）
    .replace(/"([^"，。！？\n]{1,12})"/g, '$1')
    .trim()
}

/**
 * 从带有标记的 AI 输出中解析出指定节的内容
 * 用于处理需要多字段输出的情况，例如：
 *   【故事核心目标】内容  【核心冲突】内容
 */
export function parseSections(text: string, ...sectionNames: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < sectionNames.length; i++) {
    const name = sectionNames[i]
    const nextName = sectionNames[i + 1]
    const pattern = nextName
      ? new RegExp(`【${name}】\\s*([\\s\\S]+?)(?=【${nextName}】|$)`)
      : new RegExp(`【${name}】\\s*([\\s\\S]+?)$`)
    const match = text.match(pattern)
    result[name] = match ? stripMarkdown(match[1].trim()) : ''
  }
  return result
}
