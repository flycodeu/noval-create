import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../database/db'
import { characterRelations, characters, factions, storyItems, worldMap } from '../database/schema'
import {
  buildCharacterMentionCandidates,
  buildFactionMentionCandidates,
  buildItemMentionCandidates,
  buildLocationMentionCandidates,
  collectMentionedEntityNamesFromCandidates,
  collectRelationMentionedCharacterNames,
} from './context-entity-mentions'
import {
  clearChapterEntityMentionCatalogCache,
  getChapterEntityMentionCatalogLookups,
  loadChapterEntityMentionCatalogs,
  resolveChapterEntityContextProjection,
  type ChapterEntityMentionCatalogs,
} from './context-entity-projection'

beforeEach(() => {
  clearChapterEntityMentionCatalogCache()
  vi.mocked(getDb).mockReset()
})

function createCatalogs(): ChapterEntityMentionCatalogs {
  const characters = Array.from({ length: 80 }, (_, index) => ({
    id: index + 1,
    novelId: 1,
    fullName: index === 0 ? '沈砚' : index === 59 ? '顾遥' : `角色${index + 1}`,
    surname: '',
    givenName: '',
    roleType: index === 0 ? 'protagonist' : index === 1 ? 'major' : 'supporting',
    gender: '',
    occupation: '',
    rankLevel: '',
    socialIdentity: '',
    species: '人类',
    sourceContextJson: index === 59 ? JSON.stringify({ aliases: ['副手'] }) : '[]',
    campFactionIdsJson: index === 59 ? JSON.stringify([10]) : '[]',
    sortOrder: index,
  }))
  const items = Array.from({ length: 80 }, (_, index) => ({
    id: index + 1,
    novelId: 1,
    itemName: index === 69 ? '折光钥匙' : `物品${index + 1}`,
    itemKind: 'instance',
    subType: '',
    tagsJson: '[]',
    sourceContextJson: '[]',
    typedRefsJson: index === 69
      ? JSON.stringify({ pointers: [{ name: '救命包' }] })
      : '[]',
    sortOrder: index,
  }))
  const locations = Array.from({ length: 80 }, (_, index) => ({
    id: index + 1,
    novelId: 1,
    parentId: index === 69 ? 2 : index === 1 ? 1 : null,
    level: index === 69 ? 3 : index === 1 ? 2 : 1,
    name: index === 0 ? '北境' : index === 1 ? '旧城' : index === 69 ? '东门地下库' : `地点${index + 1}`,
    locationType: '行动点',
    structureRole: '剧情节点',
    nodeType: 'location',
    tagsJson: '[]',
    description: index === 69 ? '别名：旧库、东门库房。' : '',
    atmosphere: '',
    plotRelevance: '',
    sortOrder: index,
  }))
  const factions = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    novelId: 1,
    name: index === 9 ? '影阁' : index === 10 ? '巡夜司' : index === 11 ? '外院' : `势力${index + 1}`,
    notes: index === 9 ? '别名：暗阁。' : '',
    externalRelationsJson: index === 9
      ? JSON.stringify([{ targetFactionId: 11, relation: 'enemy' }])
      : index === 11
        ? JSON.stringify([{ targetFactionId: 10, relation: 'subordinate' }])
        : '[]',
    sortOrder: index,
  }))
  const relations = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    novelId: 1,
    charAId: index === 24 ? 60 : (index % 40) + 1,
    charBId: index === 24 ? 2 : ((index + 1) % 40) + 1,
    relationType: index === 24 ? 'family' : 'ally',
    relationLabel: index === 24 ? '师徒' : `关系${index + 1}`,
    intimacyLevel: index === 24 ? 7 : 1,
    tensionLevel: index === 24 ? 9 : 1,
    interactionStyle: index === 24 ? '互相试探' : '',
  }))

  return {
    characters,
    items,
    locations,
    factions,
    relations,
    maxMapDepth: 3,
    speciesCount: 1,
  }
}

function resolveForChapter(catalogs: ChapterEntityMentionCatalogs, signalText: string) {
  const characterCandidates = buildCharacterMentionCandidates(catalogs.characters)
  const characterNameById = new Map(catalogs.characters.map((row) => [row.id, row.fullName]))
  const mentionedCharacters = new Set(collectMentionedEntityNamesFromCandidates(
    signalText,
    characterCandidates,
    8,
  ))
  collectRelationMentionedCharacterNames(
    signalText,
    catalogs.relations,
    characterNameById,
    8,
  ).forEach((name) => mentionedCharacters.add(name))

  return resolveChapterEntityContextProjection(catalogs, {
    mentionedCharacterNames: [...mentionedCharacters],
    mentionedItemNames: collectMentionedEntityNamesFromCandidates(
      signalText,
      buildItemMentionCandidates(catalogs.items),
      8,
    ),
    mentionedLocationNames: collectMentionedEntityNamesFromCandidates(
      signalText,
      buildLocationMentionCandidates(catalogs.locations),
      6,
    ),
    mentionedFactionNames: collectMentionedEntityNamesFromCandidates(
      signalText,
      buildFactionMentionCandidates(catalogs.factions),
      8,
    ),
    relationFocusText: signalText,
    characterLimit: 8,
    itemLimit: 8,
    locationLimit: 6,
    factionLimit: 8,
    relationLimit: 8,
  })
}

describe('chapter entity context projection', () => {
  const chapterCases = [
    {
      chapterNum: 1,
      signalText: '沈砚命顾遥带折光钥匙进入东门地下库，影阁与巡夜司正面冲突。',
    },
    {
      chapterNum: 2,
      signalText: '副手携救命包退入旧库，暗阁施压，这对师徒仍在互相试探。',
    },
  ]

  it.each(chapterCases)(
    'keeps chapter $chapterNum entity cards bounded while preserving direct context',
    ({ signalText }) => {
      const projection = resolveForChapter(createCatalogs(), signalText)

      expect(projection.characterFullIds).toContain(60)
      expect(projection.itemFullIds[0]).toBe(70)
      expect(projection.locationFullIds).toEqual([70, 2, 1])
      expect(projection.factionFullIds).toEqual(expect.arrayContaining([10, 11, 12]))
      expect(projection.relationFullIds).toContain(25)

      expect(projection.characterFullIds.length).toBeLessThanOrEqual(31)
      expect(projection.itemFullIds.length).toBeLessThanOrEqual(12)
      expect(projection.locationFullIds.length).toBeLessThanOrEqual(18)
      expect(projection.factionFullIds.length).toBeLessThanOrEqual(14)
      expect(projection.relationFullIds).toHaveLength(8)
    },
  )

  it('reuses derived lookup maps for the same catalog snapshot', () => {
    const catalogs = createCatalogs()

    const first = getChapterEntityMentionCatalogLookups(catalogs)
    const reused = getChapterEntityMentionCatalogLookups(catalogs)
    const refreshed = getChapterEntityMentionCatalogLookups(createCatalogs())

    expect(reused).toBe(first)
    expect(refreshed).not.toBe(first)
    expect(first.characterIdByName.get('顾遥')).toBe(60)
  })

  it('reuses a bounded catalog snapshot until the novel context version changes', () => {
    const rows = new Map<unknown, unknown[]>([
      [characters, createCatalogs().characters.slice(0, 2)],
      [storyItems, createCatalogs().items.slice(0, 2)],
      [worldMap, createCatalogs().locations.slice(0, 2)],
      [factions, createCatalogs().factions.slice(0, 2)],
      [characterRelations, createCatalogs().relations.slice(0, 2)],
    ])
    const select = vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            all: vi.fn(() => rows.get(table) || []),
          })),
        })),
      })),
    }))
    vi.mocked(getDb).mockReturnValue({ select } as never)

    const first = loadChapterEntityMentionCatalogs(1, { contextVersion: 7 })
    const cached = loadChapterEntityMentionCatalogs(1, { contextVersion: 7 })
    const refreshed = loadChapterEntityMentionCatalogs(1, { contextVersion: 8 })

    expect(cached).toBe(first)
    expect(refreshed).not.toBe(first)
    expect(select).toHaveBeenCalledTimes(10)
  })
})
