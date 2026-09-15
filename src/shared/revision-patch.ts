import { qualityIssueArtifactHash } from './quality-issue'

/** C-07: a batch of replacements against one immutable artifact. */
export interface RevisionPatchEntry {
  start: number
  end: number
  expectedText: string
  replacement: string
  issueIds: string[]
}

export interface RevisionPatch {
  baseArtifactHash: string
  patches: RevisionPatchEntry[]
}

export interface RevisionPatchLockedRange {
  start: number
  end: number
}

export interface RevisionPatchEvidence extends RevisionPatchLockedRange {
  issueId: string
  artifactHash: string
  quote: string
}

export type RevisionPatchErrorCode =
  | 'NF_PATCH_INVALID'
  | 'NF_PATCH_BASE_MISMATCH'
  | 'NF_PATCH_RANGE'
  | 'NF_PATCH_EXPECTED'
  | 'NF_PATCH_OVERLAP'
  | 'NF_PATCH_LOCKED'
  | 'NF_PATCH_EVIDENCE'

export class RevisionPatchValidationError extends Error {
  readonly code: RevisionPatchErrorCode
  readonly patchIndex?: number

  constructor(code: RevisionPatchErrorCode, message: string, patchIndex?: number) {
    super(`${code}: ${message}`)
    this.name = 'RevisionPatchValidationError'
    this.code = code
    this.patchIndex = patchIndex
  }
}

/** The artifact hash used by quality evidence and revision patches. */
export function buildRevisionPatchArtifactHash(content: string): string {
  return qualityIssueArtifactHash(content || '')
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function splitsSurrogatePair(content: string, offset: number): boolean {
  const before = content.charCodeAt(offset - 1)
  const after = content.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

function fail(
  code: RevisionPatchErrorCode,
  message: string,
  patchIndex?: number,
): never {
  throw new RevisionPatchValidationError(code, message, patchIndex)
}

function overlaps(left: RevisionPatchLockedRange, right: RevisionPatchLockedRange): boolean {
  // Empty ranges are insertion points. They overlap a non-empty span when the
  // insertion point lies inside it, and overlap another insertion at the same
  // position.
  if (left.start === left.end && right.start === right.end) return left.start === right.start
  if (left.start === left.end) return left.start >= right.start && left.start <= right.end
  if (right.start === right.end) return right.start >= left.start && right.start <= left.end
  return left.start < right.end && right.start < left.end
}

function normalizeLockedRanges(
  ranges: readonly RevisionPatchLockedRange[] | undefined,
  contentLength: number,
): RevisionPatchLockedRange[] {
  if (!ranges) return []
  return ranges.map((range, index) => {
    if (!range || !isInteger(range.start) || !isInteger(range.end)
      || range.start < 0 || range.end < range.start || range.end > contentLength) {
      fail('NF_PATCH_LOCKED', `锁定范围 ${index} 越界。`)
    }
    return { start: range.start, end: range.end }
  })
}

/**
 * Validate the whole batch before any replacement is performed. The returned
 * entries are sorted only for the caller's convenience; the input is never
 * mutated and validation always uses offsets in the original UTF-16 string.
 */
export function validateRevisionPatch(
  content: string,
  patch: RevisionPatch,
  lockedRanges?: readonly RevisionPatchLockedRange[],
): RevisionPatchEntry[] {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    fail('NF_PATCH_INVALID', '补丁必须是对象。')
  }
  if (typeof patch.baseArtifactHash !== 'string' || !patch.baseArtifactHash.trim()) {
    fail('NF_PATCH_INVALID', '缺少 baseArtifactHash。')
  }
  if (patch.baseArtifactHash !== buildRevisionPatchArtifactHash(content)) {
    fail('NF_PATCH_BASE_MISMATCH', 'baseArtifactHash 与候选正文不匹配。')
  }
  if (!Array.isArray(patch.patches) || patch.patches.length === 0) {
    fail('NF_PATCH_INVALID', '补丁必须至少包含一条替换。')
  }

  const normalized = patch.patches.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('NF_PATCH_INVALID', `第 ${index + 1} 条补丁不是对象。`, index)
    }
    if (!isInteger(entry.start) || !isInteger(entry.end)
      || entry.start < 0 || entry.end < entry.start || entry.end > content.length
      || splitsSurrogatePair(content, entry.start) || splitsSurrogatePair(content, entry.end)) {
      fail('NF_PATCH_RANGE', `第 ${index + 1} 条补丁范围越界。`, index)
    }
    if (typeof entry.expectedText !== 'string' || typeof entry.replacement !== 'string') {
      fail('NF_PATCH_INVALID', `第 ${index + 1} 条补丁文本字段无效。`, index)
    }
    if (entry.expectedText !== content.slice(entry.start, entry.end)) {
      fail('NF_PATCH_EXPECTED', `第 ${index + 1} 条补丁 expectedText 不匹配。`, index)
    }
    if (!Array.isArray(entry.issueIds) || entry.issueIds.length === 0
      || entry.issueIds.some((issueId) => typeof issueId !== 'string' || !issueId.trim())) {
      fail('NF_PATCH_INVALID', `第 ${index + 1} 条补丁缺少有效 issueIds。`, index)
    }
    return {
      start: entry.start,
      end: entry.end,
      expectedText: entry.expectedText,
      replacement: entry.replacement,
      issueIds: [...entry.issueIds],
    }
  })

  const sorted = [...normalized].sort((left, right) => left.start - right.start || left.end - right.end)
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (overlaps(previous, current)) {
      fail('NF_PATCH_OVERLAP', `第 ${index} 与第 ${index + 1} 条补丁重叠。`, index)
    }
  }

  const locks = normalizeLockedRanges(lockedRanges, content.length)
  sorted.forEach((entry, index) => {
    if (locks.some((lockedRange) => overlaps(entry, lockedRange))) {
      fail('NF_PATCH_LOCKED', `第 ${index + 1} 条补丁触碰锁定正文。`, index)
    }
  })
  return sorted
}

/** Bind automatic edits to this review's current evidence, never just a model-supplied id. */
export function validateRevisionPatchEvidence(
  content: string,
  patch: RevisionPatch,
  evidence: readonly RevisionPatchEvidence[],
): void {
  const entries = validateRevisionPatch(content, patch)
  const current = evidence.filter((item) => item.artifactHash === patch.baseArtifactHash
    && isInteger(item.start) && isInteger(item.end) && item.start >= 0 && item.end > item.start
    && item.end <= content.length && content.slice(item.start, item.end) === item.quote)
  if (!current.length || current.length !== evidence.length) fail('NF_PATCH_EVIDENCE', '缺少本轮有效问题证据。')
  for (const entry of entries) {
    if (!entry.expectedText || entry.replacement.includes(entry.expectedText)
      || entry.issueIds.some((id) => !current.some((item) => item.issueId === id
        && entry.start >= item.start && entry.end <= item.end))) {
      fail('NF_PATCH_EVIDENCE', '补丁未修改目标问题或超出其证据范围。')
    }
  }
  if (current.some((item) => !entries.some((entry) => entry.issueIds.includes(item.issueId)))) {
    fail('NF_PATCH_EVIDENCE', '本轮目标问题未全部处理。')
  }
}

/** Scope is a routing diagnostic, never a minimum amount of rewriting. */
export function revisionPatchNeedsAuthorReview(content: string, patch: RevisionPatch): boolean {
  const entries = validateRevisionPatch(content, patch)
  const touched = entries.reduce((sum, entry) => sum + Math.max(entry.end - entry.start, entry.replacement.length), 0)
  return touched > content.length * 0.25
}

/** Apply a validated batch in reverse order so all offsets remain original UTF-16 offsets. */
export function applyRevisionPatch(
  content: string,
  patch: RevisionPatch,
  lockedRanges?: readonly RevisionPatchLockedRange[],
): string {
  const entries = validateRevisionPatch(content, patch, lockedRanges)
  return [...entries]
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce((current, entry) => (
      `${current.slice(0, entry.start)}${entry.replacement}${current.slice(entry.end)}`
    ), content)
}

export interface RevisionPatchApplyResult {
  content: string
  patches: RevisionPatchEntry[]
}

/** Structured variant for production callers that need the accepted entries. */
export function applyRevisionPatchResult(
  content: string,
  patch: RevisionPatch,
  lockedRanges?: readonly RevisionPatchLockedRange[],
): RevisionPatchApplyResult {
  const patches = validateRevisionPatch(content, patch, lockedRanges)
  return { content: applyRevisionPatch(content, patch, lockedRanges), patches }
}
