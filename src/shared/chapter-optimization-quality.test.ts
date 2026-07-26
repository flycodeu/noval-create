import { describe, expect, it } from 'vitest'
import {
  buildChapterOptimizationQualityGate,
  buildChapterStructuralRepairGate,
  buildSupportingRolePattern,
} from './chapter-optimization-quality'

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
    expect(gate.warnings.join('\n')).toContain('强 AI 味命中由')
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

  it('blocks split definition-style rewrites instead of masking them with another template', () => {
    const original = '机房记录显示参数修改。延时从一点八秒改成二点五秒。'
    const optimized = '机房记录并非报警清除。实际是参数修改。延时从一点八秒改成二点五秒。'

    const gate = buildChapterOptimizationQualityGate(original, optimized)

    expect(gate.safeToApply).toBe(false)
    expect(gate.optimizedGuardrailHits).toContain('not_but_definition_pattern')
  })

  it('blocks a candidate that trades one strong AI pattern for stacked similes', () => {
    const original = '他把钥匙压在桌边，等电梯重新启动。'
    const optimized = '走廊像一条绷紧的弦，灯光像冷水一样铺开，脚步又像钉子一样敲在地上。'
    const gate = buildChapterOptimizationQualityGate(original, optimized)

    expect(gate.safeToApply).toBe(false)
    expect(gate.warnings.join('\n')).toContain('强 AI 味命中由')
  })

  it('blocks language-only repair for a golden-three chapter', () => {
    const original = '她拿到钥匙。母亲让她别再问。'
    const optimized = '她拿走了那把钥匙。母亲要求她别再问。'
    const gate = buildChapterStructuralRepairGate(original, optimized, 2)

    expect(gate.required).toBe(true)
    expect(gate.safeToApply).toBe(false)
    expect(gate.warnings.join('\n')).toContain('误判')
    expect(gate.warnings.join('\n')).toContain('持续代价')
  })

  it('requires payoff before escalation for chapter three structural repair', () => {
    const original = '她看见面包车消失。有人比她先到了。她停在门口。'
    const optimized = [
      '她看见面包车消失。',
      '她确认调档记录上的签名不是母亲的。',
      '她决定把记录交出去，却因此暴露了自己的位置。',
      '有人比她先到了。',
      '她停在门口。',
    ].join('\n')
    const gate = buildChapterStructuralRepairGate(original, optimized, 3)

    expect(gate.safeToApply).toBe(true)
    expect(gate.payoffSignals).toContain('确认')
    expect(gate.costSignals).toContain('暴露')
  })

  it('recognizes concrete judgment, agency, and cost actions without author labels', () => {
    const original = '她拿到钥匙。母亲让她别再问。她站在门边。她没有回头。'
    const optimized = [
      '她拿到钥匙。',
      '她以为拿走钥匙就能保护家里，假装接受母亲的交换。',
      '母亲让她别再问。',
      '母亲伸手按住复印件，把唯一的原件推回抽屉。',
      '这次隐瞒让她失去继续查证的机会。',
      '她站在门边。',
      '她没有回头。',
    ].join('\n')
    const gate = buildChapterStructuralRepairGate(original, optimized, 2)

    expect(gate.safeToApply).toBe(true)
    expect(gate.misjudgmentSignals).toContain('假装')
    expect(gate.supportingAgencySignals.length).toBeGreaterThan(0)
    expect(gate.costSignals).toContain('失去')
  })

  it('treats an explicitly unverified judgment as a misjudgment signal', () => {
    const original = '她拿到钥匙。母亲让她别再问。她站在门边。她没有回头。'
    const optimized = [
      '她拿到钥匙。',
      '她把复印件收起，决定不追问；这个判断没有核实过。',
      '母亲让她别再问。',
      '母亲转身收走桌上的复印件，她因此失去当晚继续查证的机会。',
      '她站在门边。',
      '她没有回头。',
    ].join('')
    const gate = buildChapterStructuralRepairGate(original, optimized, 2)

    expect(gate.safeToApply).toBe(true)
    expect(gate.misjudgmentSignals).toContain('没有核实')
  })

  it('blocks runaway structural expansion while allowing short fixtures to exercise scene gates', () => {
    const original = Array.from({ length: 20 }, () => '她拿到钥匙，母亲让她别再问。').join('')
    const optimized = [
      ...Array.from({ length: 60 }, () => '她以为拿到钥匙就能保护家里，决定暂时隐瞒。'),
      '母亲按住复印件，把钥匙收回抽屉。',
      '她因此失去继续查证的机会。',
    ].join('')
    const gate = buildChapterStructuralRepairGate(original, optimized, 2)

    expect(gate.scopeExpansionRatio).toBeGreaterThan(1.6)
    expect(gate.safeToApply).toBe(false)
    expect(gate.warnings.join('\n')).toContain('扩写比例过高')
  })

  it('blocks a whole-chapter rewrite even when it has structural signals', () => {
    const original = Array.from({ length: 10 }, (_, index) => `原文动作${index}保留在现场。`).join('')
    const optimized = [
      '她决定把钥匙收进包里。',
      '母亲拒绝回答，转身关上抽屉。',
      '她因此失去当晚继续查证的机会。',
      ...Array.from({ length: 8 }, (_, index) => `改写动作${index}改变了现场。`),
    ].join('')

    const gate = buildChapterStructuralRepairGate(original, optimized, 2)

    expect(gate.changedSentenceRate).toBeGreaterThan(45)
    expect(gate.safeToApply).toBe(false)
    expect(gate.warnings.join('\n')).toContain('改动句比例过高')
  })

  it('allows a small but concrete local structural patch', () => {
    const original = [
      '她把钥匙收进包里。',
      '母亲让她别再问。',
      ...Array.from({ length: 8 }, (_, index) => `原文动作${index}保留在现场。`),
    ].join('')
    const optimized = [
      '她把钥匙收进包里。',
      '她没有确认母亲是否见过那个孩子，决定不把复印件放回文件袋，因此失去明天让母亲签字的机会。',
      '母亲让她别再问。',
      '母亲拒绝回答，把复印件推回她面前。',
      ...Array.from({ length: 8 }, (_, index) => `原文动作${index}保留在现场。`),
    ].join('')

    const gate = buildChapterStructuralRepairGate(original, optimized, 2)

    expect(gate.changedSentenceRate).toBeGreaterThanOrEqual(15)
    expect(gate.changedSentenceRate).toBeLessThanOrEqual(45)
    expect(gate.safeToApply).toBe(true)
  })

  it('detects supporting agency only for injected role names, not arbitrary novel names', () => {
    const text = '陈阿婆把复印件藏进灶台，转身离开。'

    expect(text.match(buildSupportingRolePattern([]))).toBeNull()
    expect(text.match(buildSupportingRolePattern(['陈阿婆']))).not.toBeNull()
  })

  it('escapes regex metacharacters in injected role names', () => {
    const pattern = buildSupportingRolePattern(['A.B(测试)', 'C+D'])

    expect(() => 'A.B(测试)决定隐瞒实情。'.match(pattern)).not.toThrow()
    expect('AxB(测试)决定隐瞒实情。'.match(pattern)).toBeNull()
    expect('A.B(测试)决定隐瞒实情。'.match(pattern)).not.toBeNull()
  })

  it('supports configurable golden chapter numbers', () => {
    const original = '她拿到钥匙。'
    const optimized = '她拿走了钥匙。'

    expect(buildChapterStructuralRepairGate(original, optimized, 5).required).toBe(false)
    const custom = buildChapterStructuralRepairGate(original, optimized, 5, {
      goldenChapterNums: [4, 5],
      agencyChapterNums: [4],
      payoffChapterNums: [5],
    })
    expect(custom.required).toBe(true)
    expect(custom.safeToApply).toBe(false)
    expect(custom.warnings.join('\n')).toContain('第 5 章没有先回收')
  })

  it('applies injected supporting role names inside the structural gate', () => {
    const original = '她拿到钥匙。陈阿婆让她别再问。她站在门边。她没有回头。'
    const optimized = [
      '她拿到钥匙。',
      '她以为拿走钥匙就能保护家里，假装接受陈阿婆的交换。',
      '陈阿婆让她别再问。',
      '陈阿婆伸手按住复印件，把唯一的原件推回抽屉。',
      '这次隐瞒让她失去继续查证的机会。',
      '她站在门边。',
      '她没有回头。',
    ].join('\n')

    const withoutInjection = buildChapterStructuralRepairGate(original, optimized, 2)
    expect(withoutInjection.supportingAgencySignals).toHaveLength(0)

    const withInjection = buildChapterStructuralRepairGate(original, optimized, 2, {
      supportingRoleNames: ['陈阿婆'],
    })
    expect(withInjection.supportingAgencySignals.length).toBeGreaterThan(0)
    expect(withInjection.safeToApply).toBe(true)
  })
})
