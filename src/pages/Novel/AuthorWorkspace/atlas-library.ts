import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { atlasEntityMatchesSearch, atlasLinks } from './atlas-profile'
import { locationPath } from './atlas-presentation'

export type AtlasLibraryOrder = 'planned' | 'name' | 'chapter'
export type AtlasLibraryStatus = 'all' | 'confirmed' | 'planned'
export function atlasLibraryRows(snapshot: StoryAtlasSnapshot, options: { kind: StoryAtlasEntity['kind']; keyword: string; regionId: string | null; status: AtlasLibraryStatus; order: AtlasLibraryOrder }) {
  return snapshot.entities.filter(entity => entity.kind === options.kind
    && (options.status === 'all' || entity.status === options.status)
    && atlasEntityMatchesSearch(entity, options.keyword)
    && (!options.regionId || atlasLinks(snapshot, entity, 'location').some(link => locationPath(snapshot.entities, link.entity.id).some(item => item.id === options.regionId))))
    .sort((left, right) => {
      if (options.order === 'planned' && left.status !== right.status) return left.status === 'planned' ? -1 : 1
      if (options.order === 'chapter' && left.effectiveFromChapter !== right.effectiveFromChapter) return right.effectiveFromChapter - left.effectiveFromChapter
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true }) || left.id.localeCompare(right.id)
    })
}
export function atlasLibraryPage(rows: StoryAtlasEntity[], page: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || 12)
  const current = Math.max(1, Math.min(Math.ceil(rows.length / size) || 1, Math.floor(page) || 1))
  return { current, rows: rows.slice((current - 1) * size, current * size), total: rows.length }
}
