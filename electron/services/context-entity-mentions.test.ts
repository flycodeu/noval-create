import { describe, expect, it } from 'vitest'
import {
  buildCharacterMentionCandidates,
  buildLocationMentionCandidates,
  collectExplicitEntityNamesFromReferences,
  collectMentionedEntityNamesFromCandidates,
  collectMentionedEntityValidationTermsFromCandidates,
  collectRelationMentionedCharacterNames,
  collectRelationMentionValidationTerms,
  resolveMentionedEntityLimits,
  type EntityMentionCandidate,
} from './context-entity-mentions'

describe('context entity mention resolution', () => {
  it('keeps unique aliases and drops aliases shared by multiple owners', () => {
    const candidates = buildCharacterMentionCandidates([
      {
        id: 1,
        fullName: '沈砚',
        surname: '沈',
        givenName: '砚',
        occupation: '医生',
        roleType: 'protagonist',
        gender: '男',
        sourceContextJson: JSON.stringify({ aliases: ['砚哥'] }),
      },
      {
        id: 2,
        fullName: '林舟',
        occupation: '医生',
        roleType: 'supporting',
      },
    ] as never)

    expect(collectMentionedEntityNamesFromCandidates('男主让砚哥接管伤员。', candidates, 4))
      .toEqual(['沈砚'])
    expect(collectMentionedEntityNamesFromCandidates('医生要求停工。', candidates, 4))
      .toEqual([])
  })

  it('does not match aliases inside ASCII tokens or numbered entity prefixes', () => {
    const candidates: EntityMentionCandidate[] = [
      { canonicalName: 'AI' },
      { canonicalName: '角色1' },
    ]

    expect(collectMentionedEntityNamesFromCandidates('BRAIL 角色12', candidates, 4)).toEqual([])
    expect(collectMentionedEntityNamesFromCandidates('AI 与角色1同时出现', candidates, 4))
      .toEqual(['角色1', 'AI'])
  })

  it('resolves text aliases, explicit references, and validation terms to canonical locations', () => {
    const candidates = buildLocationMentionCandidates([
      {
        id: 7,
        name: '旧城东门',
        description: '别名：东门、旧城门；用于夜间撤离。',
      },
    ] as never)

    expect(collectMentionedEntityNamesFromCandidates('队伍从旧城门撤离。', candidates, 4))
      .toEqual(['旧城东门'])
    expect(collectExplicitEntityNamesFromReferences(['东门'], candidates)).toEqual(['旧城东门'])
    expect(collectMentionedEntityValidationTermsFromCandidates('队伍从东门撤离。', candidates, 4))
      .toEqual(['旧城东门', '东门'])
  })

  it('expands relation labels to both characters and preserves longform limits', () => {
    const relationRows = [{
      charAId: 1,
      charBId: 2,
      relationLabel: '师徒',
      interactionStyle: '互相试探',
    }] as never
    const names = new Map([[1, '沈砚'], [2, '林舟']])

    expect(collectRelationMentionedCharacterNames('这对师徒仍在互相试探。', relationRows, names, 4))
      .toEqual(['沈砚', '林舟'])
    expect(collectRelationMentionValidationTerms('这对师徒仍在互相试探。', relationRows, names, 4))
      .toEqual(['师徒', '互相试探', '沈砚', '林舟'])

    const shortform = resolveMentionedEntityLimits({ targetWords: 80_000, chapterCount: 12 })
    const complexMega = resolveMentionedEntityLimits({
      targetWords: 1_600_000,
      chapterCount: 520,
      mapDepth: 6,
      factionCount: 12,
      speciesCount: 8,
      powerSystemCount: 5,
    })
    expect(shortform).toEqual({ characters: 8, items: 8, locations: 6 })
    expect(complexMega.characters).toBeGreaterThan(48)
    expect(complexMega.items).toBeGreaterThan(40)
    expect(complexMega.locations).toBeGreaterThan(40)
  })
})
