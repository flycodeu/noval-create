import { describe, expect, it } from 'vitest'
import type {
  Chapter,
  ChapterPublishCheck,
  NovelConsistencyReport,
  StoryItem,
  TimelineEvent,
} from '../../../types'
import { buildPublishCheckPresentation, buildRelatedChapterAssets } from './writing-presentation-model'

describe('writing presentation model', () => {
  it('groups publish checks and keeps score, drift and recent history ordering', () => {
    const publishCheck = {
      checklist: [
        { status: 'pass', label: '合同' },
        { status: 'warning', label: '节奏' },
        { status: 'rewrite', label: '连续性' },
      ],
      scoreBreakdown: {
        totalScore: 71,
        continuityScore: 61,
        coherenceScore: 72,
        dialogueVoiceScore: 73,
        hookStrengthScore: 74,
        storyDynamicsScore: 75,
        languageNaturalnessScore: 76,
      },
      drift: {
        topDimensions: [
          { label: '连续性', delta: -4 },
          { label: '对白', delta: 0 },
          { label: '钩子', delta: 3 },
          { label: '节奏', delta: -2 },
          { label: '语言', delta: 1 },
        ],
      },
      history: [
        { id: 3, createdAt: '', gateLevel: 'warning', scoreBreakdown: { totalScore: 71 } },
        { id: 2, createdAt: '', gateLevel: 'blocker', scoreBreakdown: { totalScore: 65 } },
        { id: 1, createdAt: '', gateLevel: 'pass', scoreBreakdown: { totalScore: 88 } },
        { id: 0, createdAt: '', gateLevel: 'rewrite', scoreBreakdown: { totalScore: 40 } },
      ],
    } as unknown as ChapterPublishCheck

    const result = buildPublishCheckPresentation(publishCheck)

    expect(result.sections.map((section) => section.key)).toEqual(['rewrite', 'warning', 'pass'])
    expect(result.scores.map((score) => score.value)).toEqual([71, 61, 72, 73, 74, 75, 76])
    expect(result.driftHighlights).toEqual(['连续性-4', '钩子+3', '节奏-2'])
    expect(result.historyItems.map((item) => item.id)).toEqual([3, 2, 1])
    expect(result.historyItems[0].text).toContain('预警 · 总分 71')
  })

  it('relates timeline ranges, linked items and consistency issues to the current chapter', () => {
    const chapters = [
      { id: 1, chapterNum: 1 },
      { id: 2, chapterNum: 2, volumeId: 9 },
      { id: 3, chapterNum: 3 },
    ] as Chapter[]
    const timelineEvents = [
      { id: 10, chapterStartId: 1, chapterEndId: 3 },
      { id: 11, volumeId: 9 },
      { id: 12, chapterStartId: 3 },
    ] as TimelineEvent[]
    const storyItems = [
      { id: 20, linkedTimelineEventIdsJson: '[10]' },
      { id: 21, linkedTimelineEventIdsJson: '[12]' },
    ] as StoryItem[]
    const consistencyReport = {
      issues: [
        { entityType: 'chapter', entityId: 2, category: 'structure' },
        { entityType: 'timeline', entityId: 10, category: 'continuity' },
        { entityType: 'item', entityId: 20, category: 'continuity' },
        { entityType: 'timeline', entityId: 12, category: 'continuity' },
      ],
    } as NovelConsistencyReport

    const result = buildRelatedChapterAssets({
      chapter: chapters[1],
      chapters,
      timelineEvents,
      storyItems,
      consistencyReport,
    })

    expect(result.events.map((event) => event.id)).toEqual([10, 11])
    expect(result.items.map((item) => item.id)).toEqual([20])
    expect(result.issues.map((issue) => issue.entityId)).toEqual([2, 10, 20])
  })
})
