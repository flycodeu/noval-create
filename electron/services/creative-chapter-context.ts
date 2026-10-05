import { compileContextPack, stableHash, type ContextPackSource } from '../../src/shared/context-pack'
import { hasHardContractValidationBlocker } from '../../src/shared/contract-validation'
import { estimateTokens } from '../../src/shared/token-budget'
import type { CreativeContextReport, CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import type { StoryAtlasChange, StoryAtlasEntity, StoryAtlasRelation } from '../../src/shared/story-atlas'
import type { GenericAssetDraftContent } from '../../src/shared/generic-asset-workflow'
import { parseStorySettingsDocument } from '../../src/shared/story-settings'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import { listChapters } from './chapter.service'
import { getNovel } from './novel.service'
import { queryStoryAtlas } from './story-atlas.service'
import { getChapterContractBlockers, loadChapterContractAuditContext } from './chapter-publish-contract-gate'
import { validateChapterContractDelivery } from './chapter-contract-validator.service'
import { listSceneContracts } from './endgame-asset.service'
import { requireArtifact } from './artifact.service'
import { resolveProsePolicyMaterial } from './prose-operation.service'
import { creativeChapterRecallQuery, recallCreativeChapterSources } from './creative-chapter-recall'
import { creativeAtlasCoverage, creativePublicAttributes, selectChapterAtlasIntroductions, selectCreativeAtlas } from './creative-atlas-context'
import { chapterRevisionGenerationMaterial, type ChapterRevisionBase } from './creative-chapter-revision'
import { creativeRevisionIssueSources } from './creative-review-issues'
import {
  buildContextVisibilityPolicy, filterChapterContextByVisibility, loadContextVisibilityPolicyInput,
  projectPreviousChapterSources, type ContextVisibilityPolicy,
} from './context-visibility'

export class CreativeChapterContextError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CreativeChapterContextError' }
}
function fail(code: string, message: string): never { throw new CreativeChapterContextError(code, message) }
function ids(raw?: string | null): number[] {
  try { const value = JSON.parse(raw || '[]'); return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id) && id > 0) : [] } catch { return [] }
}

/** Read-only prerequisite inspection; orchestration may generate/review missing contracts before retrying. */
export function inspectCreativeChapterPrerequisites(novelId: number, chapterNum: number) {
  if (!Number.isInteger(chapterNum) || chapterNum < 1) fail('CHAPTER_POSITION_INVALID', '正文必须指定正整数章序。')
  const chapterRows = listChapters(novelId)
  const chapter = chapterRows.find(row => row.chapterNum === chapterNum)
  if (!chapter) return { chapterId: null, blockers: [`第 ${chapterNum} 章尚未建立，需要先生成章节计划。`] }
  const context = loadChapterContractAuditContext(chapter.id)
  const blockers = getChapterContractBlockers(chapter.id)
  const previous = chapterRows.filter(row => row.chapterNum < chapterNum && row.content?.trim()).sort((a, b) => b.chapterNum - a.chapterNum)[0]
  if (previous?.writebackStatusJson) {
    try {
      const sync = JSON.parse(previous.writebackStatusJson) as { runId?: number; phase?: string; blockedGeneration?: boolean; readyForNextChapter?: boolean }
      // A legacy "needs_sync" marker is also set on saves by the modern transactional flow.
      // Only an actual writeback run (or one being prepared) owns this gate.
      const hasWriteback = typeof sync.runId === 'number' && sync.runId > 0 || ['extracting', 'applying'].includes(sync.phase || '')
      if (hasWriteback && (sync.blockedGeneration === true || sync.readyForNextChapter === false)) blockers.push(`第 ${previous.chapterNum} 章回写仍待决定或处理，完成后才能推进下一章。`)
    } catch { blockers.push(`第 ${previous.chapterNum} 章回写状态无法读取，请先核对。`) }
  }
  if (!context.sceneSnapshots.length) blockers.push('章节至少需要一个已审校的场景合同。')
  return { chapterId: chapter.id, blockers }
}

function loadChapterBoundary(novelId: number, chapterNum: number) {
  const prerequisites = inspectCreativeChapterPrerequisites(novelId, chapterNum)
  if (prerequisites.blockers.length || !prerequisites.chapterId) fail('CHAPTER_PREREQUISITES_REQUIRED', prerequisites.blockers.join('；'))
  const context = loadChapterContractAuditContext(prerequisites.chapterId)
  // Scene order is narrative segmentOrder, which can differ from insertion IDs after reordering.
  const sceneRows = listSceneContracts(context.chapter.id)
  const visibilityInput = loadContextVisibilityPolicyInput(novelId, context.chapter.id, chapterNum, 'writer', { scenes: sceneRows })
  const policy = buildContextVisibilityPolicy(visibilityInput)
  if (policy.unresolvedPovLabels.length || !policy.povCharacterIds.length) fail('CHAPTER_POV_UNRESOLVED', '场景视角必须对应现有人物的唯一姓名。')
  const allowed = new Set(ids(context.chapter.allowedFactIdsJson))
  const revealed = new Set(ids(context.chapter.revealedFactIdsJson))
  const factIds = new Set([
    ...policy.allowedFacts.map(item => item.fact.id),
    ...policy.sceneLimitedFacts.map(item => item.fact.fact.id),
    ...policy.deniedFacts.map(item => item.fact.id),
  ])
  for (const id of [...allowed, ...revealed]) if (!factIds.has(id)) fail('CHAPTER_FACT_REFERENCE_INVALID', `章节引用的信息点 fact:${id} 不属于当前项目。`)
  for (const directive of policy.revealDirectives) {
    if (!allowed.has(directive.factId) || !revealed.has(directive.factId)) fail('CHAPTER_REVEAL_NOT_AUTHORIZED', `场景揭示 fact:${directive.factId} 未同时登记到本章 allowedFactIds 与 revealedFactIds。`)
  }
  for (const id of revealed) if (!policy.revealDirectives.some(directive => directive.factId === id)) fail('CHAPTER_REVEAL_SCENE_MISSING', `本章揭示 fact:${id} 缺少对应的可执行场景指令。`)
  return { context, policy, povNames: visibilityInput.characters.filter(character => policy.povCharacterIds.includes(character.id)).map(character => character.fullName) }
}

// Reuse the established writer visibility filter; only this one field is populated.
function visibleText(text: string, policy: ContextVisibilityPolicy): string {
  const empty = {
    storyCore: text, continuityNotes: '', writingContractSummary: '', hardConstraintContext: '', hardConstraintSummary: '',
    hardConstraintEntries: [], recalledMemorySources: [], previousChapterSampleReport: { segments: [] },
  } as unknown as Parameters<typeof filterChapterContextByVisibility>[0]
  return filterChapterContextByVisibility(empty, policy).storyCore
}
const chapterWorldFields: Record<string, string[]> = {
  genreProfile: ['key', 'name', 'subgenre', 'worldviewTone', 'socialFrame', 'narrativeFocus', 'languageAvoidances'],
  powerSystems: ['id', 'name', 'appliesTo', 'levels', 'advancementRule', 'limitations', 'cost', 'taboo', 'conditions', 'range', 'countermeasures'],
  speciesSystem: ['id', 'name', 'entityType', 'summary', 'traits', 'commonIdentities', 'relationToHumans', 'conditions', 'limitations', 'cost'],
  timelineConfig: ['dynastyName', 'storyStartLabel', 'calendarType', 'eraName', 'epochLabel', 'baseYearLabel', 'displayPattern', 'relativeZeroLabel', 'precisionOptions'],
  writingConstraints: ['antiQuoteEmphasis', 'antiConceptSlogans', 'antiSymmetricLines', 'narrationStyle', 'dialogueStyle', 'forbiddenPhrases', 'extraRules', 'realismLevel', 'sciencePolicy', 'physicsPolicy', 'commonSenseFocus', 'contextAlignmentFocus'],
}
const authorRuleField = /^(?:storyUse|contextLink|narrativeFunction|plot|plotUse|plotRole|plotNotes|caseAnswer|caseSolution|culprit|reveal|revealPlan|ending|endgame|resolution|plannedOutcome|futurePlan|authorNotes|secret|hiddenSecret)$/iu

/** World design is not POV knowledge: keep physical constraints, not casting or case applications. */
function chapterWorldValue(section: string, value: unknown, omitted: string[]): unknown {
  const drop = (path: string) => omitted.push(`world_rules:${path}:author_planning`)
  const clean = (input: unknown, path: string): unknown => {
    if (Array.isArray(input)) return input.map((item, index) => clean(item, `${path}:${index}`)).filter(item => item !== undefined)
    if (!input || typeof input !== 'object') return input
    const record = input as Record<string, unknown>
    if (record.futureOnly === true || record.authorOnly === true || record.status === 'planned') { drop(path); return undefined }
    return Object.fromEntries(Object.entries(record).flatMap(([key, item]) => {
      if (authorRuleField.test(key)) { drop(`${path}:${key}`); return [] }
      const safe = clean(item, `${path}:${key}`)
      return safe === undefined ? [] : [[key, safe]]
    }))
  }
  const pick = (input: unknown, keys: string[], path: string): unknown => {
    if (Array.isArray(input)) return input.map((item, index) => pick(item, keys, `${path}:${index}`)).filter(item => item !== undefined)
    if (!input || typeof input !== 'object') { drop(path); return undefined }
    return clean(Object.fromEntries(Object.entries(input).filter(([key]) => {
      if (keys.includes(key)) return true
      drop(`${path}:${key}`); return false
    })), path)
  }
  if (section === 'worldDynamics' && value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) if (!['climateCycles', 'economyLoops'].includes(key)) drop(`${section}:${key}`)
    return {
      // travelImpact and volatilityTrigger are author application fields that can state case mechanisms.
      climateCycles: pick(record.climateCycles || [], ['id', 'region', 'pattern', 'seasonalShift', 'hazardTrigger', 'resourceImpact'], `${section}:climateCycles`),
      economyLoops: pick(record.economyLoops || [], ['id', 'name', 'coreResource', 'circulationPath', 'controller', 'scarcityTrigger'], `${section}:economyLoops`),
    }
  }
  const keys = chapterWorldFields[section]
  if (!keys) { drop(section); return undefined }
  return pick(value, keys, section)
}
/** Only saved material is projected: no genre defaults or inferred canon. */
export function creativeProjectSources(novel: { worldRulesJson?: string | null; settingsJson?: string | null; themeVoiceJson?: string | null }, chapter = false, omitted: string[] = []) {
  const entries: Array<{ key: string; value: unknown; required: boolean }> = []
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return
    const required = /^(?:premise:(?:constraints|languageGuardrails)|writing_rules:|world_rules:(?:powerSystems|writingConstraints)|voice:(?:pov|tense|viewpointMode|narratorDistance|styleRules|dialogueRules|descriptionRules|forbiddenPhrases|writingContractTags)|story_design:(?:storyGoal|coreConflict))/u.test(key)
    entries.push({ key, value, required })
  }
  const settings = parseStorySettingsDocument(novel.settingsJson)
  for (const [key, value] of Object.entries(settings.premise)) add(`premise:${key}`, value)
  for (const [key, value] of Object.entries(settings.writingRules)) add(`writing_rules:${key}`, value)
  for (const [key, value] of Object.entries(settings.storyDesign)) {
    if (!chapter || key === 'storyGoal' || key === 'coreConflict') add(`story_design:${key}`, value)
  }
  if (!chapter) for (const [key, value] of Object.entries(settings.endgameDesign)) add(`endgame_design:${key}`, value)
  for (const [key, value] of Object.entries(parseThemeVoiceDocument(novel.themeVoiceJson))) add(`voice:${key}`, value)
  if (novel.worldRulesJson?.trim()) {
    let world: unknown
    try { world = JSON.parse(novel.worldRulesJson) } catch { fail('WORLD_RULES_INVALID', '已保存世界规则不是有效 JSON，请先修复规则资料。') }
    if (!world || typeof world !== 'object' || Array.isArray(world)) fail('WORLD_RULES_INVALID', '已保存世界规则必须为 JSON 对象。')
    for (const [section, raw] of Object.entries(world)) {
      if (section === 'version') continue
      const value = chapter ? chapterWorldValue(section, raw, omitted) : raw
      if (value === undefined) continue
      // Keep each rule intact, but a hidden item must not suppress unrelated public rules.
      if (Array.isArray(value)) value.forEach((item, index) => add(`world_rules:${section}:${index}`, item))
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) add(`world_rules:${section}:${key}`, item)
      else add(`world_rules:${section}`, value)
    }
  }
  return entries
}

export function creativeRevisionSource(input: CreativeWorkflowInput): string | undefined {
  if (!input.sourceArtifactId) return undefined
  const artifact = requireArtifact<GenericAssetDraftContent>(input.sourceArtifactId)
  if (artifact.novelId !== input.novelId || artifact.kind !== 'generic_draft' || artifact.content.schemaVersion !== 'generic-asset-draft-v1'
    || typeof artifact.content.output !== 'string' || !artifact.content.output.trim()) {
    fail('REVISION_SOURCE_INVALID', '修订来源必须是当前项目的有效创作候选。')
  }
  // Structured revision evidence must stay complete. Formatting whitespace outside strings
  // is not story evidence and can otherwise consume the entire local planning margin.
  try {
    const value: unknown = JSON.parse(artifact.content.output)
    if (value && typeof value === 'object') return JSON.stringify(value)
  } catch { /* A textual candidate remains intact, including a malformed JSON draft to repair. */ }
  return artifact.content.output
}

function sceneInChapterContract(
  scenes: Array<{ sceneId: number; sceneOrder: number; povName: string }>,
  snapshots: Array<{ segmentId?: number; segmentOrder?: number; pov?: string }>,
): boolean {
  return scenes.length > 0 && scenes.every(scene => snapshots.some(snapshot => {
    if (snapshot.pov && snapshot.pov !== scene.povName) return false
    if (typeof snapshot.segmentId === 'number' && snapshot.segmentId === scene.sceneId) return true
    if (typeof snapshot.segmentOrder === 'number' && snapshot.segmentOrder === scene.sceneOrder) return true
    return snapshot.segmentId == null && snapshot.segmentOrder == null && snapshot.pov === scene.povName
  }))
}

/** The chapter writer never receives raw expanded background, private attributes or future graph states. */
export async function compileCreativeChapterContext(
  input: CreativeWorkflowInput,
  limits: { maxInputTokens: number; outputReserve: number },
  revisionBase?: ChapterRevisionBase,
): Promise<CreativeContextReport> {
  if (revisionBase?.revision.target === 'summary') {
    const text = `[task] ${JSON.stringify({ request: input.request, revision: input.chapterRevision })}\n[chapter_revision] ${JSON.stringify(chapterRevisionGenerationMaterial(revisionBase))}`
    if (estimateTokens(text) > limits.maxInputTokens) fail('CHAPTER_CONTEXT_BUDGET', '本章摘要修订的完整正文依据超过预算，请切换模型或降低输出上限。')
    return { text, estimatedTokens: estimateTokens(text), ...limits, sources: ['task', 'chapter_revision'], omittedSources: ['future_plans:outside_summary_scope'] }
  }
  const chapterRows = listChapters(input.novelId)
  const chapterNum = input.atChapter ?? chapterRows.filter(row => row.content?.trim()).reduce((n, row) => Math.max(n, row.chapterNum), 0) + 1
  const { context, policy, povNames } = loadChapterBoundary(input.novelId, chapterNum)
  const novel = getNovel(input.novelId)
  if (!novel) fail('PROJECT_NOT_FOUND', '项目不存在。')
  const atlas = queryStoryAtlas({ novelId: input.novelId, atChapter: chapterNum, boundary: 'start', includePlanned: false })
  const sources: Partial<ContextPackSource>[] = []
  const omitted = ['expanded_background:author_only', 'story_design:future_plan', 'endgame_design:author_only']
  const add = (key: string, value: unknown, required = false, visibility: ContextPackSource['visibility'] = 'canon', sourcePolicy = policy) => {
    const text = typeof value === 'string' ? value.trim() : JSON.stringify(value)
    if (!text) return
    const safe = visibleText(text, sourcePolicy)
    if (!safe) {
      if (required) fail('CHAPTER_REQUIRED_SOURCE_HIDDEN', `必要资料 ${key} 与本章视角/揭示范围冲突，需要先修订计划。`)
      omitted.push(`${key}:pov_forbidden_fact`); return
    }
    sources.push({ key, sourceKind: key.split(':')[0], sourceId: key, sourceVersion: stableHash(text), text: safe, required, included: true, visibility })
  }
  const revealIds = new Set(policy.revealDirectives.map(directive => directive.factId))
  const contractPolicy = { ...policy, deniedFacts: policy.deniedFacts.filter(item => !revealIds.has(item.fact.id)) }
  add('task', { chapterNum, request: input.request, rule: '只使用本章已知资料。人物内在目标、动机和自身能力只限本人视角使用，不能移入其他人物视角；其他人物公开目标以 publicGoal 或已知信息点为准。场景限定揭示不得提前或移入其他视角。新增图谱事实必须逐条附 attributes.evidenceQuote，引用本次正文原句；不改写既往事实。' }, true, 'plan', contractPolicy)
  for (const source of creativeProjectSources(novel, true, omitted)) {
    const text = typeof source.value === 'string' ? source.value : JSON.stringify(source.value)
    if (visibleText(text, policy)) add(source.key, source.value, source.required, 'plan')
    else omitted.push(`${source.key}:pov_forbidden_fact`)
  }
  // Public project premise is useful in the first chapter; retain only whole safe paragraphs.
  for (const [index, paragraph] of (novel.userBackground || '').split(/\r?\n+/).entries()) add(`background:${index}`, paragraph)
  if (!revisionBase && input.operation !== 'review' && context.chapter.content?.trim()) add(`chapter:${context.chapter.id}:original`, context.chapter.content, true, 'draft', contractPolicy)
  const revisionSource = revisionBase ? undefined : creativeRevisionSource(input)
  if (revisionSource) add(`revision:${input.sourceArtifactId}`, revisionSource, true, 'draft', contractPolicy)
  if (revisionBase) add('chapter_revision', chapterRevisionGenerationMaterial(revisionBase), true, 'draft', contractPolicy)
  add(`chapter:${context.chapter.id}:contract`, {
    chapterNum, title: context.chapter.title, outline: context.chapter.outline, ...context.chapterContract,
    forbiddenActions: context.chapterContractRow?.forbiddenActionsJson,
    scenes: context.sceneSnapshots,
  }, true, 'plan', contractPolicy)
  for (const fact of policy.allowedFacts) add(`fact:${fact.fact.id}`, [fact.fact.title, fact.fact.summary].filter(Boolean).join('：'))
  for (const issue of creativeRevisionIssueSources(input)) add(`revision_issue:${issue.id}`, issue, true, 'draft', { ...policy, deniedFacts: [] })
  for (const limited of policy.sceneLimitedFacts) {
    const scenes = limited.scenes.map(scene => `场景${scene.sceneOrder}（scene:${scene.sceneId}，${scene.povName}#${scene.povCharacterId}）`).join('、')
    const body = [limited.fact.fact.title, limited.fact.fact.summary].filter(Boolean).join('：')
    add(`fact:${limited.fact.fact.id}:scene_limited`, `仅限指定场景和该视角使用，其他场景不得写出或暗示。允许场景：${scenes}。${body}`, sceneInChapterContract(limited.scenes, context.sceneSnapshots))
  }
  if (input.operation === 'review') {
    const original = `${context.chapter.content || ''}\n${input.request}`
    for (const item of policy.deniedFacts) {
      if (![item.fact.title, item.fact.summary].some(text => text && text.trim().length >= 2 && original.includes(text.trim()))) continue
      add(`review_boundary:fact:${item.fact.id}`, {
        instruction: '仅供评审核对：下列信息在本章开场对视角人物不可知；仅已授权场景揭示可出现，不能把原文出现视为已知授权。',
        title: item.fact.title, summary: item.fact.summary,
        authorizedScenes: policy.revealDirectives.filter(directive => directive.factId === item.fact.id),
      }, true, 'plan', { ...policy, deniedFacts: [] })
    }
  }
  for (const directive of policy.revealDirectives) {
    add(`reveal:${directive.sceneId}:${directive.factId}`, `仅限指定场景，不能作为章首已知事实。${directive.text}`, true, 'plan', contractPolicy)
  }
  const safeEntityIds = new Set<string>()
  const dependency = `${input.request}\n${JSON.stringify(context.sceneSnapshots)}\n${JSON.stringify(context.chapterContract)}\n${context.chapter.title}\n${context.chapter.outline || ''}`
  const previous = chapterRows.filter(row => row.chapterNum < chapterNum && row.content?.trim()).sort((a, b) => b.chapterNum - a.chapterNum)[0]
  const { entityIds: relevant, relationIds: relevantEdges } = selectCreativeAtlas(atlas, {
    request: input.request, anchorText: dependency, povNames,
    fallbackText: previous?.summary || previous?.content?.slice(-2000),
  })
  const introductions = selectChapterAtlasIntroductions(atlas, queryStoryAtlas({ novelId: input.novelId, atChapter: chapterNum, includePlanned: false }), {
    chapterNum, request: input.request, anchorText: dependency, povNames,
  })
  const introductionIds = new Set(introductions.entities.map(entity => entity.id))
  for (const id of [...introductionIds, ...introductions.previousParentIds]) relevant.add(id)
  if (introductionIds.size) add('chapter_introductions', {
    chapterNum, entityIds: [...introductionIds],
    instruction: '以下资料是本章引入计划，仅用于本章合同或请求明确安排的人物、地点等首次登场，以及必要的父地点。它们不是章首已知事实，也不表示登场、相识、到达或事件已经发生；必须在本章相应场景中建立。只能使用公开资料与本人视角允许的信息，不得据此补造关系、行程或提前揭示秘密。',
  }, true, 'plan')
  const safeEntities: StoryAtlasEntity[] = []
  const safeRelations: StoryAtlasRelation[] = []
  const ordered = [...atlas.entities, ...introductions.entities].sort((a, b) => Number(relevant.has(b.id)) - Number(relevant.has(a.id)))
  for (const entity of ordered) {
    if (!relevant.has(entity.id)) { omitted.push(`${entity.id}:unrelated_to_chapter`); continue }
    // Identity/public description are filtered too; provenance and arbitrary attribute payloads stay out.
    if (entity.attributes.futureOnly === true || entity.attributes.authorOnly === true) { omitted.push(`${entity.id}:author_only`); continue }
    const isPov = povNames.includes(entity.name)
    const isNpc = entity.kind === 'character' && !isPov
    const publicProjection = creativePublicAttributes(entity.attributes, { kind: entity.kind, isPov })
    for (const key of Object.keys(entity.attributes)) if (!(key in publicProjection)) omitted.push(`${entity.id}:attributes.${key}:not_public_to_pov`)
    const attributes = Object.fromEntries(Object.entries(publicProjection).filter(([key, value]) => {
      const allowed = Boolean(visibleText(JSON.stringify(value), policy))
      if (!allowed) omitted.push(`${entity.id}:attributes.${key}:pov_forbidden_fact`)
      return allowed
    }))
    // Legacy character summaries are author dossiers and can reveal a culprit without a registered fact.
    // Public description is explicit; do not manufacture one from the withheld private dossier.
    const summarySource = isNpc ? typeof entity.attributes.publicSummary === 'string' ? entity.attributes.publicSummary : '' : entity.summary
    if (isNpc && entity.summary) omitted.push(`${entity.id}:summary:not_public_to_pov`)
    const summary = visibleText(summarySource, policy)
    if (summarySource && !summary) omitted.push(`${entity.id}:summary:pov_forbidden_fact`)
    delete attributes.publicSummary
    const value = { id: entity.id, kind: entity.kind, name: entity.name, summary, parentId: entity.parentId, attributes }
    if (visibleText(JSON.stringify(value), policy)) { safeEntityIds.add(entity.id); safeEntities.push({ ...entity, ...value }) }
    if (introductionIds.has(entity.id)) add(`chapter_introduction:${entity.id}`, value, true, 'plan')
    else add(entity.id, value, relevant.has(entity.id))
  }
  for (const edge of atlas.relations) if (relevantEdges.has(edge.id) && safeEntityIds.has(edge.fromId) && safeEntityIds.has(edge.toId)) {
    if (edge.attributes.futureOnly === true || edge.attributes.authorOnly === true) { omitted.push(`relation:${edge.id}:author_only`); continue }
    const attributes = creativePublicAttributes(edge.attributes)
    if (edge.kind === 'membership' && attributes.positionId) {
      const organization = safeEntities.find(entity => entity.id === edge.toId)
      const established = organization?.attributes.positions as Array<{ id: string }> | undefined
      if (!established?.some(position => position.id === attributes.positionId)) { delete attributes.positionId; omitted.push(`relation:${edge.id}:position_not_established`) }
    }
    const value = { id: edge.id, kind: edge.kind, fromId: edge.fromId, toId: edge.toId, label: edge.label, attributes }
    if (!visibleText(JSON.stringify(value), policy)) { omitted.push(`relation:${edge.id}:pov_forbidden_fact`); continue }
    safeRelations.push({ ...edge, ...value })
    add(`relation:${edge.id}`, value, relevantEdges.has(edge.id))
  }
  add('atlas_coverage', creativeAtlasCoverage({ entities: safeEntities, relations: safeRelations }, new Set([...relevant].filter(id => safeEntityIds.has(id)))), true, 'plan')
  if (previous) {
    const projected = projectPreviousChapterSources(previous, policy, dependency)
    // Actual prose is already reader-visible. Preserve paragraphs without forbidden facts even when no
    // registered fact happens to be mentioned; do not silently discard the previous chapter ending.
    for (const source of projected) {
      if (source.reason === 'unclassified_visibility') {
        const text = previous.content!.slice(source.start!, source.end!)
        sources.push({ ...source, text, included: true, reason: 'previous_prose_without_forbidden_fact', required: source.end === previous.content!.trimEnd().length, estimatedTokens: estimateTokens(text) })
      } else if (source.included) sources.push(source)
      else omitted.push(`${source.key}:${source.reason}`)
    }
  }
  const recalled = await recallCreativeChapterSources({ novelId: input.novelId, chapterNum, previousChapterId: previous?.id,
    queryText: creativeChapterRecallQuery([context.chapter.title || '', context.chapter.outline || '',
      ...context.sceneSnapshots.flatMap(scene => [scene.sceneGoal, scene.obstacle, scene.timeLocation]), input.request]),
    chapters: chapterRows, policy, maxInputTokens: limits.maxInputTokens, modelConfigId: novel.modelConfigId || undefined })
  sources.push(...recalled.sources)
  omitted.push(...recalled.omitted)
  // Samples and chapter-scoped feedback pass through the same visibility and token selection as prose.
  const narrative = resolveProsePolicyMaterial(input.novelId, context.chapter.id)
  if (narrative.policy.policyVersion === 'reader-first-v1') {
    add('reader_policy', '保留事实、视角和有效表达；未确认计划不当作已经发生的事实。作者样稿仅用于语感，不得复制情节或当作本章已知事实。', true, 'plan')
    for (const [index, paragraph] of narrative.reference.split(/\r?\n+/).entries()) add(`author_reference:${index}`, paragraph, false, 'plan')
  }
  // Include rendering overhead in selection; compiler otherwise counts payload text alone.
  const compiled = await compileContextPack({ novelId: input.novelId, chapterId: context.chapter.id, chapterNum, stage: 'draft',
    contextVersion: novel.contextVersion || 1, contractVersion: stableHash({ contract: context.chapterContractRow, scenes: context.sceneSnapshots }),
    outputReserve: limits.outputReserve, budget: limits.maxInputTokens,
    sources: sources.map(source => ({ ...source, text: source.text || '', estimatedTokens: estimateTokens(`[${source.visibility}] ${source.key}: ${source.text}\n`) })),
  })
  if (compiled.diagnostics.requiredOverflow || estimateTokens(compiled.rendered) > limits.maxInputTokens) fail('CHAPTER_CONTEXT_BUDGET', '本章必要资料超过输入预算，需要缩小场景范围或切换模型。')
  return { text: compiled.rendered, estimatedTokens: estimateTokens(compiled.rendered), ...limits,
    sources: compiled.pack.sources.filter(source => source.included).map(source => source.key),
    omittedSources: [...omitted, ...compiled.pack.sources.filter(source => !source.included).map(source => `${source.key}:${source.reason}`)],
  }
}

/** Deterministic checks complement independent semantic review; no writes occur here. */
export function creativeChapterSceneVisibility(novelId: number, chapterNum: number) {
  const { policy } = loadChapterBoundary(novelId, chapterNum)
  return [...policy.sceneLimitedFacts.map(item => ({
    factId: item.fact.fact.id, title: item.fact.fact.title, summary: item.fact.fact.summary,
    allowedScenes: item.scenes,
    authorizedRevelations: policy.revealDirectives.filter(directive => directive.factId === item.fact.fact.id),
  })), ...policy.deniedFacts.map(item => ({
    factId: item.fact.id, title: item.fact.title, summary: item.fact.summary,
    allowedScenes: [], authorizedRevelations: policy.revealDirectives.filter(directive => directive.factId === item.fact.id),
  }))]
}

export function assertCreativeChapterCandidate(input: {
  novelId: number; chapterNum: number; content: string; expectedContextVersion?: number; changes?: StoryAtlasChange[]
}) {
  const novel = getNovel(input.novelId)
  if (!novel) fail('PROJECT_NOT_FOUND', '项目不存在。')
  if (input.expectedContextVersion !== undefined && (novel.contextVersion || 1) !== input.expectedContextVersion) fail('CHAPTER_CONTEXT_STALE', '本章生成期间资料已变化，请重新编译并审校。')
  const { context, policy } = loadChapterBoundary(input.novelId, input.chapterNum)
  const revealed = new Set(policy.revealDirectives.map(directive => directive.factId))
  for (const item of policy.deniedFacts.filter(fact => !revealed.has(fact.fact.id))) {
    if ([item.fact.title, item.fact.summary].some(text => text && text.trim().length >= 2 && input.content.includes(text.trim()))) fail('CHAPTER_FORBIDDEN_FACT', `正文包含本章不可揭示的信息点 fact:${item.fact.id}。`)
  }
  for (const change of input.changes || []) {
    if (change.op !== 'retire' && change.attributes?.stateTiming === 'chapter_start') fail('CHAPTER_CHANGE_TIMING_INVALID', '正文实际发生的变化只能在章内或章末生效，不能倒写为章初状态。')
    if (change.op === 'retire') fail('CHAPTER_RETIRE_FORBIDDEN', '正文写回不能删除既有图谱事实，请提交明确的资料修订。')
    const quote = change.attributes?.evidenceQuote
    if (typeof quote !== 'string' || quote.trim().length < 4 || !input.content.includes(quote.trim())) fail('CHAPTER_CHANGE_EVIDENCE_MISSING', '每项图谱变化必须附 attributes.evidenceQuote，并逐字引用本次正文至少 4 个字符。')
  }
  const validation = validateChapterContractDelivery({ chapterId: context.chapter.id, content: input.content })
  // These legacy heuristics impose genre advice even when no such delivery was contracted.
  // Keep their diagnostics for review, but do not force new plot consequences into a quiet scene.
  const contractedValidation = { ...validation, itemResults: validation.itemResults.filter(item =>
    item.contractItemType !== 'golden_three_state_delivery'
    && (item.contractItemType !== 'chapter_hook' || Boolean(context.chapterContract.hookType)),
  ) }
  if (hasHardContractValidationBlocker(contractedValidation)) fail('CHAPTER_CONTRACT_NOT_DELIVERED', `正文未兑现必要合同：${validation.summary}`)
  return { chapterId: context.chapter.id, validation }
}
