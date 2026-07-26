import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWorldRulesSummary,
  normalizeContractAudit,
  parseAiCheck,
  parseBridgePlan,
  parseCharacterKnowledgeJson,
  parseContinuity,
  parseContractAudit,
  parseExpressionDedup,
  parseHookContinuity,
  parseNumberArray,
  parsePipelineSnapshot,
  parseReviewNotes,
  parseScenePlan,
  parseStringArray,
  parseSummaryHealth,
  parseWritebackStatus,
  resetSafeParseWarnings,
  safeParse,
} from './index'

const BROKEN = '{ not valid json'

let warnSpy: ReturnType<typeof getWarnSpy>

function getWarnSpy() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

beforeEach(() => {
  resetSafeParseWarnings()
  warnSpy = getWarnSpy()
})

afterEach(() => {
  warnSpy.mockRestore()
})

describe('safeParse', () => {
  it('空输入直接返回 fallback 且不告警', () => {
    expect(safeParse('demo', null, () => 1, 0)).toBe(0)
    expect(safeParse('demo', undefined, () => 1, 0)).toBe(0)
    expect(safeParse('demo', '', () => 1, 0)).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('损坏 JSON 返回 fallback 并按解析器名告警一次', () => {
    expect(safeParse('demo', BROKEN, () => 1, 0)).toBe(0)
    expect(safeParse('demo', BROKEN, () => 1, 0)).toBe(0)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('demo')
  })

  it('validate 返回 null 时回退 fallback', () => {
    expect(safeParse('demo', '"text"', (value) => (Array.isArray(value) ? value : null), [] as unknown[])).toEqual([])
  })
})

describe('parseNumberArray', () => {
  it('正常解析并过滤非数字', () => {
    // 注意：Number(null) === 0，沿用原实现行为保留 0
    expect(parseNumberArray('[1, "2", "x", null]')).toEqual([1, 2, 0])
  })
  it('损坏 JSON 返回空数组', () => {
    expect(parseNumberArray(BROKEN)).toEqual([])
  })
  it('null 输入返回空数组', () => {
    expect(parseNumberArray(null)).toEqual([])
    expect(parseNumberArray(undefined)).toEqual([])
  })
  it('非数组 JSON 返回空数组', () => {
    expect(parseNumberArray('{"a":1}')).toEqual([])
  })
})

describe('parseStringArray', () => {
  it('正常解析并去除空白项', () => {
    expect(parseStringArray('[" a ", "", 3, "b"]')).toEqual(['a', 'b'])
  })
  it('损坏 JSON 返回空数组', () => {
    expect(parseStringArray(BROKEN)).toEqual([])
  })
  it('null 输入返回空数组', () => {
    expect(parseStringArray(null)).toEqual([])
  })
})

describe('parsePipelineSnapshot', () => {
  it('正常解析 chapter_pipeline 快照', () => {
    const snapshot = parsePipelineSnapshot(JSON.stringify({ kind: 'chapter_pipeline', chapterId: 3, roles: {} }))
    expect(snapshot?.chapterId).toBe(3)
  })
  it('kind 不匹配返回 null', () => {
    expect(parsePipelineSnapshot(JSON.stringify({ kind: 'other' }))).toBeNull()
  })
  it('损坏 JSON 返回 null', () => {
    expect(parsePipelineSnapshot(BROKEN)).toBeNull()
  })
  it('null 输入返回 null', () => {
    expect(parsePipelineSnapshot(null)).toBeNull()
  })
})

describe('parseCharacterKnowledgeJson', () => {
  it('正常解析并规范化 knownChapterId', () => {
    const rows = parseCharacterKnowledgeJson(JSON.stringify([
      { characterId: 1, knownChapterId: 5 },
      { characterId: 2, knownChapterId: 'x' },
      { characterId: -1 },
      'junk',
    ]))
    expect(rows).toEqual([
      { characterId: 1, knownChapterId: 5 },
      { characterId: 2, knownChapterId: null },
    ])
  })
  it('损坏 JSON 返回空数组', () => {
    expect(parseCharacterKnowledgeJson(BROKEN)).toEqual([])
  })
  it('null 输入返回空数组', () => {
    expect(parseCharacterKnowledgeJson(null)).toEqual([])
  })
})

describe('parseContinuity', () => {
  it('正常解析', () => {
    expect(parseContinuity('{"arc_progress":"推进"}')).toEqual({ arc_progress: '推进' })
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseContinuity(BROKEN)).toBeNull()
  })
  it('空输入返回 null', () => {
    expect(parseContinuity(undefined)).toBeNull()
  })
})

describe('parseScenePlan', () => {
  it('正常解析数组', () => {
    const plan = parseScenePlan('[{"scene_order":1,"scene_title":"开场"}]')
    expect(plan).toHaveLength(1)
    expect(plan[0].scene_title).toBe('开场')
  })
  it('非数组返回空数组', () => {
    expect(parseScenePlan('{"scene_order":1}')).toEqual([])
  })
  it('损坏 JSON 返回空数组', () => {
    expect(parseScenePlan(BROKEN)).toEqual([])
  })
  it('空输入返回空数组', () => {
    expect(parseScenePlan(undefined)).toEqual([])
  })
})

describe('parseReviewNotes', () => {
  it('正常解析', () => {
    expect(parseReviewNotes('{"summary":"ok"}')?.summary).toBe('ok')
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseReviewNotes(BROKEN)).toBeNull()
  })
  it('空输入返回 null', () => {
    expect(parseReviewNotes(undefined)).toBeNull()
  })
})

describe('parseContractAudit / normalizeContractAudit', () => {
  it('正常解析并补齐缺失字段', () => {
    const audit = parseContractAudit('{"summary":"总述"}')
    expect(audit).toEqual({ summary: '总述', items: [] })
  })
  it('非对象返回 null', () => {
    expect(parseContractAudit('[1,2]')).toBeNull()
    expect(normalizeContractAudit('text')).toBeNull()
    expect(normalizeContractAudit(null)).toBeNull()
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseContractAudit(BROKEN)).toBeNull()
  })
  it('null 输入返回 null', () => {
    expect(parseContractAudit(null)).toBeNull()
  })
})

describe('parseBridgePlan', () => {
  it('正常解析', () => {
    expect(parseBridgePlan('{"timeJump":"次日"}')).toEqual({ timeJump: '次日' })
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseBridgePlan(BROKEN)).toBeNull()
  })
  it('空输入返回 null', () => {
    expect(parseBridgePlan(undefined)).toBeNull()
  })
})

describe('parseSummaryHealth', () => {
  it('正常解析', () => {
    expect(parseSummaryHealth('{"status":"ok"}')).toMatchObject({ status: 'ok' })
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseSummaryHealth(BROKEN)).toBeNull()
  })
  it('空输入返回 null', () => {
    expect(parseSummaryHealth(undefined)).toBeNull()
  })
})

describe('parseExpressionDedup', () => {
  it('正常解析', () => {
    expect(parseExpressionDedup('{"mode":"longform"}')).toMatchObject({ mode: 'longform' })
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseExpressionDedup(BROKEN)).toBeNull()
  })
  it('空输入返回 null', () => {
    expect(parseExpressionDedup(undefined)).toBeNull()
  })
})

describe('parseHookContinuity', () => {
  it('正常解析', () => {
    expect(parseHookContinuity('{"hookStrengthScore":80}')).toMatchObject({ hookStrengthScore: 80 })
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseHookContinuity(BROKEN)).toBeNull()
  })
  it('空输入返回 null', () => {
    expect(parseHookContinuity(undefined)).toBeNull()
  })
})

describe('parseAiCheck', () => {
  it('正常解析字符串输入并裁剪分数', () => {
    const result = parseAiCheck(JSON.stringify({
      score: 120,
      overall_feedback: '整体不错',
      issues: [{ type: '语言', location: '第一段', suggestion: '改口语化' }],
    }))
    expect(result).toMatchObject({ score: 100, overall_feedback: '整体不错' })
    expect(result?.issues).toHaveLength(1)
  })
  it('支持对象输入与 top_fixes 兼容', () => {
    const result = parseAiCheck({ ai_like_rate: 30, top_fixes: ['减少排比'] })
    expect(result?.score).toBe(70)
    expect(result?.issues[0]).toMatchObject({ type: '重点修复', suggestion: '减少排比' })
  })
  it('无有效字段返回 null', () => {
    expect(parseAiCheck({ irrelevant: true })).toBeNull()
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseAiCheck(BROKEN)).toBeNull()
  })
  it('空输入返回 null', () => {
    expect(parseAiCheck(null)).toBeNull()
    expect(parseAiCheck('')).toBeNull()
  })
})

describe('parseWritebackStatus', () => {
  it('正常解析并规范化', () => {
    const status = parseWritebackStatus(JSON.stringify({ phase: 'applied' }))
    expect(status?.phase).toBe('applied')
  })
  it('损坏 JSON 返回 null', () => {
    expect(parseWritebackStatus(BROKEN)).toBeNull()
  })
  it('空输入返回 null', () => {
    expect(parseWritebackStatus(undefined)).toBeNull()
  })
})

describe('getWorldRulesSummary', () => {
  it('正常提取摘要行', () => {
    const summary = getWorldRulesSummary(JSON.stringify({
      power_system: { name: '灵气修炼' },
      social_structure: '宗门制',
      forbidden_elements: ['枪械', '现代科技', '穿越', '外星'],
    }))
    expect(summary).toEqual([
      '力量体系：灵气修炼',
      '社会结构：宗门制',
      '禁用元素：枪械、现代科技、穿越',
    ])
  })
  it('损坏 JSON 返回空数组', () => {
    expect(getWorldRulesSummary(BROKEN)).toEqual([])
  })
  it('空输入返回空数组', () => {
    expect(getWorldRulesSummary(undefined)).toEqual([])
  })
})
