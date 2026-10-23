import { describe, expect, it } from 'vitest'
import { remapForeshadowReferences, selectClueMergeKeep } from './foreshadow-merge'

describe('foreshadow reference remapping', () => {
  it('deduplicates only merged clue ids and keeps unrelated duplicate values', () => {
    expect(remapForeshadowReferences([3, 7, 3, 9, 9], new Set([3]), 7)).toEqual([7, 9, 9])
    expect(remapForeshadowReferences(['foreshadow:3', 'character:3', 'foreshadow #7', '普通说明', '普通说明'], new Set([3]), 7, true)).toEqual(['foreshadow:7', 'character:3', '普通说明', '普通说明'])
  })
  it('preserves typed object metadata and does not rewrite natural-language mentions', () => {
    const source = [{ assetType: 'foreshadow', assetId: '3', note: '保留依据' }, { type: 'character', id: 3 }, '在第3章回收伏笔']
    expect(remapForeshadowReferences(source, new Set([3]), 7, true)).toEqual([{ assetType: 'foreshadow', assetId: '7', note: '保留依据' }, source[1], source[2]])
    expect(source[0]).toEqual({ assetType: 'foreshadow', assetId: '3', note: '保留依据' })
  })
  it('migrates legacy string ids and deduplicates mixed representations of the kept clue', () => {
    expect(remapForeshadowReferences(['3', 7, '7', ' 3 ', '9', '9'], new Set([3]), 7)).toEqual([7, '9', '9'])
    expect(remapForeshadowReferences(['7', '3', '线索3', '', null, false], new Set([3]), 7)).toEqual(['7', '线索3', '', null, false])
  })
  it('leaves references untouched when none points to a merged source', () => {
    expect(remapForeshadowReferences([7, '7', 7, 9, 9], new Set([3]), 7)).toEqual([7, '7', 7, 9, 9])
    expect(remapForeshadowReferences(['foreshadow:7', 'foreshadow:7'], new Set([3]), 7, true)).toEqual(['foreshadow:7', 'foreshadow:7'])
  })
})

describe('clue merge selection', () => {
  it('keeps both clues selected when their keep/source roles are exchanged', () => {
    const initial = { keepId: 3, sourceIds: [7] }
    const switched = selectClueMergeKeep(initial, 7)
    expect(switched).toEqual({ keepId: 7, sourceIds: [3] })
    expect(selectClueMergeKeep(switched, 3)).toEqual(initial)
    expect(initial).toEqual({ keepId: 3, sourceIds: [7] })
  })
  it('preserves other selected sources and does not add an unselected previous keep item', () => {
    expect(selectClueMergeKeep({ keepId: 3, sourceIds: [7, 9] }, 7)).toEqual({ keepId: 7, sourceIds: [3, 9] })
    expect(selectClueMergeKeep({ keepId: 3, sourceIds: [7, 9] }, 12)).toEqual({ keepId: 12, sourceIds: [7, 9] })
    expect(selectClueMergeKeep({ keepId: 3, sourceIds: [7, 9] }, 3)).toEqual({ keepId: 3, sourceIds: [7, 9] })
  })
})
