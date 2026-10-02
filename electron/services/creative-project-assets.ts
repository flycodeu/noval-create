import { eq } from 'drizzle-orm'
import { validateJsonSchema, type AgentToolJsonSchema as Schema } from '../../src/shared/tool-contracts'
import { buildStorySettingsPayload } from '../../src/shared/story-settings'
import { buildProjectBriefPayload } from '../../src/shared/project-brief'
import { buildThemeVoicePayload } from '../../src/shared/theme-voice'
import { getDb } from '../database/db'
import { novels } from '../database/schema'
import { getNovel } from './novel.service'
import { markNovelContextChanged } from './context-impact.service'
import { CREATIVE_FACT_PLANS_SCHEMA, applyCreativeFactPlans } from './creative-facts'

const string: Schema = { type: 'string', minLength: 1, maxLength: 12000 }
const strings: Schema = { type: 'array', items: string, maxItems: 100 }
const integer: Schema = { type: 'integer', minimum: 1 }
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required, additionalProperties: false })
const textFields = (...keys: string[]) => Object.fromEntries(keys.map(key => [key, string]))
const array = (properties: Record<string, Schema>, required: string[]): Schema => ({ type: 'array', maxItems: 100, items: object(properties, required) })
const worldRulesSchema = object({
  genreProfile: object({ ...textFields('name', 'subgenre', 'worldviewTone', 'socialFrame'), narrativeFocus: strings, languageAvoidances: strings }),
  powerSystems: array({ ...textFields('id', 'name', 'advancementRule', 'limitations', 'cost', 'taboo'), appliesTo: strings, levels: strings }, ['id', 'name']),
  speciesSystem: array({ ...textFields('id', 'name', 'entityType', 'summary', 'relationToHumans', 'storyUse'), traits: strings, commonIdentities: strings }, ['id', 'name']),
  factionSystem: array({ ...textFields('id', 'name', 'factionType', 'summary', 'structure', 'resources', 'externalRelations', 'recruitFrom'), notableSites: strings }, ['id', 'name']),
  characterEcology: object({ overview: string, slots: array({ ...textFields('id', 'label', 'entityType', 'species', 'narrativeFunction', 'contextLink'), preferredFactions: strings, powerBias: strings }, ['id', 'label']) }),
  mapBlueprint: object({ overview: string, levels: array({ depth: integer, ...textFields('label', 'relationHint'), nodeTypes: strings, examples: strings, suggestedCount: integer }, ['depth', 'label']) }),
  worldDynamics: object({ overview: string,
    climateCycles: array(textFields('id', 'region', 'pattern', 'seasonalShift', 'hazardTrigger', 'travelImpact', 'resourceImpact'), ['id', 'region']),
    economyLoops: array(textFields('id', 'name', 'coreResource', 'circulationPath', 'controller', 'scarcityTrigger', 'volatilityTrigger', 'storyUse'), ['id', 'name']),
  }),
  timelineConfig: object({ ...textFields('eraName', 'epochLabel', 'baseYearLabel', 'displayPattern', 'relativeZeroLabel'), calendarType: { enum: ['gregorian', 'regnal', 'relative-disaster', 'custom-era', 'future-date'] }, recommendedEventTypes: strings, precisionOptions: strings }),
  writingConstraints: object({
    ...textFields('narrationStyle', 'dialogueStyle', 'sciencePolicy', 'physicsPolicy'),
    antiQuoteEmphasis: { type: 'boolean' }, antiConceptSlogans: { type: 'boolean' }, antiSymmetricLines: { type: 'boolean' },
    realismLevel: { enum: ['strict-realism', 'rule-realism', 'stylized-fantasy'] },
    forbiddenPhrases: strings, extraRules: strings, commonSenseFocus: strings, contextAlignmentFocus: strings,
  }),
})
const storySchema = object({
  facts: CREATIVE_FACT_PLANS_SCHEMA,
  projectBrief: object({ platformMode: { enum: ['web_serial', 'publishing', 'general', 'fanqie', 'feilu'] }, ...textFields('targetAudience', 'targetReader', 'readerPromise', 'sellingPoints', 'compTitles', 'tabooRules', 'deliveryRhythm') }),
  writingRules: object(textFields('antiAiFlavor', 'commonSenseRules', 'bannedTerms')),
  premise: object(textFields('positioning', 'coreHook', 'protagonistStart', 'constraints', 'languageGuardrails')),
  storyDesign: object({ ...textFields('storyGoal', 'coreConflict', 'mainPlot', 'subPlotsText', 'ending'),
    subPlotsList: array(textFields('name', 'characters', 'conflict', 'mainlineLink', 'endChapter'), ['name', 'conflict', 'mainlineLink']),
    rhythmSetup: { type: 'number', minimum: 0, maximum: 100 }, rhythmConflict: { type: 'number', minimum: 0, maximum: 100 }, rhythmEnding: { type: 'number', minimum: 0, maximum: 100 },
    endingType: { enum: ['HE', 'BE', 'open', 'multi', 'HE_BE'] },
  }),
  endgameDesign: object({ ...textFields('finalConflict', 'themeAnswer', 'mustDeliverPromises', 'payoffChecklist', 'deliberateUnknowns', 'finalImage', 'lastScene'), endingMode: { enum: ['victory', 'hard_won', 'costly_victory', 'tragic', 'ironic', 'open', 'multi_line'] } }),
})
const themeVoiceSchema = object({
  ...textFields('theme', 'themeChapterTest', 'motifs', 'emotionalCore', 'narratorDistance', 'voiceKeywords', 'styleRules', 'dialogueRules', 'descriptionRules', 'forbiddenPhrases', 'targetWorkSampleGuide', 'humanStyleSampleLock'),
  writingContractTags: strings, pov: { enum: ['first_person', 'third_limited', 'third_omniscient', 'multi_pov'] },
  tense: { enum: ['past', 'present', 'mixed'] }, protagonistCount: { enum: ['single', 'dual', 'ensemble'] },
  viewpointMode: { enum: ['fixed', 'rotating', 'free_switch'] }, parallelTimelines: { enum: ['none', 'light', 'heavy'] },
  openingStyle: { enum: ['hook', 'daily', 'incident', 'flashback'] }, flashbackPolicy: { enum: ['forbidden', 'limited', 'allowed'] },
})
export const PROJECT_STAGE_SCHEMAS = {
  world_rules: object({ worldRules: worldRulesSchema }, ['worldRules']),
  story: storySchema,
  style: object({ themeVoice: themeVoiceSchema }, ['themeVoice']),
} as const
export type ProjectAssetStage = keyof typeof PROJECT_STAGE_SCHEMAS
export function isProjectAssetStage(stage: string): stage is ProjectAssetStage { return Object.hasOwn(PROJECT_STAGE_SCHEMAS, stage) }
export function validateProjectAsset(stage: ProjectAssetStage, data: unknown): void {
  const result = validateJsonSchema(data, PROJECT_STAGE_SCHEMAS[stage])
  if (!result.valid) throw new Error(`阶段输出结构错误：${result.issues.join('；')}`)
  const containsValue = (value: unknown): boolean => value !== null && typeof value === 'object'
    ? Object.values(value).some(containsValue) : typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' && Boolean(value.trim())
  if (!containsValue(data)) throw new Error('阶段输出没有实际变更。')
}
function json(raw: string | null | undefined): Record<string, unknown> { try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} } }

/** Model output is an additive patch: absent keys and unknown stored fields remain untouched. */
export function mergeCreativeAssetPatch(current: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) {
    const previous = Array.isArray(current) ? [...current] : []
    for (const value of patch) {
      if (value && typeof value === 'object') {
        const key = 'id' in value ? 'id' : 'depth' in value ? 'depth' : 'name'
        const index = previous.findIndex(item => item && typeof item === 'object' && item[key] === value[key])
        if (index >= 0) previous[index] = mergeCreativeAssetPatch(previous[index], value)
        else previous.push(value)
      } else if (!previous.includes(value)) previous.push(value)
    }
    return previous
  }
  if (patch && typeof patch === 'object') {
    const output = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } as Record<string, unknown> : {}
    for (const [key, value] of Object.entries(patch)) output[key] = mergeCreativeAssetPatch(output[key], value)
    return output
  }
  return patch
}

export function applyCreativeProjectAsset(novelId: number, stage: ProjectAssetStage, data: Record<string, unknown>, sourceArtifactId: string): Record<string, unknown> {
  validateProjectAsset(stage, data)
  const novel = getNovel(novelId)
  if (!novel) throw new Error('项目不存在。')
  let result: Record<string, unknown> = {}
  if (stage === 'world_rules') {
    const merged = mergeCreativeAssetPatch(json(novel.worldRulesJson), data.worldRules)
    getDb().update(novels).set({ worldRulesJson: JSON.stringify(merged) }).where(eq(novels.id, novelId)).run()
  } else if (stage === 'story') {
    // The established serializer owns legacy aliases; preserve unknown nested fields too.
    const current = json(novel.settingsJson)
    const normalized = buildStorySettingsPayload(data, novel.settingsJson)
    const sections = { premise: 'premise', storyDesign: 'story_design', endgameDesign: 'endgame_design', writingRules: 'writing_rules' } as const
    const patch: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(sections)) if (data[key]) {
      patch[field] = normalized[field]
    }
    getDb().update(novels).set({ settingsJson: JSON.stringify(mergeCreativeAssetPatch(current, patch)) }).where(eq(novels.id, novelId)).run()
    if (data.projectBrief) {
      const brief = json(buildProjectBriefPayload(data.projectBrief as Parameters<typeof buildProjectBriefPayload>[0], novel.projectBriefJson))
      getDb().update(novels).set({ projectBriefJson: JSON.stringify(mergeCreativeAssetPatch(json(novel.projectBriefJson), brief)) }).where(eq(novels.id, novelId)).run()
    }
    if (data.facts) result = applyCreativeFactPlans(novelId, data.facts, sourceArtifactId)
  } else {
    const current = json(novel.themeVoiceJson)
    const normalized = json(buildThemeVoicePayload(data.themeVoice as Parameters<typeof buildThemeVoicePayload>[0], novel.themeVoiceJson))
    getDb().update(novels).set({ themeVoiceJson: JSON.stringify(mergeCreativeAssetPatch(current, normalized)) }).where(eq(novels.id, novelId)).run()
  }
  markNovelContextChanged(novelId, stage === 'world_rules' ? 'World rules changed' : stage === 'story' ? 'Story design changed' : 'Theme voice changed')
  return result
}
