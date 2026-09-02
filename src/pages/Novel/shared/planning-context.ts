import type { Novel } from '../../../types'
import {
  buildWorldRulesSummary,
  parseWorldRulesJson,
} from '../../../shared/genre-system'
import {
  buildProjectBriefSummary,
  parseProjectBriefSnapshot,
} from '../../../shared/project-brief'
import {
  buildEndgameDesignSummary,
  buildPremiseSummary,
  buildStoryDesignSummary,
  buildWritingRulesSummary,
  parseStorySettingsSnapshot,
} from '../../../shared/story-settings'
import {
  buildThemeVoiceSummary,
  parseThemeVoiceSnapshot,
} from '../../../shared/theme-voice'
import type { DraftContextSection } from './ai-draft'

interface PlanningContextOptions {
  includeSubplots?: boolean
  includeWorldRules?: boolean
  extraSections?: DraftContextSection[]
}

export const PLANNING_CONTEXT_MAX_CHARS = 12000
const PLANNING_CONTEXT_MAX_SECTION_CHARS = 1800

function compactText(value?: string | null, max = 900): string {
  const text = value?.trim() || ''
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function compactContextValue(value: DraftContextSection['value']): string {
  if (Array.isArray(value)) {
    return compactText(value.filter(Boolean).join('、'), PLANNING_CONTEXT_MAX_SECTION_CHARS)
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : ''
  }
  return compactText(value, PLANNING_CONTEXT_MAX_SECTION_CHARS)
}

function normalizeContextSections(sections: DraftContextSection[]): DraftContextSection[] {
  const result: DraftContextSection[] = []
  const seenLabels = new Set<string>()
  const seenValues = new Set<string>()
  let usedChars = 0

  sections.forEach((section) => {
    const label = section.label?.trim()
    if (!label) return

    const labelKey = label.replace(/\s+/g, '')
    if (seenLabels.has(labelKey)) return

    const value = compactContextValue(section.value)
    if (!value) {
      result.push({ label, value: '' })
      seenLabels.add(labelKey)
      return
    }

    const valueKey = value.replace(/\s+/g, '')
    if (valueKey.length >= 20 && seenValues.has(valueKey)) return

    const remaining = PLANNING_CONTEXT_MAX_CHARS - usedChars - label.length - 4
    if (remaining <= 0) return

    const boundedValue = value.length > remaining
      ? `${value.slice(0, Math.max(0, remaining - 3))}...`
      : value
    if (!boundedValue) return

    result.push({ label, value: boundedValue })
    seenLabels.add(labelKey)
    if (valueKey.length >= 20) seenValues.add(valueKey)
    usedChars += label.length + boundedValue.length + 4
  })

  return result
}

function appendContextSection(
  sections: DraftContextSection[],
  include: boolean,
  label: string,
  value: string,
): void {
  if (include) sections.push({ label, value })
}

export function buildPlanningContextSections(
  novel: Novel | null | undefined,
  options: PlanningContextOptions = {},
): DraftContextSection[] {
  const projectBrief = parseProjectBriefSnapshot(novel?.projectBriefJson)
  const storySettings = parseStorySettingsSnapshot(novel?.settingsJson)
  const themeVoice = parseThemeVoiceSnapshot(novel?.themeVoiceJson)
  const worldRules = parseWorldRulesJson(novel?.worldRulesJson, novel?.genreName)

  const sections: DraftContextSection[] = [
    { label: '书名', value: novel?.title || '' },
    { label: '题材', value: novel?.genreName || '' },
    { label: '一句话简介', value: novel?.synopsis || '' },
    { label: '扩展背景', value: compactText(novel?.expandedBackground || novel?.userBackground, 1000) },
  ]

  appendContextSection(sections, projectBrief.readyCount > 0, '项目立项', compactText(buildProjectBriefSummary(projectBrief), 900))
  appendContextSection(sections, storySettings.premiseReadyCount > 0, '基础设定', compactText(buildPremiseSummary(storySettings.premise), 900))
  appendContextSection(
    sections,
    storySettings.storyDesignReadyCount > 0 || storySettings.subPlotCount > 0,
    '故事设计',
    compactText(buildStoryDesignSummary(storySettings.storyDesign, {
      includeSubplots: options.includeSubplots,
    }), options.includeSubplots === false ? 900 : 1200),
  )
  appendContextSection(sections, themeVoice.readyCount > 0, '主题与文风', compactText(buildThemeVoiceSummary(themeVoice), 1000))

  const writingRulesSummary = buildWritingRulesSummary(storySettings.writingRules)
  appendContextSection(sections, Boolean(writingRulesSummary), '写作边界', compactText(writingRulesSummary, 800))
  appendContextSection(sections, options.includeWorldRules !== false && Boolean(novel?.worldRulesJson), '世界规则', compactText(buildWorldRulesSummary(worldRules), 1400))
  appendContextSection(sections, storySettings.endgameReadyCount > 0, '终局设计', compactText(buildEndgameDesignSummary(storySettings.endgameDesign), 900))

  return normalizeContextSections(sections.concat(options.extraSections || []))
}
