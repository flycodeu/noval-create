import type {
  ChapterSegment,
  PagedResult,
  StoryPart,
  StoryStructureChapterSummary,
  StoryStructurePartSummary,
  StoryStructureSegmentSummary,
  StoryStructureVolumeSummary,
  StoryVolume,
} from '../../../types'

export function createEmptyPage<T>(pageSize: number): PagedResult<T> {
  return {
    items: [],
    page: 1,
    pageSize,
    total: 0,
    hasMore: false,
  }
}

export function parseOptionalNumber(value: string | null): number | null {
  if (!value) return null

  const next = Number(value)
  return Number.isFinite(next) ? next : null
}

export function optionalId(value: number | null | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}

export function getVolumeLabel(volume?: Pick<StoryVolume, 'title' | 'volumeNumber'> | null): string {
  if (!volume) return '未选择'
  return volume.title || `第 ${volume.volumeNumber} 卷`
}

export function getPartLabel(part?: Pick<StoryPart, 'title' | 'partNumber'> | null): string {
  if (!part) return '未选择'
  return part.title || `第 ${part.partNumber} 部`
}

export function getChapterLabel(chapter?: Pick<StoryStructureChapterSummary, 'chapterNum'> | null): string {
  if (!chapter) return '未选择'
  return `第 ${chapter.chapterNum} 章`
}

export function getSegmentLabel(segment?: Pick<ChapterSegment, 'title' | 'segmentOrder'> | null): string {
  if (!segment) return '未选择'
  return segment.title || `场景 ${segment.segmentOrder}`
}

export function getVolumeOptionLabel(volume: Pick<StoryStructureVolumeSummary, 'title' | 'volumeNumber'>): string {
  return volume.title || `第 ${volume.volumeNumber} 卷`
}

export function getPartOptionLabel(part: Pick<StoryStructurePartSummary, 'title' | 'partNumber'>): string {
  return part.title || `第 ${part.partNumber} 部`
}

export function getSegmentOptionLabel(
  segment: Pick<StoryStructureSegmentSummary, 'title' | 'segmentOrder'>,
): string {
  return segment.title || `场景 ${segment.segmentOrder}`
}
