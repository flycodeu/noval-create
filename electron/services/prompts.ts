import {
  GLOBAL_WRITING_RULES,
  buildAvoidanceSection,
  buildVariationHint,
  protagonistPrompt as rawProtagonistPrompt,
  batchCharacterPrompt as rawBatchCharacterPrompt,
  regenerateCharacterPrompt as rawRegenerateCharacterPrompt,
  characterRelationsPrompt as rawCharacterRelationsPrompt,
  mapGenerationPrompt as rawMapGenerationPrompt,
  storyArcsPrompt as rawStoryArcsPrompt,
  chapterOutlinePrompt as rawChapterOutlinePrompt,
  chapterWritingPrompt as rawChapterWritingPrompt,
  chapterSummaryPrompt as rawChapterSummaryPrompt,
  aiCheckPrompt as rawAiCheckPrompt,
  rewriteParagraphPrompt as rawRewriteParagraphPrompt,
  genericExpandPrompt as rawGenericExpandPrompt,
  subplotExpandPrompt as rawSubplotExpandPrompt,
  contentScoringPrompt as rawContentScoringPrompt,
  type BatchCharacterPromptInput,
  type CharacterRelationsPromptInput,
  type ContentScoringPromptInput,
  type GenericExpandPromptInput,
  type MapGenerationPromptInput,
  type ProtagonistPromptInput,
  type RegenerateCharacterPromptInput,
  type RewriteParagraphPromptInput,
  type SubplotExpandPromptInput,
} from '../../src/shared/prompt-library'
import type { AssetReviewTarget } from '../../src/types'
import { getBuiltinGenreRules } from '../../src/shared/genre-system'
import { applyPromptOverride } from './prompt-override.service'

export { GLOBAL_WRITING_RULES }

type StoryArcsPromptParams = Parameters<typeof rawStoryArcsPrompt>[0]
type ChapterOutlinePromptParams = Parameters<typeof rawChapterOutlinePrompt>[0]
type ChapterWritingPromptParams = Parameters<typeof rawChapterWritingPrompt>[0]
type ExtendedProtagonistPromptInput = ProtagonistPromptInput & {
  ageRange?: string
  speciesPreference?: string
  occupationHint?: string
  factionHint?: string
  itemPreferences?: string
  personalitySeed?: string
  forbiddenNames?: string
  forceDifferentFromExisting?: boolean
  rejectedDigests?: string[]
}
type ExtendedBatchCharacterPromptInput = BatchCharacterPromptInput & {
  existingCharacterSummaries?: string
  roleBlueprint?: string
  relationSeedMode?: string
  requiredItemLinks?: string
  diversityConstraints?: string
  rejectedDigests?: string[]
}
type ExtendedRegenerateCharacterPromptInput = RegenerateCharacterPromptInput & {
  attemptNumber?: number
  rejectedDigests?: string[]
}

export interface AssetReviewPromptInput {
  targetType: AssetReviewTarget
  contextSummary: string
  generatedOutput: string
  schemaHint?: string
  reviewFocus?: string[]
}

export interface AssetRewritePromptInput {
  targetType: AssetReviewTarget
  contextSummary: string
  generatedOutput: string
  reviewSummary: string
  topFixes?: string[]
  humanLanguageRepairs?: string[]
  schemaHint?: string
  rewriteConstraints?: string[]
}

export interface BackgroundExpansionResult {
  expanded_background: string
  titles: string[]
  synopsis: string
}

export interface BackgroundNamingViolation {
  token: string
  kind: 'person' | 'place' | 'org'
  placeholder: string
}

interface BackgroundNamingRule {
  kind: BackgroundNamingViolation['kind']
  placeholder: string
  pattern: RegExp
}

const GENERIC_BACKGROUND_NAME_TOKENS = new Set([
  '主角',
  '主人公',
  '角色',
  '人物',
  '身份',
  '处境',
  '背景',
  '设定',
  '城市',
  '城镇',
  '县城',
  '小镇',
  '组织',
  '机构',
  '部门',
  '单位',
  '工厂',
  '厂区',
  '报社',
  '公司',
  '集团',
  '学校',
  '学院',
  '大学',
  '基地',
  '据点',
  '避难所',
  '区域',
  '地方',
  '城区',
  '代号',
  '这座城市',
  '某个机构',
  '某家工厂',
  '某家报社',
  '某家公司',
  '某所学校',
  '某个基地',
])

const BACKGROUND_FALLBACK_TITLE_MAP: Array<{ match: RegExp; titles: string[] }> = [
  { match: /\u60ac\u7591|\u63a8\u7406|\u63a2\u79d8/u, titles: ['\u7f3a\u9875\u5377\u5b97', '\u5c01\u5b58\u8bb0\u5f55', '\u503c\u73ed\u5ba4\u7559\u6863'] },
  { match: /\u73b0\u4ee3|\u90fd\u5e02/u, titles: ['\u65e7\u57ce\u6162\u7ebf', '\u665a\u73ed\u4e4b\u540e', '\u7a7a\u767d\u8bb0\u5f55'] },
  { match: /\u8d5b\u535a/u, titles: ['\u5931\u5e8f\u8fb9\u754c', '\u9759\u9ed8\u534f\u8bae', '\u7070\u57df\u56de\u58f0'] },
  { match: /\u79d1\u5e7b/u, titles: ['\u5931\u8861\u5e74\u4ee3', '\u8fb9\u754c\u56de\u58f0', '\u9759\u9ed8\u822a\u7ebf'] },
  { match: /\u672b\u4e16|\u4e27\u5c38/u, titles: ['\u4f59\u70ec\u4e4b\u540e', '\u5931\u5b88\u8fb9\u7ebf', '\u9759\u9ed8\u8865\u7ed9'] },
  { match: /\u6b66\u4fa0/u, titles: ['\u6e21\u53e3\u65e7\u4e8b', '\u6c5f\u6e56\u56de\u6f6e', '\u65ad\u7891\u4e4b\u524d'] },
  { match: /\u7384\u5e7b|\u4fee\u771f|\u4ed9\u4fa0/u, titles: ['\u5c71\u95e8\u65e7\u96ea', '\u7075\u8109\u56de\u58f0', '\u7981\u5730\u6765\u4fe1'] },
  { match: /\u53e4\u4ee3|\u5386\u53f2/u, titles: ['\u65e7\u671d\u98ce\u58f0', '\u957f\u591c\u672a\u592e', '\u5c40\u4e2d\u4eba'] },
]

const BACKGROUND_NAMING_RULES: BackgroundNamingRule[] = [
  {
    kind: 'person',
    placeholder: '主角',
    pattern: /(?:主角|主人公|男主|女主)(?:叫|名叫|名为|是)?[“"'《「『]?([\u4e00-\u9fff·]{2,4})[”"'》」』]?(?=[，。；：、“”"'《》「」『』\s]|是|在|从|将|已)/gu,
  },
  {
    kind: 'place',
    placeholder: '这座城市',
    pattern: /(?:这座城市|这座城|城市|城镇|县城|小镇|都城|城邦|国家|王朝|帝国|联邦)(?:叫|名叫|名为|被称为)[“"'《「『]?([\u4e00-\u9fffA-Za-z·]{2,12})[”"'》」』]?/gu,
  },
  {
    kind: 'org',
    placeholder: '某个机构',
    pattern: /(?:组织|机构|部门|单位)(?:叫|名叫|名为|被称为)[“"'《「『]?([\u4e00-\u9fffA-Za-z·]{2,12})[”"'》」』]?/gu,
  },
  {
    kind: 'org',
    placeholder: '某家工厂',
    pattern: /(?:工厂|机械厂|厂区)(?:叫|名叫|名为|被称为)[“"'《「『]?([\u4e00-\u9fffA-Za-z·]{2,12})[”"'》」』]?/gu,
  },
  {
    kind: 'org',
    placeholder: '某家报社',
    pattern: /(?:报社|报馆)(?:叫|名叫|名为|被称为)[“"'《「『]?([\u4e00-\u9fffA-Za-z·]{2,12})[”"'》」』]?/gu,
  },
  {
    kind: 'org',
    placeholder: '某家公司',
    pattern: /(?:公司|集团)(?:叫|名叫|名为|被称为)[“"'《「『]?([\u4e00-\u9fffA-Za-z·]{2,12})[”"'》」』]?/gu,
  },
  {
    kind: 'org',
    placeholder: '某所学校',
    pattern: /(?:学校|学院|大学)(?:叫|名叫|名为|被称为)[“"'《「『]?([\u4e00-\u9fffA-Za-z·]{2,12})[”"'》」』]?/gu,
  },
  {
    kind: 'org',
    placeholder: '某个基地',
    pattern: /(?:基地|据点|避难所)(?:叫|名叫|名为|被称为)[“"'《「『]?([\u4e00-\u9fffA-Za-z·]{2,12})[”"'》」』]?/gu,
  },
]

function appendPromptSection(prompt: string, title: string, lines: string[]): string {
  const body = lines.map((line) => line.trim()).filter(Boolean).join('\n')
  if (!body) return prompt
  return `${prompt}\n\n【${title}】\n${body}`
}

function appendPromptText(prompt: string, text: string): string {
  const normalized = text.trim()
  if (!normalized) return prompt
  return `${prompt}\n\n${normalized}`
}

function stripTrailingJsonOutputInstruction(prompt: string): string {
  return prompt.replace(/\n{1,2}只输出 JSON：\{[^\n]*\}\s*$/u, '').trim()
}

function appendMandatoryExpandBackgroundGuardrails(prompt: string): string {
  return appendPromptSection(prompt, '不可覆盖的硬约束', [
    '- 只允许沿用用户原始背景里已经明确出现的专有名词。',
    '- 如果用户没有明确给出人名、城市名、组织名、工厂名、学校名、机构名、地名或代号，禁止擅自补出这些名字。',
    '- 需要指代时只能使用“主角”“这座城市”“某家工厂”“某个机构”“这片区域”等泛称。',
    '- 不要把泛称换成带引号的伪专名，不要发明简称、旧称、别名或代号。',
    '- 标题、简介和扩展背景都必须遵守同样的命名规则。',
    '- 只输出 JSON：{"expanded_background":"...","titles":["A","B","C"],"synopsis":"..."}',
  ])
}
function appendGenreSpecificExpandBackgroundFocus(prompt: string, genre: string): string {
  const genreKey = getBuiltinGenreRules(genre).genreProfile.key
  if (genreKey !== 'modern-mystery') return prompt

  return appendPromptSection(prompt, '现代悬疑校准', [
    '- 必须给出一个可追查的异常切口，例如旧案缺页、记录矛盾、封存卷宗、监控空窗、失联人员或厂区旧事故。',
    '- 必须写出主角为什么能接触这条线索，以及第一道现实阻力来自哪里：权限、人情、单位流程、面子、维稳或证据缺口。',
    '- 场域优先使用县城、老工业区、沿江港区、报社、医院、学校、街道、分局、档案馆、厂办等现实空间。',
    '- 标题优先从证据载体、地点纹理、时间锚点和职业现场取词，不要堆“迷雾”“深渊”“命运”这类万能词。',
    '- 如果用户已经给了人名地名，沿用并保持现实质感；如果没有给，就继续使用泛称。',
  ])
}

function normalizeBackgroundText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\uFEFF/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizeBackgroundTitle(text: string): string {
  return normalizeBackgroundText(text)
    .replace(/[\r\n]/g, ' ')
    .replace(/[“”"'《》「」『』]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function fallbackBackgroundTitles(genre: string): string[] {
  const matched = BACKGROUND_FALLBACK_TITLE_MAP.find((entry) => entry.match.test(genre))
  return matched?.titles.slice() || ['未竟之事', '暗线初起', '风暴前夜']
}

function finalizeBackgroundTitles(titles: string[], genre: string): string[] {
  const normalized = uniqueValues(
    titles
      .map(normalizeBackgroundTitle)
      .filter(Boolean),
  )

  for (const fallback of fallbackBackgroundTitles(genre)) {
    if (normalized.length >= 3) break
    if (!normalized.includes(fallback)) normalized.push(fallback)
  }

  return normalized.slice(0, 3)
}

function clipBackgroundSynopsis(text: string): string {
  const normalized = normalizeBackgroundText(text)
  if (normalized.length <= 180) return normalized
  return `${normalized.slice(0, 176)}...`
}

function buildFallbackBackgroundSynopsis(source: string): string {
  const normalized = normalizeBackgroundText(source)
  if (!normalized) return ''
  if (normalized.length <= 160) return normalized
  return `${normalized.slice(0, 156)}...`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceBackgroundToken(text: string, token: string, placeholder: string): string {
  if (!text || !token) return text
  const quoted = new RegExp(`[“"'《「『]?${escapeRegExp(token)}[”"'》」』]?`, 'gu')
  return text.replace(quoted, placeholder)
}

function normalizeBackgroundPlaceholders(text: string): string {
  return normalizeBackgroundText(text)
    .replace(/这座城市(?:叫|名叫|名为|被称为)这座城市/gu, '这座城市')
    .replace(/某个机构(?:叫|名叫|名为|被称为)某个机构/gu, '某个机构')
    .replace(/某家工厂(?:叫|名叫|名为|被称为)某家工厂/gu, '某家工厂')
    .replace(/某家报社(?:叫|名叫|名为|被称为)某家报社/gu, '某家报社')
    .replace(/某家公司(?:叫|名叫|名为|被称为)某家公司/gu, '某家公司')
    .replace(/某所学校(?:叫|名叫|名为|被称为)某所学校/gu, '某所学校')
    .replace(/某个基地(?:叫|名叫|名为|被称为)某个基地/gu, '某个基地')
    .replace(/[“"'《》「」『』](主角|这座城市|某个机构|某家工厂|某家报社|某家公司|某所学校|某个基地)[“"'《》「」『』]/gu, '$1')
    .replace(/(主角){2,}/gu, '主角')
    .replace(/(这座城市){2,}/gu, '这座城市')
    .replace(/(某个机构){2,}/gu, '某个机构')
    .replace(/(某家工厂){2,}/gu, '某家工厂')
    .replace(/(某家报社){2,}/gu, '某家报社')
    .replace(/(某家公司){2,}/gu, '某家公司')
    .replace(/(某所学校){2,}/gu, '某所学校')
    .replace(/(某个基地){2,}/gu, '某个基地')
}

export function normalizeBackgroundExpansionPayload(
  payload: unknown,
  genre: string,
  fallbackSource = '',
): BackgroundExpansionResult {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}

  const expandedBackground = normalizeBackgroundText(
    (typeof record.expanded_background === 'string' ? record.expanded_background : '')
    || (typeof record.expandedBackground === 'string' ? record.expandedBackground : '')
    || fallbackSource,
  )
  const synopsis = clipBackgroundSynopsis(
    (typeof record.synopsis === 'string' ? record.synopsis : '')
    || buildFallbackBackgroundSynopsis(expandedBackground || fallbackSource),
  )
  const rawTitles = Array.isArray(record.titles)
    ? record.titles.map((value) => (typeof value === 'string' ? value : ''))
    : []

  return {
    expanded_background: expandedBackground,
    synopsis,
    titles: finalizeBackgroundTitles(rawTitles, genre),
  }
}

export function collectForbiddenBackgroundNaming(
  result: BackgroundExpansionResult,
  originalInput: string,
): BackgroundNamingViolation[] {
  const content = [result.expanded_background, result.synopsis, ...result.titles].join('\n')
  const findings: BackgroundNamingViolation[] = []

  for (const rule of BACKGROUND_NAMING_RULES) {
    for (const match of content.matchAll(rule.pattern)) {
      const token = (match[1] || '').trim()
      if (!token || token.length <= 1) continue
      if (GENERIC_BACKGROUND_NAME_TOKENS.has(token)) continue
      if (originalInput.includes(token)) continue
      findings.push({ token, kind: rule.kind, placeholder: rule.placeholder })
    }
  }

  const seen = new Set<string>()
  return findings.filter((item) => {
    const key = `${item.kind}:${item.token}:${item.placeholder}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function sanitizeBackgroundExpansionResult(
  result: BackgroundExpansionResult,
  violations: BackgroundNamingViolation[],
  genre: string,
): BackgroundExpansionResult {
  const ordered = [...violations].sort((left, right) => right.token.length - left.token.length)

  const sanitizeText = (value: string) => ordered.reduce(
    (current, item) => replaceBackgroundToken(current, item.token, item.placeholder),
    value,
  )

  const expandedBackground = normalizeBackgroundPlaceholders(sanitizeText(result.expanded_background))
  const synopsis = clipBackgroundSynopsis(
    normalizeBackgroundPlaceholders(sanitizeText(result.synopsis || expandedBackground)),
  )
  const titles = finalizeBackgroundTitles(
    result.titles.map((title) => ordered.reduce(
      (current, item) => replaceBackgroundToken(current, item.token, ''),
      title,
    )),
    genre,
  )

  return {
    expanded_background: expandedBackground,
    synopsis,
    titles,
  }
}

export function buildBackgroundExpansionRepairPrompt(params: {
  userBackground: string
  genre: string
  worldTemplateSummary?: string
  invalidResult: BackgroundExpansionResult
  violations: BackgroundNamingViolation[]
}): string {
  const violationText = params.violations
    .map((item) => `${item.token}（${item.kind === 'person' ? '人物名' : item.kind === 'place' ? '地点名' : '组织名'}）`)
    .join('、')

  return [
    '下面这份“背景扩写”结果违反了命名约束，请只做收敛修复，不要重写成另一套故事。',
    '',
    '【用户原始输入】',
    `题材：${params.genre}`,
    `背景：${params.userBackground}`,
    params.worldTemplateSummary ? `世界模板参考：${params.worldTemplateSummary}` : '',
    '',
    '【发现的问题】',
    `以下名字不在用户原始输入里，却被擅自补出来了：${violationText}`,
    '',
    '【修复要求】',
    '1. 只允许保留用户原始输入里已经明确出现过的专有名词。',
    '2. 所有新增人物名统一改成“主角”。',
    '3. 所有新增城市/地区名统一改成“这座城市”或“这片区域”。',
    '4. 所有新增组织/工厂/报社/公司/学校/基地名统一改成泛称，例如“某个机构”“某家工厂”“某家报社”。',
    '5. 只做必要替换和轻微润色，让语句自然，不要改变故事方向、题材和冲突。',
    '6. 标题、简介和扩展背景都要同步修正。',
    '',
    '【待修复结果】',
    JSON.stringify(params.invalidResult, null, 2),
    '',
    '只输出 JSON：{"expanded_background":"...","titles":["A","B","C"],"synopsis":"..."}',
  ].filter(Boolean).join('\n')
}

export function expandBackgroundPrompt(params: {
  userBackground: string
  genre: string
  worldTemplateSummary?: string
}): string {
  const normalizedParams = {
    ...params,
    worldTemplateSummary: params.worldTemplateSummary || '',
  }
  const genreKey = getBuiltinGenreRules(normalizedParams.genre).genreProfile.key
  const isModernMystery = genreKey === 'modern-mystery'
  const fallback = [
    '你在补一份新小说的开篇背景。',
    '目标是把开局底盘写稳：时代环境、日常规则、制度压力、资源约束、危险来源和主角所处位置。',
    '不要提前展开中后期剧情，不要偷写真相、终局、反转或完整事件链。',
    '',
    '【已有信息】',
    `用户背景：${normalizedParams.userBackground}`,
    `题材：${normalizedParams.genre}`,
    normalizedParams.worldTemplateSummary ? `世界模板参考：${normalizedParams.worldTemplateSummary}` : '',
    '',
    '【本次任务】',
    '1. 写一段 300-500 字的扩展背景，只补当前可直接开写的处境和压力。',
    '2. 给出 3 个标题建议，标题要贴题材、贴冲突，不要像宣传语。',
    '3. 写一段 120-180 字的简介，直接点明开局处境、驱动力和最大阻力。',
    ...(isModernMystery ? ['4. 现代悬疑必须交代可追查的异常切口、调查入口和第一道现实阻力。'] : []),
    '',
    '【写法要求】',
    '1. 优先沿用用户已有设想，再补缺口，不要另起一套世界观。',
    '2. 优先写具体处境、行动边界、制度摩擦、资源短缺、风险和代价，少写空泛气氛。',
    '3. 允许写“首轮冲突的来源”，但不要直接写成详细剧情过程。',
    '4. 语言要自然、克制、可引用，像编辑会留下来的项目底稿，不要写成广告文案。',
    '5. 如果输入信息不够，就保守输出，不要靠幻觉补完。',
    ...(isModernMystery ? [
      '6. 现代悬疑必须给出异常切口、调查入口和现实阻力，不能只写压抑氛围。',
      '7. 标题和简介优先从卷宗、记录、地点、时间、机构和职业现场取词。',
    ] : []),
    '',
    '【输出格式】',
    '只输出 JSON：{"expanded_background":"...","titles":["A","B","C"],"synopsis":"..."}',
  ].filter(Boolean).join('\n')
  const overridden = applyPromptOverride('expandBackground', fallback, normalizedParams)
  const genreAligned = appendGenreSpecificExpandBackgroundFocus(overridden, normalizedParams.genre)
  return appendMandatoryExpandBackgroundGuardrails(genreAligned)
}
export function protagonistPrompt(params: ExtendedProtagonistPromptInput): string {
  const baseParams: ProtagonistPromptInput = {
    novelTitle: params.novelTitle,
    novelSynopsis: params.novelSynopsis,
    genre: params.genre,
    worldSummary: params.worldSummary,
    storyCore: params.storyCore,
    gender: params.gender,
    surnameHint: params.surnameHint,
    speciesSummary: params.speciesSummary,
    factionSummary: params.factionSummary,
    ecologySummary: params.ecologySummary,
    mapSummary: params.mapSummary,
    writingConstraints: params.writingConstraints,
    attemptNumber: params.attemptNumber,
  }
  const fallback = appendPromptText(
    appendPromptSection(
      appendPromptSection(rawProtagonistPrompt(baseParams), '差异化约束', [
      params.ageRange ? `- 年龄区间偏好：${params.ageRange}` : '',
      params.speciesPreference ? `- 种类偏好：${params.speciesPreference}` : '',
      params.occupationHint ? `- 职业或身份倾向：${params.occupationHint}` : '',
      params.factionHint ? `- 势力倾向：${params.factionHint}` : '',
      params.itemPreferences ? `- 重点绑定物品或资源：${params.itemPreferences}` : '',
      params.personalitySeed ? `- 性格种子：${params.personalitySeed}` : '',
      params.forbiddenNames ? `- 禁止复用或接近这些名字：${params.forbiddenNames}` : '',
      typeof params.forceDifferentFromExisting === 'boolean'
        ? `- ${params.forceDifferentFromExisting ? '必须显著区别于现有人物设定。' : '可以适度沿用现有生态风格。'}`
        : '',
      ]),
      '生产补充要求',
      [
        '- 主角档案必须能直接进入场景写作，不能只像设定卡。',
        '- 动机、弱点、关系和能力都要能制造后续章节冲突与代价。',
        '- 主角需要带出至少一个可持续调用的物品、资源或身份筹码。',
      ],
    ),
    [
      buildAvoidanceSection(params.rejectedDigests || []),
      params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'character') : '',
    ].filter(Boolean).join('\n\n'),
  )
  return applyPromptOverride('protagonist', fallback, params as unknown as Record<string, unknown>)
}

export function batchCharacterPrompt(params: ExtendedBatchCharacterPromptInput): string {
  const baseParams: BatchCharacterPromptInput = {
    novelTitle: params.novelTitle,
    novelSynopsis: params.novelSynopsis,
    protagonistSummary: params.protagonistSummary,
    existingNames: params.existingNames,
    genre: params.genre,
    worldSummary: params.worldSummary,
    storyCore: params.storyCore,
    count: params.count,
    genderRatio: params.genderRatio,
    specialRequirements: params.specialRequirements,
    speciesSummary: params.speciesSummary,
    factionSummary: params.factionSummary,
    ecologySummary: params.ecologySummary,
    mapSummary: params.mapSummary,
    writingConstraints: params.writingConstraints,
    attemptNumber: params.attemptNumber,
  }
  const fallback = appendPromptText(
    appendPromptSection(
      appendPromptSection(rawBatchCharacterPrompt(baseParams), '角色网络约束', [
      params.roleBlueprint ? `- 角色槽位蓝图：${params.roleBlueprint}` : '',
      params.relationSeedMode ? `- 关系网络倾向：${params.relationSeedMode}` : '',
      params.requiredItemLinks ? `- 每一批至少覆盖这些物品或资源线：${params.requiredItemLinks}` : '',
      params.diversityConstraints ? `- 差异化硬约束：${params.diversityConstraints}` : '',
      params.existingCharacterSummaries ? `- 现有人物摘要，避免撞设定：\n${params.existingCharacterSummaries}` : '',
      ]),
      '生产补充要求',
      [
        '- 每个配角都要承担明确剧情功能，避免批量生成同质化人物。',
        '- 如果某个角色对主线、支线、冲突或关系网没有作用，就不要硬塞进去。',
        '- 至少一部分人物要直接绑定物品、资源、地点或组织权力，而不是只有情绪标签。',
      ],
    ),
    [
      buildAvoidanceSection(params.rejectedDigests || []),
      params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'character') : '',
    ].filter(Boolean).join('\n\n'),
  )
  return applyPromptOverride('batchCharacter', fallback, params as unknown as Record<string, unknown>)
}

export function regenerateCharacterPrompt(params: ExtendedRegenerateCharacterPromptInput): string {
  const baseParams: RegenerateCharacterPromptInput = {
    novelTitle: params.novelTitle,
    novelSynopsis: params.novelSynopsis,
    genre: params.genre,
    worldSummary: params.worldSummary,
    storyCore: params.storyCore,
    protagonistRule: params.protagonistRule,
    lockedName: params.lockedName,
    lockedRoleType: params.lockedRoleType,
    currentProfile: params.currentProfile,
    relatedCharacters: params.relatedCharacters,
    relationSummary: params.relationSummary,
    speciesSummary: params.speciesSummary,
    factionSummary: params.factionSummary,
    ecologySummary: params.ecologySummary,
    writingConstraints: params.writingConstraints,
  }
  const fallback = appendPromptText(
    appendPromptSection(rawRegenerateCharacterPrompt(baseParams), '生产补充要求', [
      '- 重做人设时优先修正空心化、工具人感和人机味，保住原有剧情槽位。',
      '- 修改结果必须能直接用于后续章节，不要只变得更华丽。',
    ]),
    [
      buildAvoidanceSection(params.rejectedDigests || []),
      params.attemptNumber && params.attemptNumber > 1 ? buildVariationHint(params.attemptNumber, 'character') : '',
    ].filter(Boolean).join('\n\n'),
  )
  return applyPromptOverride('regenerateCharacter', fallback, params as unknown as Record<string, unknown>)
}

export function characterRelationsPrompt(params: CharacterRelationsPromptInput): string {
  const fallback = appendPromptSection(rawCharacterRelationsPrompt(params), '关系类型补充', [
    '- 关系类型只使用 stranger / acquaintance / friend / family / colleague / mentor_student / ally / subordinate / rival / lover / enemy，不要额外发明新枚举。',
    '- label 要写成读者一眼能懂的中文关系简称，例如“同门师兄妹”“互相利用”“表面同盟”。',
    '- 如果关系明显是单向错位，可以把 bilateral 设为 false，并在 description 里写清双方认知差。',
  ])
  return applyPromptOverride('characterRelations', fallback, params as unknown as Record<string, unknown>)
}

export function mapGenerationPrompt(params: MapGenerationPromptInput): string {
  const fallback = appendPromptSection(rawMapGenerationPrompt(params), '生产补充要求', [
    '- 地点不只是名字和风景，还要承担行动路线、资源争夺、势力边界或剧情压力。',
    '- 每个关键地点至少具备一个可用于章节冲突的实际功能。',
  ])
  return applyPromptOverride('mapGeneration', fallback, params as unknown as Record<string, unknown>)
}

export function storyArcsPrompt(params: StoryArcsPromptParams): string {
  const fallback = appendPromptSection(rawStoryArcsPrompt(params), '生产补充要求', [
    '- 故事弧设计要优先服务章节生产，不要只追求概念完整。',
  ])
  return applyPromptOverride('storyArcsLegacy', fallback, params as unknown as Record<string, unknown>)
}

export function chapterOutlinePrompt(params: ChapterOutlinePromptParams): string {
  const fallback = appendPromptSection(rawChapterOutlinePrompt(params), '生产补充要求', [
    '- 章节大纲需要兼顾读者理解和追读欲，不要只写结构名词。',
  ])
  return applyPromptOverride('chapterOutlineLegacy', fallback, params as unknown as Record<string, unknown>)
}

export function chapterWritingPrompt(params: ChapterWritingPromptParams): string {
  const fallback = appendPromptSection(rawChapterWritingPrompt(params), '生产补充要求', [
    '- 正文必须像最终交付给读者的小说片段，不能露出提示词味和说明书味。',
  ])
  return applyPromptOverride('chapterWriting', fallback, params as unknown as Record<string, unknown>)
}

export function chapterSummaryPrompt(chapterContent: string): string {
  const fallback = rawChapterSummaryPrompt(chapterContent)
  return applyPromptOverride('chapterSummary', fallback, { chapterContent })
}

export function aiCheckPrompt(text: string, truncated = false): string {
  const fallback = appendPromptSection(rawAiCheckPrompt(text, truncated), '补充检查重点', [
    '- 如果某处表达虽然字面能懂，但明显不像正常中文，也要指出并给更自然替换说法。',
    '- 优先标出最影响读者沉浸和可信度的问题，不要堆低价值噪声。',
  ])
  return applyPromptOverride('aiCheck', fallback, { text, truncated })
}

export function rewriteParagraphPrompt(params: RewriteParagraphPromptInput): string {
  const fallback = rawRewriteParagraphPrompt(params)
  return applyPromptOverride('rewriteParagraph', fallback, params as unknown as Record<string, unknown>)
}

export function genericExpandPrompt(params: GenericExpandPromptInput): string {
  const fallback = appendPromptSection(rawGenericExpandPrompt(params), '生产补充要求', [
    '- 扩写结果要便于后续章节、人物或地图继续调用，不要只做漂亮描述。',
  ])
  return applyPromptOverride('genericExpand', fallback, params as unknown as Record<string, unknown>)
}

export function subplotExpandPrompt(params: SubplotExpandPromptInput): string {
  const fallback = appendPromptSection(rawSubplotExpandPrompt(params), '生产补充要求', [
    '- 支线必须提高主线张力或改变关系站位，避免写成可删可不删的装饰线。',
  ])
  return applyPromptOverride('subplotExpand', fallback, params as unknown as Record<string, unknown>)
}

export function contentScoringPrompt(params: ContentScoringPromptInput): string {
  const outputInstruction = '只输出 JSON：{"dimensions":[{"name":"文笔质量","score":0,"feedback":"","suggestion":""},{"name":"逻辑连贯","score":0,"feedback":"","suggestion":""},{"name":"节奏控制","score":0,"feedback":"","suggestion":""},{"name":"情感深度","score":0,"feedback":"","suggestion":""},{"name":"人物塑造","score":0,"feedback":"","suggestion":""},{"name":"世界一致","score":0,"feedback":"","suggestion":""},{"name":"准确度","score":0,"feedback":"","suggestion":""},{"name":"追读欲","score":0,"feedback":"","suggestion":""}],"ai_like_rate":0,"repetition_risk":"低/中/高","overall_score":0,"overall_feedback":"","top_fixes":[],"weak_dimensions":[]}'
  const fallback = appendPromptText(
    appendPromptSection(stripTrailingJsonOutputInstruction(rawContentScoringPrompt(params)), '补充评分要求', [
      '- 维度里要显式覆盖连贯性、准确度和追读欲，不要把这些都塞进一个笼统的逻辑分里。',
      '- 如果存在明显人机味、硬造词、表达不通或解释腔，要在 top_fixes 里优先指出。',
    ]),
    outputInstruction,
  )
  return applyPromptOverride('contentScoring', fallback, params as unknown as Record<string, unknown>)
}

function assetTargetLabel(targetType: AssetReviewTarget): string {
  switch (targetType) {
    case 'character':
      return '人物资产'
    case 'faction':
      return '势力资产'
    case 'item':
      return '物品资产'
    case 'thread':
      return '故事线程'
    case 'timeline':
      return '时间轴事件'
    case 'subplot':
      return '支线资产'
    case 'map':
      return '地图资产'
    case 'world_rules':
      return '世界规则分区'
    default:
      return '故事资产'
  }
}

export function assetReviewPrompt(params: AssetReviewPromptInput): string {
  const fallback = [
    `你现在是小说生产链的资产审校器，负责审查一份${assetTargetLabel(params.targetType)}是否适合直接进入写作上下文。`,
    '',
    '审校原则：',
    '- 先判断它是否贴合题材、背景、主线目标与核心冲突。',
    '- 再判断它是否存在模板腔、设定稿腔、空泛抽象、语言生硬、人机味。',
    '- 再判断它是否与世界规则、角色关系、时间逻辑或已有资产发生明显冲突。',
    '- 轻问题使用 rewrite_required=true，表示可通过定向重写修复。',
    '- 重问题使用 reject_required=true，表示不应直接落库，需要整条拒收或重生。',
    '',
    '【上游上下文】',
    params.contextSummary.trim(),
    '',
    '【待审校输出】',
    params.generatedOutput.trim(),
    params.schemaHint?.trim() ? `\n【结构提示】\n${params.schemaHint.trim()}` : '',
    params.reviewFocus && params.reviewFocus.length > 0
      ? `\n【额外审校重点】\n${params.reviewFocus.map((line) => `- ${line.trim()}`).filter((line) => line !== '-').join('\n')}`
      : '',
    '',
    '只输出 JSON：',
    '{"summary":"总体判断","severity":"low|medium|high","rewrite_required":false,"reject_required":false,"genre_drift_risks":["风险"],"theme_drift_risks":["风险"],"background_drift_risks":["风险"],"language_risks":["风险"],"human_language_repairs":["原说法 -> 更自然说法"],"conflict_risks":["风险"],"top_fixes":[],"strengths":["具体优点"]}',
  ].filter(Boolean).join('\n')

  return applyPromptOverride('assetReview', fallback, params as unknown as Record<string, unknown>)
}

export function assetRewritePrompt(params: AssetRewritePromptInput): string {
  const fallback = [
    `你现在只负责定向修复一份${assetTargetLabel(params.targetType)}，不要另起炉灶，不要换题，不要发明新的主线方向。`,
    '',
    '修复原则：',
    '- 只处理审校里指出的关键问题，优先修语言自然度、背景贴合度、主线贴合度和明显冲突。',
    '- 如果原输出是 JSON，必须继续只输出 JSON，不要解释，不要 Markdown。',
    '- 必须尽量保持原有顶层结构、数组长度、对象顺序、字段名和字段语义稳定。',
    '- 不要新增无关设定，不要把轻修变成整份重写。',
    '',
    '【上游上下文】',
    params.contextSummary.trim(),
    '',
    '【审校结论】',
    params.reviewSummary.trim(),
    ...(params.topFixes || []).map((line) => `- ${line}`),
    ...(params.humanLanguageRepairs && params.humanLanguageRepairs.length > 0
      ? ['语言替换建议：', ...params.humanLanguageRepairs.map((line) => `- ${line}`)]
      : []),
    '',
    '【待修复输出】',
    params.generatedOutput.trim(),
    params.schemaHint?.trim() ? `\n【结构提示】\n${params.schemaHint.trim()}` : '',
    ...(params.rewriteConstraints && params.rewriteConstraints.length > 0
      ? ['', '【硬约束】', ...params.rewriteConstraints.map((line) => `- ${line.trim()}`)]
      : []),
    '',
    '直接输出修复后的最终内容，不要补充解释。',
  ].filter(Boolean).join('\n')

  return applyPromptOverride('assetRewrite', fallback, params as unknown as Record<string, unknown>)
}
