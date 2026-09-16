import { normalizeQualityIssue, qualityIssueArtifactHash, type QualityIssueEvidence, type QualityIssueV1 } from '../../../shared/quality-issue'

export function readCurrentReviewIssues(raw: string | undefined, content: string): Array<{ issue: QualityIssueV1; current: boolean }> {
  let value: unknown
  try { value = JSON.parse(raw || '{}') } catch { return [] }
  if (!value || typeof value !== 'object' || !('issues' in value) || !Array.isArray(value.issues)) return []
  return value.issues.map(normalizeQualityIssue).filter((issue): issue is QualityIssueV1 => Boolean(issue))
    .map((issue) => ({ issue, current: issue.evidence.length > 0 && issue.evidence.every((evidence) => isCurrentReviewEvidence(evidence, content)) }))
}

export function isCurrentReviewEvidence(evidence: QualityIssueEvidence, content: string): boolean {
  return evidence.artifactHash === qualityIssueArtifactHash(content) && Number.isInteger(evidence.start)
    && Number.isInteger(evidence.end) && evidence.start >= 0 && evidence.end > evidence.start
    && evidence.end <= content.length && content.slice(evidence.start, evidence.end) === evidence.quote
}

/** Only select exact UTF-16 coordinates. Never relocate stale evidence by a similar quote. */
export function locateReviewEvidence(editor: HTMLElement, content: string, evidence: QualityIssueEvidence): boolean {
  if (!isCurrentReviewEvidence(evidence, content) || editor.textContent !== content) return false
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let offset = 0
  let startFound = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const end = offset + (node.textContent?.length || 0)
    if (!startFound && evidence.start >= offset && evidence.start < end) { range.setStart(node, evidence.start - offset); startFound = true }
    if (startFound && evidence.end <= end) {
      range.setEnd(node, evidence.end - offset)
      editor.focus({ preventScroll: true })
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      // The editor can be taller than its scroll host; scroll to the evidence,
      // not to the centre of the entire chapter.
      for (let host: HTMLElement | null = editor; host; host = host.parentElement) {
        if (host.scrollHeight <= host.clientHeight || !/(auto|scroll)/.test(getComputedStyle(host).overflowY)) continue
        const target = range.getBoundingClientRect()
        const viewport = host.getBoundingClientRect()
        host.scrollTop += target.top - viewport.top - host.clientHeight / 2
      }
      const target = range.getBoundingClientRect()
      if (target.top < 0 || target.bottom > window.innerHeight) window.scrollBy(0, target.top - window.innerHeight / 2)
      return true
    }
    offset = end
  }
  return false
}
