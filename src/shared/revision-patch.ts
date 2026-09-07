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

export type RevisionPatchErrorCode =
  | 'NF_PATCH_INVALID'
  | 'NF_PATCH_BASE_MISMATCH'
  | 'NF_PATCH_RANGE'
  | 'NF_PATCH_EXPECTED'
  | 'NF_PATCH_OVERLAP'
  | 'NF_PATCH_LOCKED'

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
      || entry.start < 0 || entry.end < entry.start || entry.end > content.length) {
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
