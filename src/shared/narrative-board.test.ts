import { describe, expect, it } from 'vitest'
import type { TimelineEvent, WorldMapItem } from '../types'
import {
  filterWorldMapTreeByIds,
  findWorldMapNode,
  flattenWorldMapTree,
  getWorldMapDescendantIds,
  getWorldMapPath,
  isTimelineEventInChapterWindow,
  parseJsonNumberIds,
  parseJsonTokens,
  parseNarrativeBoardRoute,
  setNarrativeBoardParam,
} from './narrative-board'

const tree: WorldMapItem[] = [
  {
    id: 1,
    novelId: 9,
    level: 1,
    name: '北境',
    sortOrder: 1,
    children: [
      { id: 2, novelId: 9, level: 2, parentId: 1, name: '雾港', sortOrder: 1 },
      {
        id: 3,
        novelId: 9,
        level: 2,
        parentId: 1,
        name: '雪线哨站',
        sortOrder: 2,
        children: [{ id: 4, novelId: 9, level: 3, parentId: 3, name: '旧塔', sortOrder: 1 }],
      },
    ],
  },
]

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 1,
    novelId: 9,
    sortOrder: 1,
    eventTitle: '雾港交涉',
    timeMode: 'chapter',
    timeLabel: '第 4 章',
    timeSortValue: 4,
    isMajorEvent: 0,
    protagonistPresent: 1,
    status: 'planned',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('narrative-board scope helpers', () => {
  it('parses a shareable board scope and removes a parameter without losing others', () => {
    const parsed = parseNarrativeBoardRoute(
      '?mode=characters&layout=locations&stageId=3&chapterStart=2&chapterEnd=8&threadIds=7,7,11&eventId=5&taskId=6&mapNodeId=4&focusCharacterId=12',
      9,
    )

    expect(parsed.mode).toBe('characters')
    expect(parsed.layout).toBe('locations')
    expect(parsed.scope).toMatchObject({
      novelId: 9,
      stageId: 3,
      chapterStart: 2,
      chapterEnd: 8,
      storyThreadIds: [7, 11],
      timelineEventId: 5,
      taskId: 6,
      mapNodeId: 4,
      characterIds: [12],
      timeMode: 'current-stage',
    })

    const next = setNarrativeBoardParam('?mode=progress&stageId=3', 'stageId', null)
    expect(next.toString()).toBe('mode=progress')
  })

  it('keeps the selected map region separate from the level being browsed', () => {
    const parsed = parseNarrativeBoardRoute('?mapNodeId=4&mapViewNodeId=3', 9)

    expect(parsed.mapViewNodeId).toBe(3)
    expect(parsed.scope.mapNodeId).toBe(4)
  })

  it('keeps map hierarchy navigable and preserves only selected branches', () => {
    expect(flattenWorldMapTree(tree).map((item) => item.id)).toEqual([1, 2, 3, 4])
    expect(findWorldMapNode(tree, 4)?.name).toBe('旧塔')
    expect(getWorldMapPath(tree, 4).map((item) => item.name)).toEqual(['北境', '雪线哨站', '旧塔'])
    expect(getWorldMapDescendantIds(findWorldMapNode(tree, 3))).toEqual([3, 4])
    expect(flattenWorldMapTree(filterWorldMapTreeByIds(tree, new Set([3, 4]))).map((item) => item.id)).toEqual([1, 3, 4])
  })

  it('supports both numeric ids and legacy names in JSON fields', () => {
    expect(parseJsonTokens('[1,"雾港",null," 旧塔 ",0]')).toEqual([1, '雾港', '旧塔'])
    expect(parseJsonNumberIds('[1,2]', '[2,"雾港"]')).toEqual([1, 2])
  })

  it('uses chapter id to number resolution and fails open for unresolved authored anchors', () => {
    const scoped = { chapterStart: 3, chapterEnd: 5 }
    expect(isTimelineEventInChapterWindow(event({ chapterStartId: 10, chapterEndId: 11 }), scoped, new Map([[10, 2], [11, 4]]))).toBe(true)
    expect(isTimelineEventInChapterWindow(event({ chapterStartId: 10, chapterEndId: 11 }), scoped, new Map([[10, 6], [11, 8]]))).toBe(false)
    expect(isTimelineEventInChapterWindow(event({ chapterStartId: 999 }), scoped, new Map([[1, 1]]))).toBe(true)
    expect(isTimelineEventInChapterWindow(event({ chapterStartId: 999 }), scoped, new Map([[1, 1]]), true)).toBe(false)
    expect(isTimelineEventInChapterWindow(event({ anchorInvalid: 1, chapterStartId: 10 }), scoped, new Map([[10, 4]]), true)).toBe(false)
    expect(isTimelineEventInChapterWindow(event(), {})).toBe(true)
  })
})
