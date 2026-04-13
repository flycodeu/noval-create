import type { SubPlotDraft } from './subplot-framework'

export type StoryEndingType = 'HE' | 'BE' | 'open' | 'multi' | 'HE_BE'
export type StoryEndgameMode =
  | 'victory'
  | 'hard_won'
  | 'costly_victory'
  | 'tragic'
  | 'ironic'
  | 'open'
  | 'multi_line'

export interface StoryPremiseSettings {
  positioning: string
  coreHook: string
  protagonistStart: string
  constraints: string
  languageGuardrails: string
}

export interface StoryDesignSettings {
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlotsText: string
  subPlotsList: SubPlotDraft[]
  rhythmSetup?: number
  rhythmConflict?: number
  rhythmEnding?: number
  endingType?: StoryEndingType
  ending: string
}

export interface StoryEndgameDesignSettings {
  endingMode?: StoryEndgameMode
  finalConflict: string
  themeAnswer: string
  mustDeliverPromises: string
  payoffChecklist: string
  deliberateUnknowns: string
  finalImage: string
  lastScene: string
}

export interface StoryWritingRulesSettings {
  antiAiFlavor: string
  commonSenseRules: string
  bannedTerms: string
}

export interface StorySettingsDocument {
  premise: StoryPremiseSettings
  storyDesign: StoryDesignSettings
  endgameDesign: StoryEndgameDesignSettings
  writingRules: StoryWritingRulesSettings
}

export interface StorySettingsSnapshot extends StorySettingsDocument {
  storyGoal: string
  coreConflict: string
  mainPlot: string
  ending: string
  subPlotCount: number
  premiseReadyCount: number
  storyDesignReadyCount: number
  endgameReadyCount: number
  endgameSummary: string
}

const EMPTY_PREMISE: StoryPremiseSettings = {
  positioning: '',
  coreHook: '',
  protagonistStart: '',
  constraints: '',
  languageGuardrails: '',
}

const EMPTY_STORY_DESIGN: StoryDesignSettings = {
  storyGoal: '',
  coreConflict: '',
  mainPlot: '',
  subPlotsText: '',
  subPlotsList: [],
  rhythmSetup: undefined,
  rhythmConflict: undefined,
  rhythmEnding: undefined,
  endingType: undefined,
  ending: '',
}

const EMPTY_ENDGAME_DESIGN: StoryEndgameDesignSettings = {
  endingMode: undefined,
  finalConflict: '',
  themeAnswer: '',
  mustDeliverPromises: '',
  payoffChecklist: '',
  deliberateUnknowns: '',
  finalImage: '',
  lastScene: '',
}

const EMPTY_WRITING_RULES: StoryWritingRulesSettings = {
  antiAiFlavor: '',
  commonSenseRules: '',
  bannedTerms: '',
}

function parseJsonObject(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asLooseText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value)
  return undefined
}

function asEndingType(value: unknown): StoryEndingType | undefined {
  return value === 'HE' || value === 'BE' || value === 'open' || value === 'multi' || value === 'HE_BE'
    ? value
    : undefined
}

function asEndgameMode(value: unknown): StoryEndgameMode | undefined {
  return value === 'victory'
    || value === 'hard_won'
    || value === 'costly_victory'
    || value === 'tragic'
    || value === 'ironic'
    || value === 'open'
    || value === 'multi_line'
    ? value
    : undefined
}

function parseSubPlots(value: unknown): SubPlotDraft[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        name: asText(record.name),
        characters: asText(record.characters),
        conflict: asText(record.conflict),
        mainlineLink: asText(record.mainlineLink),
        endChapter: asLooseText(record.endChapter),
      }
    })
    .filter((subplot) => Object.values(subplot).some(Boolean))
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T
}

function cleanPatch<T extends Record<string, unknown>>(patch?: Partial<T>): Partial<T> {
  if (!patch) return {}
  return compactObject(patch as Record<string, unknown>) as Partial<T>
}

export function parseStorySettingsDocument(raw?: string | null): StorySettingsDocument {
  const root = parseJsonObject(raw)
  const premise = asRecord(root.premise)
  const storyDesign = asRecord(root.story_design)
  const endgameDesign = asRecord(root.endgame_design)
  const writingRules = asRecord(root.writing_rules)

  const nextPremise: StoryPremiseSettings = {
    positioning: asText(premise.positioning ?? root.premise_positioning),
    coreHook: asText(premise.core_hook ?? root.premise_core_hook ?? root.core_hook),
    protagonistStart: asText(premise.protagonist_start ?? root.protagonist_start ?? root.protagonist_baseline),
    constraints: asText(premise.constraints ?? root.premise_constraints ?? root.core_constraints),
    languageGuardrails: asText(
      premise.language_guardrails
      ?? root.language_guardrails
      ?? root.writing_constraints
      ?? root.common_sense_rules,
    ),
  }

  const nextStoryDesign: StoryDesignSettings = {
    storyGoal: asText(storyDesign.story_goal ?? root.story_goal),
    coreConflict: asText(storyDesign.core_conflict ?? root.core_conflict),
    mainPlot: asText(storyDesign.main_plot ?? root.main_plot),
    subPlotsText: asText(storyDesign.sub_plots ?? root.sub_plots),
    subPlotsList: parseSubPlots(storyDesign.sub_plots_list ?? root.sub_plots_list),
    rhythmSetup: asNumber(storyDesign.rhythm_setup ?? root.rhythm_setup),
    rhythmConflict: asNumber(storyDesign.rhythm_conflict ?? root.rhythm_conflict),
    rhythmEnding: asNumber(storyDesign.rhythm_ending ?? root.rhythm_ending),
    endingType: asEndingType(asText(storyDesign.ending_type ?? root.ending_type)),
    ending: asText(storyDesign.ending ?? root.ending),
  }

  const nextEndgameDesign: StoryEndgameDesignSettings = {
    endingMode: asEndgameMode(asText(endgameDesign.ending_mode ?? root.endgame_ending_mode)),
    finalConflict: asText(endgameDesign.final_conflict ?? root.endgame_final_conflict),
    themeAnswer: asText(endgameDesign.theme_answer ?? root.endgame_theme_answer),
    mustDeliverPromises: asText(endgameDesign.must_deliver_promises ?? root.endgame_must_deliver_promises),
    payoffChecklist: asText(endgameDesign.payoff_checklist ?? root.endgame_payoff_checklist),
    deliberateUnknowns: asText(endgameDesign.deliberate_unknowns ?? root.endgame_deliberate_unknowns),
    finalImage: asText(endgameDesign.final_image ?? root.endgame_final_image),
    lastScene: asText(endgameDesign.last_scene ?? root.endgame_last_scene),
  }

  const nextWritingRules: StoryWritingRulesSettings = {
    antiAiFlavor: asText(writingRules.anti_ai_flavor ?? root.anti_ai_flavor),
    commonSenseRules: asText(writingRules.common_sense_rules ?? root.common_sense_rules ?? nextPremise.languageGuardrails),
    bannedTerms: asText(writingRules.banned_terms ?? root.banned_terms),
  }

  if (!nextPremise.positioning && nextStoryDesign.storyGoal) {
    nextPremise.positioning = nextStoryDesign.storyGoal
  }
  if (!nextPremise.constraints && nextStoryDesign.coreConflict) {
    nextPremise.constraints = nextStoryDesign.coreConflict
  }

  return {
    premise: { ...EMPTY_PREMISE, ...nextPremise },
    storyDesign: { ...EMPTY_STORY_DESIGN, ...nextStoryDesign },
    endgameDesign: { ...EMPTY_ENDGAME_DESIGN, ...nextEndgameDesign },
    writingRules: { ...EMPTY_WRITING_RULES, ...nextWritingRules },
  }
}

export function parseStorySettingsSnapshot(raw?: string | null): StorySettingsSnapshot {
  const document = parseStorySettingsDocument(raw)
  const premiseReadyCount = [
    document.premise.positioning,
    document.premise.coreHook,
    document.premise.protagonistStart,
    document.premise.constraints,
    document.premise.languageGuardrails,
  ].filter(Boolean).length
  const storyDesignReadyCount = [
    document.storyDesign.storyGoal,
    document.storyDesign.coreConflict,
    document.storyDesign.mainPlot,
    document.storyDesign.ending,
  ].filter(Boolean).length
  const endgameReadyCount = [
    document.endgameDesign.endingMode,
    document.endgameDesign.finalConflict,
    document.endgameDesign.themeAnswer,
    document.endgameDesign.mustDeliverPromises,
    document.endgameDesign.payoffChecklist,
    document.endgameDesign.deliberateUnknowns,
    document.endgameDesign.finalImage,
    document.endgameDesign.lastScene,
  ].filter(Boolean).length

  return {
    ...document,
    storyGoal: document.storyDesign.storyGoal,
    coreConflict: document.storyDesign.coreConflict,
    mainPlot: document.storyDesign.mainPlot,
    ending: document.storyDesign.ending,
    subPlotCount: document.storyDesign.subPlotsList.length,
    premiseReadyCount,
    storyDesignReadyCount,
    endgameReadyCount,
    endgameSummary: buildEndgameDesignSummary(document.endgameDesign),
  }
}

export function buildStorySettingsPayload(
  patch: {
    premise?: Partial<StoryPremiseSettings>
    storyDesign?: Partial<StoryDesignSettings>
    endgameDesign?: Partial<StoryEndgameDesignSettings>
    writingRules?: Partial<StoryWritingRulesSettings>
  },
  existingRaw?: string | null,
): Record<string, unknown> {
  const legacyRoot = parseJsonObject(existingRaw)
  const current = parseStorySettingsDocument(existingRaw)
  const premise = { ...current.premise, ...cleanPatch(patch.premise) }
  const storyDesign = { ...current.storyDesign, ...cleanPatch(patch.storyDesign) }
  const endgameDesign = { ...current.endgameDesign, ...cleanPatch(patch.endgameDesign) }
  const writingRules = { ...current.writingRules, ...cleanPatch(patch.writingRules) }

  const payload: Record<string, unknown> = {
    ...legacyRoot,
    premise: compactObject({
      positioning: premise.positioning,
      core_hook: premise.coreHook,
      protagonist_start: premise.protagonistStart,
      constraints: premise.constraints,
      language_guardrails: premise.languageGuardrails,
    }),
    story_design: compactObject({
      story_goal: storyDesign.storyGoal,
      core_conflict: storyDesign.coreConflict,
      main_plot: storyDesign.mainPlot,
      sub_plots: storyDesign.subPlotsText,
      sub_plots_list: storyDesign.subPlotsList,
      rhythm_setup: storyDesign.rhythmSetup,
      rhythm_conflict: storyDesign.rhythmConflict,
      rhythm_ending: storyDesign.rhythmEnding,
      ending_type: storyDesign.endingType,
      ending: storyDesign.ending,
    }),
    endgame_design: compactObject({
      ending_mode: endgameDesign.endingMode,
      final_conflict: endgameDesign.finalConflict,
      theme_answer: endgameDesign.themeAnswer,
      must_deliver_promises: endgameDesign.mustDeliverPromises,
      payoff_checklist: endgameDesign.payoffChecklist,
      deliberate_unknowns: endgameDesign.deliberateUnknowns,
      final_image: endgameDesign.finalImage,
      last_scene: endgameDesign.lastScene,
    }),
    writing_rules: compactObject({
      anti_ai_flavor: writingRules.antiAiFlavor,
      common_sense_rules: writingRules.commonSenseRules,
      banned_terms: writingRules.bannedTerms,
    }),
    premise_positioning: premise.positioning,
    premise_core_hook: premise.coreHook,
    protagonist_start: premise.protagonistStart,
    premise_constraints: premise.constraints,
    language_guardrails: premise.languageGuardrails,
    anti_ai_flavor: writingRules.antiAiFlavor,
    common_sense_rules: writingRules.commonSenseRules,
    banned_terms: writingRules.bannedTerms,
    story_goal: storyDesign.storyGoal,
    core_conflict: storyDesign.coreConflict,
    main_plot: storyDesign.mainPlot,
    sub_plots: storyDesign.subPlotsText,
    sub_plots_list: storyDesign.subPlotsList,
    rhythm_setup: storyDesign.rhythmSetup,
    rhythm_conflict: storyDesign.rhythmConflict,
    rhythm_ending: storyDesign.rhythmEnding,
    ending_type: storyDesign.endingType,
    ending: storyDesign.ending,
    endgame_ending_mode: endgameDesign.endingMode,
    endgame_final_conflict: endgameDesign.finalConflict,
    endgame_theme_answer: endgameDesign.themeAnswer,
    endgame_must_deliver_promises: endgameDesign.mustDeliverPromises,
    endgame_payoff_checklist: endgameDesign.payoffChecklist,
    endgame_deliberate_unknowns: endgameDesign.deliberateUnknowns,
    endgame_final_image: endgameDesign.finalImage,
    endgame_last_scene: endgameDesign.lastScene,
  }

  return compactObject(payload)
}

export function buildPremiseSummary(premise: StoryPremiseSettings): string {
  return [
    premise.positioning ? `故事定位：${premise.positioning}` : '',
    premise.coreHook ? `核心钩子：${premise.coreHook}` : '',
    premise.protagonistStart ? `主角起点：${premise.protagonistStart}` : '',
    premise.constraints ? `关键限制：${premise.constraints}` : '',
    premise.languageGuardrails ? `语言约束：${premise.languageGuardrails}` : '',
  ].filter(Boolean).join('\n')
}

export function buildStoryDesignSummary(
  storyDesign: StoryDesignSettings,
  options: { includeSubplots?: boolean } = {},
): string {
  const lines = [
    storyDesign.storyGoal ? `故事目标：${storyDesign.storyGoal}` : '',
    storyDesign.coreConflict ? `核心冲突：${storyDesign.coreConflict}` : '',
    storyDesign.mainPlot ? `主线剧情：${storyDesign.mainPlot}` : '',
    storyDesign.ending ? `结局设计：${storyDesign.ending}` : '',
  ]

  if (options.includeSubplots !== false) {
    const subplotSummary = storyDesign.subPlotsList.length > 0
      ? storyDesign.subPlotsList
        .slice(0, 6)
        .map((subplot, index) => `${index + 1}. ${[subplot.name, subplot.conflict, subplot.mainlineLink].filter(Boolean).join(' / ')}`)
        .join('\n')
      : storyDesign.subPlotsText
    lines.push(subplotSummary ? `支线设计：${subplotSummary}` : '')
  }

  return lines.filter(Boolean).join('\n')
}

export function buildEndgameDesignSummary(endgameDesign: StoryEndgameDesignSettings): string {
  const endingModeLabel = endgameDesign.endingMode
    ? ({
      victory: '胜利式收束',
      hard_won: '苦胜式收束',
      costly_victory: '代价式胜利',
      tragic: '悲剧式收束',
      ironic: '反讽式收束',
      open: '开放式收束',
      multi_line: '多线并收',
    } satisfies Record<StoryEndgameMode, string>)[endgameDesign.endingMode]
    : ''

  return [
    endingModeLabel ? `终局类型：${endingModeLabel}` : '',
    endgameDesign.finalConflict ? `最终冲突：${endgameDesign.finalConflict}` : '',
    endgameDesign.themeAnswer ? `主题答案：${endgameDesign.themeAnswer}` : '',
    endgameDesign.mustDeliverPromises ? `必须兑现的承诺：${endgameDesign.mustDeliverPromises}` : '',
    endgameDesign.payoffChecklist ? `长线回收清单：${endgameDesign.payoffChecklist}` : '',
    endgameDesign.deliberateUnknowns ? `故意保留的未解释项：${endgameDesign.deliberateUnknowns}` : '',
    endgameDesign.finalImage ? `终章意象：${endgameDesign.finalImage}` : '',
    endgameDesign.lastScene ? `最后一幕：${endgameDesign.lastScene}` : '',
  ].filter(Boolean).join('\n')
}

export function buildWritingRulesSummary(writingRules: StoryWritingRulesSettings): string {
  return [
    writingRules.antiAiFlavor ? `反 AI 味：${writingRules.antiAiFlavor}` : '',
    writingRules.commonSenseRules ? `常识约束：${writingRules.commonSenseRules}` : '',
    writingRules.bannedTerms ? `禁用表达：${writingRules.bannedTerms}` : '',
  ].filter(Boolean).join('\n')
}
