export type InlineCompletionMode = 'sentence' | 'paragraph'
export const INLINE_COMPLETION_LIMITS = { sentence: 60, paragraph: 220 } as const
export interface InlineCompletionInput {
  novelId: number; chapterId: number; editorId: string; requestId: string
  editVersion: number; cursor: number; before: string; after: string; mode: InlineCompletionMode; modelConfigId?: number
}
export interface InlineCompletionResult { requestId: string; editVersion: number; cursor: number; text: string; cancelled?: boolean; busy?: boolean }
export function clipInlineCompletion(raw: string, mode: InlineCompletionMode, options: { streaming?: boolean } = {}) {
  const source = raw.replace(/^\s+/u, '')
  const boundary = mode === 'sentence' ? /[。！？!?][”’」』"]*|\r?\n/u.exec(source) : /\r?\n/u.exec(source)
  const end = boundary ? boundary.index + (boundary[0].includes('\n') ? 0 : boundary[0].length) : source.length
  const chars = Array.from(source.slice(0, end)), limit = INLINE_COMPLETION_LIMITS[mode]
  // A closing quote may arrive in the next chunk; finalize a trailing boundary at EOF.
  const boundaryComplete = boundary && (!options.streaming || boundary[0].includes('\n') || end < source.length)
  return { text: chars.slice(0, limit).join(''), stop: Boolean(boundaryComplete) || chars.length >= limit }
}
export function insertInlineCompletion(content: string, cursor: number, text: string) {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > content.length || !text.trim()) throw new Error('补全位置或文本无效。')
  if (cursor > 0 && cursor < content.length && /[\uD800-\uDBFF]/u.test(content[cursor - 1]) && /[\uDC00-\uDFFF]/u.test(content[cursor])) throw new Error('光标不能切断完整字符。')
  return content.slice(0, cursor) + text + content.slice(cursor)
}
