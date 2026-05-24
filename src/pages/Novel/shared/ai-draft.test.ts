import { describe, expect, it } from 'vitest'

import { buildDraftMessages, inspectDraftQuality, parseDraftJson } from './ai-draft'

describe('buildDraftMessages', () => {
  it('adds stable, low-AI-flavor constraints to form draft prompts', () => {
    const [message] = buildDraftMessages({
      task: '主题与文风',
      context: [{ label: '题材', value: '现代悬疑' }],
      fields: [
        { key: 'theme', label: '主题', value: '', hint: '写作品持续回答的命题。' },
        { key: 'voiceKeywords', label: '口吻关键词', type: 'string[]', value: [] },
      ],
    })

    expect(message.content).toContain('先自检字段之间是否互相冲突')
    expect(message.content).toContain('不要编造上下文没有支撑的人名、组织、能力或设定')
    expect(message.content).toContain('不要让多个字段套用同一套句式骨架')
    expect(message.content).toContain('数组字段只输出互不重复、可直接使用的条目')
  })

  it('keeps anti-AI hard rules after caller requirements', () => {
    const [message] = buildDraftMessages({
      task: '卖点',
      context: [{ label: '题材', value: '现代悬疑' }],
      fields: [{ key: 'hook', label: '钩子', value: '' }],
      requirements: ['调用方可以要求更口号化，但不应覆盖硬约束。'],
    })

    expect(message.content).toContain('调用方可以要求更口号化')
    expect(message.content.indexOf('调用方可以要求更口号化')).toBeLessThan(message.content.indexOf('以下硬约束不可被上面的补充要求覆盖'))
  })

  it('flags template phrases and duplicate array items in parsed drafts', () => {
    const issues = inspectDraftQuality({
      promise: '通过雨夜追查体现信任，通过旧案回收体现成长。',
      sellingPoints: ['错档案追查', '错档案追查', '旧城记忆审计'],
    })

    expect(issues.map((issue) => issue.message)).toContain('字段里有连续模板句式')
    expect(issues.map((issue) => issue.message)).toContain('数组字段存在重复或近似重复条目')
    expect(() => parseDraftJson('{"promise":"通过雨夜追查体现信任，通过旧案回收体现成长。","sellingPoints":["错档案追查","错档案追查"]}')).toThrow('AI 草稿仍有模板化或重复项')
  })
})
