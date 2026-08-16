import type {
  Chapter,
  ChapterPublishCheck,
  ConsistencyIssue,
  NovelConsistencyReport,
  StoryItem,
  TimelineEvent,
} from '../../../types'
import { parseNumberArray } from './parsers'

export interface PublishCheckSectionPresentation {
  key: string
  title: string
  items: ChapterPublishCheck['checklist']
}

export interface PublishCheckPresentation {
  sections: PublishCheckSectionPresentation[]
  scores: Array<{ label: string; value: number }>
  driftHighlights: string[]
  historyItems: Array<{ id: number; text: string }>
}

export interface RelatedChapterAssetsPresentation {
  events: TimelineEvent[]
  items: StoryItem[]
  issues: ConsistencyIssue[]
}

function gateLevelLabel(level: ChapterPublishCheck['gateLevel']): string {
  if (level === 'rewrite') return '退回重写'
  if (level === 'blocker') return '阻塞'
  if (level === 'warning') return '预警'
  return '通过'
}

export function buildPublishCheckPresentation(publishCheck: ChapterPublishCheck | null): PublishCheckPresentation {
  if (!publishCheck) return { sections: [], scores: [], driftHighlights: [], historyItems: [] }
  const sections = [
    { key: 'rewrite', title: '退回重写', items: publishCheck.checklist.filter((item) => item.status === 'rewrite') },
    { key: 'blocker', title: '阻塞项', items: publishCheck.checklist.filter((item) => item.status === 'blocker') },
    { key: 'warning', title: '预警项', items: publishCheck.checklist.filter((item) => item.status === 'warning') },
    { key: 'pass', title: '已通过', items: publishCheck.checklist.filter((item) => item.status === 'pass') },
  ].filter((section) => section.items.length > 0)
  const scores = [
    { label: '总分', value: publishCheck.scoreBreakdown.totalScore },
    { label: '连续性', value: publishCheck.scoreBreakdown.continuityScore },
    { label: '结构连贯', value: publishCheck.scoreBreakdown.coherenceScore },
    { label: '对白辨识', value: publishCheck.scoreBreakdown.dialogueVoiceScore },
    { label: '钩子强度', value: publishCheck.scoreBreakdown.hookStrengthScore },
    { label: '主角与节奏', value: publishCheck.scoreBreakdown.storyDynamicsScore },
    { label: '语言自然度', value: publishCheck.scoreBreakdown.languageNaturalnessScore },
  ]
  const driftHighlights = (publishCheck.drift?.topDimensions || [])
    .filter((item) => item.delta !== 0)
    .slice(0, 3)
    .map((item) => `${item.label}${item.delta > 0 ? '+' : ''}${item.delta}`)
  const historyItems = (publishCheck.history || []).slice(0, 3).map((entry) => ({
    id: entry.id,
    text: `${entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''} · ${gateLevelLabel(entry.gateLevel)} · 总分 ${entry.scoreBreakdown.totalScore}`,
  }))
  return { sections, scores, driftHighlights, historyItems }
}

function isEventRelatedToChapter(event: TimelineEvent, chapter: Chapter, chapterIdToNum: Map<number, number>): boolean {
  if (event.partId && event.partId === chapter.partId) return true
  if (event.volumeId && event.volumeId === chapter.volumeId) return true
  if (event.chapterStartId === chapter.id || event.chapterEndId === chapter.id) return true
  const startNum = event.chapterStartId ? chapterIdToNum.get(event.chapterStartId) : undefined
  const endNum = event.chapterEndId ? chapterIdToNum.get(event.chapterEndId) : undefined
  if (typeof startNum === 'number' && typeof endNum === 'number') {
    return chapter.chapterNum >= startNum && chapter.chapterNum <= endNum
  }
  if (typeof startNum === 'number') return chapter.chapterNum === startNum
  if (typeof endNum === 'number') return chapter.chapterNum === endNum
  return false
}

export function buildRelatedChapterAssets(input: {
  chapter: Chapter | null
  chapters: Chapter[]
  timelineEvents: TimelineEvent[]
  storyItems: StoryItem[]
  consistencyReport: NovelConsistencyReport | null
}): RelatedChapterAssetsPresentation {
  const { chapter, chapters, consistencyReport, storyItems, timelineEvents } = input
  if (!chapter) return { events: [], items: [], issues: [] }
  const chapterIdToNum = new Map(chapters.map((item) => [item.id, item.chapterNum]))
  const events = timelineEvents.filter((event) => isEventRelatedToChapter(event, chapter, chapterIdToNum))
  const eventIds = new Set(events.map((event) => event.id))
  const items = storyItems.filter((item) => (
    parseNumberArray(item.linkedTimelineEventIdsJson).some((id) => eventIds.has(id))
  ))
  const itemIds = new Set(items.map((item) => item.id))
  const issues = (consistencyReport?.issues || []).filter((issue) => (
    ((issue.entityType === 'chapter' || issue.category === 'continuity') && issue.entityId === chapter.id)
    || (issue.entityType === 'timeline' && issue.entityId ? eventIds.has(issue.entityId) : false)
    || (issue.entityType === 'item' && issue.entityId ? itemIds.has(issue.entityId) : false)
  ))
  return { events, items, issues }
}
