import type { ThemeVoiceDocument } from './theme-voice'
import { estimateTokens } from './token-budget'

export interface SceneWritingSceneInput {
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

export type SceneWritingThemeVoiceInput = Pick<ThemeVoiceDocument, 'targetWorkSampleGuide' | 'humanStyleSampleLock'>

export interface SceneWritingKnownState {
  chapterNum?: number
  chapterTitle?: string
  knownFacts?: string[]
}

export interface SceneWritingBrief {
  scene: {
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
  const diagnostics: string[] = []
  let remaining = STYLE_MATERIAL_LIMIT
  let guide = ''
  const samples: string[] = []
  const sampleSources: string[] = []
  let omittedSamples = 0

  const explicitGuide = cleanText(themeVoice.targetWorkSampleGuide)
  if (explicitGuide && estimateTokens(explicitGuide) <= remaining) {
    guide = explicitGuide
    remaining -= estimateTokens(guide)
  } else if (explicitGuide) {
    diagnostics.push('作者样稿说明超过风格材料上限，未注入。')
  }

  const sampleParts = splitCompleteParagraphs(cleanText(themeVoice.humanStyleSampleLock))
  sampleParts.forEach((sample, index) => {
    if (samples.length >= MAX_SAMPLES) {
      omittedSamples += 1
      return
    }
    const cost = estimateTokens(sample)
    if (cost <= remaining) {
      samples.push(sample)
      sampleSources.push(`ThemeVoice.humanStyleSampleLock#${index + 1}`)
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
    knownState: {
      chapterNum: typeof knownState.chapterNum === 'number' ? knownState.chapterNum : null,
      chapterTitle: cleanText(knownState.chapterTitle),
      knownFacts,
    },
    sourceKeys,
    diagnostics: [
      ...authorStyle.diagnostics,
      ...(!normalizedScene.purpose && !normalizedScene.conflict ? ['场景目标与冲突均缺失，保持空白，不补造动机或事实。'] : []),
    ],
  }
}

export function formatSceneWritingBrief(brief: SceneWritingBrief): string {
  const scene = brief.scene
  const sceneLines = [
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
    `风格材料估算：${brief.authorStyle.estimatedTokens}/600 tokens`,
  ].filter(Boolean)
  const knownLines = brief.knownState.knownFacts.length > 0
    ? `已知状态（仅用于边界，不新增事实）：${brief.knownState.knownFacts.join('；')}`
    : ''
  const diagnostics = brief.diagnostics.length > 0 ? `诊断：${brief.diagnostics.join('；')}` : ''
  return [
    '【场景写作材料】',
    ...sceneLines,
    ...styleLines,
    knownLines,
    diagnostics,
    `来源追踪：${brief.sourceKeys.join('、') || '无显式来源'}`,
    '规则：只使用以上显式材料；缺失项留空，不补造人物动机、经历、物件或关系。',
  ].filter(Boolean).join('\n')
}
