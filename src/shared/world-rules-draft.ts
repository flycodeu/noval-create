import {
  getBuiltinGenreRules,
  type FactionProfile,
  type GenreProfile,
  type GenreWorldRules,
  type MapBlueprintLevel,
  type PowerSystem,
  type RealismLevel,
  type SpeciesProfile,
  type TimelineCalendarType,
} from './genre-system'

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value)
  return fallback
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function createEmptyWorldRules(genreName?: string | null): GenreWorldRules {
  const builtin = getBuiltinGenreRules(genreName)
  return {
    version: 2,
    genreProfile: {
      key: builtin.genreProfile.key,
      name: '',
      subgenre: '',
      worldviewTone: '',
      socialFrame: '',
      narrativeFocus: [],
      languageAvoidances: [],
    },
    powerSystems: [],
    speciesSystem: [],
    factionSystem: [],
    characterEcology: {
      overview: '',
      slots: [],
    },
    mapBlueprint: {
      overview: '',
      levels: [],
    },
    timelineConfig: {
      calendarType: '' as TimelineCalendarType,
      eraName: '',
      epochLabel: '',
      baseYearLabel: '',
      displayPattern: '',
      relativeZeroLabel: '',
      recommendedEventTypes: [],
      precisionOptions: [],
    },
    writingConstraints: {
      antiQuoteEmphasis: false,
      antiConceptSlogans: false,
      antiSymmetricLines: false,
      narrationStyle: '',
      dialogueStyle: '',
      forbiddenPhrases: [],
      extraRules: [],
      realismLevel: 'rule-realism',
      sciencePolicy: '',
      physicsPolicy: '',
      commonSenseFocus: [],
      contextAlignmentFocus: [],
    },
  }
}

function normalizeGenreProfile(value: unknown, fallback: GenreProfile): GenreProfile {
  const record = asRecord(value)
  return {
    key: typeof record.key === 'string' ? record.key as GenreProfile['key'] : fallback.key,
    name: asText(record.name),
    subgenre: asText(record.subgenre),
    worldviewTone: asText(record.worldviewTone),
    socialFrame: asText(record.socialFrame),
    narrativeFocus: dedupe(toStringArray(record.narrativeFocus)),
    languageAvoidances: dedupe(toStringArray(record.languageAvoidances)),
  }
}

function normalizePowerSystems(value: unknown): PowerSystem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const record = asRecord(item)
      const name = asText(record.name)
      const appliesTo = dedupe(toStringArray(record.appliesTo))
      const levels = dedupe(toStringArray(record.levels))
      const advancementRule = asText(record.advancementRule)
      const limitations = asText(record.limitations)
      const cost = asText(record.cost)
      const taboo = asText(record.taboo)
      if (!name && appliesTo.length === 0 && levels.length === 0 && !advancementRule && !limitations && !cost && !taboo) return null
      return {
        id: asText(record.id) || `power-${index + 1}`,
        name,
        appliesTo,
        levels,
        advancementRule,
        limitations,
        cost,
        taboo,
      }
    })
    .filter((item): item is PowerSystem => Boolean(item))
}

function normalizeSpecies(value: unknown): SpeciesProfile[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const record = asRecord(item)
      const name = asText(record.name)
      const summary = asText(record.summary)
      const traits = dedupe(toStringArray(record.traits))
      const commonIdentities = dedupe(toStringArray(record.commonIdentities))
      const relationToHumans = asText(record.relationToHumans)
      const storyUse = asText(record.storyUse)
      if (!name && !summary && traits.length === 0 && commonIdentities.length === 0 && !relationToHumans && !storyUse) return null
      return {
        id: asText(record.id) || `species-${index + 1}`,
        name,
        entityType: asText(record.entityType) || 'human',
        summary,
        traits,
        commonIdentities,
        relationToHumans,
        storyUse,
      }
    })
    .filter((item): item is SpeciesProfile => Boolean(item))
}

function normalizeFactions(value: unknown): FactionProfile[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const record = asRecord(item)
      const name = asText(record.name)
      const summary = asText(record.summary)
      const structure = asText(record.structure)
      const resources = asText(record.resources)
      const externalRelations = asText(record.externalRelations)
      const recruitFrom = asText(record.recruitFrom)
      const notableSites = dedupe(toStringArray(record.notableSites))
      if (!name && !summary && !structure && !resources && !externalRelations && !recruitFrom && notableSites.length === 0) return null
      return {
        id: asText(record.id) || `faction-${index + 1}`,
        name,
        factionType: asText(record.factionType) || '',
        summary,
        structure,
        resources,
        externalRelations,
        recruitFrom,
        notableSites,
      }
    })
    .filter((item): item is FactionProfile => Boolean(item))
}

function normalizeMapLevels(value: unknown): MapBlueprintLevel[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      const record = asRecord(item)
      const label = asText(record.label)
      const nodeTypes = dedupe(toStringArray(record.nodeTypes))
      const relationHint = asText(record.relationHint)
      const examples = dedupe(toStringArray(record.examples))
      const suggestedCount = Math.max(1, asNumber(record.suggestedCount, 3))
      if (!label && nodeTypes.length === 0 && !relationHint && examples.length === 0) return null
      return {
        depth: Math.max(1, asNumber(record.depth, index + 1)),
        label,
        nodeTypes,
        relationHint,
        suggestedCount,
        examples,
      }
    })
    .filter((item): item is MapBlueprintLevel => Boolean(item))
}

export function normalizeWorldRulesDraft(raw: unknown, genreName?: string | null): GenreWorldRules {
  const base = createEmptyWorldRules(genreName)
  const record = asRecord(raw)
  const writing = asRecord(record.writingConstraints)
  const ecology = asRecord(record.characterEcology)
  const realismLevelText = asText(writing.realismLevel)
  const realismLevel = (['strict-realism', 'rule-realism', 'stylized-fantasy'] as RealismLevel[]).includes(realismLevelText as RealismLevel)
    ? realismLevelText as RealismLevel
    : base.writingConstraints.realismLevel

  return {
    version: 2,
    genreProfile: normalizeGenreProfile(record.genreProfile, base.genreProfile),
    powerSystems: normalizePowerSystems(record.powerSystems),
    speciesSystem: normalizeSpecies(record.speciesSystem),
    factionSystem: normalizeFactions(record.factionSystem),
    characterEcology: {
      overview: asText(ecology.overview),
      slots: Array.isArray(ecology.slots)
        ? ecology.slots.map((item: unknown, index: number) => {
            const slot = asRecord(item)
            const label = asText(slot.label)
            const entityType = asText(slot.entityType) || 'human'
            const species = asText(slot.species)
            const narrativeFunction = asText(slot.narrativeFunction)
            const contextLink = asText(slot.contextLink)
            const preferredFactions = dedupe(toStringArray(slot.preferredFactions))
            const powerBias = dedupe(toStringArray(slot.powerBias))
            if (!label && !species && !narrativeFunction && !contextLink && preferredFactions.length === 0 && powerBias.length === 0) return null
            return {
              id: asText(slot.id) || `ecology-${index + 1}`,
              label,
              entityType,
              species,
              narrativeFunction,
              contextLink,
              preferredFactions,
              powerBias,
            }
          }).filter(Boolean) as GenreWorldRules['characterEcology']['slots']
        : [],
    },
    mapBlueprint: {
      overview: asText(asRecord(record.mapBlueprint).overview),
      levels: normalizeMapLevels(asRecord(record.mapBlueprint).levels),
    },
    timelineConfig: {
      calendarType: (asText(asRecord(record.timelineConfig).calendarType) || base.timelineConfig.calendarType) as TimelineCalendarType,
      eraName: asText(asRecord(record.timelineConfig).eraName),
      epochLabel: asText(asRecord(record.timelineConfig).epochLabel),
      baseYearLabel: asText(asRecord(record.timelineConfig).baseYearLabel),
      displayPattern: asText(asRecord(record.timelineConfig).displayPattern),
      relativeZeroLabel: asText(asRecord(record.timelineConfig).relativeZeroLabel),
      recommendedEventTypes: dedupe(toStringArray(asRecord(record.timelineConfig).recommendedEventTypes)),
      precisionOptions: dedupe(toStringArray(asRecord(record.timelineConfig).precisionOptions)),
    },
    writingConstraints: {
      antiQuoteEmphasis: typeof writing.antiQuoteEmphasis === 'boolean' ? writing.antiQuoteEmphasis : base.writingConstraints.antiQuoteEmphasis,
      antiConceptSlogans: typeof writing.antiConceptSlogans === 'boolean' ? writing.antiConceptSlogans : base.writingConstraints.antiConceptSlogans,
      antiSymmetricLines: typeof writing.antiSymmetricLines === 'boolean' ? writing.antiSymmetricLines : base.writingConstraints.antiSymmetricLines,
      narrationStyle: asText(writing.narrationStyle),
      dialogueStyle: asText(writing.dialogueStyle),
      forbiddenPhrases: dedupe(toStringArray(writing.forbiddenPhrases)),
      extraRules: dedupe(toStringArray(writing.extraRules)),
      realismLevel,
      sciencePolicy: asText(writing.sciencePolicy),
      physicsPolicy: asText(writing.physicsPolicy),
      commonSenseFocus: dedupe(toStringArray(writing.commonSenseFocus)),
      contextAlignmentFocus: dedupe(toStringArray(writing.contextAlignmentFocus)),
    },
  }
}

export function parseWorldRulesDraftJson(raw?: string | null, genreName?: string | null): GenreWorldRules {
  if (!raw) return createEmptyWorldRules(genreName)
  try {
    return normalizeWorldRulesDraft(JSON.parse(raw) as unknown, genreName)
  } catch {
    return createEmptyWorldRules(genreName)
  }
}

export function stringifyWorldRulesDraft(rules: GenreWorldRules): string {
  return JSON.stringify(normalizeWorldRulesDraft(clone(rules), rules.genreProfile.name))
}


