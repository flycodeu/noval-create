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

function compactText(value?: string | null, max = 900): string {
  const text = value?.trim() || ''
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}...` : text
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

  if (projectBrief.readyCount > 0) {
    sections.push({
      label: '项目立项',
      value: compactText(buildProjectBriefSummary(projectBrief), 900),
    })
  }

  if (storySettings.premiseReadyCount > 0) {
    sections.push({
      label: '基础设定',
      value: compactText(buildPremiseSummary(storySettings.premise), 900),
    })
  }

  if (storySettings.storyDesignReadyCount > 0 || storySettings.subPlotCount > 0) {
    sections.push({
      label: '故事设计',
      value: compactText(buildStoryDesignSummary(storySettings.storyDesign, {
        includeSubplots: options.includeSubplots,
      }), options.includeSubplots === false ? 900 : 1200),
    })
  }

  if (themeVoice.readyCount > 0) {
    sections.push({
      label: '主题与文风',
      value: compactText(buildThemeVoiceSummary(themeVoice), 1000),
    })
  }

  const writingRulesSummary = buildWritingRulesSummary(storySettings.writingRules)
  if (writingRulesSummary) {
    sections.push({
      label: '写作边界',
      value: compactText(writingRulesSummary, 800),
    })
  }

  if (options.includeWorldRules !== false && novel?.worldRulesJson) {
    sections.push({
      label: '世界规则',
      value: compactText(buildWorldRulesSummary(worldRules), 1400),
    })
  }

  if (storySettings.endgameReadyCount > 0) {
    sections.push({
      label: '终局设计',
      value: compactText(buildEndgameDesignSummary(storySettings.endgameDesign), 900),
    })
  }

  return sections.concat(options.extraSections || [])
}
