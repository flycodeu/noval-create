import { describe, expect, it } from 'vitest'
import {
  formatStaleReasonsSummary,
  translateContextChangeReason,
  translateContextChangeReasons,
} from './context-change-reasons'

describe('context-change-reasons', () => {
  it('translates known English reasons to Chinese', () => {
    expect(translateContextChangeReason('Character profiles changed')).toBe('人物档案已变更')
    expect(translateContextChangeReason('Chapter contract updated')).toBe('章节合同已更新')
    expect(translateContextChangeReason('Scene contract updated')).toBe('场景合同已更新')
    expect(translateContextChangeReason('World rules changed')).toBe('世界规则已变更')
  })

  it('passes through Chinese or unknown reasons and dedupes after translation', () => {
    expect(translateContextChangeReason('人物档案已变更')).toBe('人物档案已变更')
    expect(translateContextChangeReason('Some future reason')).toBe('Some future reason')
    expect(translateContextChangeReasons([
      'Character profiles changed',
      '人物档案已变更',
      ' ',
      'Glossary changed',
    ])).toEqual(['人物档案已变更', '设定词典已变更'])
  })

  it('formats a concise summary with overflow folding', () => {
    expect(formatStaleReasonsSummary([])).toBe('上下文版本落后于当前设定。')
    expect(formatStaleReasonsSummary(['Character profiles changed'])).toBe('人物档案已变更。请刷新本章上下文后重试。')
    const summary = formatStaleReasonsSummary([
      'Character profiles changed',
      'Chapter contract updated',
      'Scene contract updated',
      'World rules changed',
      'Glossary changed',
    ])
    expect(summary).toContain('人物档案已变更；章节合同已更新；场景合同已更新')
    expect(summary).toContain('等 5 项变更')
    expect(summary).not.toContain('World rules')
  })
})
