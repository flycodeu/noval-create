import { describe, expect, it } from 'vitest'
import { analyzeLanguageDrift } from './language-drift'

describe('language-drift', () => {
  it('tracks punctuation, metaphor, body-detail, and isolated paragraph drift', () => {
    const metrics = analyzeLanguageDrift([
      '他停在门口——没有进去——也没有解释。',
      '这不是犹豫，而是某种更深的命运安排。',
      '她的心像沉进水里，又像被玻璃压住。',
      '他的指节微微泛白，声音很轻。',
      '他睁开眼睛。',
    ].join('\n'))

    expect(metrics.dashDensity).toBeGreaterThan(0)
    expect(metrics.parallelismRate).toBeGreaterThan(0)
    expect(metrics.metaphorStackRate).toBeGreaterThan(0)
    expect(metrics.bodyDetailClicheRate).toBeGreaterThan(0)
    expect(metrics.isolatedTemplateParagraphRate).toBeGreaterThan(0)
  })

  it('keeps new drift metrics quiet for ordinary scene prose', () => {
    const metrics = analyzeLanguageDrift([
      '门卫把登记簿推过来，让他先写姓名。',
      '她按住伤口，等纱布不再渗血才开口。',
      '楼下传来脚步声，两个人同时停住。',
    ].join('\n'))

    expect(metrics.dashDensity).toBe(0)
    expect(metrics.parentheticalExplanationDensity).toBe(0)
    expect(metrics.metaphorStackRate).toBe(0)
    expect(metrics.isolatedTemplateParagraphRate).toBe(0)
  })
})
