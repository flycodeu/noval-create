import {
  GLOBAL_WRITING_RULES,
  expandBackgroundPrompt as rawExpandBackgroundPrompt,
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
}
type ExtendedBatchCharacterPromptInput = BatchCharacterPromptInput & {
  existingCharacterSummaries?: string
  roleBlueprint?: string
  relationSeedMode?: string
  requiredItemLinks?: string
  diversityConstraints?: string
}

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

export function expandBackgroundPrompt(params: {
  userBackground: string
  genre: string
  worldTemplateSummary?: string
}): string {
  const normalizedParams = {
    ...params,
    worldTemplateSummary: params.worldTemplateSummary || '',
  }
  const fallback = rawExpandBackgroundPrompt(normalizedParams)
  return applyPromptOverride('expandBackground', fallback, normalizedParams)
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
  }
  const fallback = appendPromptSection(
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
  }
  const fallback = appendPromptSection(
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
  )
  return applyPromptOverride('batchCharacter', fallback, params as unknown as Record<string, unknown>)
}

export function regenerateCharacterPrompt(params: RegenerateCharacterPromptInput): string {
  const fallback = appendPromptSection(rawRegenerateCharacterPrompt(params), '生产补充要求', [
    '- 重做人设时优先修正空心化、工具人感和人机味，保住原有剧情槽位。',
    '- 修改结果必须能直接用于后续章节，不要只变得更华丽。',
  ])
  return applyPromptOverride('regenerateCharacter', fallback, params as unknown as Record<string, unknown>)
}

export function characterRelationsPrompt(params: CharacterRelationsPromptInput): string {
  const fallback = appendPromptSection(rawCharacterRelationsPrompt(params), '关系类型补充', [
    '- 在既有 friend / enemy / lover / parent_child / colleague / rival / mentor_student / acquaintance 基础上，也允许输出 family / ally / subordinate / benefactor / debtor / handler / teammate / spouse / ex_lover / political_partner。',
    '- label 要写成读者一眼能懂的中文关系简称，例如“同门师兄妹”“互相利用”“表面同盟”。',
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
  const fallback = appendPromptText(
    appendPromptSection(rawContentScoringPrompt(params), '补充评分要求', [
      '- 维度里要显式覆盖连贯性、准确度和追读欲，不要把这些都塞进一个笼统的逻辑分里。',
      '- 如果存在明显人机味、硬造词、表达不通或解释腔，要在 top_fixes 里优先指出。',
    ]),
    '只输出 JSON：{"dimensions":[{"name":"创新性","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"丰富度","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"自然度","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"连贯性","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"准确度","score":0,"feedback":"一句简评","suggestion":"具体改法"},{"name":"追读欲","score":0,"feedback":"一句简评","suggestion":"具体改法"}],"ai_like_rate":0,"repetition_risk":"低/中/高","overall_score":0,"overall_feedback":"综合评价","top_fixes":["修改建议1","修改建议2","修改建议3"]}',
  )
  return applyPromptOverride('contentScoring', fallback, params as unknown as Record<string, unknown>)
}
