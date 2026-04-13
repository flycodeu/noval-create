import type {
  WorkspaceAiFlavorReport,
  WorkspaceQualityAnalyzeRequest,
  WorkspaceQualityAnalyzeResult,
  WorkspaceQualityEntityResult,
  WorkspaceQualityFieldResult,
  WorkspaceQualityIssue,
  WorkspaceQualityIssueKind,
  WorkspaceQualityPatch,
  WorkspaceQualityRepairPreview,
  WorkspaceQualityRepairRequest,
  WorkspaceQualitySeverity,
} from '../../src/types'
import { analyzeLanguageDrift } from '../../src/shared/language-drift'
import { collectQualityGuardrailFindings } from '../../src/shared/content-guardrails'
import * as taskService from './task.service'
import { safeParseJson } from '../utils/json'

const ISSUE_KIND_LABELS: Record<WorkspaceQualityIssueKind, string> = {
  relevance_drift: '内容跑题',
  workflow_misalignment: '上下步骤脱节',
  context_loss: '上下文丢失',
  ai_like_language: 'AI 味重',
  ornament_overload: '辞藻堆砌',
  fabricated_terms: '生造概念',
  incoherent_sentence: '语句不顺',
  format_noise: '格式噪音',
  flat_narration: '叙述发平',
}

const TEMPLATE_CONNECTORS = [
  '然而',
  '与此同时',
  '就在这时',
  '某种',
  '仿佛',
  '似乎',
  '也许',
  '或许',
  '这意味着',
  '这说明',
  '由此可见',
]

const EXPLANATORY_TOKENS = [
  '意味着',
  '代表着',
  '说明了',
  '体现了',
  '展现了',
  '本质上',
  '某种程度上',
]

const ACTION_OR_SENSORY_TOKENS = [
  '看',
  '听',
  '闻',
  '摸',
  '抓',
  '推',
  '拉',
  '撞',
  '站',
  '坐',
  '跑',
  '走',
  '抬',
  '落',
  '痛',
  '冷',
  '热',
  '响',
  '湿',
  '汗',
]

const STANCE_TOKENS = [
  '我',
  '我们',
  '他',
  '她',
  '他们',
  '她们',
  '主角',
  '角色',
]

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

function normalizeSeverity(value: unknown, fallback: WorkspaceQualitySeverity = 'warning'): WorkspaceQualitySeverity {
  return value === 'info' || value === 'warning' || value === 'critical'
    ? value
    : fallback
}

function normalizeIssueKind(value: unknown): WorkspaceQualityIssueKind {
  return value === 'relevance_drift'
    || value === 'workflow_misalignment'
    || value === 'context_loss'
    || value === 'ai_like_language'
    || value === 'ornament_overload'
    || value === 'fabricated_terms'
    || value === 'incoherent_sentence'
    || value === 'format_noise'
    || value === 'flat_narration'
    ? value
    : 'ai_like_language'
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toPath(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number')
    .map((item) => String(item))
    .filter(Boolean)
}

function renderPrompt(parts: Array<string | null | undefined | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function section(title: string, content?: string | null): string {
  const text = cleanText(content)
  if (!text) return ''
  return `【${title}】\n${text}`
}

function bulletList(lines: string[]): string {
  return lines
    .map((line) => cleanText(line))
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

function summarizePath(path: string[]): string {
  if (path.length === 0) return '当前项'
  return path.join(' / ')
}

function summarizeValue(value: unknown): string {
  if (typeof value === 'string') {
    const compact = value.replace(/\s+/g, ' ').trim()
    return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const compact = JSON.stringify(value)
    return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact
  }
  if (value && typeof value === 'object') {
    const compact = JSON.stringify(value)
    return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact
  }
  return ''
}

function flattenSnapshotTexts(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? [text] : []
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenSnapshotTexts(item))
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => flattenSnapshotTexts(item))
  }
  return []
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/[。！？!?；\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
}

function countTokenRate(sentences: string[], tokens: string[]): number {
  if (sentences.length === 0) return 0
  const hits = sentences.filter((sentence) => tokens.some((token) => sentence.includes(token))).length
  return clampPercent((hits / sentences.length) * 100)
}

function analyzeAiFlavor(text: string): WorkspaceAiFlavorReport {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  const drift = analyzeLanguageDrift(normalized)
  const sentences = splitSentences(normalized)
  const guardrailFindings = collectQualityGuardrailFindings(normalized)
  const templateConnectorRate = countTokenRate(sentences, TEMPLATE_CONNECTORS)
  const explanatoryNarrationRate = countTokenRate(sentences, EXPLANATORY_TOKENS)
  const sensoryAnchorWeakRate = clampPercent(
    sentences.length === 0
      ? 0
      : (sentences.filter((sentence) => !ACTION_OR_SENSORY_TOKENS.some((token) => sentence.includes(token))).length / sentences.length) * 100,
  )
  const stanceWeakRate = clampPercent(
    sentences.length === 0
      ? 0
      : (sentences.filter((sentence) => !STANCE_TOKENS.some((token) => sentence.includes(token))).length / sentences.length) * 100,
  )
  const breakdown = [
    { key: 'abstractTokenDensity', label: '抽象词密度', value: drift.abstractTokenDensity },
    { key: 'sentencePatternRepeatRate', label: '句式重复率', value: drift.sentencePatternRepeatRate },
    { key: 'endingSummaryRate', label: '段尾升华率', value: drift.endingSummaryRate },
    { key: 'ornamentOverloadRate', label: '华丽辞藻率', value: drift.ornamentOverloadRate },
    { key: 'nonHumanCollocationRate', label: '非自然搭配率', value: drift.nonHumanCollocationRate },
    { key: 'templateConnectorRate', label: '模板连接词占比', value: templateConnectorRate },
    { key: 'explanatoryNarrationRate', label: '解释腔占比', value: explanatoryNarrationRate },
    { key: 'sensoryAnchorWeakRate', label: '缺少动作感官锚点', value: sensoryAnchorWeakRate },
    { key: 'stanceWeakRate', label: '缺少人物立场', value: stanceWeakRate },
  ]
  const averageRisk = breakdown.reduce((total, item) => total + item.value, 0) / Math.max(breakdown.length, 1)
  const score = Math.max(0, Math.round(100 - averageRisk * 0.9 - guardrailFindings.length * 4))
  const severity = score <= 45 ? 'high' : score <= 70 ? 'medium' : 'low'
  const sampleFindings: string[] = []
  if (templateConnectorRate >= 35) sampleFindings.push('模板连接词密度偏高，读起来像自动拼接。')
  if (explanatoryNarrationRate >= 30) sampleFindings.push('解释腔偏重，像旁白在替作者说明。')
  if (drift.ornamentOverloadRate >= 35) sampleFindings.push('辞藻和虚词过多，实感被冲淡。')
  if (sensoryAnchorWeakRate >= 60) sampleFindings.push('很多句子缺少动作、触感和现场锚点。')
  if (stanceWeakRate >= 60) sampleFindings.push('人物立场不够明显，像在做平叙说明。')
  if (guardrailFindings.some((finding) => finding.code === 'ai_slogan' || finding.code === 'template_emotion')) {
    sampleFindings.push('存在口号句或模板情绪表达。')
  }
  const humanizationDirections: string[] = []
  if (drift.abstractTokenDensity >= 30) humanizationDirections.push('把抽象判断改回具体动作、关系和代价。')
  if (templateConnectorRate >= 35) humanizationDirections.push('删掉“然而、与此同时、某种”等模板衔接，改成事件自然承接。')
  if (sensoryAnchorWeakRate >= 60) humanizationDirections.push('补人物动作、环境反应和感官细节，让句子落地。')
  if (stanceWeakRate >= 60) humanizationDirections.push('让句子更贴人物视角，而不是站在场外总结。')
  if (drift.ornamentOverloadRate >= 35) humanizationDirections.push('压掉空转修辞，只保留能推进信息的描述。')

  return {
    score,
    severity,
    summary: severity === 'high'
      ? '当前内容 AI 味偏重，容易出现模板腔、解释腔和空泛修辞。'
      : severity === 'medium'
        ? '当前内容存在一定 AI 痕迹，需要压缩模板表达和抽象总结。'
        : '当前内容的人味基础尚可，重点继续压制模板句和空泛收束。',
    breakdown,
    sampleFindings,
    humanizationDirections,
  }
}

function buildFallbackIssue(kind: WorkspaceQualityIssueKind, severity: WorkspaceQualitySeverity, description: string): WorkspaceQualityIssue {
  return {
    id: `fallback-${kind}-${severity}`,
    kind,
    severity,
    title: ISSUE_KIND_LABELS[kind],
    description,
    suggestion: kind === 'ai_like_language'
      ? '优先删除模板句、解释腔和假深刻总结，补具体动作与人物立场。'
      : kind === 'workflow_misalignment'
        ? '回到当前工作区职责，把内容改成能直接服务上下步骤的输入。'
        : '补齐与当前主题、背景和上下文的直接关联，再做润色。',
  }
}

function normalizeIssues(value: unknown): WorkspaceQualityIssue[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const record = item as Record<string, unknown>
      const kind = normalizeIssueKind(record.kind)
      return {
        id: cleanText(record.id) || `issue-${index + 1}`,
        kind,
        severity: normalizeSeverity(record.severity),
        title: cleanText(record.title) || ISSUE_KIND_LABELS[kind],
        description: cleanText(record.description) || cleanText(record.summary) || '检测到需要处理的问题。',
        suggestion: cleanText(record.suggestion) || '根据上下文与当前职责重写这部分内容。',
        path: toPath(record.path),
        entityId: typeof record.entityId === 'number' ? record.entityId : undefined,
        entityLabel: cleanText(record.entityLabel) || undefined,
        excerpt: cleanText(record.excerpt) || undefined,
      }
    })
}

function normalizeFieldResults(value: unknown): WorkspaceQualityFieldResult[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        path: toPath(record.path),
        label: cleanText(record.label) || summarizePath(toPath(record.path)),
        score: typeof record.score === 'number' ? Math.max(0, Math.min(100, Math.round(record.score))) : 0,
        severity: normalizeSeverity(record.severity),
        issues: toStringArray(record.issues),
        suggestions: toStringArray(record.suggestions),
      }
    })
}

function normalizeEntityResults(value: unknown): WorkspaceQualityEntityResult[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        path: toPath(record.path),
        label: cleanText(record.label) || summarizePath(toPath(record.path)),
        severity: normalizeSeverity(record.severity),
        summary: cleanText(record.summary) || '该实体需要进一步贴合当前工作区目标。',
        issues: toStringArray(record.issues),
        suggestions: toStringArray(record.suggestions),
        entityId: typeof record.entityId === 'number' ? record.entityId : undefined,
      }
    })
}

function buildAnalyzePrompt(request: WorkspaceQualityAnalyzeRequest): string {
  const snapshot = JSON.stringify(request.contentSnapshot, null, 2)
  return renderPrompt([
    `你是小说创作工作区的质量审校与去 AI 味分析器，当前正在审查「${request.workspaceLabel || request.workspaceKey}」。`,
    section('工作区职责', request.workspaceSummary || '判断当前工作区输出是否贴合主题、背景、上下步骤，并能直接服务后续创作。'),
    section('上一步', request.upstreamContext),
    section('下一步', request.downstreamContext),
    section('项目立项', request.projectBriefSummary),
    section('主题与文风', request.themeVoiceSummary),
    section('背景与题材', [
      request.genreContext ? `题材：${request.genreContext}` : '',
      request.backgroundSummary ? `背景：${request.backgroundSummary}` : '',
    ].filter(Boolean).join('\n')),
    section('待检测快照', snapshot),
    section('检测要求', bulletList([
      '先判断内容是否切合当前工作区职责，是否承接上一步并为下一步提供可执行输入。',
      '重点检查是否跑题、脱离主题、脱离背景、丢失上下文、与既有设定冲突。',
      '重点检查是否出现 AI 味、模板腔、解释腔、平铺直叙、华丽辞藻堆砌、自创新词、语句不通和格式污染。',
      '“AI 味检测”要优先识别没有代入感、只会总结、不像真实作者会写的句段。',
      '字段结果用于表单型工作区，实体结果用于集合型工作区；没有对应项时返回空数组。',
      '所有建议必须具体、可执行，不要只说“更自然”“更生动”。',
    ])),
    '只输出 JSON：{"summary":"总评","severity":"info|warning|critical","overallScore":0,"globalIssues":[{"id":"issue-1","kind":"relevance_drift","severity":"warning","title":"问题标题","description":"问题描述","suggestion":"如何修","path":["fields","targetAudience"]}],"fieldResults":[{"path":["fields","readerPromise"],"label":"读者承诺","score":0,"severity":"warning","issues":["问题1"],"suggestions":["建议1"]}],"entityResults":[{"path":["entities","0"],"label":"人物A","entityId":1,"severity":"warning","summary":"问题摘要","issues":["问题1"],"suggestions":["建议1"]}],"repairPriority":["先改什么","再改什么"],"sampleFindings":["AI味样例判断"],"humanizationDirections":["去AI味的人类化改写方向"]}',
  ])
}

function buildRepairPrompt(request: WorkspaceQualityRepairRequest): string {
  return renderPrompt([
    `你现在只负责修复「${request.workspaceLabel || request.workspaceKey}」当前快照，不要换题，不要新增无关设定，不要改坏原有结构。`,
    section('工作区职责', request.workspaceSummary || '保持当前工作区的功能位，只修问题，不另起炉灶。'),
    section('上一步', request.upstreamContext),
    section('下一步', request.downstreamContext),
    section('项目立项', request.projectBriefSummary),
    section('主题与文风', request.themeVoiceSummary),
    section('背景与题材', [
      request.genreContext ? `题材：${request.genreContext}` : '',
      request.backgroundSummary ? `背景：${request.backgroundSummary}` : '',
    ].filter(Boolean).join('\n')),
    section('当前问题', [
      ...((request.issues || []).map((issue) => `${issue.title}：${issue.description}；建议：${issue.suggestion}`)),
      request.extraRequirements ? `用户追加要求：${request.extraRequirements}` : '',
    ].filter(Boolean).join('\n')),
    section('待修复快照', JSON.stringify(request.contentSnapshot, null, 2)),
    section('修复原则', bulletList([
      '必须保留原有字段结构、数组顺序、实体 id 和已有功能位，不要凭空新增实体。',
      '优先修复跑题、上下步骤脱节、上下文丢失、AI 味、辞藻堆砌、自创新词、语句不通和格式污染。',
      '语言向真实作者会写的中文靠拢，少解释，少空话，多具体动作、关系、代价和现场感。',
      '不要把去 AI 味理解成口语化灌水，也不要把轻修变成整份推倒重写。',
    ])),
    '只输出 JSON：{"summary":"修复说明","repairedSnapshot":{}}',
  ])
}

function buildHeuristicIssues(text: string, request: WorkspaceQualityAnalyzeRequest, aiFlavor: WorkspaceAiFlavorReport): WorkspaceQualityIssue[] {
  const issues: WorkspaceQualityIssue[] = []
  if (aiFlavor.severity !== 'low') {
    issues.push(buildFallbackIssue('ai_like_language', aiFlavor.severity === 'high' ? 'critical' : 'warning', aiFlavor.summary))
  }
  if (request.workspaceSummary && text && !request.workspaceSummary.split(/[，、。；]/).some((token) => token.trim() && text.includes(token.trim()))) {
    issues.push(buildFallbackIssue('workflow_misalignment', 'warning', '当前内容和工作区职责的直接对应关系偏弱，容易写了很多但对后续步骤帮助不大。'))
  }
  if (request.projectBriefSummary && text && !request.projectBriefSummary.split(/[，、。；\n]/).some((token) => token.trim().length >= 3 && text.includes(token.trim()))) {
    issues.push(buildFallbackIssue('relevance_drift', 'warning', '当前内容和项目立项的关键信息绑定偏弱，容易脱离读者承诺与产品定位。'))
  }
  return issues
}

function normalizeAnalyzeResponse(
  parsed: Record<string, unknown>,
  request: WorkspaceQualityAnalyzeRequest,
  aiFlavor: WorkspaceAiFlavorReport,
): WorkspaceQualityAnalyzeResult {
  const globalIssues = normalizeIssues(parsed.globalIssues)
  const heuristicIssues = buildHeuristicIssues(flattenSnapshotTexts(request.contentSnapshot).join('\n'), request, aiFlavor)
  const mergedIssues = [...globalIssues, ...heuristicIssues.filter((issue) => !globalIssues.some((existing) => existing.kind === issue.kind))]
  return {
    summary: cleanText(parsed.summary) || '已完成工作区质量分析。',
    severity: normalizeSeverity(parsed.severity, mergedIssues.some((issue) => issue.severity === 'critical') ? 'critical' : 'warning'),
    overallScore: typeof parsed.overallScore === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.overallScore))) : aiFlavor.score,
    aiFlavor: {
      ...aiFlavor,
      sampleFindings: [
        ...aiFlavor.sampleFindings,
        ...toStringArray(parsed.sampleFindings),
      ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index).slice(0, 6),
      humanizationDirections: [
        ...aiFlavor.humanizationDirections,
        ...toStringArray(parsed.humanizationDirections),
      ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index).slice(0, 6),
    },
    globalIssues: mergedIssues,
    fieldResults: normalizeFieldResults(parsed.fieldResults),
    entityResults: normalizeEntityResults(parsed.entityResults),
    repairPriority: toStringArray(parsed.repairPriority),
    warnings: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function entityLabelFromRecord(record: Record<string, unknown>): string | undefined {
  return cleanText(record.label)
    || cleanText(record.name)
    || cleanText(record.title)
    || cleanText(record.term)
    || cleanText(record.eventTitle)
    || cleanText(record.arcName)
    || undefined
}

function collectPatches(
  previous: unknown,
  next: unknown,
  path: string[] = [],
  patches: WorkspaceQualityPatch[] = [],
  entityContext?: { id?: number; label?: string },
): WorkspaceQualityPatch[] {
  if (JSON.stringify(previous) === JSON.stringify(next)) return patches

  if (Array.isArray(previous) && Array.isArray(next)) {
    const isEntityArray = previous.every((item) => isRecord(item) && typeof item.id === 'number')
      && next.every((item) => isRecord(item) && typeof item.id === 'number')
    if (isEntityArray) {
      const nextById = new Map(next.map((item) => {
        const record = item as Record<string, unknown>
        return [record.id as number, record] as const
      }))
      previous.forEach((item, index) => {
        const record = item as Record<string, unknown>
        const current = nextById.get(record.id as number)
        if (!current) return
        collectPatches(
          record,
          current,
          [...path, String(index)],
          patches,
          { id: record.id as number, label: entityLabelFromRecord(current) || entityLabelFromRecord(record) },
        )
      })
      return patches
    }

    patches.push({
      id: path.join('.') || 'root-array',
      patchKind: entityContext ? 'entity' : 'field',
      path,
      label: entityContext?.label ? `${entityContext.label} · ${summarizePath(path.slice(-1))}` : summarizePath(path),
      before: summarizeValue(previous),
      after: summarizeValue(next),
      reason: '该列表内容经过整体修复。',
      entityId: entityContext?.id,
      entityLabel: entityContext?.label,
    })
    return patches
  }

  if (isRecord(previous) && isRecord(next)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
    keys.forEach((key) => {
      collectPatches(previous[key], next[key], [...path, key], patches, entityContext)
    })
    return patches
  }

  patches.push({
    id: path.join('.') || 'root',
    patchKind: entityContext ? 'entity' : 'field',
    path,
    label: entityContext?.label ? `${entityContext.label} · ${path.at(-1) || '字段'}` : summarizePath(path),
    before: summarizeValue(previous),
    after: summarizeValue(next),
    reason: '根据质量检测结果完成定向修复。',
    entityId: entityContext?.id,
    entityLabel: entityContext?.label,
  })
  return patches
}

function normalizeRepairSnapshot(parsed: unknown, fallbackSnapshot: Record<string, unknown>): {
  summary: string
  repairedSnapshot: Record<string, unknown>
  warnings: string[]
} {
  if (!isRecord(parsed)) {
    return {
      summary: 'AI 修复输出未返回有效 JSON，已保留原快照。',
      repairedSnapshot: cloneJson(fallbackSnapshot),
      warnings: ['AI 修复输出格式异常，未应用任何修改。'],
    }
  }

  const repairedSnapshot = isRecord(parsed.repairedSnapshot)
    ? parsed.repairedSnapshot
    : fallbackSnapshot

  return {
    summary: cleanText(parsed.summary) || '已生成工作区修复预览。',
    repairedSnapshot: cloneJson(repairedSnapshot),
    warnings: isRecord(parsed.repairedSnapshot) ? [] : ['AI 修复未返回 repairedSnapshot，已保留原快照。'],
  }
}

export async function analyzeWorkspaceQuality(request: WorkspaceQualityAnalyzeRequest): Promise<WorkspaceQualityAnalyzeResult> {
  const snapshotText = flattenSnapshotTexts(request.contentSnapshot).join('\n')
  const aiFlavor = analyzeAiFlavor(snapshotText)
  const raw = await taskService.runChatTask({
    type: 'review',
    novelId: request.novelId,
    retryable: true,
    modelConfigId: request.modelConfigId,
    messages: [{
      role: 'user',
      content: buildAnalyzePrompt(request),
    }],
  })
  const parsed = safeParseJson<Record<string, unknown>>(raw) || {}
  return normalizeAnalyzeResponse(parsed, request, aiFlavor)
}

export async function repairWorkspaceQuality(request: WorkspaceQualityRepairRequest): Promise<WorkspaceQualityRepairPreview> {
  const raw = await taskService.runChatTask({
    type: 'review',
    novelId: request.novelId,
    retryable: true,
    modelConfigId: request.modelConfigId,
    messages: [{
      role: 'user',
      content: buildRepairPrompt(request),
    }],
  })
  const parsed = safeParseJson<Record<string, unknown>>(raw)
  const normalized = normalizeRepairSnapshot(parsed, request.contentSnapshot)
  const patches = collectPatches(request.contentSnapshot, normalized.repairedSnapshot)
  const aiFlavor = analyzeAiFlavor(flattenSnapshotTexts(normalized.repairedSnapshot).join('\n'))

  return {
    summary: normalized.summary,
    warnings: normalized.warnings,
    aiFlavor,
    fieldPatches: patches.filter((patch) => patch.patchKind === 'field'),
    entityPatches: patches.filter((patch) => patch.patchKind === 'entity'),
    patchedSnapshot: normalized.repairedSnapshot,
  }
}
