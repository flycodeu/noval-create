import { describe, expect, it } from 'vitest'
import {
  buildGenrePacingGuidance,
  collectQualityGuardrailFindings,
  hasBlockingGuardrailFindings,
  shouldForceRepair,
} from './content-guardrails'

describe('content guardrail repair threshold', () => {
  it('distinguishes camera vocabulary and tentative judgments from dense similes', () => {
    const normal = [
      '他把摄像头转向门口，检查摄像机的电源，又从录像里找出昨夜的影像。画面停在九点，他把时间记在纸上。',
      '看着像是老张，好像是送货来的。他放大图像，还是不能确认，便把录像交给了值班员。',
      '她长得像母亲，走路却随父亲。弟弟站起来让出椅子，问她吃没吃午饭。',
    ]
    for (const content of normal) {
      expect(collectQualityGuardrailFindings(content).filter((finding) => /simile/.test(finding.code))).toEqual([])
    }
    const dense = '雾像棉絮，像碎云，又像潮水，灯光仿佛刀锋，宛如火焰，把他的心照得无处藏身。'
    const finding = collectQualityGuardrailFindings(dense).find((item) => item.code === 'paragraph_simile_stacking')
    expect(finding).toBeDefined()
    expect(dense).toContain(finding!.excerpt)
  })

  it('keeps isolated clarification, psychology, scenery and technical speech below high risk', () => {
    const samples = [
      '这不是原件，而是复印件。她把两张纸放在一起，指出右下角缺了半枚印章。',
      '他怕回家，怕母亲问起那笔钱。车到了站，他又坐过了一站，直到售票员来提醒才起身。',
      '河边的芦苇倒了一片，水退到桥墩下面。她沿着干了的泥地走，鞋底带起细小的裂块。',
      '“摄像机电源没坏。录像缺一段，影像编码也有错。先查码流，再查时间戳。”',
      '回来吧。她对空院子说。过了一会儿，又说：回来吧。没人应，她收起了第二副碗筷。',
      '“我会来接你。”他把雨伞往她那边挪了挪。“我将离开这里，不会再回来了。”',
    ]
    for (const content of samples) {
      expect(collectQualityGuardrailFindings(content).filter((item) => item.severity === 'high')).toEqual([])
    }
    expect(collectQualityGuardrailFindings('她把手指放在桌上。').some((item) => item.code === 'low_value_body_detail')).toBe(false)
    const repeated = Array.from({ length: 10 }, () => '他终于明白，这意味着一切。也就是说，这只能说明命运如此。').join('\n')
    const finding = collectQualityGuardrailFindings(repeated).find((item) => item.code === 'narrative_explanation_overuse')
    expect(finding).toBeDefined()
    expect(repeated).toContain(finding!.excerpt)
  })
  it('reports a single AI cliche as advice without forcing repair', () => {
    const findings = collectQualityGuardrailFindings('他相信命运的齿轮已经开始转动。')

    expect(findings.some((finding) => finding.code === 'ai_slogan')).toBe(true)
    expect(shouldForceRepair(findings)).toBe(false)
  })

  it('does not turn a single low-severity stylistic hint into a rewrite', () => {
    const findings = collectQualityGuardrailFindings('她静静地看着窗外的雨。')

    expect(findings.some((finding) => finding.severity === 'low')).toBe(true)
    expect(shouldForceRepair(findings)).toBe(false)
  })

  it('does not mistake ordinary progressive wording for AI parallelism', () => {
    const findings = collectQualityGuardrailFindings('走廊里的脚步声越来越近，他把登记表压在桌角。')

    expect(findings.some((finding) => finding.code === 'parallelism_overuse')).toBe(false)
  })

  it('does not treat a natural comparative dialogue phrase as formal parallelism', () => {
    const findings = collectQualityGuardrailFindings('“越还手他越有话说。”')

    expect(findings.some((finding) => finding.code === 'parallelism_overuse')).toBe(false)
  })

  it('keeps one soft-voice cliché as a warning instead of a hard AI-flavor blocker', () => {
    const findings = collectQualityGuardrailFindings('方大炉低声说：“先把扳手放下。”', '历史正剧')
    const softVoiceFinding = findings.find((finding) => finding.code === 'soft_voice_cliche')

    expect(softVoiceFinding).toBeDefined()
    expect(hasBlockingGuardrailFindings(findings)).toBe(false)
  })

  it('allows a quoted character correction while keeping narrative definitions flagged', () => {
    const dialogueFindings = collectQualityGuardrailFindings('方大炉说：“不是你一个人扣，是全班。”', '历史正剧')
    const narrativeFindings = collectQualityGuardrailFindings('这不是一次失败，而是命运给他的另一种证明。', '历史正剧')

    expect(dialogueFindings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(false)
    expect(narrativeFindings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(true)
  })

  it('does not mistake a concrete movement correction for a definition sentence', () => {
    const findings = collectQualityGuardrailFindings('他不是往锅炉房方向走的，是一步一顿往车间外头去的。', '历史正剧')

    expect(findings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(false)
  })

  it('does not treat two negative facts as a not-but definition', () => {
    const findings = collectQualityGuardrailFindings('笔迹不是她母亲的，不是护士刚才当面写字的那种力度。', '历史正剧')

    expect(findings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(false)
  })

  it('does not cross a sentence boundary when detecting not-but definitions', () => {
    const findings = collectQualityGuardrailFindings('我不是第一次被联系过。但今天是第一次有人提前到了。', '历史正剧')

    expect(findings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(false)
  })

  it('flags the split “并非……实际是……” definition pattern', () => {
    const findings = collectQualityGuardrailFindings('她并非来取原件。实际是来确认谁动过档案。', '历史正剧')

    expect(findings.some((finding) => finding.code === 'not_but_definition_pattern')).toBe(true)
  })

  it('does not treat tracked character names as descriptive repetition', () => {
    const content = Array.from({ length: 20 }, (_, index) => `第${index + 1}次点名时，郭大桩都站在炉门旁，手里还攥着当班记录。`).join('\n')

    const findings = collectQualityGuardrailFindings(content, undefined, {
      knownTerms: ['郭大桩'],
    })

    const repetitionFinding = findings.find((finding) => finding.code === 'high_frequency_repetition')
    expect(repetitionFinding?.excerpt || '').not.toContain('郭大')
    expect(repetitionFinding?.excerpt || '').not.toContain('大桩')
  })

  it('keeps flagging repeated descriptive phrases when they are not tracked terms', () => {
    const content = Array.from({ length: 20 }, () => '阴冷的墙面贴着他的后背，阴冷气息没有散去，他把记录纸压在膝上继续核对。').join('\n')

    const findings = collectQualityGuardrailFindings(content, undefined, {
      knownTerms: ['郭大桩'],
    })

    expect(findings.some((finding) => finding.code === 'high_frequency_repetition')).toBe(true)
  })

  it('flags ink-night atmosphere and cold-gaze templates from 规则怪谈 drafts', () => {
    const findings = collectQualityGuardrailFindings('夜色浓稠得像化不开的墨。空气中弥漫着福尔马林。苏临眼神冷冽如冰。')

    expect(findings.some((finding) => finding.code === 'ai_description_cliche')).toBe(true)
    expect(findings.some((finding) => finding.code === 'ai_action_cliche')).toBe(true)
    expect(shouldForceRepair(findings)).toBe(false)
  })

  it('flags stacked system settlement panels as a style signal', () => {
    const findings = collectQualityGuardrailFindings([
      '【击杀B级怪谈‘血色巡考官’！】',
      '【因果命盘吞噬神性力量……】',
      '【获得：破碎的神格残片·因果目（一阶）！】',
      '【你的寿命获得补充，因果视界解锁！】',
    ].join('\n'))

    expect(findings.some((finding) => finding.code === 'system_settlement_wall')).toBe(true)
    expect(shouldForceRepair(findings)).toBe(false)
  })

  it('flags appearance ads and chapter-end slogans', () => {
    const findings = collectQualityGuardrailFindings('她面容绝美却如万载玄冰。青藤市的天，要变了。')

    expect(findings.some((finding) => finding.code === 'appearance_ad')).toBe(true)
    expect(findings.some((finding) => finding.code === 'ai_ending_summary')).toBe(true)
    expect(shouldForceRepair(findings)).toBe(false)
  })

  it('flags repeated narrator explanations without treating one necessary conclusion as AI authorship', () => {
    const content = [
      '门锁没有新划痕，这只能说明钥匙曾被使用。',
      '鞋印停在窗边，现有证据不足以确认来人从哪里离开。',
      '杯底仍是温的，这意味着对方刚走。',
      '值班表缺了一页，尚不能证明是谁撕掉的。',
      '监控在同一分钟断开，也就是说有人提前算过时间。',
      '她收起照片，没有马上追问。',
      '走廊尽头传来推车声。',
      '保安把钥匙攥回掌心。',
    ].join('\n')

    expect(collectQualityGuardrailFindings(content).some((finding) => finding.code === 'narrative_explanation_overuse')).toBe(true)
    expect(collectQualityGuardrailFindings('杯底还是温的。她抓起外套追了出去。').some((finding) => finding.code === 'narrative_explanation_overuse')).toBe(false)
  })

  it('detects mechanically uniform sentence lengths while allowing varied scene rhythm', () => {
    const uniform = Array.from({ length: 24 }, (_, index) => `第${index + 1}盏灯熄灭以后，他把门边的纸条收进衣袋里`).join('。') + '。'
    const varied = [
      '门响了。',
      '她没动。',
      '楼道里有人拖着箱子往上走，轮子每撞一级台阶，桌上的水就跟着晃一下。',
      '到了门口，声音停住。',
      '半晌，那人隔着门问：“三楼？”',
      '她这才发现自己一直捏着没挂断的电话。',
    ].join('\n')

    expect(collectQualityGuardrailFindings(uniform).some((finding) => finding.code === 'uniform_sentence_rhythm')).toBe(true)
    expect(collectQualityGuardrailFindings(varied).some((finding) => finding.code === 'uniform_sentence_rhythm')).toBe(false)
  })

  it('builds pacing from genre profiles without fixed quotas or a universal realist label', () => {
    const xianxia = buildGenrePacingGuidance('修仙')
    const romance = buildGenrePacingGuidance('都市情感')

    expect(xianxia).toContain('题材画像')
    expect(romance).toContain('题材画像')
    expect(romance).not.toContain('写实叙事类型')
    expect(`${xianxia}\n${romance}`).not.toMatch(/每章至少|每千字不超过|单段不超过/)
  })
})
