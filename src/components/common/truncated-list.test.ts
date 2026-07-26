import { describe, expect, it } from 'vitest'
import { computeVisibleItems } from './truncated-list'

describe('computeVisibleItems', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f']

  it('collapses to limit and reports hidden count', () => {
    const result = computeVisibleItems(items, 4, false)
    expect(result.visible).toEqual(['a', 'b', 'c', 'd'])
    expect(result.hiddenCount).toBe(2)
    expect(result.canToggle).toBe(true)
  })

  it('shows everything when expanded but keeps the toggle', () => {
    const result = computeVisibleItems(items, 4, true)
    expect(result.visible).toEqual(items)
    expect(result.hiddenCount).toBe(0)
    expect(result.canToggle).toBe(true)
  })

  it('does not toggle when the list fits within the limit', () => {
    const result = computeVisibleItems(['a', 'b'], 4, false)
    expect(result.visible).toEqual(['a', 'b'])
    expect(result.hiddenCount).toBe(0)
    expect(result.canToggle).toBe(false)
  })

  it('treats a list exactly at the limit as fully visible', () => {
    const result = computeVisibleItems(['a', 'b', 'c', 'd'], 4, false)
    expect(result.visible).toEqual(['a', 'b', 'c', 'd'])
    expect(result.hiddenCount).toBe(0)
    expect(result.canToggle).toBe(false)
  })

  it('treats non-positive or non-finite limits as no truncation', () => {
    expect(computeVisibleItems(items, 0, false).visible).toEqual(items)
    expect(computeVisibleItems(items, -3, false).canToggle).toBe(false)
    expect(computeVisibleItems(items, Number.NaN, false).visible).toEqual(items)
  })

  it('handles empty lists', () => {
    const result = computeVisibleItems([], 4, false)
    expect(result.visible).toEqual([])
    expect(result.hiddenCount).toBe(0)
    expect(result.canToggle).toBe(false)
  })
})
