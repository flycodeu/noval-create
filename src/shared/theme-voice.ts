import {
  formatWritingContractTags,
  normalizeWritingContractTags,
} from './writing-contract'

export type ThemeVoicePov = 'first_person' | 'third_limited' | 'third_omniscient' | 'multi_pov'
export type ThemeVoiceTense = 'past' | 'present' | 'mixed'
export type ThemeVoiceProtagonistCount = 'single' | 'dual' | 'ensemble'
export type ThemeVoiceViewpointMode = 'fixed' | 'rotating' | 'free_switch'
export type ThemeVoiceParallelTimelines = 'none' | 'light' | 'heavy'
export type ThemeVoiceOpeningStyle = 'hook' | 'daily' | 'incident' | 'flashback'
export type ThemeVoiceFlashbackPolicy = 'forbidden' | 'limited' | 'allowed'

export interface ThemeVoiceDocument {
  writingContractTags: string[]
  theme: string
  themeChapterTest: string
  motifs: string
  emotionalCore: string
  pov: ThemeVoicePov | ''
  tense: ThemeVoiceTense | ''
  protagonistCount: ThemeVoiceProtagonistCount | ''
  viewpointMode: ThemeVoiceViewpointMode | ''
  parallelTimelines: ThemeVoiceParallelTimelines | ''
  openingStyle: ThemeVoiceOpeningStyle | ''
  flashbackPolicy: ThemeVoiceFlashbackPolicy | ''
  narratorDistance: string
  voiceKeywords: string
  styleRules: string
  dialogueRules: string
  descriptionRules: string
  forbiddenPhrases: string
  targetWorkSampleGuide: string
  humanStyleSampleLock: string
}

export interface ThemeVoiceSnapshot extends ThemeVoiceDocument {
  readyCount: number
}

const EMPTY_THEME_VOICE: ThemeVoiceDocument = {
  writingContractTags: [],
  theme: '',
  themeChapterTest: '',
  motifs: '',
  emotionalCore: '',
  pov: '',
  tense: '',
  protagonistCount: '',
  viewpointMode: '',
  parallelTimelines: '',
  openingStyle: '',
  flashbackPolicy: '',
  narratorDistance: '',
  voiceKeywords: '',
  styleRules: '',
  dialogueRules: '',
  descriptionRules: '',
  forbiddenPhrases: '',
  targetWorkSampleGuide: '',
  humanStyleSampleLock: '',
}

const POV_LABELS: Record<ThemeVoicePov, string> = {
  first_person: '第一人称',
  third_limited: '第三人称限知',
  third_omniscient: '第三人称全知',
  multi_pov: '多视角',
}

const TENSE_LABELS: Record<ThemeVoiceTense, string> = {
  past: '过去时',
  present: '现在时',
  mixed: '混合时态',
}

const PROTAGONIST_COUNT_LABELS: Record<ThemeVoiceProtagonistCount, string> = {
  single: '单主角',
  dual: '双主角',
  ensemble: '群像',
}

const VIEWPOINT_MODE_LABELS: Record<ThemeVoiceViewpointMode, string> = {
  fixed: '固定视角',
  rotating: '轮换视角',
  free_switch: '自由切换',
}

const PARALLEL_TIMELINES_LABELS: Record<ThemeVoiceParallelTimelines, string> = {
  none: '单线推进',
  light: '轻度多线',
  heavy: '重度多线',
}

const OPENING_STYLE_LABELS: Record<ThemeVoiceOpeningStyle, string> = {
  hook: '钩子型开篇',
  daily: '日常切入',
  incident: '事件切入',
  flashback: '倒叙开场',
}

const FLASHBACK_POLICY_LABELS: Record<ThemeVoiceFlashbackPolicy, string> = {
  forbidden: '禁止插叙/倒叙',
  limited: '有限使用',
  allowed: '允许使用',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonObject(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}

  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return {}
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

export function parseThemeVoiceDocument(raw?: string | null): ThemeVoiceDocument {
  const root = parseJsonObject(raw)

  return {
    writingContractTags: normalizeWritingContractTags(root.writing_contract_tags ?? root.writingContractTags),
    theme: asText(root.theme),
    themeChapterTest: asText(root.theme_chapter_test ?? root.themeChapterTest),
    motifs: asText(root.motifs),
    emotionalCore: asText(root.emotional_core ?? root.emotionalCore),
    pov: asText(root.pov) as ThemeVoicePov | '',
    tense: asText(root.tense) as ThemeVoiceTense | '',
    protagonistCount: asText(root.protagonist_count ?? root.protagonistCount) as ThemeVoiceProtagonistCount | '',
    viewpointMode: asText(root.viewpoint_mode ?? root.viewpointMode) as ThemeVoiceViewpointMode | '',
    parallelTimelines: asText(root.parallel_timelines ?? root.parallelTimelines) as ThemeVoiceParallelTimelines | '',
    openingStyle: asText(root.opening_style ?? root.openingStyle) as ThemeVoiceOpeningStyle | '',
    flashbackPolicy: asText(root.flashback_policy ?? root.flashbackPolicy) as ThemeVoiceFlashbackPolicy | '',
    narratorDistance: asText(root.narrator_distance ?? root.narratorDistance),
    voiceKeywords: asText(root.voice_keywords ?? root.voiceKeywords),
    styleRules: asText(root.style_rules ?? root.styleRules),
    dialogueRules: asText(root.dialogue_rules ?? root.dialogueRules),
    descriptionRules: asText(root.description_rules ?? root.descriptionRules),
    forbiddenPhrases: asText(root.forbidden_phrases ?? root.forbiddenPhrases),
    targetWorkSampleGuide: asText(root.target_work_sample_guide ?? root.targetWorkSampleGuide),
    humanStyleSampleLock: asText(root.human_style_sample_lock ?? root.humanStyleSampleLock),
  }
}

export function parseThemeVoiceSnapshot(raw?: string | null): ThemeVoiceSnapshot {
  const document = parseThemeVoiceDocument(raw)
  const readyCount = [
    document.theme,
    document.emotionalCore,
    document.pov,
    document.tense,
    document.styleRules,
    document.dialogueRules,
  ].filter(Boolean).length

  return {
    ...EMPTY_THEME_VOICE,
    ...document,
    readyCount,
  }
}

export function buildThemeVoicePayload(
  patch: Partial<ThemeVoiceDocument>,
  existingRaw?: string | null,
): string {
  const current = parseThemeVoiceDocument(existingRaw)
  const next = {
    ...current,
    ...patch,
    writingContractTags: normalizeWritingContractTags(patch.writingContractTags ?? current.writingContractTags),
  }

  return JSON.stringify(compactObject({
    writing_contract_tags: next.writingContractTags.length > 0 ? next.writingContractTags : undefined,
    theme: next.theme,
    theme_chapter_test: next.themeChapterTest,
    motifs: next.motifs,
    emotional_core: next.emotionalCore,
    pov: next.pov,
    tense: next.tense,
    protagonist_count: next.protagonistCount,
    viewpoint_mode: next.viewpointMode,
    parallel_timelines: next.parallelTimelines,
    opening_style: next.openingStyle,
    flashback_policy: next.flashbackPolicy,
    narrator_distance: next.narratorDistance,
    voice_keywords: next.voiceKeywords,
    style_rules: next.styleRules,
    dialogue_rules: next.dialogueRules,
    description_rules: next.descriptionRules,
    forbidden_phrases: next.forbiddenPhrases,
    target_work_sample_guide: next.targetWorkSampleGuide,
    human_style_sample_lock: next.humanStyleSampleLock,
  }))
}

export function buildThemeVoiceSummary(themeVoice: ThemeVoiceDocument): string {
  return [
    themeVoice.writingContractTags.length > 0 ? `写作类型：${formatWritingContractTags(themeVoice.writingContractTags)}` : '',
    themeVoice.theme ? `主题：${themeVoice.theme}` : '',
    themeVoice.themeChapterTest ? `章节级主题验证：${themeVoice.themeChapterTest}` : '',
    themeVoice.motifs ? `母题：${themeVoice.motifs}` : '',
    themeVoice.emotionalCore ? `情感核心：${themeVoice.emotionalCore}` : '',
    themeVoice.pov ? `视角：${POV_LABELS[themeVoice.pov]}` : '',
    themeVoice.tense ? `时态：${TENSE_LABELS[themeVoice.tense]}` : '',
    themeVoice.protagonistCount ? `主角格局：${PROTAGONIST_COUNT_LABELS[themeVoice.protagonistCount]}` : '',
    themeVoice.viewpointMode ? `视角调度：${VIEWPOINT_MODE_LABELS[themeVoice.viewpointMode]}` : '',
    themeVoice.parallelTimelines ? `叙事线：${PARALLEL_TIMELINES_LABELS[themeVoice.parallelTimelines]}` : '',
    themeVoice.openingStyle ? `开篇方式：${OPENING_STYLE_LABELS[themeVoice.openingStyle]}` : '',
    themeVoice.flashbackPolicy ? `插叙策略：${FLASHBACK_POLICY_LABELS[themeVoice.flashbackPolicy]}` : '',
    themeVoice.narratorDistance ? `叙述距离：${themeVoice.narratorDistance}` : '',
    themeVoice.voiceKeywords ? `口吻关键词：${themeVoice.voiceKeywords}` : '',
    themeVoice.styleRules ? `风格规则：${themeVoice.styleRules}` : '',
    themeVoice.dialogueRules ? `对白规则：${themeVoice.dialogueRules}` : '',
    themeVoice.descriptionRules ? `描写规则：${themeVoice.descriptionRules}` : '',
    themeVoice.forbiddenPhrases ? `禁用表达：${themeVoice.forbiddenPhrases}` : '',
    themeVoice.targetWorkSampleGuide ? `真实样章对照：${themeVoice.targetWorkSampleGuide}` : '',
    themeVoice.humanStyleSampleLock ? `人工风格样本锁定：${themeVoice.humanStyleSampleLock}` : '',
  ].filter(Boolean).join('\n')
}
