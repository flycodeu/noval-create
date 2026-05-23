import { describe, expect, it } from 'vitest'
import { analyzeManualStyleLockCompliance, analyzeStyleCompliance } from './style-compliance.service'

describe('style-compliance service', () => {
  const fingerprint = {
    avgSentenceLength: 18,
    avgParagraphLength: 80,
    dialogueLineRate: 35,
    abstractTokenDensity: 6,
    sentencePatterns: ['短长交替'],
    wordFrequencyProfile: {},
    narrativeTechniques: '动作驱动',
    dialogueStyle: '对白利落',
    descriptionDensity: '偏少',
    paceProfile: '快推进',
    toneKeywords: ['冷硬'],
    forbiddenPatterns: ['命运的齿轮', '不要空喊'],
    exampleExcerpts: [],
  }

  it('returns pass when the content stays close to the fingerprint', () => {
    const passFingerprint = {
      ...fingerprint,
      avgSentenceLength: 23,
      avgParagraphLength: 72,
      dialogueLineRate: 40,
      abstractTokenDensity: 2,
    }
    const result = analyzeStyleCompliance(
      `林远贴着门边停下，先看守卫握枪的手，再看桌角那道新划痕，呼吸压得很浅，脚尖却已经蹭到了门槛阴影里。\n\n“进去。”他把证件压在桌面，手没抬高，声音也不重，只让那一声闷响先替他把场子按住，连守卫的肩膀都跟着僵了一下。\n\n守卫眼神先往左偏，又很快收回来。林远顺着那一下停顿往下问，视线没有离开对方袖口沾着的灰，连语气都像刀背一样平平压过去。\n\n“药箱转去哪了？”他只追这一句，尾音干净，没有额外逼迫，只把右手按在桌边，等守卫自己把慌乱从喉头挤出来。\n\n守卫喉结滚了滚，终于报出旧仓。林远收回证件转身就走，步子很快，但肩背始终绷着，像是随时准备撞开下一道门。`,
      passFingerprint,
    )

    expect(result.status).toBe('pass')
    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.deviations).toHaveLength(0)
  })

  it('returns warning when paragraph and dialogue ratios drift', () => {
    const result = analyzeStyleCompliance(
      `林远站在门外，没有急着逼问，只是把呼吸压稳，再一点点盘算守卫可能露出的破绽和接下来每一步试探的节奏，因为他知道此时任何一句话都可能让对方提前警觉，稍微快半拍都会把线索逼回暗处。\n\n守卫盯着他，半天不接话，手却悄悄往腰后挪。林远看见那点动作后，反而把肩膀松下来，像是已经接受了这场拉扯会被拖长，于是他把证件放到桌边，给对方留出一次自己开口的机会。\n\n“药箱转去哪了？”他终于问，声音不高，也没有故意压人，只是把问题端正地摆出来，然后继续盯着守卫的眼睛，等对方在沉默里露出第二次迟疑。\n\n又过了几息，守卫的视线终于往旧仓方向飘了一下。林远没有立刻追击，只把那一瞬记下来，随后转身离开，准备沿着更稳的路线把这条线索继续往下压实。`,
      fingerprint,
    )

    expect(result.status).toBe('warning')
    expect(result.score).toBeLessThan(80)
    expect(result.deviations.length).toBeGreaterThan(0)
  })

  it('returns rewrite when forbidden patterns and abstract density spike together', () => {
    const result = analyzeStyleCompliance(
      `命运的齿轮在这一刻再次转动，他忽然意识到这不仅是选择，更是意义、信念、尊严与未来的总和。\n\n命运的齿轮没有停，意义与信念反复撞在他心里，让他几乎要对整个世界喊出答案。`,
      fingerprint,
    )

    expect(result.status).toBe('rewrite')
    expect(result.matchedForbiddenPatterns).toContain('命运的齿轮')
    expect(result.rewriteHints.length).toBeGreaterThan(0)
  })

  it('checks manual sample lock rules even without a stored style fingerprint', () => {
    const result = analyzeManualStyleLockCompliance(
      [
        '林远在这一刻忽然意识到，所有意义、信念、尊严和未来都以不可言说的方式压在他的心口，命运的齿轮再次转动，让他不得不理解这份沉重的情绪究竟意味着什么。',
        '这段文字继续解释他的复杂感受，却没有把证据、筹码和动作真正放回现场。',
      ].join('\n\n'),
      JSON.stringify({
        target_work_sample_guide: '短句、压迫节奏、动作密度和现场质感。',
        human_style_sample_lock: '保留人工样本的冷硬动作感，禁止命运的齿轮，禁止总结腔。',
      }),
    )

    expect(result?.status).toBe('rewrite')
    expect(result?.matchedForbiddenPatterns).toContain('命运的齿轮')
    expect(result?.deviations.join('\n')).toContain('人工风格锁')
  })
})
