import type { ApprovedStyleSample } from './style-source'
import type { ThemeVoiceDocument } from './theme-voice'
import type { ReaderFeedbackItem, ResolvedReaderFeedback } from './reader-feedback'
import { estimateTokens } from './token-budget'
import { formatSceneStoryDesign, isSceneStoryDesign, type SceneStoryDesign } from './story-thread-generation'

export interface SceneWritingSceneInput {
  story_design?: SceneStoryDesign
  scene_order?: number
  scene_title?: string
  purpose?: string
  conflict?: string
  hidden_agendas?: string[]
  irony_gap?: string
  theme_question?: string
  theme_choice?: string
  theme_cost?: string
  theme_consequence?: string
  sourceText?: string
}

export type SceneWritingThemeVoiceInput = Pick<ThemeVoiceDocument, 'targetWorkSampleGuide' | 'humanStyleSampleLock'> & {
  approvedSample?: ApprovedStyleSample
  styleSourceDiagnostics?: string[]
  readerFeedback?: ResolvedReaderFeedback
}

export interface SceneWritingKnownState {
  chapterNum?: number
  chapterTitle?: string
  knownFacts?: string[]
}

export interface SceneWritingBrief {
  scene: {
    storyDesign?: SceneStoryDesign
    order: number | null
    title: string
    purpose: string
    conflict: string
    hiddenAgendas: string[]
    ironyGap: string
    themeQuestion: string
    themeChoice: string
    themeCost: string
    themeConsequence: string
    sourceText: string
  }
  authorStyle: {
    guide: string
    samples: string[]
    sampleSources: string[]
    omittedSamples: number
    estimatedTokens: number
  }
  authorFeedback: {
    selected: ReaderFeedbackItem[]
    conflicts: ResolvedReaderFeedback['conflicts']
    settingsRevision: number
  }
  knownState: {
    chapterNum: number | null
    chapterTitle: string
    knownFacts: string[]
  }
  sourceKeys: string[]
  diagnostics: string[]
}

const STYLE_MATERIAL_LIMIT = 600
const MAX_SAMPLES = 2

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(cleanText).filter(Boolean)
    : []
}

function splitCompleteParagraphs(value: string): string[] {
  return value
    .split(/\r?\n\s*\r?\n|\r?\n---+\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function selectStyleMaterial(themeVoice: SceneWritingThemeVoiceInput): SceneWritingBrief['authorStyle'] & { diagnostics: string[] } {
  const diagnostics: string[] = [...(themeVoice.styleSourceDiagnostics || [])]
  let remaining = STYLE_MATERIAL_LIMIT
  let guide = ''
  const samples: string[] = []
  const sampleSources: string[] = []
  let omittedSamples = 0

  const explicitGuide = [cleanText(themeVoice.targetWorkSampleGuide), cleanText(themeVoice.humanStyleSampleLock)].filter(Boolean).join('\n')
  if (explicitGuide && estimateTokens(explicitGuide) <= remaining) {
    guide = explicitGuide
    remaining -= estimateTokens(guide)
  } else if (explicitGuide) {
    diagnostics.push('作者样稿说明超过风格材料上限，未注入。')
  }

  const sampleParts = splitCompleteParagraphs(cleanText(themeVoice.approvedSample?.text))
  sampleParts.forEach((sample, index) => {
    if (samples.length >= MAX_SAMPLES) {
      omittedSamples += 1
      return
    }
    const cost = estimateTokens(sample)
    if (cost <= remaining) {
      samples.push(sample)
      sampleSources.push(`${themeVoice.approvedSample?.source}#${index + 1}`)
      remaining -= cost
    } else {
      omittedSamples += 1
    }
  })

  if (omittedSamples > 0) diagnostics.push(`有 ${omittedSamples} 段样稿因数量或预算限制未注入；未截断片段。`)
  return { guide, samples, sampleSources, omittedSamples, estimatedTokens: STYLE_MATERIAL_LIMIT - remaining, diagnostics }
}

export function buildSceneWritingBrief(
  scene: SceneWritingSceneInput | null | undefined,
  themeVoice: SceneWritingThemeVoiceInput,
  knownState: SceneWritingKnownState = {},
): SceneWritingBrief {
  const source = scene || {}
  const normalizedScene = {
    ...(isSceneStoryDesign(source.story_design) ? { storyDesign: structuredClone(source.story_design) } : {}),
    order: typeof source.scene_order === 'number' && Number.isSafeInteger(source.scene_order) ? source.scene_order : null,
    title: cleanText(source.scene_title),
    purpose: cleanText(source.purpose),
    conflict: cleanText(source.conflict),
    hiddenAgendas: cleanList(source.hidden_agendas),
    ironyGap: cleanText(source.irony_gap),
    themeQuestion: cleanText(source.theme_question),
    themeChoice: cleanText(source.theme_choice),
    themeCost: cleanText(source.theme_cost),
    themeConsequence: cleanText(source.theme_consequence),
    sourceText: cleanText(source.sourceText),
  }
  const authorStyle = selectStyleMaterial(themeVoice)
  const authorFeedback = themeVoice.readerFeedback || {
    settingsRevision: 0,
    selected: [],
    conflicts: [],
    states: [],
    omittedCount: 0,
    diagnostics: [],
  }
  const knownFacts = cleanList(knownState.knownFacts)
  const sourceKeys = [
    normalizedScene.purpose ? 'ScenePlanStep.purpose' : '',
    normalizedScene.conflict ? 'ScenePlanStep.conflict' : '',
    normalizedScene.hiddenAgendas.length > 0 ? 'ScenePlanStep.hidden_agendas' : '',
    normalizedScene.ironyGap ? 'ScenePlanStep.irony_gap' : '',
    normalizedScene.themeQuestion ? 'ScenePlanStep.theme_question' : '',
    normalizedScene.themeChoice ? 'ScenePlanStep.theme_choice' : '',
    normalizedScene.themeCost ? 'ScenePlanStep.theme_cost' : '',
    normalizedScene.themeConsequence ? 'ScenePlanStep.theme_consequence' : '',
    normalizedScene.sourceText ? 'ChapterPipeline.scenePlanText' : '',
    authorStyle.guide ? 'ThemeVoice.targetWorkSampleGuide' : '',
    ...authorStyle.sampleSources,
    ...authorFeedback.selected.map((item) => `ReaderFeedback.${item.id}`),
  ].filter(Boolean)
  return {
    scene: normalizedScene,
    authorStyle: {
      guide: authorStyle.guide,
      samples: authorStyle.samples,
      sampleSources: authorStyle.sampleSources,
      omittedSamples: authorStyle.omittedSamples,
      estimatedTokens: authorStyle.estimatedTokens,
    },
    authorFeedback: {
      selected: authorFeedback.selected,
      conflicts: authorFeedback.conflicts,
      settingsRevision: authorFeedback.settingsRevision,
    },
    knownState: {
      chapterNum: typeof knownState.chapterNum === 'number' ? knownState.chapterNum : null,
      chapterTitle: cleanText(knownState.chapterTitle),
      knownFacts,
    },
    sourceKeys,
    diagnostics: [
      ...authorStyle.diagnostics,
      ...authorFeedback.diagnostics,
      ...(!normalizedScene.purpose && !normalizedScene.conflict ? [normalizedScene.sourceText ? '历史文本可用，结构字段不可用；不推断缺少目标。' : '未提供结构场景字段；不补造冲突。'] : []),
    ],
  }
}

function formatFeedbackScope(item: ReaderFeedbackItem): string {
  switch (item.scope.type) {
    case 'book': return '全书（作者显式指定）'
    case 'passage': return `来源章节 ${item.source.chapterId} 的当前段落`
    case 'scene': return `来源章节 ${item.source.chapterId} / 场景 ${item.scope.sceneOrder}`
    case 'character': return `角色 ${item.scope.characterName || `#${item.scope.characterId}`}`
  }
}

function formatAuthorFeedback(brief: SceneWritingBrief): string[] {
  if (brief.authorFeedback.selected.length === 0) return []
  return [
    `【作者反馈｜版本 ${brief.authorFeedback.settingsRevision}｜仅限标注范围】`,
    ...brief.authorFeedback.selected.map((item) => `${item.sentiment === 'keep' ? '保留' : '减少'}｜${formatFeedbackScope(item)}｜${item.topic}：${item.note}`),
    ...(brief.authorFeedback.conflicts.length > 0
      ? ['存在同范围同主题的相反反馈；两侧均保留，按当前场景语境取舍，不自行改写成永久规则。'] : []),
    '这些反馈是当前场景的软偏好；不得扩大到未标注角色或全书，也不得改写成“禁止某种写法”。',
  ]
}

export function formatSceneWritingBrief(brief: SceneWritingBrief): string {
  const scene = brief.scene
  const sceneLines = [
    formatSceneStoryDesign(scene.storyDesign),
    scene.order ? `场景${scene.order}${scene.title ? `《${scene.title}》` : ''}` : '',
    scene.purpose ? `目标：${scene.purpose}` : '',
    scene.conflict ? `冲突：${scene.conflict}` : '',
    scene.hiddenAgendas.length > 0 ? `各方诉求：${scene.hiddenAgendas.join('；')}` : '',
    scene.ironyGap ? `信息差：${scene.ironyGap}` : '',
    scene.themeQuestion ? `主题问题：${scene.themeQuestion}` : '',
    scene.themeChoice ? `主题选择：${scene.themeChoice}` : '',
    scene.themeCost ? `主题代价：${scene.themeCost}` : '',
    scene.themeConsequence ? `主题后果：${scene.themeConsequence}` : '',
    scene.sourceText ? `场景材料来源：${scene.sourceText}` : '',
  ].filter(Boolean)
  const styleLines = [
    brief.authorStyle.guide ? `作者说明（非正文样稿）：${brief.authorStyle.guide}` : '',
    ...brief.authorStyle.samples.map((sample, index) => `作者样稿正文${index + 1}（${brief.authorStyle.sampleSources[index] || '显式样稿'}）：${sample}`),
  ].filter(Boolean)
  const knownLines = brief.knownState.knownFacts.length > 0
    ? `已知状态（仅用于边界，不新增事实）：${brief.knownState.knownFacts.join('；')}`
    : ''
  return [
    '【场景写作材料】',
    ...sceneLines,
    ...styleLines,
    ...formatAuthorFeedback(brief),
    knownLines,
    '冲突取舍：已确认状态和场景任务优先；作者样稿控制表达方式，不得改写事实、补造设定或复制样稿内容。',
    '规则：只使用以上显式材料；缺失项留空，不补造人物动机、经历、物件或关系。',
  ].filter(Boolean).join('\n')
}

/** Reader-first carries only selected author expression material; scene facts are rendered by the role builder. */
export function formatAuthorStyleReference(brief: SceneWritingBrief): string {
  return [brief.authorStyle.guide ? `作者说明（非正文样稿）：${brief.authorStyle.guide}` : '',
    ...brief.authorStyle.samples.map((sample, index) => `作者样稿正文${index + 1}：${sample}`),
    ...formatAuthorFeedback(brief),
  ].filter(Boolean).join('\n\n')
}
