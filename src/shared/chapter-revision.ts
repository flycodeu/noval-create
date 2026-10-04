export interface RevisionParagraph { index: number; start: number; end: number; text: string }

/** Blank-line separators (including CRLF and spaces) stay outside the editable ranges. */
export function chapterRevisionParagraphs(content: string): RevisionParagraph[] {
  const rows: RevisionParagraph[] = []
  const separator = /(?:\r?\n)[\t ]*(?:\r?\n)(?:[\t ]*\r?\n)*/gu
  let start = 0
  for (const match of content.matchAll(separator)) {
    const end = match.index!
    if (content.slice(start, end).trim()) rows.push({ index: rows.length + 1, start, end, text: content.slice(start, end) })
    start = end + match[0].length
  }
  if (content.slice(start).trim()) rows.push({ index: rows.length + 1, start, end: content.length, text: content.slice(start) })
  return rows
}
