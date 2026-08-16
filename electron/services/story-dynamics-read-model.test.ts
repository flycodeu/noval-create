import { describe, expect, it } from 'vitest'
import {
  buildStoryDynamicsReadModel,
  selectStoryPacingAlertsForChapter,
  type StoryDynamicsSourceChapter,
} from './story-dynamics-read-model'

function chapterFixture(
  id: number,
  chapterNum: number,
  review: Record<string, unknown> | null,
): StoryDynamicsSourceChapter {
  return {
    id,
    chapterNum,
    title: `第${chapterNum}章`,
    volumeId: 1,
    reviewNotesJson: review ? JSON.stringify(review) : null,
  }
}

describe('story dynamics read model', () => {
  it('normalizes chapter 1 review evidence and chapter 2 timeline evidence through one model', () => {
    const readModel = buildStoryDynamicsReadModel([
      chapterFixture(101, 1, {
        protagonist_setback: 'minor',
        reversal_marker: true,
        reversal_support_state: 'forced',
        pace_marker: 'reversal',
      }),
      chapterFixture(102, 2, null),
    ], [{
      eventType: 'conflict',
      eventTitle: '第二章发生追击',
      eventSummary: '主角遭到追击',
      eventResult: null,
      chapterStartId: 102,
      chapterEndId: 102,
      protagonistPresent: 1,
      protagonistAction: '逃离包围',
    }])

    expect(readModel.chapters.map((chapter) => chapter.chapterId)).toEqual([101, 102])
    expect(readModel.chapterById.get(102)?.dynamics).toMatchObject({
      protagonistSetback: 'minor',
      paceMarker: 'conflict',
      protagonistPressure: 60,
    })
  })

  it('returns only alerts that include the requested chapter and respects the limit', () => {
    const readModel = buildStoryDynamicsReadModel([
      chapterFixture(101, 1, {
        reversal_marker: true,
        reversal_support_state: 'forced',
        pace_marker: 'climax',
      }),
      chapterFixture(102, 2, {
        reversal_marker: true,
        reversal_support_state: 'forced',
        pace_marker: 'climax',
      }),
    ])

    const alerts = selectStoryPacingAlertsForChapter(readModel, 2, 1)

    expect(alerts).toHaveLength(1)
    expect(alerts[0].chapterNums).toContain(2)
    expect(selectStoryPacingAlertsForChapter(readModel, 99)).toEqual([])
    expect(selectStoryPacingAlertsForChapter(readModel, 2, 0)).toEqual([])
  })
})
