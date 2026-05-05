import { describe, expect, it } from 'vitest'
import {
  buildNameFallbackPointer,
  buildTypedRefOverlay,
  countUnresolvedTypedRefs,
  hasTypedRefOverlay,
  parseTypedRefOverlay,
  stringifyTypedRefOverlay,
} from './typed-ref'

describe('typed-ref', () => {
  it('round-trips overlay payloads', () => {
    const raw = stringifyTypedRefOverlay(buildTypedRefOverlay([
      buildNameFallbackPointer('character', { id: 12, name: '林远', confidence: 0.98 }),
      buildNameFallbackPointer('story_thread', { name: '旧仓暗门', alias: ['暗门线'], confidence: 0.42 }),
    ]))

    expect(hasTypedRefOverlay(raw)).toBe(true)
    expect(parseTypedRefOverlay(raw)?.pointers).toHaveLength(2)
  })

  it('counts unresolved refs when only fallback names exist', () => {
    const raw = stringifyTypedRefOverlay(buildTypedRefOverlay([
      buildNameFallbackPointer('story_thread', { name: '暗门线', alias: ['旧仓暗门'] }),
      buildNameFallbackPointer('item', { id: 5, name: '铜钥', confidence: 0.9 }),
    ]))

    expect(countUnresolvedTypedRefs(raw)).toBe(1)
  })
})
