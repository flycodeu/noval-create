export interface SelectionRange { novelId: number; chapterId: number; start: number; end: number; original: string }
export interface SelectionRevisionInput extends SelectionRange {
  sourceContentHash: string; contextVersion: number; request: string; idempotencyKey: string
}
export interface SelectionRevisionCandidate extends SelectionRevisionInput { replacement: string }

export function assertSelectionRange(content: string, selection: Pick<SelectionRange, 'start' | 'end' | 'original'>) {
  if (!Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0 || selection.end <= selection.start
    || selection.end > content.length || selection.end - selection.start > 6000 || content.slice(selection.start, selection.end) !== selection.original) {
    throw new Error('选区与当前正文不一致，或超过 6000 字符；请重新选择。')
  }
  for (const position of [selection.start, selection.end]) {
    if (position > 0 && position < content.length && /[\uD800-\uDBFF]/.test(content[position - 1]) && /[\uDC00-\uDFFF]/.test(content[position])) {
      throw new Error('选区切断了完整字符，请重新选择。')
    }
  }
}

export function replaceSelection(content: string, candidate: Pick<SelectionRevisionCandidate, 'start' | 'end' | 'original' | 'replacement'>) {
  assertSelectionRange(content, candidate)
  if (!candidate.replacement.trim() || candidate.replacement.length > 12000) throw new Error('修订候选不能为空或超过 12000 字符。')
  return content.slice(0, candidate.start) + candidate.replacement + content.slice(candidate.end)
}
