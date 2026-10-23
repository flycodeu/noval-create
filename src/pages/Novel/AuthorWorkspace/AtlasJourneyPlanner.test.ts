import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { AtlasJourneyPlanner } from './AtlasJourneyPlanner'

describe('journey query presentation', () => {
  it('shows the recorded multi-leg path and keeps missing distance explicit', () => {
    const snapshot: StoryAtlasSnapshot = { novelId: 1, contextVersion: 1, atChapter: 0, diagnostics: [], locationChildren: [], entities: ['甲镇', '中渡', '丙镇'].map(name => ({ id: name, name, kind: 'location', parentId: null, attributes: {}, summary: '', status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })), relations: [
      { id: 'ab', kind: 'route', fromId: '甲镇', toId: '中渡', label: '甲镇堤道', attributes: { travelHours: 2, travelMode: '步行', routeOpen: true, distanceKm: 8 }, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
      { id: 'bc', kind: 'route', fromId: '中渡', toId: '丙镇', label: '丙镇堤道', attributes: { travelHours: 3, travelMode: '步行', routeOpen: true }, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
    ] }
    const markup = renderToStaticMarkup(createElement(AtlasJourneyPlanner, { snapshot, initialFromId: '甲镇', initialToId: '丙镇', onRelation: () => {} }))
    expect(markup).toContain('已登记方案：5 小时 · 里程资料未齐')
    expect(markup).toContain('甲镇 → 中渡')
    expect(markup).toContain('中渡 → 丙镇')
    expect(markup).toContain('允许已登记换乘')
    expect(markup).not.toContain('直线距离')
    const unknown = renderToStaticMarkup(createElement(AtlasJourneyPlanner, { snapshot: { ...snapshot, relations: snapshot.relations.map(route => ({ ...route, attributes: {} })) }, initialFromId: '甲镇', initialToId: '丙镇', onRelation: () => {} }))
    expect(unknown).toContain('待核对通路')
    expect(unknown).toContain('行程耗时缺失')
    expect(unknown).not.toContain('已登记方案')
  })
})
