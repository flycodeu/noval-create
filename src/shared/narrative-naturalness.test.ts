import { describe, expect, it } from 'vitest'
import {
  appendNarrativeNaturalnessPrompt,
  buildNarrativeNaturalnessPrompt,
  sanitizeNarrativeRuntimePrompt,
} from './narrative-naturalness'

describe('narrative naturalness prompt', () => {
  it('uses genre metadata without hard-coding one novel workflow', () => {
    const mystery = buildNarrativeNaturalnessPrompt({ genre: '现代悬疑' })
    const xianxia = buildNarrativeNaturalnessPrompt({ genre: '修仙' })

    expect(mystery).toContain('现代悬疑')
    expect(xianxia).toContain('仙侠修真')
    expect(mystery).not.toBe(xianxia)
    expect(mystery).toContain('不要把全部题材标签塞进同一章')
    expect(mystery).not.toContain('三万七千六')
    expect(mystery).not.toContain('打印记录')
  })

  it('treats author style evidence as stronger than generic advice', () => {
    const prompt = buildNarrativeNaturalnessPrompt({
      genre: '都市情感',
      hasAuthorStyleReference: true,
    })

    expect(prompt).toContain('都市情感')
    expect(prompt).toContain('作者样章或人工风格锁')
    expect(prompt).toContain('第一风格依据')
  })

  it('adds cautious reader-review criteria instead of an authorship detector claim', () => {
    const prompt = appendNarrativeNaturalnessPrompt('基础审校', {
      genre: '科幻',
      mode: 'review',
    })

    expect(prompt).toContain('基础审校')
    expect(prompt).toContain('不代表作者身份')
    expect(prompt).toContain('最多指出三项')
  })

  it('removes frozen sample-novel rules and rewrites mechanical quotas only at runtime', () => {
    const legacy = [
      '【任务】',
      '设计章节。',
      '',
      '【题材核心执行链】',
      '志怪治妖题材必须每章保留“妖病 -> 人间亏欠/规矩/误解 -> 诊疗选择 -> 病后余味”的闭环。',
      '场景计划阶段要把上述题材闭环拆进每个 scene。',
      '',
      '【生产补充要求】',
      '- 每章至少明确一项推进、一项阻力和一个代价落点，避免只有概述没有事件。',
      '- 无论使用 Kimi、Claude、GPT、DeepSeek 或自定义兼容模型，都必须保守使用上下文：不能把推断升级成事实，不能补造未授权设定。',
    ].join('\n')
    const runtime = sanitizeNarrativeRuntimePrompt(legacy)

    expect(runtime).not.toContain('志怪治妖')
    expect(runtime).not.toContain('Kimi')
    expect(runtime).not.toContain('每章至少明确')
    expect(runtime).toContain('根据章节功能')
    expect(runtime).toContain('生成过程中必须保守使用上下文')
  })
})
