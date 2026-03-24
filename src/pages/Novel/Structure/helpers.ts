import type { TimelineAnchorFilters, TimelineEvent } from '../../../types'
import { parseOptionalNumber } from '../shared/workspace-utils'

export interface StructureSelection {
  volumeId: number | null
  partId: number | null
  chapterId: number | null
  segmentId: number | null
}

export interface ChapterFormValues {
  title?: string
  outline?: string
  targetWords?: number
  partId?: number
}

export interface SegmentFormValues {
  title?: string
  segmentType?: string
  purpose?: string
  timeAnchor?: string
  locationName?: string
  inputState?: string
  outputState?: string
  summary?: string
  content?: string
  status?: string
}

export const PART_PAGE_SIZE = 30
export const CHAPTER_PAGE_SIZE = 50
export const SEGMENT_PAGE_SIZE = 80
export const LINKED_PAGE_SIZE = 12
export const CHECKPOINT_PAGE_SIZE = 12

export const SEGMENT_TYPE_OPTIONS = [
  { value: 'scene', label: '场景' },
  { value: 'bridge', label: '过渡' },
  { value: 'turn', label: '转折' },
  { value: 'reveal', label: '揭示' },
  { value: 'climax', label: '高潮' },
] as const

export const SEGMENT_STATUS_OPTIONS = [
  { value: 'planned', label: '待写' },
  { value: 'draft', label: '草稿' },
  { value: 'locked', label: '定稿' },
] as const

export const TIMELINE_STATUS_META: Record<TimelineEvent['status'], { label: string; color: string }> = {
  planned: { label: '计划中', color: 'default' },
  seeded: { label: '已埋点', color: 'orange' },
  written: { label: '已写入正文', color: 'blue' },
  resolved: { label: '已回收', color: 'green' },
}

export function createStructureSelection(): StructureSelection {
  return {
    volumeId: null,
    partId: null,
    chapterId: null,
    segmentId: null,
  }
}

export function parseStructureRoute(search: URLSearchParams): Partial<StructureSelection> {
  return {
    volumeId: parseOptionalNumber(search.get('volumeId')),
    partId: parseOptionalNumber(search.get('partId')),
    chapterId: parseOptionalNumber(search.get('chapterId')),
    segmentId: parseOptionalNumber(search.get('segmentId')),
  }
}

export function buildStructureParams(selection: StructureSelection): URLSearchParams {
  const params = new URLSearchParams()

  if (selection.volumeId) params.set('volumeId', String(selection.volumeId))
  if (selection.partId) params.set('partId', String(selection.partId))
  if (selection.chapterId) params.set('chapterId', String(selection.chapterId))
  if (selection.segmentId) params.set('segmentId', String(selection.segmentId))

  return params
}

export function reorderItems<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

export function parseActiveThreadCount(raw?: string | null): number {
  if (!raw) return 0

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string' && item.trim()).length
      : 0
  } catch {
    return 0
  }
}

export function toTimelineAnchorFilters(
  filters: Partial<StructureSelection> & { novelId: number },
): TimelineAnchorFilters {
  const next: TimelineAnchorFilters = { novelId: filters.novelId }

  if (typeof filters.volumeId === 'number') next.volumeId = filters.volumeId
  if (typeof filters.partId === 'number') next.partId = filters.partId
  if (typeof filters.chapterId === 'number') next.chapterId = filters.chapterId
  if (typeof filters.segmentId === 'number') next.segmentId = filters.segmentId

  return next
}

export function buildTimelineFilters(
  novelId: number,
  selection: StructureSelection,
): TimelineAnchorFilters | null {
  if (selection.segmentId) return { novelId, segmentId: selection.segmentId }
  if (selection.chapterId) return { novelId, chapterId: selection.chapterId }
  if (selection.partId) return { novelId, partId: selection.partId }
  if (selection.volumeId) return { novelId, volumeId: selection.volumeId }

  return null
}

export function buildCheckpointFilters(novelId: number, selection: StructureSelection) {
  if (selection.partId) {
    return { novelId, scopeType: 'part' as const, scopeId: selection.partId }
  }

  if (selection.volumeId) {
    return { novelId, scopeType: 'volume' as const, scopeId: selection.volumeId }
  }

  return { novelId, scopeType: 'novel' as const }
}
