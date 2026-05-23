import { describe, expect, it } from 'vitest'
import { cleanAiFieldText, cleanAiStringArray } from './text'

describe('text utils AI cleanup', () => {
  it('removes AI workflow wrappers before persisted field text', () => {
    expect(cleanAiFieldText('以下是优化后的正文：\n```md\n“命运的齿轮”开始转动。\n```'))
      .toBe('开始转动。')
  })

  it('drops leading process notes without deleting the actual result', () => {
    expect(cleanAiFieldText('修订建议：删掉模板句\n最终正文：林远把钥匙放回抽屉。'))
      .toBe('林远把钥匙放回抽屉。')
  })

  it('cleans string arrays through the same workflow rules', () => {
    expect(cleanAiStringArray(['生成结果：真正的成长', '  ']))
      .toEqual(['变化'])
  })
})
