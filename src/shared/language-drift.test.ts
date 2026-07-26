import { describe, expect, it } from 'vitest'
import { analyzeLanguageDrift, analyzeReferenceDensity } from './language-drift'

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

  it('counts split “并非……实际是……” definitions as parallelism drift', () => {
    const metrics = analyzeLanguageDrift('她并非来取原件。实际是来确认谁动过档案。')

    expect(metrics.parallelismRate).toBeGreaterThan(0)
  })

  it('flags over-dense character names with actionable rewrite briefs', () => {
    const paragraph = Array.from({ length: 4 }, () => '程烁看向门口。程烁没有说话。程烁把钥匙收好。').join('\n\n')
    const report = analyzeReferenceDensity(paragraph, ['程烁', '林晚'])

    expect(report.nameFindings).toHaveLength(1)
    expect(report.nameFindings[0].name).toBe('程烁')
    expect(report.nameFindings[0].denseParagraphCount).toBe(4)
    expect(report.rewriteBriefs[0]).toContain('代词')
  })

  it('flags body-part token overuse and stays silent within budget', () => {
    const dense = Array.from({ length: 12 }, () => '他的掌心出汗。').join('')
    const report = analyzeReferenceDensity(dense, [])
    expect(report.bodyPartFindings.some((finding) => finding.name === '掌心')).toBe(true)

    const clean = '他推开门，看了一眼窗外，转身下楼。'
    expect(analyzeReferenceDensity(clean, ['程烁']).rewriteBriefs).toHaveLength(0)
  })
})
