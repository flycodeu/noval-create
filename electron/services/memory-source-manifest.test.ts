import { describe, expect, it } from 'vitest'
import {
  createMemorySourceManifest,
  createMemorySourceRef,
  hashMemorySourceArtifact,
  parseMemorySourceManifest,
} from './memory-source-manifest'

describe('memory source manifest v1', () => {
  it('builds a deterministic, deduplicated source list', () => {
    const source = createMemorySourceRef('chapter', 3, { summary: '事实 A', state: ['x'] })
    const manifest = createMemorySourceManifest({
      contextVersion: 10,
      sources: [
        createMemorySourceRef('timeline_event', 8, { result: '事实 B' }, 2),
        source,
        source,
      ],
      range: { startChapterNum: 3, endChapterNum: 8 },
      unresolvedRefs: [' missing:item:9 ', 'missing:item:9'],
    })

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.sources).toHaveLength(2)
    expect(manifest.unresolvedRefs).toEqual(['missing:item:9'])
    expect(hashMemorySourceArtifact({ b: 2, a: 1 })).toBe(hashMemorySourceArtifact({ a: 1, b: 2 }))
  })

  it('distinguishes legacy, stale, invalid, unresolved, and verified manifests', () => {
    const verified = createMemorySourceManifest({
      contextVersion: 11,
      sources: [createMemorySourceRef('chapter', 3, { summary: 'confirmed' }, 7)],
      range: { startChapterNum: 3, endChapterNum: 3 },
    })

    expect(parseMemorySourceManifest(null, 11).state).toBe('legacy')
    expect(parseMemorySourceManifest('{bad', 11).state).toBe('invalid')
    expect(parseMemorySourceManifest(JSON.stringify(verified), 12).state).toBe('stale')
    expect(parseMemorySourceManifest(JSON.stringify({
      ...verified,
      unresolvedRefs: ['missing:thread:4'],
    }), 11).state).toBe('unresolved')
    expect(parseMemorySourceManifest(JSON.stringify(verified), 11)).toEqual({
      state: 'verified',
      manifest: verified,
      requiredGaps: [],
    })
  })
})
