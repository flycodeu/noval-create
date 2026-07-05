import { describe, expect, it } from 'vitest'
import {
  EMPTY_WORKFLOW_STATS,
  getAssetBloatSignal,
  getNextChapterReadiness,
} from './workflow'

describe('workflow asset bloat signal', () => {
  it('stays quiet when assets are still within the starter range', () => {
    const signal = getAssetBloatSignal({
      ...EMPTY_WORKFLOW_STATS,
      mapCount: 2,
      characterCount: 3,
      itemCount: 2,
      threadCount: 1,
      volumeCount: 1,
    })

    expect(signal.risk).toBe('none')
  })

  it('warns when pre-writing assets pile up without enough structure coverage', () => {
    const signal = getAssetBloatSignal({
      ...EMPTY_WORKFLOW_STATS,
      mapCount: 6,
      factionCount: 4,
      characterCount: 8,
      characterArcCount: 3,
      relationshipArcCount: 2,
      itemCount: 5,
      glossaryCount: 2,
      sceneTemplateCount: 1,
    })

    expect(signal.risk).toBe('high')
    expect(signal.reason).toContain('首章前已经堆积')
  })
})

describe('workflow next chapter readiness', () => {
  it('blocks writing when high priority revision blockers still exist', () => {
    const readiness = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      outlineCount: 1,
      timelineCount: 1,
      threadCount: 1,
      revisionBlockerCount: 2,
    })

    expect(readiness.ready).toBe(false)
    expect(readiness.label).toBe('先清阻塞项')
  })

  it('marks the project as ready for the first chapter once structure anchors exist', () => {
    const readiness = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      characterCount: 3,
      hasProtagonist: true,
      characterArcCount: 1,
      relationshipArcCount: 1,
      resistanceTrackCount: 2,
      volumeCount: 1,
      outlineCount: 1,
      timelineCount: 1,
      threadCount: 1,
    })

    expect(readiness.ready).toBe(true)
    expect(readiness.label).toBe('可写第一章')
  })

  it('blocks writing before the character network and resistance line are usable', () => {
    const missingCharacterNetwork = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      characterCount: 2,
      hasProtagonist: true,
      outlineCount: 1,
      timelineCount: 1,
      threadCount: 1,
      volumeCount: 1,
      resistanceTrackCount: 1,
    })

    expect(missingCharacterNetwork.ready).toBe(false)
    expect(missingCharacterNetwork.label).toBe('缺人物网')

    const missingResistance = getNextChapterReadiness({
      ...EMPTY_WORKFLOW_STATS,
      characterCount: 2,
      hasProtagonist: true,
      characterArcCount: 1,
      relationshipArcCount: 1,
      outlineCount: 1,
      timelineCount: 1,
      threadCount: 1,
      volumeCount: 1,
    })

    expect(missingResistance.ready).toBe(false)
    expect(missingResistance.label).toBe('缺阻力线')
  })
})
