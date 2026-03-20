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

export function collectQualityGuardrailFindings(text: string, genre?: string): TextGuardrailFinding[] {
  const content = text.trim()
  if (!content) return []

  const realismLevel = getBuiltinGenreRules(genre).writingConstraints.realismLevel
  const findings = LANGUAGE_PATTERN_RULES
    .filter((rule) => rule.pattern.test(content))
    .map((rule) => ({
      code: rule.code,
      severity: adjustSeverity(rule.severity, realismLevel),
      message: rule.message,
      excerpt: findExcerpt(content, rule.pattern),
    }))

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
