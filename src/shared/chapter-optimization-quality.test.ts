import { describe, expect, it } from 'vitest'
import { buildChapterOptimizationQualityGate } from './chapter-optimization-quality'

describe('chapter-optimization-quality', () => {
  it('blocks optimized drafts when strong AI flavor is not reduced', () => {
    const original = [
      '他推开门，看见旧仓库里只剩一盏灯。',
      '她按住伤口，等纱布不再渗血才开口。',
    ].join('\n')
    const optimized = [
      '这不是一次失败，而是命运给他的另一种证明——至少他这样告诉自己。',
      '他的心像被潮水卷走，又像被玻璃压住，仿佛整个世界都在低语。',
      '他睁开眼睛。',
    ].join('\n')

    const gate = buildChapterOptimizationQualityGate(original, optimized)

    expect(gate.safeToApply).toBe(false)
    expect(gate.optimizedStrongAiFlavorCount).toBeGreaterThan(gate.originalStrongAiFlavorCount)
    expect(gate.warnings.join('\n')).toContain('强 AI 味命中未下降')
  })

  it('allows drafts when AI flavor and drift are reduced', () => {
    const original = [
      '这不是一次失败，而是命运给他的另一种证明——至少他这样告诉自己。',
      '他的心像被潮水卷走，又像被玻璃压住，仿佛整个世界都在低语。',
      '他的指节微微泛白，声音很轻。',
      '他睁开眼睛。',
    ].join('\n')
    const optimized = [
      '他把门闩压回去，先确认仓库后窗没有人守着。',
      '她递来沾血的纱布，他没接，只问药箱还剩几包。',
      '楼下脚步声逼近，两个人同时停住。',
    ].join('\n')

    const gate = buildChapterOptimizationQualityGate(original, optimized)

    expect(gate.safeToApply).toBe(true)
    expect(gate.optimizedStrongAiFlavorCount).toBeLessThan(gate.originalStrongAiFlavorCount)
    expect(gate.optimizedDriftScore).toBeLessThanOrEqual(gate.originalDriftScore)
  })
})
