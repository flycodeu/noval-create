import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { atlasLibraryPage, atlasLibraryRows } from './atlas-library'

const character = (index: number, status: StoryAtlasEntity['status'] = 'confirmed'): StoryAtlasEntity => ({ id: `character:${index}`, kind: 'character', name: `人物${index}`, summary: '', parentId: null, attributes: {}, status, effectiveFromChapter: index % 7, source: { kind: 'test' } })
const snapshot: StoryAtlasSnapshot = { novelId: 1, contextVersion: 2, atChapter: null, entities: [...Array.from({ length: 85 }, (_, index) => character(index + 1)), character(86, 'planned')], relations: [], diagnostics: [], locationChildren: [] }
const options = { kind: 'character' as const, keyword: '', regionId: null, status: 'all' as const, order: 'planned' as const }

describe('atlas library browsing', () => {
  it('exposes saved planned people first and reaches every record across bounded pages', () => {
    const rows = atlasLibraryRows(snapshot, options)
    expect(rows[0].id).toBe('character:86')
    const pages = Array.from({ length: Math.ceil(rows.length / 12) }, (_, page) => atlasLibraryPage(rows, page + 1, 12))
    expect(pages.flatMap(page => page.rows).map(row => row.id)).toEqual(rows.map(row => row.id))
    expect(new Set(pages.flatMap(page => page.rows).map(row => row.id)).size).toBe(86)
    expect(pages.at(-1)?.rows).toHaveLength(2)
  })
  it('filters planned and recorded people independently without mutating the snapshot', () => {
    expect(atlasLibraryRows(snapshot, { ...options, status: 'planned' }).map(row => row.id)).toEqual(['character:86'])
    expect(atlasLibraryRows(snapshot, { ...options, status: 'confirmed' })).toHaveLength(85)
    expect(snapshot.entities[0].id).toBe('character:1')
    expect(atlasLibraryRows(snapshot, { ...options, keyword: '人物86' })).toHaveLength(1)
  })
  it('clamps a stale page after a search or dataset shrink and gives chapter order a precise meaning', () => {
    const rows = atlasLibraryRows(snapshot, { ...options, keyword: '人物86' })
    expect(atlasLibraryPage(rows, 8, 12)).toMatchObject({ current: 1, total: 1 })
    expect(atlasLibraryPage([], 8, 12)).toEqual({ current: 1, total: 0, rows: [] })
    const byChapter = atlasLibraryRows(snapshot, { ...options, order: 'chapter' })
    expect(byChapter[0].effectiveFromChapter).toBe(6)
  })
})
