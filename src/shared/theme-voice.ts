import {
  formatWritingContractTags,
  normalizeWritingContractTags,
} from './writing-contract'

export type ThemeVoicePov = 'first_person' | 'third_limited' | 'third_omniscient' | 'multi_pov'
export type ThemeVoiceTense = 'past' | 'present' | 'mixed'

export interface ThemeVoiceDocument {
  writingContractTags: string[]
  theme: string
  motifs: string
  emotionalCore: string
  pov: ThemeVoicePov | ''
  tense: ThemeVoiceTense | ''
  narratorDistance: string
  voiceKeywords: string
  styleRules: string
  dialogueRules: string
  descriptionRules: string
  forbiddenPhrases: string
}

export interface ThemeVoiceSnapshot extends ThemeVoiceDocument {
  readyCount: number
}

const EMPTY_THEME_VOICE: ThemeVoiceDocument = {
  writingContractTags: [],
  theme: '',
  motifs: '',
  emotionalCore: '',
  pov: '',
  tense: '',
  narratorDistance: '',
  voiceKeywords: '',
  styleRules: '',
  dialogueRules: '',
  descriptionRules: '',
  forbiddenPhrases: '',
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
    motifs: asText(root.motifs),
    emotionalCore: asText(root.emotional_core ?? root.emotionalCore),
    pov: asText(root.pov) as ThemeVoicePov | '',
    tense: asText(root.tense) as ThemeVoiceTense | '',
    narratorDistance: asText(root.narrator_distance ?? root.narratorDistance),
    voiceKeywords: asText(root.voice_keywords ?? root.voiceKeywords),
    styleRules: asText(root.style_rules ?? root.styleRules),
    dialogueRules: asText(root.dialogue_rules ?? root.dialogueRules),
    descriptionRules: asText(root.description_rules ?? root.descriptionRules),
    forbiddenPhrases: asText(root.forbidden_phrases ?? root.forbiddenPhrases),
  }
}

export function parseThemeVoiceSnapshot(raw?: string | null): ThemeVoiceSnapshot {
  const document = parseThemeVoiceDocument(raw)
  const readyCount = [
    document.writingContractTags.length > 0,
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
    motifs: next.motifs,
    emotional_core: next.emotionalCore,
    pov: next.pov,
    tense: next.tense,
    narrator_distance: next.narratorDistance,
    voice_keywords: next.voiceKeywords,
    style_rules: next.styleRules,
    dialogue_rules: next.dialogueRules,
    description_rules: next.descriptionRules,
    forbidden_phrases: next.forbiddenPhrases,
  }))
}

export function buildThemeVoiceSummary(themeVoice: ThemeVoiceDocument): string {
  return [
    themeVoice.writingContractTags.length > 0 ? `写作类型：${formatWritingContractTags(themeVoice.writingContractTags)}` : '',
    themeVoice.theme ? `主题：${themeVoice.theme}` : '',
    themeVoice.motifs ? `母题：${themeVoice.motifs}` : '',
    themeVoice.emotionalCore ? `情感核心：${themeVoice.emotionalCore}` : '',
    themeVoice.pov ? `视角：${POV_LABELS[themeVoice.pov]}` : '',
    themeVoice.tense ? `时态：${TENSE_LABELS[themeVoice.tense]}` : '',
    themeVoice.narratorDistance ? `叙述距离：${themeVoice.narratorDistance}` : '',
    themeVoice.voiceKeywords ? `口吻关键词：${themeVoice.voiceKeywords}` : '',
    themeVoice.styleRules ? `风格规则：${themeVoice.styleRules}` : '',
    themeVoice.dialogueRules ? `对白规则：${themeVoice.dialogueRules}` : '',
    themeVoice.descriptionRules ? `描写规则：${themeVoice.descriptionRules}` : '',
    themeVoice.forbiddenPhrases ? `禁用表达：${themeVoice.forbiddenPhrases}` : '',
  ].filter(Boolean).join('\n')
}