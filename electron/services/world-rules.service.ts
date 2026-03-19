import type { WebContents } from 'electron'
import { eq } from 'drizzle-orm'
import type { GenreWorldRules } from '../../src/shared/genre-system'
import {
  buildCharacterEcologySummary,
  buildMapBlueprintSummary,
  buildTimelineConfigSummary,
  normalizeWorldRules,
} from '../../src/shared/genre-system'
import { buildHumanLanguageRules } from '../../src/shared/prompt-library'
import {
  WORLD_RULE_SECTION_DEFINITIONS,
  WORLD_RULE_SECTION_ORDER,
  type WorldRuleSectionKey,
  type WorldRulesGenerationProgressEvent,
  type WorldRulesGenerationRequest,
  type WorldRulesGenerationResult,
  type WorldRulesGenerationStepResult,
} from '../../src/shared/world-rules-generation'
import { cleanAiFieldText, cleanAiValue } from '../../src/utils/text'
import { getDb } from '../database/db'
import { novels } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { runChatTask } from './task.service'

const SECTION_LABELS = new Map(WORLD_RULE_SECTION_DEFINITIONS.map((item) => [item.key, item.label]))

function clean(value?: string | null): string {
  return value?.trim() || ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function joinLines(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n')
}

function section(title: string, content?: string | null): string {
  const body = clean(content)
  if (!body) return ''
  return `\u3010${title}\u3011\n${body}`
}

function renderPrompt(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function summarizeLanguageConstraints(rules: GenreWorldRules): string {
  const writing = rules.writingConstraints
  return joinLines([
    writing.antiQuoteEmphasis ? '\u907f\u514d\u5f15\u53f7\u5f3a\u8c03' : '',
    writing.antiConceptSlogans ? '\u907f\u514d\u6982\u5ff5\u53e3\u53f7' : '',
    writing.antiSymmetricLines ? '\u907f\u514d\u5bf9\u79f0\u6392\u6bd4' : '',
    writing.narrationStyle ? `\u53d9\u8ff0\u98ce\u683c\uff1a${writing.narrationStyle}` : '',
    writing.dialogueStyle ? `\u5bf9\u8bdd\u98ce\u683c\uff1a${writing.dialogueStyle}` : '',
    writing.forbiddenPhrases.length > 0 ? `\u7981\u7528 AI \u8154\uff1a${writing.forbiddenPhrases.join('\u3001')}` : '',
    writing.extraRules.length > 0 ? `\u989d\u5916\u89c4\u5219\uff1a${writing.extraRules.join('\u3001')}` : '',
  ])
}

function summarizeCurrentSection(sectionKey: WorldRuleSectionKey, rules: GenreWorldRules): string {
  switch (sectionKey) {
    case 'overview':
      return joinLines([
        `\u7c7b\u578b\u540d\u79f0\uff1a${rules.genreProfile.name || '\u672a\u8bbe\u7f6e'}`,
        rules.genreProfile.subgenre ? `\u5b50\u7c7b\u578b\uff1a${rules.genreProfile.subgenre}` : '',
        rules.genreProfile.worldviewTone ? `\u4e16\u754c\u89c2\u57fa\u8c03\uff1a${rules.genreProfile.worldviewTone}` : '',
        rules.genreProfile.socialFrame ? `\u793e\u4f1a\u6846\u67b6\uff1a${rules.genreProfile.socialFrame}` : '',
        rules.genreProfile.narrativeFocus.length > 0 ? `\u53d9\u4e8b\u7126\u70b9\uff1a${rules.genreProfile.narrativeFocus.join('\u3001')}` : '',
        rules.genreProfile.languageAvoidances.length > 0 ? `\u8bed\u8a00\u907f\u8ba9\uff1a${rules.genreProfile.languageAvoidances.join('\u3001')}` : '',
      ])
    case 'power':
      return rules.powerSystems
        .map((system, index) => joinLines([
          `${index + 1}. \u4f53\u7cfb\uff1a${system.name || '\u672a\u547d\u540d'}`,
          system.appliesTo.length > 0 ? `   \u9002\u7528\u5bf9\u8c61\uff1a${system.appliesTo.join('\u3001')}` : '',
          system.levels.length > 0 ? `   \u7b49\u7ea7\u9636\u6bb5\uff1a${system.levels.join(' / ')}` : '',
          system.advancementRule ? `   \u664b\u5347\u89c4\u5219\uff1a${system.advancementRule}` : '',
          system.limitations ? `   \u9650\u5236\u6761\u4ef6\uff1a${system.limitations}` : '',
          system.cost ? `   \u4ee3\u4ef7\uff1a${system.cost}` : '',
          system.taboo ? `   \u7981\u5fcc\uff1a${system.taboo}` : '',
        ]))
        .join('\n')
    case 'species':
      return [
        rules.speciesSystem.length > 0
          ? section('\u79cd\u65cf\u5b9e\u4f53', rules.speciesSystem.map((item, index) => joinLines([
              `${index + 1}. \u540d\u79f0\uff1a${item.name || '\u672a\u547d\u540d'}`,
              item.entityType ? `   \u5b9e\u4f53\u7c7b\u578b\uff1a${item.entityType}` : '',
              item.summary ? `   \u7b80\u8ff0\uff1a${item.summary}` : '',
              item.traits.length > 0 ? `   \u7279\u5f81\uff1a${item.traits.join('\u3001')}` : '',
              item.commonIdentities.length > 0 ? `   \u5e38\u89c1\u8eab\u4efd\uff1a${item.commonIdentities.join('\u3001')}` : '',
              item.relationToHumans ? `   \u4e0e\u4e3b\u6d41\u793e\u4f1a\u5173\u7cfb\uff1a${item.relationToHumans}` : '',
              item.storyUse ? `   \u5267\u60c5\u7528\u9014\uff1a${item.storyUse}` : '',
            ])).join('\n'))
          : '',
        rules.factionSystem.length > 0
          ? section('\u7ec4\u7ec7\u52bf\u529b', rules.factionSystem.map((item, index) => joinLines([
              `${index + 1}. \u540d\u79f0\uff1a${item.name || '\u672a\u547d\u540d'}`,
              item.factionType ? `   \u52bf\u529b\u7c7b\u578b\uff1a${item.factionType}` : '',
              item.summary ? `   \u7b80\u8ff0\uff1a${item.summary}` : '',
              item.structure ? `   \u7ec4\u7ec7\u7ed3\u6784\uff1a${item.structure}` : '',
              item.resources ? `   \u6838\u5fc3\u8d44\u6e90\uff1a${item.resources}` : '',
              item.externalRelations ? `   \u5bf9\u5916\u5173\u7cfb\uff1a${item.externalRelations}` : '',
              item.recruitFrom ? `   \u5438\u7eb3\u6765\u6e90\uff1a${item.recruitFrom}` : '',
              item.notableSites.length > 0 ? `   \u91cd\u8981\u636e\u70b9\uff1a${item.notableSites.join('\u3001')}` : '',
            ])).join('\n'))
          : '',
      ].filter(Boolean).join('\n\n')
    case 'ecology':
      return buildCharacterEcologySummary(rules)
    case 'map':
      return buildMapBlueprintSummary(rules)
    case 'timeline':
      return buildTimelineConfigSummary(rules)
    case 'language':
      return summarizeLanguageConstraints(rules)
    default:
      return ''
  }
}

function summarizeOtherSections(sectionKey: WorldRuleSectionKey, rules: GenreWorldRules): string {
  return WORLD_RULE_SECTION_ORDER
    .filter((key) => key !== sectionKey)
    .map((key) => {
      const summary = summarizeCurrentSection(key, rules)
      if (!summary) return ''
      return section(SECTION_LABELS.get(key) || key, summary)
    })
    .filter(Boolean)
    .join('\n\n')
}

function buildStoryCoreSummary(profile: Awaited<ReturnType<typeof buildStoryProfile>>): string {
  return joinLines([
    `\u5c0f\u8bf4\uff1a${profile.novelTitle}`,
    `\u9898\u6750\uff1a${profile.genre}`,
    profile.background ? `\u57fa\u7840\u80cc\u666f\uff1a${profile.background}` : '',
    profile.storyGoal ? `\u6545\u4e8b\u76ee\u6807\uff1a${profile.storyGoal}` : '',
    profile.coreConflict ? `\u6838\u5fc3\u51b2\u7a81\uff1a${profile.coreConflict}` : '',
    profile.mainPlot ? `\u4e3b\u7ebf\u63a8\u8fdb\uff1a${profile.mainPlot}` : '',
    profile.subPlots ? `\u652f\u7ebf\u6982\u8981\uff1a${profile.subPlots}` : '',
    profile.ending ? `\u7ed3\u5c40\u65b9\u5411\uff1a${profile.ending}` : '',
    `\u4e3b\u89d2\u6307\u4ee3\uff1a${profile.protagonistReference}`,
    `\u4e3b\u89d2\u79f0\u547c\u89c4\u5219\uff1a${profile.protagonistRule}`,
  ])
}

function buildActionInstruction(action: WorldRulesGenerationRequest['action']): string {
  if (action === 'expand') {
    return joinLines([
      '\u57fa\u4e8e\u5f53\u524d\u5206\u533a\u8349\u7a3f\u7ee7\u7eed\u6269\u5199\uff0c\u4e0d\u8981\u63a8\u7ffb\u5df2\u6709\u53ef\u7528\u5185\u5bb9\u3002',
      '\u65b0\u589e\u4fe1\u606f\u8981\u56de\u6263\u57fa\u7840\u80cc\u666f\u3001\u6838\u5fc3\u8bbe\u5b9a\u3001\u9898\u6750\u4ee5\u53ca\u5176\u4ed6\u5206\u533a\u3002',
      '\u4f18\u5148\u8865\u8db3\u9650\u5236\u3001\u4ee3\u4ef7\u3001\u7ed3\u6784\u5173\u7cfb\u3001\u5267\u60c5\u7528\u9014\u4e0e\u53ef\u5199\u573a\u666f\u3002',
    ])
  }

  return joinLines([
    '\u5982\u679c\u5f53\u524d\u5206\u533a\u4e3a\u7a7a\uff0c\u76f4\u63a5\u7ed9\u51fa\u53ef\u843d\u5230\u8868\u5355\u7684\u7b2c\u4e00\u7248\u89c4\u5219\u3002',
    '\u5982\u679c\u5f53\u524d\u5206\u533a\u5df2\u6709\u90e8\u5206\u5185\u5bb9\uff0c\u5141\u8bb8\u7ee7\u627f\u5e76\u8865\u5168\uff0c\u4e0d\u8981\u91cd\u590d\u5806\u780c\u3002',
    '\u51cf\u5c11\u7a7a\u6cdb\u53e3\u53f7\u4e0e\u767e\u79d1\u5f0f\u8bf4\u660e\uff0c\u8ba9\u89c4\u5219\u80fd\u76f4\u63a5\u670d\u52a1\u4eba\u7269\u3001\u5730\u56fe\u3001\u65f6\u95f4\u8f74\u548c\u5199\u4f5c\u3002',
  ])
}

function buildSectionRequirement(sectionKey: WorldRuleSectionKey): string {
  switch (sectionKey) {
    case 'overview':
      return joinLines([
        '\u5199\u6e05\u4e16\u754c\u89c2\u57fa\u8c03\u3001\u793e\u4f1a\u6846\u67b6\u4e0e\u6545\u4e8b\u53d9\u4e8b\u91cd\u5fc3\u3002',
        '\u5c3d\u91cf\u8ba9\u57fa\u8c03\u548c\u4eba\u7269\u5904\u5883\u3001\u8d44\u6e90\u7ade\u4e89\u3001\u7ec4\u7ec7\u5173\u7cfb\u76f4\u63a5\u76f8\u8fde\u3002',
      ])
    case 'power':
      return joinLines([
        '\u6bcf\u5957\u4f53\u7cfb\u90fd\u8981\u5177\u5907\u5bf9\u8c61\u3001\u9636\u6bb5\u3001\u664b\u5347\u6761\u4ef6\u3001\u9650\u5236\u4e0e\u4ee3\u4ef7\u3002',
        '\u4f18\u5148\u7ed9\u51fa\u5c11\u800c\u6e05\u6670\u7684\u4f53\u7cfb\uff0c\u4e0d\u8981\u4e00\u6b21\u5806\u51fa\u8fc7\u591a\u7a7a\u58f3\u7b49\u7ea7\u3002',
      ])
    case 'species':
      return joinLines([
        '\u79cd\u65cf\u3001\u5b9e\u4f53\u4e0e\u52bf\u529b\u7684\u8bbe\u5b9a\u8981\u80fd\u76f4\u63a5\u53c2\u4e0e\u5267\u60c5\u51b2\u7a81\u3002',
        '\u79cd\u65cf\u5199\u751f\u5b58\u903b\u8f91\uff0c\u52bf\u529b\u5199\u7ec4\u7ec7\u7ed3\u6784\u4e0e\u8d44\u6e90\u63a7\u5236\u3002',
      ])
    case 'ecology':
      return joinLines([
        '\u4eba\u7269\u69fd\u4f4d\u8981\u4e0e\u4e3b\u7ebf\u51b2\u7a81\u3001\u52bf\u529b\u7ed3\u6784\u3001\u5730\u56fe\u7a7a\u95f4\u76f8\u8fde\u3002',
        '\u5c3d\u91cf\u7ed9\u51fa\u53ef\u7528\u4e8e\u4eba\u7269\u6279\u91cf\u751f\u6210\u7684\u7ed3\u6784\u6027\u69fd\u4f4d\u3002',
      ])
    case 'map':
      return joinLines([
        '\u5730\u56fe\u6309\u5c42\u7ea7\u8bbe\u8ba1\uff0c\u7b2c 1 \u5c42\u8868\u793a\u56fd\u5bb6 / \u5927\u533a / \u754c\u57df\uff0c\u7b2c 2 \u5c42\u8868\u793a\u6bcf\u4e2a\u4e0a\u7ea7\u4e0b\u7684\u533a\u57df\uff0c\u66f4\u6df1\u5c42\u518d\u8868\u793a\u5730\u70b9\u3002',
        '\u5bf9 suggestedCount \u7684\u7406\u89e3\u662f\u201c\u6bcf\u4e2a\u7236\u8282\u70b9\u5404\u81ea\u62e5\u6709\u7684\u76f4\u5c5e\u5b50\u8282\u70b9\u6570\u91cf\u201d\uff0c\u4e0d\u662f\u5168\u5c40\u603b\u6570\u3002',
      ])
    case 'timeline':
      return joinLines([
        '\u5199\u6e05\u7eaa\u5143\u3001\u96f6\u70b9\u3001\u663e\u793a\u683c\u5f0f\u3001\u53ef\u7528\u7cbe\u5ea6\u548c\u63a8\u8350\u4e8b\u4ef6\u7c7b\u578b\u3002',
        '\u65f6\u95f4\u89c4\u5219\u8981\u80fd\u76f4\u63a5\u670d\u52a1\u4e8b\u4ef6\u65f6\u95f4\u8f74\u7684\u547d\u540d\u548c\u6392\u5e8f\u3002',
      ])
    case 'language':
      return joinLines([
        '\u6587\u98ce\u7ea6\u675f\u8981\u80fd\u76f4\u63a5\u4f5c\u4e3a\u540e\u7eed\u6b63\u6587\u5199\u4f5c\u7684\u786c\u89c4\u5219\u3002',
        '\u4f18\u5148\u5f3a\u5316\u81ea\u7136\u4e2d\u6587\u3001\u5173\u7cfb\u611f\u548c\u5177\u4f53\u573a\u666f\uff0c\u51cf\u5c11 AI \u5473\u3002',
      ])
    default:
      return ''
  }
}

function buildOutputSchema(sectionKey: WorldRuleSectionKey): string {
  switch (sectionKey) {
    case 'overview':
      return '\u53ea\u8fd4\u56de JSON\uff0c\u4e0d\u8981\u89e3\u91ca\u3001\u4e0d\u8981 Markdown\u3001\u4e0d\u8981\u4ee3\u7801\u5757\uff1a{"genreProfile":{"name":"","subgenre":"","worldviewTone":"","socialFrame":"","narrativeFocus":[""],"languageAvoidances":[""]}}'
    case 'power':
      return '\u53ea\u8fd4\u56de JSON\uff1a{"powerSystems":[{"name":"","appliesTo":[""],"levels":[""],"advancementRule":"","limitations":"","cost":"","taboo":""}]}'
    case 'species':
      return '\u53ea\u8fd4\u56de JSON\uff1a{"speciesSystem":[{"name":"","entityType":"human|undead|beast|immortal|nonhuman","summary":"","traits":[""],"commonIdentities":[""],"relationToHumans":"","storyUse":""}],"factionSystem":[{"name":"","factionType":"","summary":"","structure":"","resources":"","externalRelations":"","recruitFrom":"","notableSites":[""]}]}'
    case 'ecology':
      return '\u53ea\u8fd4\u56de JSON\uff1a{"characterEcology":{"overview":"","slots":[{"label":"","entityType":"human|undead|beast|immortal|nonhuman","species":"","narrativeFunction":"","contextLink":"","preferredFactions":[""],"powerBias":[""]}]}}'
    case 'map':
      return '\u53ea\u8fd4\u56de JSON\uff1a{"mapBlueprint":{"overview":"","levels":[{"depth":1,"label":"","nodeTypes":[""],"relationHint":"","suggestedCount":3,"examples":[""]}]}}'
    case 'timeline':
      return '\u53ea\u8fd4\u56de JSON\uff1a{"timelineConfig":{"calendarType":"gregorian|regnal|relative-disaster|custom-era|future-date","eraName":"","epochLabel":"","baseYearLabel":"","displayPattern":"","relativeZeroLabel":"","recommendedEventTypes":[""],"precisionOptions":[""]}}'
    case 'language':
      return '\u53ea\u8fd4\u56de JSON\uff1a{"writingConstraints":{"antiQuoteEmphasis":true,"antiConceptSlogans":true,"antiSymmetricLines":true,"narrationStyle":"","dialogueStyle":"","forbiddenPhrases":[""],"extraRules":[""]}}'
    default:
      return ''
  }
}

function buildSectionPrompt(
  sectionKey: WorldRuleSectionKey,
  action: WorldRulesGenerationRequest['action'],
  profile: Awaited<ReturnType<typeof buildStoryProfile>>,
  rules: GenreWorldRules,
  requirements?: string,
): string {
  const sectionLabel = SECTION_LABELS.get(sectionKey) || sectionKey
  const currentSummary = summarizeCurrentSection(sectionKey, rules)
  const otherSummary = summarizeOtherSections(sectionKey, rules)

  return renderPrompt([
    `\u4f60\u662f\u5c0f\u8bf4\u4e16\u754c\u89c4\u5219\u534f\u4f5c\u52a9\u624b\uff0c\u73b0\u5728\u53ea\u5904\u7406\u300c${sectionLabel}\u300d\u5206\u533a\u3002`,
    section('\u6545\u4e8b\u6838\u5fc3', buildStoryCoreSummary(profile)),
    section('\u5f53\u524d\u5206\u533a\u8349\u7a3f', currentSummary || '\u5f53\u524d\u5206\u533a\u8fd8\u6ca1\u6709\u53ef\u7528\u8349\u7a3f\uff0c\u8bf7\u4ece\u96f6\u751f\u6210\u3002'),
    otherSummary ? section('\u5176\u4ed6\u5206\u533a\u53c2\u8003', otherSummary) : '',
    requirements ? section('\u989d\u5916\u8981\u6c42', requirements) : '',
    section('\u4efb\u52a1\u76ee\u6807', buildActionInstruction(action)),
    section('\u672c\u5206\u533a\u8981\u6c42', buildSectionRequirement(sectionKey)),
    section('\u8bed\u8a00\u8981\u6c42', buildHumanLanguageRules([
      '\u51cf\u5c11\u7a7a\u6cdb\u53e3\u53f7\u548c\u767e\u79d1\u5f0f\u8bf4\u660e\uff0c\u4fdd\u7559\u9898\u6750\u6c14\u8d28\u3002',
      '\u6bcf\u6761\u89c4\u5219\u5c3d\u91cf\u5199\u51fa\u5bf9\u8c61\u3001\u6761\u4ef6\u3001\u4ee3\u4ef7\u6216\u5173\u8054\u5173\u7cfb\u3002',
      '\u5982\u679c\u6d89\u53ca\u5730\u56fe\u3001\u52bf\u529b\u3001\u4eba\u7269\u69fd\u4f4d\u6216\u65f6\u95f4\u5236\u5ea6\uff0c\u8981\u4e0e\u5176\u4ed6\u5206\u533a\u4fdd\u6301\u4e00\u81f4\u3002',
      '\u4e0d\u8981\u53d1\u660e\u4e0e\u6545\u4e8b\u6838\u5fc3\u65e0\u5173\u7684\u5b8f\u5927\u8bbe\u5b9a\u3002',
    ])),
    buildOutputSchema(sectionKey),
  ])
}

function applySectionPatch(
  currentRules: GenreWorldRules,
  sectionKey: WorldRuleSectionKey,
  patch: Partial<GenreWorldRules>,
  genreName: string,
): GenreWorldRules {
  switch (sectionKey) {
    case 'overview':
      return normalizeWorldRules({
        ...currentRules,
        genreProfile: {
          ...currentRules.genreProfile,
          ...asRecord(patch.genreProfile),
        },
      }, genreName)
    case 'power':
      return normalizeWorldRules({
        ...currentRules,
        powerSystems: patch.powerSystems ?? currentRules.powerSystems,
      }, genreName)
    case 'species':
      return normalizeWorldRules({
        ...currentRules,
        speciesSystem: patch.speciesSystem ?? currentRules.speciesSystem,
        factionSystem: patch.factionSystem ?? currentRules.factionSystem,
      }, genreName)
    case 'ecology':
      return normalizeWorldRules({
        ...currentRules,
        characterEcology: {
          ...currentRules.characterEcology,
          ...asRecord(patch.characterEcology),
        },
      }, genreName)
    case 'map':
      return normalizeWorldRules({
        ...currentRules,
        mapBlueprint: {
          ...currentRules.mapBlueprint,
          ...asRecord(patch.mapBlueprint),
        },
      }, genreName)
    case 'timeline':
      return normalizeWorldRules({
        ...currentRules,
        timelineConfig: {
          ...currentRules.timelineConfig,
          ...asRecord(patch.timelineConfig),
        },
      }, genreName)
    case 'language':
      return normalizeWorldRules({
        ...currentRules,
        writingConstraints: {
          ...currentRules.writingConstraints,
          ...asRecord(patch.writingConstraints),
        },
      }, genreName)
    default:
      return currentRules
  }
}

function parseSectionPatch(sectionKey: WorldRuleSectionKey, text: string): Partial<GenreWorldRules> {
  const parsed = cleanAiValue(safeParseJson<Record<string, unknown>>(text))

  switch (sectionKey) {
    case 'overview': {
      const genreProfile = asRecord(parsed.genreProfile)
      const direct = Object.keys(genreProfile).length > 0 ? genreProfile : parsed
      return { genreProfile: direct as GenreWorldRules['genreProfile'] }
    }
    case 'power': {
      const powerSystems = Array.isArray(parsed.powerSystems)
        ? parsed.powerSystems
        : Array.isArray(parsed.systems)
          ? parsed.systems
          : Array.isArray(parsed.list)
            ? parsed.list
            : []
      return { powerSystems: powerSystems as GenreWorldRules['powerSystems'] }
    }
    case 'species': {
      const speciesSystem = Array.isArray(parsed.speciesSystem)
        ? parsed.speciesSystem
        : Array.isArray(parsed.species)
          ? parsed.species
          : []
      const factionSystem = Array.isArray(parsed.factionSystem)
        ? parsed.factionSystem
        : Array.isArray(parsed.factions)
          ? parsed.factions
          : []
      return {
        speciesSystem: speciesSystem as GenreWorldRules['speciesSystem'],
        factionSystem: factionSystem as GenreWorldRules['factionSystem'],
      }
    }
    case 'ecology': {
      const ecology = asRecord(parsed.characterEcology)
      const direct = Object.keys(ecology).length > 0 ? ecology : parsed
      return { characterEcology: direct as GenreWorldRules['characterEcology'] }
    }
    case 'map': {
      const blueprint = asRecord(parsed.mapBlueprint)
      const direct = Object.keys(blueprint).length > 0 ? blueprint : parsed
      return { mapBlueprint: direct as GenreWorldRules['mapBlueprint'] }
    }
    case 'timeline': {
      const config = asRecord(parsed.timelineConfig)
      const direct = Object.keys(config).length > 0 ? config : parsed
      return { timelineConfig: direct as GenreWorldRules['timelineConfig'] }
    }
    case 'language': {
      const writing = asRecord(parsed.writingConstraints)
      const direct = Object.keys(writing).length > 0 ? writing : parsed
      return { writingConstraints: direct as GenreWorldRules['writingConstraints'] }
    }
    default:
      return {}
  }
}

function ensurePatchHasContent(sectionKey: WorldRuleSectionKey, patch: Partial<GenreWorldRules>) {
  switch (sectionKey) {
    case 'overview':
      if (!patch.genreProfile || Object.keys(asRecord(patch.genreProfile)).length === 0) {
        throw new Error('\u672a\u751f\u6210\u53ef\u7528\u7684\u4e16\u754c\u6982\u89c8')
      }
      return
    case 'power':
      if (!Array.isArray(patch.powerSystems) || patch.powerSystems.length === 0) {
        throw new Error('\u672a\u751f\u6210\u53ef\u7528\u7684\u529b\u91cf\u4f53\u7cfb')
      }
      return
    case 'species':
      if (
        (!Array.isArray(patch.speciesSystem) || patch.speciesSystem.length === 0)
        && (!Array.isArray(patch.factionSystem) || patch.factionSystem.length === 0)
      ) {
        throw new Error('\u672a\u751f\u6210\u53ef\u7528\u7684\u79cd\u65cf\u6216\u52bf\u529b')
      }
      return
    case 'ecology':
      if (!patch.characterEcology || Object.keys(asRecord(patch.characterEcology)).length === 0) {
        throw new Error('\u672a\u751f\u6210\u53ef\u7528\u7684\u4eba\u7269\u751f\u6001')
      }
      return
    case 'map':
      if (!patch.mapBlueprint || Object.keys(asRecord(patch.mapBlueprint)).length === 0) {
        throw new Error('\u672a\u751f\u6210\u53ef\u7528\u7684\u5730\u56fe\u84dd\u56fe')
      }
      return
    case 'timeline':
      if (!patch.timelineConfig || Object.keys(asRecord(patch.timelineConfig)).length === 0) {
        throw new Error('\u672a\u751f\u6210\u53ef\u7528\u7684\u65f6\u95f4\u89c4\u5219')
      }
      return
    case 'language':
      if (!patch.writingConstraints || Object.keys(asRecord(patch.writingConstraints)).length === 0) {
        throw new Error('\u672a\u751f\u6210\u53ef\u7528\u7684\u6587\u98ce\u7ea6\u675f')
      }
      return
    default:
      return
  }
}

function sanitizeErrorMessage(error: unknown, fallback = '\u751f\u6210\u5931\u8d25'): string {
  const raw = error instanceof Error ? error.message : fallback
  return cleanAiFieldText(raw).replace(/^\[[^\]]+\]\s*/g, '').trim() || fallback
}

function sendProgress(sender: WebContents | undefined, payload: WorldRulesGenerationProgressEvent) {
  if (!sender || sender.isDestroyed()) return
  sender.send('ai:world-rules-progress', payload)
}

async function runPromptTask(
  novelId: number,
  modelConfigId: number | undefined,
  prompt: string,
): Promise<string> {
  const messages = [{ role: 'user' as const, content: prompt }]
  return runChatTask({
    type: 'world_rules_generate',
    novelId,
    modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: novelId,
    inputJson: JSON.stringify(messages),
    messages,
  })
}

export async function generateWorldRules(
  data: WorldRulesGenerationRequest,
  sender?: WebContents,
): Promise<WorldRulesGenerationResult> {
  if (data.mode === 'section' && !data.section) {
    throw new Error('\u7f3a\u5c11\u76ee\u6807\u5206\u533a')
  }

  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, data.novelId)).all()[0]
  if (!novel) throw new Error('\u5c0f\u8bf4\u4e0d\u5b58\u5728')

  const profile = await buildStoryProfile(data.novelId)
  const requestedSections = data.mode === 'section'
    ? [data.section as WorldRuleSectionKey]
    : [...WORLD_RULE_SECTION_ORDER]

  let workingRules = normalizeWorldRules(data.currentRules, profile.genre)
  const steps: WorldRulesGenerationStepResult[] = []
  const warnings: string[] = []
  let completedSteps = 0

  for (const sectionKey of requestedSections) {
    const label = SECTION_LABELS.get(sectionKey) || sectionKey
    sendProgress(sender, {
      novelId: data.novelId,
      section: sectionKey,
      label,
      status: 'running',
      completed: completedSteps,
      total: requestedSections.length,
      detail: data.action === 'expand'
        ? '\u6b63\u5728\u7ed3\u5408\u73b0\u6709\u8349\u7a3f\u7ee7\u7eed\u6269\u5199...'
        : '\u6b63\u5728\u6839\u636e\u73b0\u6709\u8bbe\u5b9a\u751f\u6210\u5206\u533a\u521d\u7a3f...',
    })

    try {
      const prompt = buildSectionPrompt(sectionKey, data.action, profile, workingRules, data.requirements)
      const output = await runPromptTask(data.novelId, novel.modelConfigId || undefined, prompt)
      const patch = parseSectionPatch(sectionKey, output)
      ensurePatchHasContent(sectionKey, patch)
      const nextRules = applySectionPatch(
        workingRules,
        sectionKey,
        patch,
        workingRules.genreProfile.name || profile.genre,
      )

      const changed = JSON.stringify(nextRules) !== JSON.stringify(workingRules)
      workingRules = nextRules
      completedSteps += 1

      const warning = changed ? undefined : '\u751f\u6210\u7ed3\u679c\u672a\u5e26\u6765\u65b0\u7684\u6709\u6548\u6539\u52a8'
      if (warning) warnings.push(`${label}\uff1a${warning}`)

      steps.push({
        key: sectionKey,
        label,
        status: warning ? 'warning' : 'success',
        warning,
      })

      sendProgress(sender, {
        novelId: data.novelId,
        section: sectionKey,
        label,
        status: 'success',
        completed: completedSteps,
        total: requestedSections.length,
        warning,
        detail: warning || `${label}\u5df2\u66f4\u65b0\u5230\u8868\u5355\u8349\u7a3f`,
      })
    } catch (error) {
      const errorMessage = sanitizeErrorMessage(error)
      warnings.push(`${label}\uff1a${errorMessage}`)
      steps.push({
        key: sectionKey,
        label,
        status: 'failed',
        error: errorMessage,
      })

      sendProgress(sender, {
        novelId: data.novelId,
        section: sectionKey,
        label,
        status: 'failed',
        completed: completedSteps,
        total: requestedSections.length,
        warning: errorMessage,
        detail: `${label}\u751f\u6210\u5931\u8d25`,
      })

      if (data.mode === 'section') {
        break
      }
    }
  }

  const failedSteps = steps.filter((step) => step.status === 'failed').length
  return {
    rules: normalizeWorldRules(workingRules, workingRules.genreProfile.name || profile.genre),
    requestedSections,
    steps,
    warnings,
    completedSteps,
    failedSteps,
    hasPartialResult: completedSteps > 0,
  }
}
