import { describe, expect, it } from 'vitest'
import { assessHistoricalGrounding, getBuiltinGenreRules, parseWorldRulesJson } from './genre-system'

describe('genre-system historical packs', () => {
  it('maps historical aliases to the historical capability pack', () => {
    expect(getBuiltinGenreRules('历史正剧').genreProfile.key).toBe('historical')
    expect(getBuiltinGenreRules('架空历史').genreProfile.key).toBe('historical')
    expect(getBuiltinGenreRules('类历史奇幻').genreProfile.key).toBe('historical')
    expect(getBuiltinGenreRules('古言权谋').genreProfile.key).toBe('historical')
    expect(getBuiltinGenreRules('宫斗宅斗').genreProfile.key).toBe('historical')
  })

  it('maps mainstream web-serial aliases to differentiated genre packs', () => {
    expect(getBuiltinGenreRules('都市神豪系统爽文').genreProfile.key).toBe('urban-ability')
    expect(getBuiltinGenreRules('末世废土生存').genreProfile.key).toBe('zombie')
    expect(getBuiltinGenreRules('凡人流修仙').genreProfile.key).toBe('xianxia')
    expect(getBuiltinGenreRules('骑士领地西幻').genreProfile.key).toBe('western-fantasy')
  })

  it('keeps historical world rules when parsing empty or invalid payloads', () => {
    expect(parseWorldRulesJson(undefined, '历史正剧').genreProfile.key).toBe('historical')
    expect(parseWorldRulesJson('{broken', '架空历史').genreProfile.key).toBe('historical')
  })

  it('treats project-level source and canon data as valid historical grounding signals', () => {
    const assessment = assessHistoricalGrounding({
      genreName: '历史正剧',
      historicalProfileJson: JSON.stringify({
        mode: 'historical_realist',
        eraPackId: 'ming_qing',
        regionPackId: 'jiangnan',
      }),
      sourceLedgerJson: JSON.stringify([
        {
          sourceKey: 'source-1',
          factTitle: '驿递制度',
          sourceText: '跨省公文主要依赖驿站与官道传递。',
        },
      ]),
      canonFactCardsJson: JSON.stringify([
        {
          cardKey: 'canon-1',
          title: '驿递制度',
          summary: '跨省传递依赖驿站与官道，不能当日越省。',
        },
      ]),
    })

    expect(assessment.mode).toBe('historical_realist')
    expect(assessment.coverage).toBe('grounded')
    expect(assessment.sourceSignals).toEqual(expect.arrayContaining([
      'historical_profile',
      'source_ledger',
      'canon_fact_cards',
    ]))
  })
})
