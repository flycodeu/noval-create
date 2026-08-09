import { describe, expect, it } from 'vitest'
import {
  buildCharacterSemanticDocuments,
  buildItemSemanticDocuments,
  buildMapSemanticDocuments,
  buildStoryThreadSemanticDocuments,
  buildTimelineEventSemanticDocuments,
} from './semantic-memory'

describe('semantic memory documents', () => {
  it('splits character identity, motivation and voice into independently replaceable fragments', () => {
    const documents = buildCharacterSemanticDocuments({
      id: 7,
      fullName: '叶振',
      roleType: 'protagonist',
      occupation: '矿工',
      goals: '查清事故责任',
      coreFear: '再次因迟疑失去同伴',
      speechPattern: '短句，先报事实再下判断',
      recordStatus: 'confirmed',
      appearChapter: 2,
    })

    expect(documents.map((document) => document.fragmentKey)).toEqual(['identity', 'motivation', 'voice'])
    expect(documents.find((document) => document.fragmentKey === 'motivation')?.content).toContain('查清事故责任')
    expect(documents.find((document) => document.fragmentKey === 'voice')?.content).toContain('先报事实')
    expect(documents.every((document) => document.validFromChapter === 2)).toBe(true)
  })

  it('keeps map narrative purpose separate from stable location identity', () => {
    const documents = buildMapSemanticDocuments({
      id: 3,
      name: '东门警戒区',
      level: 4,
      dangerLevel: '高',
      description: '旧城门改造的封锁点。',
      plotRelevance: '用于检验人物能否在宵禁前完成会合。',
    })

    expect(documents).toHaveLength(2)
    expect(documents[0].fragmentKey).toBe('identity')
    expect(documents[1].fragmentKey).toBe('narrative')
    expect(documents[1].content).toContain('宵禁前完成会合')
  })

  it('records item ownership and cost without coupling names to database ids', () => {
    const documents = buildItemSemanticDocuments({
      id: 11,
      itemName: '救命包',
      status: 'sealed',
      ownerCharacterId: 7,
      locationMapId: 3,
      abilitySpec: '可维持一人六小时生命体征',
      cost: '启封后不可复原',
      recordStatus: 'draft',
    }, {
      ownerName: '叶振',
      locationName: '东门警戒区',
    })

    expect(documents[0].content).toContain('持有人=叶振')
    expect(documents[0].entityRefs).toEqual(['救命包', '叶振', '东门警戒区'])
    expect(documents[1].content).toContain('启封后不可复原')
    expect(documents.every((document) => document.visibility === 'draft')).toBe(true)
  })

  it('gives plot threads and timeline events explicit chapter validity windows', () => {
    const thread = buildStoryThreadSemanticDocuments({
      id: 21,
      title: '事故责任追查',
      status: 'active',
      currentState: '证据指向封锁记录被改写',
      plantedChapter: 3,
      targetPayoffChapter: 40,
      resolvedChapter: 38,
    })[0]
    const event = buildTimelineEventSemanticDocuments({
      id: 31,
      eventTitle: '东门封锁',
      eventResult: '救命包未能按计划送入矿区',
      status: 'written',
    }, {
      sourceChapterStart: 18,
      sourceChapterEnd: 18,
      entityRefs: ['东门警戒区', '救命包'],
    })[0]

    expect(thread.validFromChapter).toBe(3)
    expect(thread.validToChapter).toBe(38)
    expect(event.validFromChapter).toBe(18)
    expect(event.validToChapter).toBeUndefined()
    expect(event.sourceChapterStart).toBe(18)
    expect(event.sourceChapterEnd).toBe(18)
    expect(event.entityRefs).toEqual(['东门封锁', '东门警戒区', '救命包'])
  })
})
