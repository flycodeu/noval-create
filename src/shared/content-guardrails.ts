import { getBuiltinGenreRules, type RealismLevel } from './genre-system'

export type GuardrailSeverity = 'low' | 'medium' | 'high'

export interface TextGuardrailFinding {
  code: string
  severity: GuardrailSeverity
  message: string
  excerpt: string
}

interface PatternRule {
  code: string
  severity: GuardrailSeverity
  message: string
  pattern: RegExp
}

interface GenreHollowRule {
  message: string
  abstractTokens: string[]
  concreteTokens: string[]
  minAbstractHits: number
  maxConcreteHits: number
}

const LANGUAGE_PATTERN_RULES: PatternRule[] = [
  {
    code: 'object_category_mismatch',
    severity: 'high',
    message: '把物体、系统或地点写成了人才会有的生命状态，属于对象类别错配。',
    pattern: /(电网|系统|组织|城市|铁门|基地|设施|防线|通讯).{0,4}(死亡|呼吸|哭泣|思考|愤怒|悲鸣)/u,
  },
  {
    code: 'ai_slogan',
    severity: 'medium',
    message: '口号化、假深刻的 AI 腔盖过了具体场景。',
    pattern: /(命运的齿轮|某种无法言说|真正的成长|古老而神秘|光与暗的永恒战争)/u,
  },
  {
    code: 'zero_cost_resolution',
    severity: 'medium',
    message: '重大伤势、物资短缺、秩序问题或冲突被零成本解决了。',
    pattern: /(毫无代价|没有任何代价|轻易就解决了|立刻恢复|一下子就全部同意)/u,
  },
  {
    code: 'template_emotion',
    severity: 'low',
    message: '模板化情绪表达正在拉平文本质感。',
    pattern: /(不禁|不由得|忍不住|微微一愣|心头一紧)/u,
  },
]

const GENRE_HOLLOW_RULES: Partial<Record<string, GenreHollowRule>> = {
  zombie: {
    message: '末世段落写了丧尸或灾变，却缺少食水、补给、感染、噪声、路线、收容或信任分配等生存链细节。',
    abstractTokens: ['末世', '丧尸', '尸潮', '灾变', '沦陷', '危机', '绝望'],
    concreteTokens: ['食物', '食水', '饮水', '净水', '药品', '药物', '补给', '物资', '感染', '伤口', '隔离', '体力', '噪声', '路线', '撤离', '据点', '值守', '守夜', '配给', '收容', '柴油', '汽油', '车辆', '发电', '信任', '纪律', '分配'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  xianxia: {
    message: '修仙段落只喊大道、飞升或机缘，却缺少境界、资源、宗门秩序、凡俗牵连和修行生态。',
    abstractTokens: ['大道', '飞升', '长生', '问道', '造化', '天道', '仙途', '道心', '仙缘', '机缘'],
    concreteTokens: ['炼气', '筑基', '金丹', '元婴', '化神', '渡劫', '宗门', '外门', '内门', '长老', '掌门', '坊市', '灵石', '丹药', '功法', '秘境', '洞府', '灵兽', '异兽', '邪修', '散修', '恶灵', '凡人', '家族', '灵脉', '护山', '试炼', '任务殿'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
  wuxia: {
    message: '武侠段落只有打斗或招式，却缺少江湖规矩、师承门第、名声、盘缠、官府和行路成本。',
    abstractTokens: ['刀光', '剑光', '掌风', '交手', '过招', '比武', '决战', '轻功', '剑招', '刀招'],
    concreteTokens: ['江湖', '师门', '门规', '门派', '帮会', '镖局', '客栈', '盘缠', '官府', '捕快', '名声', '拜帖', '驿站', '马匹', '伤药', '路引', '行路', '师承', '人情', '报官', '护镖'],
    minAbstractHits: 2,
    maxConcreteHits: 1,
  },
}

function findExcerpt(text: string, pattern: RegExp): string {
  const match = text.match(pattern)
  return match?.[0]?.trim() || ''
}

function adjustSeverity(base: GuardrailSeverity, realismLevel: RealismLevel): GuardrailSeverity {
  if (realismLevel === 'strict-realism' && base === 'medium') return 'high'
  if (realismLevel === 'stylized-fantasy' && base === 'medium') return 'low'
  return base
}

function dedupeFindings(findings: TextGuardrailFinding[]): TextGuardrailFinding[] {
  const seen = new Set<string>()
  const result: TextGuardrailFinding[] = []

  for (const finding of findings) {
    const key = `${finding.code}:${finding.excerpt}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(finding)
  }

  return result
}

function collectTokenHits(text: string, tokens: string[]): string[] {
  return [...new Set(tokens.filter((token) => text.includes(token)))]
}

function collectGenreHollowingFinding(text: string, genre?: string): TextGuardrailFinding | null {
  if (text.length < 20) return null

  const genreKey = getBuiltinGenreRules(genre).genreProfile.key
  const rule = GENRE_HOLLOW_RULES[genreKey]
  if (!rule) return null

  const abstractHits = collectTokenHits(text, rule.abstractTokens)
  const concreteHits = collectTokenHits(text, rule.concreteTokens)

  if (abstractHits.length < rule.minAbstractHits) return null
  if (concreteHits.length > rule.maxConcreteHits) return null

  return {
    code: 'genre_hollowing',
    severity: abstractHits.length >= rule.minAbstractHits + 1 && concreteHits.length === 0 ? 'high' : 'medium',
    message: rule.message,
    excerpt: abstractHits.slice(0, 3).join('、'),
  }
}

export function collectQualityGuardrailFindings(text: string, genre?: string): TextGuardrailFinding[] {
  const content = text.trim()
  if (!content) return []

  const realismLevel = getBuiltinGenreRules(genre).writingConstraints.realismLevel
  const patternFindings = LANGUAGE_PATTERN_RULES
    .filter((rule) => rule.pattern.test(content))
    .map((rule) => ({
      code: rule.code,
      severity: adjustSeverity(rule.severity, realismLevel),
      message: rule.message,
      excerpt: findExcerpt(content, rule.pattern),
    }))

  const genreFinding = collectGenreHollowingFinding(content, genre)
  const findings = genreFinding ? [...patternFindings, genreFinding] : patternFindings

  return dedupeFindings(findings).slice(0, 6)
}

export function shouldForceRepair(findings: TextGuardrailFinding[]): boolean {
  const highCount = findings.filter((finding) => finding.severity === 'high').length
  const mediumCount = findings.filter((finding) => finding.severity === 'medium').length
  return highCount > 0 || mediumCount >= 2
}

export function formatQualityGuardrailSummary(findings: TextGuardrailFinding[]): string[] {
  return findings.map((finding) => {
    const prefix = finding.severity === 'high' ? '[高]' : finding.severity === 'medium' ? '[中]' : '[低]'
    return `${prefix} ${finding.message}${finding.excerpt ? ` 例子：${finding.excerpt}` : ''}`
  })
}

