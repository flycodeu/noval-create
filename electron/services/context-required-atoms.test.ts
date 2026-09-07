import { describe, expect, it } from 'vitest'
import {
  allocateRequiredContextAtoms,
  createRequiredContextAtom,
} from './context-required-atoms'

describe('required context atoms', () => {
  it('keeps complete required text and reports the missing atom when one token is unavailable', () => {
    const first = createRequiredContextAtom({
      sourceKey: 'context:chapterGoal',
      label: 'chapterGoal',
      text: '必须完成会合。',
      tokenEstimate: 5,
    })
    const second = createRequiredContextAtom({
      sourceKey: 'context:continuityNotes',
      label: 'continuityNotes',
      text: '除非收到回执，否则之前的伤势不允许被忽略。',
      tokenEstimate: 2,
    })

    const allocation = allocateRequiredContextAtoms([first, second], 6)

    expect(allocation.included).toEqual([first])
    expect(allocation.included[0].text).toBe('必须完成会合。')
    expect(allocation.dropped).toEqual([second])
    expect(allocation.requiredTokens).toBe(7)
    expect(allocation.deficitTokens).toBe(1)
    expect(allocation.missingAtomIds).toEqual([second.id])
  })

  it('keeps every atom complete when the budget exactly matches the required total', () => {
    const atoms = [
      createRequiredContextAtom({ sourceKey: 'context:a', label: 'a', text: 'A', tokenEstimate: 3 }),
      createRequiredContextAtom({ sourceKey: 'context:b', label: 'b', text: 'B', tokenEstimate: 4 }),
    ]

    const allocation = allocateRequiredContextAtoms(atoms, 7)

    expect(allocation.included).toEqual(atoms)
    expect(allocation.dropped).toEqual([])
    expect(allocation.usedTokens).toBe(7)
    expect(allocation.deficitTokens).toBe(0)
  })

  it('does not split a CRLF condition or emoji at a character boundary', () => {
    const text = '除非收到回执，否则之前的伤势不允许被忽略。\r\n必须保留现场🙂'
    const atom = createRequiredContextAtom({
      sourceKey: 'context:writingContractSummary',
      label: 'writingContractSummary',
      text,
      tokenEstimate: 12,
    })

    const allocation = allocateRequiredContextAtoms([atom], 12)

    expect(allocation.included[0].text).toBe(text)
    expect(allocation.included[0].text).not.toContain('…')
  })

  it('does not count a one-token pinned-style reserve as a preserved atom', () => {
    const atom = createRequiredContextAtom({
      sourceKey: 'context:pinned',
      label: 'pinned',
      text: '完整条件句',
      tokenEstimate: 2,
    })

    const allocation = allocateRequiredContextAtoms([atom], 1)

    expect(allocation.included).toEqual([])
    expect(allocation.dropped).toEqual([atom])
    expect(allocation.missingAtomIds).toEqual([atom.id])
  })

  it('uses deterministic legacy ids for the same source and text', () => {
    const input = {
      sourceKey: 'context:chapterGoal',
      label: 'chapterGoal',
      text: '稳定目标',
    }

    const first = createRequiredContextAtom(input)
    const second = createRequiredContextAtom(input)

    expect(first.id).toBe(second.id)
    expect(first.id).toMatch(/^legacy:chapterGoal:[0-9a-f]{64}$/)
    expect(first.required).toBe(true)
  })

  it('treats an invalid or negative budget as empty without mutating atoms', () => {
    const atom = createRequiredContextAtom({ sourceKey: 'context:a', label: 'a', text: 'A', tokenEstimate: 1 })

    const allocation = allocateRequiredContextAtoms([atom], Number.NaN)

    expect(allocation.budget).toBe(0)
    expect(allocation.included).toEqual([])
    expect(allocation.dropped).toEqual([atom])
    expect(atom.text).toBe('A')
  })
})
