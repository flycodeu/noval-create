import type {
  Chapter,
  Character,
  Faction,
  GlossaryEntry,
  MapNodeSummary,
  Novel,
  RevisionCenterSnapshot,
  SceneTemplate,
  StoryArc,
  StoryItem,
  StoryThread,
  TimelineEvent,
  WorkspaceQualityAnalyzeRequest,
} from '../../../types'
import { buildProjectBriefSummary, parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { parseWorldRulesDraftJson } from '../../../shared/world-rules-draft'
import {
  buildEndgameDesignSummary,
  buildPremiseSummary,
  buildStoryDesignSummary,
  parseStorySettingsSnapshot,
} from '../../../shared/story-settings'
import { buildThemeVoiceSummary, parseThemeVoiceSnapshot } from '../../../shared/theme-voice'

export type WorkspaceQualityRouteKey =
  | 'overview'
  | 'project-brief'
  | 'core-settings'
  | 'theme-voice'
  | 'world-rules'
  | 'endgame'
  | 'map'
  | 'factions'
  | 'characters'
  | 'items'
  | 'glossary'
  | 'threads'
  | 'scene-templates'
  | 'story-design'
  | 'outline'
  | 'volume-design'
  | 'contracts'
  | 'structure'
  | 'timeline'
  | 'writing'
  | 'revision'

export interface WorkspaceQualityAdapterContext {
  novelId: number
  currentNovel: Novel | null
  currentChapter: Chapter | null
}

export interface FallbackWorkspaceQualityAdapter {
  readonly?: boolean
  fetchSnapshot: (context: WorkspaceQualityAdapterContext) => Promise<Record<string, unknown> | null>
  applySnapshot?: (
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
    context: WorkspaceQualityAdapterContext,
  ) => Promise<void>
}

const WORKSPACE_SEQUENCE: Array<{ key: WorkspaceQualityRouteKey; label: string; summary: string }> = [
  { key: 'overview', label: '基础信息', summary: '维护书名、简介、背景和目标字数。' },
  { key: 'project-brief', label: '项目立项', summary: '先定读者承诺、卖点和禁区。' },
  { key: 'core-settings', label: '基础设定', summary: '固定定位、主角起点和底层约束。' },
  { key: 'theme-voice', label: '主题与文风', summary: '固定主题、叙事口吻和语言边界。' },
  { key: 'world-rules', label: '世界规则', summary: '统一题材规则、时间制度和写作约束。' },
  { key: 'endgame', label: '终局设计', summary: '提前锁定最终冲突、兑现承诺和最后一幕。' },
  { key: 'map', label: '地图结构', summary: '让地点能承载路线、冲突和代价。' },
  { key: 'factions', label: '势力系统', summary: '整理外部势力、资源与关系格局。' },
  { key: 'characters', label: '角色系统', summary: '补齐主角与关键人物关系。' },
  { key: 'items', label: '物品装备', summary: '沉淀道具、资源和线索。' },
  { key: 'glossary', label: '设定词典', summary: '固定术语、阶位、材料和专有名词。' },
  { key: 'threads', label: '故事线程', summary: '把主线、支线和伏笔挂成可追踪线程。' },
  { key: 'scene-templates', label: '场景模板', summary: '沉淀高频场景的节拍和复用骨架。' },
  { key: 'story-design', label: '故事设计', summary: '统一设计主线、支线和结局。' },
  { key: 'outline', label: '故事大纲', summary: '按章节推进主线，落实关键转折。' },
  { key: 'volume-design', label: '卷级设计', summary: '把终局压力和本卷闭环拆成可执行约束。' },
  { key: 'contracts', label: '章节合同', summary: '把本章和场景约束变成显式合同。' },
  { key: 'structure', label: '结构规划', summary: '拆卷、拆部、拆章，稳住长篇节奏。' },
  { key: 'timeline', label: '时间轴', summary: '维护事件顺序、后果链和时间锚点。' },
  { key: 'writing', label: '正文写作', summary: '处理场景计划、主写、审校和定稿。' },
  { key: 'revision', label: '修订中心', summary: '收口一致性问题和上下文同步任务。' },
]

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getWorkspaceMeta(key: WorkspaceQualityRouteKey) {
  return WORKSPACE_SEQUENCE.find((item) => item.key === key) || null
}

function buildUpstreamContext(key: WorkspaceQualityRouteKey): string {
  const index = WORKSPACE_SEQUENCE.findIndex((item) => item.key === key)
  if (index <= 0) return '当前工作区前面没有更基础的步骤，重点看是否贴合项目总目标。'
  const previous = WORKSPACE_SEQUENCE[index - 1]
  return `${previous.label}：${previous.summary}`
}

function buildDownstreamContext(key: WorkspaceQualityRouteKey): string {
  const index = WORKSPACE_SEQUENCE.findIndex((item) => item.key === key)
  if (index < 0 || index >= WORKSPACE_SEQUENCE.length - 1) return '当前工作区已经接近链路尾部，重点看是否能直接支持写作或修订。'
  const next = WORKSPACE_SEQUENCE[index + 1]
  return `${next.label}：${next.summary}`
}

function buildWorldRulesSnapshot(novel: Novel | null) {
  const rules = parseWorldRulesDraftJson(novel?.worldRulesJson, novel?.genreName)
  return {
    fields: {
      genreName: novel?.genreName || '',
      worldviewTone: rules.genreProfile.worldviewTone,
      socialFrame: rules.genreProfile.socialFrame,
      mapOverview: rules.mapBlueprint.overview,
      calendarType: rules.timelineConfig.calendarType,
      narrationStyle: rules.writingConstraints.narrationStyle,
      dialogueStyle: rules.writingConstraints.dialogueStyle,
      forbiddenPhrases: rules.writingConstraints.forbiddenPhrases,
      extraRules: rules.writingConstraints.extraRules,
      realismLevel: rules.writingConstraints.realismLevel,
      contextAlignmentFocus: rules.writingConstraints.contextAlignmentFocus,
      commonSenseFocus: rules.writingConstraints.commonSenseFocus,
    },
    powerSystems: rules.powerSystems.map((item) => ({
      id: item.id,
      name: item.name,
      appliesTo: item.appliesTo,
      levels: item.levels,
      advancementRule: item.advancementRule,
      limitations: item.limitations,
      cost: item.cost,
      taboo: item.taboo,
    })),
    speciesSystem: rules.speciesSystem.map((item) => ({
      id: item.id,
      name: item.name,
      entityType: item.entityType,
      summary: item.summary,
      traits: item.traits,
      relationToHumans: item.relationToHumans,
      storyUse: item.storyUse,
    })),
    factionSystem: rules.factionSystem.map((item) => ({
      id: item.id,
      name: item.name,
      factionType: item.factionType,
      summary: item.summary,
      structure: item.structure,
      resources: item.resources,
      externalRelations: item.externalRelations,
      recruitFrom: item.recruitFrom,
      notableSites: item.notableSites,
    })),
  }
}

type EntityWithId = { id: number }

function buildCollectionSnapshot(entityKey: string, entities: Array<Record<string, unknown>>) {
  return {
    scope: 'collection',
    entityKey,
    entities,
  }
}

async function applyCollectionSnapshot<T extends EntityWithId>(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  updateEntity: (id: number, data: Partial<T>) => Promise<void>,
) {
  const previousEntities = Array.isArray(previous.entities) ? previous.entities.filter(isRecord) : []
  const nextEntities = Array.isArray(next.entities) ? next.entities.filter(isRecord) : []
  const previousMap = new Map(previousEntities
    .filter((item) => typeof item.id === 'number')
    .map((item) => [item.id as number, item] as const))

  for (const entity of nextEntities) {
    const id = typeof entity.id === 'number' ? entity.id : null
    if (!id) continue
    const current = previousMap.get(id)
    if (!current) continue
    const changes: Record<string, unknown> = {}
    const keys = new Set([...Object.keys(current), ...Object.keys(entity)])
    keys.forEach((key) => {
      if (key === 'id') return
      const before = JSON.stringify(current[key])
      const after = JSON.stringify(entity[key])
      if (before !== after) changes[key] = entity[key]
    })
    if (Object.keys(changes).length > 0) {
      await updateEntity(id, changes as Partial<T>)
    }
  }
}

function pickCharacter(item: Character) {
  return {
    id: item.id,
    fullName: item.fullName,
    roleType: item.roleType,
    recordStatus: item.recordStatus,
    occupation: item.occupation || '',
    background: item.background || '',
    personalityTraitsJson: item.personalityTraitsJson || '',
    goals: item.goals || '',
    innerConflict: item.innerConflict || '',
    contradiction: item.contradiction || '',
    relationshipTension: item.relationshipTension || '',
    characterArc: item.characterArc || '',
    speechPattern: item.speechPattern || '',
    catchphrases: item.catchphrases || '',
  }
}

function pickFaction(item: Faction) {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    goal: item.goal || '',
    resources: item.resources || '',
    memberPolicy: item.memberPolicy || '',
    currentPhase: item.currentPhase || '',
    notes: item.notes || '',
  }
}

function pickStoryItem(item: StoryItem) {
  return {
    id: item.id,
    itemName: item.itemName,
    itemKind: item.itemKind,
    status: item.status,
    summary: item.summary || '',
    plotFunction: item.plotFunction || '',
    appearance: item.appearance || '',
    usageMethod: item.usageMethod || '',
    acquisitionMethod: item.acquisitionMethod || '',
    cost: item.cost || '',
    risk: item.risk || '',
    factionHint: item.factionHint || '',
  }
}

function pickGlossary(item: GlossaryEntry) {
  return {
    id: item.id,
    term: item.term,
    category: item.category,
    definition: item.definition || '',
    aliasesJson: item.aliasesJson || '',
    firstAppearChapter: item.firstAppearChapter,
    relatedEntityIdsJson: item.relatedEntityIdsJson || '',
    isCanonical: item.isCanonical,
  }
}

function pickThread(item: StoryThread) {
  return {
    id: item.id,
    threadType: item.threadType,
    title: item.title,
    summary: item.summary || '',
    premise: item.premise || '',
    status: item.status,
    priority: item.priority,
    payoffCondition: item.payoffCondition || '',
    currentState: item.currentState || '',
    notes: item.notes || '',
  }
}

function pickTimelineEvent(item: TimelineEvent) {
  return {
    id: item.id,
    eventTitle: item.eventTitle,
    eventSummary: item.eventSummary || '',
    timeLabel: item.timeLabel || '',
    eventType: item.eventType || '',
    protagonistAction: item.protagonistAction || '',
    eventCause: item.eventCause || '',
    eventProcess: item.eventProcess || '',
    eventResult: item.eventResult || '',
    notes: item.notes || '',
  }
}

function pickSceneTemplate(item: SceneTemplate) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    description: item.description || '',
    typicalBeatsJson: item.typicalBeatsJson || '',
    suggestedCharacterRolesJson: item.suggestedCharacterRolesJson || '',
    emotionArc: item.emotionArc || '',
  }
}

function pickOutlineArc(item: StoryArc) {
  return {
    id: item.id,
    arcName: item.arcName,
    chapterStart: item.chapterStart,
    chapterEnd: item.chapterEnd,
    arcGoal: item.arcGoal || '',
    arcSummary: item.arcSummary || '',
    growthLedger: item.growthLedger || '',
    costLedger: item.costLedger || '',
    phaseTargetsJson: item.phaseTargetsJson || '',
  }
}

function pickMapNode(item: MapNodeSummary) {
  return {
    id: item.id,
    name: item.name,
    nodeType: item.nodeType,
    locationType: item.locationType || '',
    structureRole: item.structureRole || '',
    description: item.description || '',
    atmosphere: item.atmosphere || '',
    plotRelevance: item.plotRelevance || '',
    tagsJson: item.tagsJson || '',
    dangerLevel: item.dangerLevel || '',
    childCount: item.childCount,
  }
}

function pickRevisionTask(snapshot: RevisionCenterSnapshot) {
  return buildCollectionSnapshot('revision_tasks', snapshot.tasks.map((item) => ({
    id: item.id,
    taskType: item.taskType,
    title: item.title,
    description: item.description,
    fixBrief: item.fixBrief,
    status: item.status,
    severity: item.severity,
    relatedPage: item.relatedPage || '',
  })))
}

export function buildWorkspaceQualityRequestBase(
  workspaceKey: WorkspaceQualityRouteKey,
  context: WorkspaceQualityAdapterContext,
): Omit<WorkspaceQualityAnalyzeRequest, 'contentSnapshot'> {
  const projectBrief = parseProjectBriefSnapshot(context.currentNovel?.projectBriefJson)
  const storySettings = parseStorySettingsSnapshot(context.currentNovel?.settingsJson)
  const themeVoice = parseThemeVoiceSnapshot(context.currentNovel?.themeVoiceJson)
  const meta = getWorkspaceMeta(workspaceKey)

  return {
    novelId: context.novelId,
    workspaceKey,
    pageKey: workspaceKey,
    workspaceLabel: meta?.label || workspaceKey,
    workspaceSummary: meta?.summary || '',
    upstreamContext: buildUpstreamContext(workspaceKey),
    downstreamContext: buildDownstreamContext(workspaceKey),
    themeVoiceSummary: buildThemeVoiceSummary(themeVoice),
    projectBriefSummary: buildProjectBriefSummary(projectBrief),
    backgroundSummary: [context.currentNovel?.synopsis, context.currentNovel?.expandedBackground].filter(Boolean).join('\n'),
    genreContext: context.currentNovel?.genreName || '',
    modelConfigId: context.currentNovel?.modelConfigId,
  }
}

const FALLBACK_ADAPTERS: Partial<Record<WorkspaceQualityRouteKey, FallbackWorkspaceQualityAdapter>> = {
  overview: {
    async fetchSnapshot(context) {
      if (!context.currentNovel) return null
      return {
        scope: 'form',
        fields: {
          title: context.currentNovel.title,
          synopsis: context.currentNovel.synopsis || '',
          userBackground: context.currentNovel.userBackground || '',
          expandedBackground: context.currentNovel.expandedBackground || '',
          targetWords: context.currentNovel.targetWords,
        },
      }
    },
    async applySnapshot(_previous, next, context) {
      const fields = isRecord(next.fields) ? next.fields : {}
      await window.electron.novel.update(context.novelId, {
        title: cleanText(fields.title) || context.currentNovel?.title || '',
        synopsis: cleanText(fields.synopsis),
        userBackground: cleanText(fields.userBackground),
        expandedBackground: cleanText(fields.expandedBackground),
        targetWords: typeof fields.targetWords === 'number' ? fields.targetWords : context.currentNovel?.targetWords,
      })
    },
  },
  'project-brief': {
    async fetchSnapshot(context) {
      return {
        scope: 'form',
        fields: cloneJson(parseProjectBriefSnapshot(context.currentNovel?.projectBriefJson)),
      }
    },
  },
  'core-settings': {
    async fetchSnapshot(context) {
      const settings = parseStorySettingsSnapshot(context.currentNovel?.settingsJson)
      return {
        scope: 'form',
        fields: {
          ...cloneJson(settings.premise),
          antiAiFlavor: settings.writingRules.antiAiFlavor,
          commonSenseRules: settings.writingRules.commonSenseRules,
          bannedTerms: settings.writingRules.bannedTerms,
        },
      }
    },
  },
  'theme-voice': {
    async fetchSnapshot(context) {
      return {
        scope: 'form',
        fields: cloneJson(parseThemeVoiceSnapshot(context.currentNovel?.themeVoiceJson)),
      }
    },
  },
  'world-rules': {
    async fetchSnapshot(context) {
      return buildWorldRulesSnapshot(context.currentNovel)
    },
  },
  endgame: {
    async fetchSnapshot(context) {
      const settings = parseStorySettingsSnapshot(context.currentNovel?.settingsJson)
      return {
        scope: 'form',
        fields: {
          endingMode: settings.endgameDesign.endingMode || '',
          finalConflict: settings.endgameDesign.finalConflict,
          themeAnswer: settings.endgameDesign.themeAnswer,
          mustDeliverPromises: settings.endgameDesign.mustDeliverPromises,
          payoffChecklist: settings.endgameDesign.payoffChecklist,
          deliberateUnknowns: settings.endgameDesign.deliberateUnknowns,
          finalImage: settings.endgameDesign.finalImage,
          lastScene: settings.endgameDesign.lastScene,
          summary: buildEndgameDesignSummary(settings.endgameDesign),
        },
      }
    },
  },
  'story-design': {
    async fetchSnapshot(context) {
      const settings = parseStorySettingsSnapshot(context.currentNovel?.settingsJson)
      return {
        scope: 'form',
        fields: {
          storyGoal: settings.storyDesign.storyGoal,
          coreConflict: settings.storyDesign.coreConflict,
          mainPlot: settings.storyDesign.mainPlot,
          rhythmSetup: settings.storyDesign.rhythmSetup,
          rhythmConflict: settings.storyDesign.rhythmConflict,
          rhythmEnding: settings.storyDesign.rhythmEnding,
          endingType: settings.storyDesign.endingType,
          ending: settings.storyDesign.ending,
        },
        subplots: cloneJson(settings.storyDesign.subPlotsList),
      }
    },
  },
  characters: {
    async fetchSnapshot(context) {
      const items = await window.electron.character.list(context.novelId)
      return buildCollectionSnapshot('characters', items.map(pickCharacter))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<Character>(previous, next, (id, data) => window.electron.character.update(id, data))
    },
  },
  factions: {
    async fetchSnapshot(context) {
      const page = await window.electron.faction.query({ novelId: context.novelId, page: 1, pageSize: 300 })
      return buildCollectionSnapshot('factions', page.items.map(pickFaction))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<Faction>(previous, next, (id, data) => window.electron.faction.update(id, data))
    },
  },
  items: {
    async fetchSnapshot(context) {
      const items = await window.electron.item.list(context.novelId)
      return buildCollectionSnapshot('items', items.map(pickStoryItem))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<StoryItem>(previous, next, (id, data) => window.electron.item.update(id, data))
    },
  },
  glossary: {
    async fetchSnapshot(context) {
      const items = await window.electron.glossary.list(context.novelId)
      return buildCollectionSnapshot('glossary', items.map(pickGlossary))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<GlossaryEntry>(previous, next, (id, data) => window.electron.glossary.update(id, data))
    },
  },
  threads: {
    async fetchSnapshot(context) {
      const items = await window.electron.thread.list(context.novelId)
      return buildCollectionSnapshot('threads', items.map(pickThread))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<StoryThread>(previous, next, (id, data) => window.electron.thread.update(id, data))
    },
  },
  timeline: {
    async fetchSnapshot(context) {
      const items = await window.electron.timeline.list(context.novelId)
      return buildCollectionSnapshot('timeline_events', items.map(pickTimelineEvent))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<TimelineEvent>(previous, next, (id, data) => window.electron.timeline.update(id, data))
    },
  },
  'scene-templates': {
    async fetchSnapshot(context) {
      const page = await window.electron.sceneTemplate.query({
        novelId: context.novelId,
        genreId: context.currentNovel?.genreId,
        page: 1,
        pageSize: 200,
      })
      return buildCollectionSnapshot('scene_templates', page.items.map(pickSceneTemplate))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<SceneTemplate>(previous, next, (id, data) => window.electron.sceneTemplate.update(id, data))
    },
  },
  outline: {
    async fetchSnapshot(context) {
      const items = await window.electron.outline.getArcs(context.novelId)
      return buildCollectionSnapshot('story_arcs', items.map(pickOutlineArc))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<StoryArc>(previous, next, (id, data) => window.electron.outline.updateArc(id, data))
    },
  },
  map: {
    async fetchSnapshot(context) {
      const page = await window.electron.map.queryNodes({
        novelId: context.novelId,
        page: 1,
        pageSize: 300,
      })
      return buildCollectionSnapshot('map_nodes', page.items.map(pickMapNode))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot<MapNodeSummary>(previous, next, (id, data) => window.electron.map.update(id, data))
    },
  },
  structure: {
    async fetchSnapshot(context) {
      const volumes = await window.electron.structure.listVolumes(context.novelId)
      return buildCollectionSnapshot('structure_volumes', volumes.map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary || '',
        status: item.status,
        targetWords: item.targetWords,
        chapterCount: item.chapterCount,
        segmentCount: item.segmentCount,
        linkedTimelineEventCount: item.linkedTimelineEventCount,
      })))
    },
    async applySnapshot(previous, next) {
      await applyCollectionSnapshot(previous, next, (id, data) => window.electron.structure.updateVolume(id, data))
    },
  },
  writing: {
    async fetchSnapshot(context) {
      if (!context.currentChapter) return null
      return {
        scope: 'form',
        chapterId: context.currentChapter.id,
        fields: {
          title: context.currentChapter.title || '',
          outline: context.currentChapter.outline || '',
          summary: context.currentChapter.summary || '',
          content: context.currentChapter.content || '',
          emotionTone: context.currentChapter.emotionTone || '',
          targetWords: context.currentChapter.targetWords,
        },
      }
    },
    async applySnapshot(_previous, next, context) {
      if (!context.currentChapter) return
      const fields = isRecord(next.fields) ? next.fields : {}
      await window.electron.chapter.update(context.currentChapter.id, {
        title: cleanText(fields.title) || context.currentChapter.title,
        outline: cleanText(fields.outline),
        summary: cleanText(fields.summary),
        content: cleanText(fields.content),
        emotionTone: cleanText(fields.emotionTone),
        targetWords: typeof fields.targetWords === 'number' ? fields.targetWords : context.currentChapter.targetWords,
      })
    },
  },
  revision: {
    readonly: true,
    async fetchSnapshot(context) {
      const snapshot = await window.electron.revision.getSnapshot(context.novelId)
      return pickRevisionTask(snapshot)
    },
  },
}

export function getFallbackWorkspaceQualityAdapter(key: WorkspaceQualityRouteKey) {
  return FALLBACK_ADAPTERS[key] || null
}
