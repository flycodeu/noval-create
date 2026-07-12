import { asc, eq } from 'drizzle-orm'
import type {
  CharacterNeedsAnalysisInput,
  CharacterNeedsAnalysisResult,
} from '../../src/shared/character-cast-planning'
import { getCharacterBatchPreset } from '../../src/shared/creation-tools'
import {
  getSpeciesNameOptions,
  parseWorldRulesJson,
} from '../../src/shared/genre-system'
import {
  analyzeCharacterNeeds as runCharacterNeedsAnalyzer,
  CharacterCastPlanningError,
  type CharacterCastContextCharacter,
  type CharacterCastContextEvidence,
  type CharacterCastCoveragePrior,
  type CharacterCastModelRequest,
  type CharacterCastPlanningContext,
} from '../application/character-cast-planner'
import { getDb } from '../database/db'
import {
  chapters,
  factions,
  resistanceTracks,
  storyItems,
  storyThreads,
  storyVolumes,
} from '../database/schema'
import {
  buildAiModelRouteReport,
  buildChatOptionsFromRoute,
  resolveAiExecutionMode,
} from './ai-engine.service'
import * as characterService from './character.service'
import { buildStoryProfile } from './context.service'
import * as novelService from './novel.service'
import { createTask, executeChatTask } from './task.service'
import { createArtifact } from './artifact.service'

function clip(value: unknown, max = 600): string {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function parseIds(raw: unknown): number[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
      .map((item) => typeof item === 'number' ? item : Number(item))
      .filter((item) => Number.isInteger(item) && item > 0))]
  } catch {
    return []
  }
}

function toContextCharacter(row: ReturnType<typeof characterService.listCharacters>[number]): CharacterCastContextCharacter {
  return {
    id: row.id,
    name: row.fullName,
    roleType: row.roleType || 'minor',
    recordStatus: row.recordStatus || 'confirmed',
    species: clip(row.species, 80),
    occupation: clip(row.occupation || row.socialIdentity, 120),
    goals: clip(row.goals || row.surfaceDesire, 180),
    dramaticEngine: clip(row.dramaticEngine || row.innerConflict, 220),
    characterArc: clip(row.characterArc, 220),
    relationshipTension: clip(row.relationshipTension, 180),
    appearChapter: typeof row.appearChapter === 'number' ? row.appearChapter : null,
  }
}

function coveragePrior(
  characters: ReturnType<typeof characterService.listCharacters>,
  threadCharacterIds: number[],
  resistanceCharacterIds: number[],
): CharacterCastCoveragePrior[] {
  const protagonists = characters.filter((item) => item.roleType === 'protagonist').map((item) => item.id)
  const antagonists = [...new Set([
    ...characters.filter((item) => item.roleType === 'antagonist').map((item) => item.id),
    ...resistanceCharacterIds,
  ])]
  const majors = characters.filter((item) => item.roleType === 'major').map((item) => item.id)
  const relationshipAnchors = characters
    .filter((item) => clip(item.relationshipTension || item.resonancePoint, 20))
    .map((item) => item.id)
  const informationRoles = characters
    .filter((item) => /(调查|记者|侦探|情报|线人|导师|学者|医生|守门|证人|秘书|顾问)/u.test([
      item.occupation,
      item.socialIdentity,
      item.contextHooksJson,
    ].filter(Boolean).join(' ')))
    .map((item) => item.id)
  const resourceRoles = characters
    .filter((item) => /(商|后勤|军需|管理|财务|执事|官员|技术|维修|医疗|运输|向导|中介)/u.test([
      item.occupation,
      item.socialIdentity,
      item.contextHooksJson,
    ].filter(Boolean).join(' ')))
    .map((item) => item.id)
  const nonHumanOrSpecial = characters
    .filter((item) => item.entityType !== 'human' || (item.species && !/(人类|人族|幸存者)/u.test(item.species)))
    .map((item) => item.id)

  const entry = (
    functionKey: string,
    label: string,
    ids: number[],
    reason: string,
  ): CharacterCastCoveragePrior => ({
    functionKey,
    function: label,
    initialCoverage: ids.length > 0 ? 'partial' : 'unknown',
    candidateCharacterIds: [...new Set(ids)].slice(0, 20),
    reason,
  })

  return [
    entry('pov_anchor', 'POV 与读者体验锚点', protagonists, '主角角色可优先承担，但仍需验证视角负载。'),
    entry('desire_driver', '核心欲望和行动推动者', protagonists, '主角欲望链是首选覆盖来源。'),
    entry('primary_resistance', '主阻力承担者', antagonists, '反派标签与阻力线来源只是候选，仍需验证升级能力。'),
    entry('value_mirror', '价值观镜像角色', majors, '主要人物可能承担镜像功能，但不能仅凭角色级别认定。'),
    entry('information_gatekeeper', '信息或线索守门人', informationRoles, '按职业、身份和上下文钩子抽取的候选。'),
    entry('resource_interface', '关键资源接口角色', resourceRoles, '按职业、身份和上下文钩子抽取的候选。'),
    entry('emotional_pivot', '情绪关系支点', relationshipAnchors, '存在关系张力或共鸣点的人物优先。'),
    entry('foreshadow_payoff', '伏笔播种或回收承担者', threadCharacterIds, '故事线程显式关联人物可作为候选。'),
    entry('world_rule_expositor', '通过行动展示世界规则的角色', nonHumanOrSpecial, '特殊身份或非人类角色可能承担展示功能。'),
    entry('endgame_witness', '终局承诺的见证或对抗者', [...protagonists, ...antagonists, ...majors], '核心人物仅是候选，需对照终局承诺复核。'),
  ]
}

function resolveScopedChapters(
  allChapters: Array<typeof chapters.$inferSelect>,
  input: CharacterNeedsAnalysisInput,
): Array<typeof chapters.$inferSelect> {
  const byScope = input.scope?.type === 'volume'
    ? allChapters.filter((chapter) => chapter.volumeId === input.scope?.volumeId)
    : allChapters
  const lookahead = input.scope?.lookaheadChapters
  if (typeof lookahead !== 'number' || lookahead <= 0) return byScope.slice(0, 30)

  const lastFinishedChapter = allChapters
    .filter((chapter) => chapter.status === 'final' || (chapter.wordCount || 0) > 0)
    .reduce((max, chapter) => Math.max(max, chapter.chapterNum), 0)
  const upcoming = byScope.filter((chapter) => chapter.chapterNum > lastFinishedChapter)
  return (upcoming.length > 0 ? upcoming : byScope).slice(0, lookahead)
}

function addEvidence(
  target: CharacterCastContextEvidence[],
  item: CharacterCastContextEvidence,
): void {
  if (target.some((current) => current.ref === item.ref)) return
  target.push({ ...item, title: clip(item.title, 160), summary: clip(item.summary, 500) })
}

async function loadPlanningContext(input: CharacterNeedsAnalysisInput): Promise<CharacterCastPlanningContext> {
  const novel = novelService.getNovel(input.novelId)
  if (!novel) throw new CharacterCastPlanningError('PROJECT_NOT_FOUND', `未找到项目 #${input.novelId}。`)

  const db = getDb()
  const profile = await buildStoryProfile(input.novelId)
  const characters = characterService.listCharacters(input.novelId)
  const threadRows = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, input.novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
  const factionRows = db.select().from(factions)
    .where(eq(factions.novelId, input.novelId))
    .orderBy(asc(factions.sortOrder), asc(factions.id))
    .all()
  const resistanceRows = db.select().from(resistanceTracks)
    .where(eq(resistanceTracks.novelId, input.novelId))
    .orderBy(asc(resistanceTracks.id))
    .all()
  const volumeRows = db.select().from(storyVolumes)
    .where(eq(storyVolumes.novelId, input.novelId))
    .orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id))
    .all()
  const allChapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, input.novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()
  const itemRows = db.select().from(storyItems)
    .where(eq(storyItems.novelId, input.novelId))
    .orderBy(asc(storyItems.id))
    .all()

  const selectedVolume = input.scope?.type === 'volume'
    ? volumeRows.find((volume) => volume.id === input.scope?.volumeId)
    : null
  if (input.scope?.type === 'volume' && !selectedVolume) {
    throw new CharacterCastPlanningError('VOLUME_NOT_FOUND', `项目中不存在卷 #${input.scope.volumeId}。`)
  }

  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const species = getSpeciesNameOptions(rules)
  const preset = getCharacterBatchPreset(profile.genre, species, {
    launchMode: novel.launchMode,
    operatingMode: novel.operatingMode,
    targetWords: novel.targetWords,
    chapterCount: allChapterRows.length,
    settingsJson: novel.settingsJson,
    factionCount: factionRows.length,
    speciesCount: species.length,
  })
  const suggested = preset.totalCount
  const priorRange = {
    min: Math.max(3, Math.round(suggested * 0.55)),
    suggested,
    max: Math.max(suggested, Math.round(suggested * 1.25)),
    rationale: `${preset.scaleLabel}先验：${preset.rationale}。该范围只提供认知负担与篇幅安全边界，不是生成配额。`,
  }

  const evidence: CharacterCastContextEvidence[] = []
  addEvidence(evidence, {
    ref: `novel:${novel.id}`,
    kind: 'novel',
    title: novel.title,
    summary: [profile.premiseSummary, profile.storyDesignSummary, profile.endgameDesignSummary].filter(Boolean).join('；'),
  })
  if (selectedVolume) {
    addEvidence(evidence, {
      ref: `volume:${selectedVolume.id}`,
      kind: 'volume',
      title: selectedVolume.title || `第 ${selectedVolume.volumeNumber} 卷`,
      summary: selectedVolume.summary || '',
    })
  }
  resolveScopedChapters(allChapterRows, input).forEach((chapter) => addEvidence(evidence, {
    ref: `chapter:${chapter.id}`,
    kind: 'chapter',
    title: `第 ${chapter.chapterNum} 章${chapter.title ? ` · ${chapter.title}` : ''}`,
    summary: chapter.outline || chapter.summary || chapter.nextChapterSeed || '',
  }))
  threadRows.slice(0, 32).forEach((thread) => addEvidence(evidence, {
    ref: `thread:${thread.id}`,
    kind: 'thread',
    title: thread.title,
    summary: [thread.threadType, thread.status, thread.summary, thread.currentState, thread.payoffCondition].filter(Boolean).join('；'),
  }))
  factionRows.slice(0, 24).forEach((faction) => addEvidence(evidence, {
    ref: `faction:${faction.id}`,
    kind: 'faction',
    title: faction.name,
    summary: [faction.type, faction.goal, faction.resources, faction.currentPhase].filter(Boolean).join('；'),
  }))
  resistanceRows
    .filter((track) => !selectedVolume || track.linkedVolumeId == null || track.linkedVolumeId === selectedVolume.id)
    .slice(0, 24)
    .forEach((track) => addEvidence(evidence, {
      ref: `resistance:${track.id}`,
      kind: 'resistance',
      title: track.title,
      summary: [track.resistanceKind, track.goal, track.escalationPlan, track.counterMove].filter(Boolean).join('；'),
    }))
  itemRows
    .filter((item) => item.itemKind === 'instance')
    .slice(0, 20)
    .forEach((item) => addEvidence(evidence, {
      ref: `item:${item.id}`,
      kind: 'item',
      title: item.itemName,
      summary: [item.category, item.summary, item.plotFunction, item.ownerCharacterId ? `持有者 #${item.ownerCharacterId}` : '暂无持有者'].filter(Boolean).join('；'),
    }))

  const threadCharacterIds = threadRows.flatMap((thread) => parseIds(thread.relatedCharacterIdsJson))
  const resistanceCharacterIds = resistanceRows
    .filter((track) => track.sourceType === 'character' && typeof track.sourceId === 'number')
    .map((track) => track.sourceId as number)
  const lookaheadText = input.scope?.lookaheadChapters
    ? `，前瞻 ${input.scope.lookaheadChapters} 章`
    : ''
  const scopeSummary = selectedVolume
    ? `第 ${selectedVolume.volumeNumber} 卷「${selectedVolume.title || '未命名'}」${lookaheadText}`
    : `全书${lookaheadText}`

  return {
    novelId: novel.id,
    novelTitle: novel.title,
    genre: profile.genre,
    operatingMode: novel.operatingMode,
    targetWords: novel.targetWords,
    contextVersion: novel.contextVersion || 1,
    modelConfigId: novel.modelConfigId || undefined,
    scopeSummary,
    profile: {
      premise: clip(profile.premiseSummary, 2400),
      storyDesign: clip(profile.storyDesignSummary, 3200),
      endgame: clip(profile.endgameDesignSummary, 2200),
      worldRules: clip(profile.worldRulesSummary, 3200),
      storyThreads: clip(profile.storyThreadsSummary, 2400),
      writingRules: clip(profile.writingRulesSummary, 1600),
    },
    existingCharacters: characters.map(toContextCharacter),
    existingCount: characters.length,
    priorRange,
    coveragePrior: coveragePrior(characters, threadCharacterIds, resistanceCharacterIds),
    evidence: evidence.slice(0, 100),
  }
}

async function runPlanningModel(request: CharacterCastModelRequest) {
  const novel = novelService.getNovel(request.novelId)
  if (!novel) throw new CharacterCastPlanningError('PROJECT_NOT_FOUND', `未找到项目 #${request.novelId}。`)
  const mode = resolveAiExecutionMode({
    explicitMode: request.executionMode,
    settingsJson: novel.settingsJson,
  })
  const isReview = request.phase === 'review'
  const route = buildAiModelRouteReport({
    taskKind: isReview ? 'character_review' : 'character_planning',
    stageLabel: isReview ? 'Character Cast Review' : 'Character Cast Planning',
    executionMode: mode.mode,
    resolutionSource: mode.source,
    modelConfigId: request.modelConfigId || novel.modelConfigId || undefined,
    temperatureCap: isReview ? 0.3 : 0.65,
    maxTokensFactor: isReview ? 0.72 : 1,
    extraReasons: [
      isReview
        ? '人物生态审校独立于规划阶段，优先稳定诊断。'
        : '人物数量由功能位覆盖推导，结果只生成计划而不写正式角色。',
    ],
  })
  const taskType = isReview ? 'character_cast_review' : 'character_cast_plan'
  const messages = [{ role: 'user' as const, content: request.prompt }]
  const inputJson = JSON.stringify(messages)
  const taskId = await createTask({
    type: taskType,
    novelId: request.novelId,
    modelConfigId: route.modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: request.novelId,
    inputJson,
    runnerType: 'chat',
    retryable: true,
  })
  const output = await executeChatTask(taskId, {
    type: taskType,
    novelId: request.novelId,
    modelConfigId: route.modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: request.novelId,
    inputJson,
    messages,
    chatOpts: buildChatOptionsFromRoute(route),
    retryable: true,
  })
  return { taskId, output }
}

export async function analyzeCharacterNeeds(
  input: CharacterNeedsAnalysisInput,
): Promise<CharacterNeedsAnalysisResult> {
  const result = await runCharacterNeedsAnalyzer(input, {
    loadContext: loadPlanningContext,
    runModel: runPlanningModel,
  })
  const resolvedModelConfigId = input.modelConfigId || novelService.getNovel(input.novelId)?.modelConfigId || null
  createArtifact({
    id: result.planId,
    novelId: input.novelId,
    kind: 'character_cast_plan',
    status: result.review.status === 'blocked' ? 'rejected' : 'reviewed',
    content: result,
    contextVersion: result.contextVersion,
    producerType: 'novelforge_model',
    producerId: `task:${result.taskId}`,
    producerClient: 'novelforge-character-planner',
    modelConfigId: resolvedModelConfigId,
    taskId: result.taskId,
  })
  return result
}
