import { compileContextPack, stableHash, type ContextPackSource } from '../../src/shared/context-pack'
import { hasHardContractValidationBlocker } from '../../src/shared/contract-validation'
import { estimateTokens } from '../../src/shared/token-budget'
import type { CreativeContextReport, CreativeWorkflowInput } from '../../src/shared/creative-workflow'
import type { StoryAtlasChange } from '../../src/shared/story-atlas'
import { listChapters } from './chapter.service'
import { getNovel } from './novel.service'
import { queryStoryAtlas } from './story-atlas.service'
import { getChapterContractBlockers, loadChapterContractAuditContext } from './chapter-publish-contract-gate'
import { validateChapterContractDelivery } from './chapter-contract-validator.service'
import { listSceneContracts } from './endgame-asset.service'
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
  const chapter = listChapters(novelId).find(row => row.chapterNum === chapterNum)
  if (!chapter) return { chapterId: null, blockers: [`第 ${chapterNum} 章尚未建立，需要先生成章节计划。`] }
  const context = loadChapterContractAuditContext(chapter.id)
  const blockers = getChapterContractBlockers(chapter.id)
  if (!context.sceneSnapshots.length) blockers.push('章节至少需要一个已审校的场景合同。')
  return { chapterId: chapter.id, blockers }
}

function loadChapterBoundary(novelId: number, chapterNum: number) {
  const prerequisites = inspectCreativeChapterPrerequisites(novelId, chapterNum)
  if (prerequisites.blockers.length || !prerequisites.chapterId) fail('CHAPTER_PREREQUISITES_REQUIRED', prerequisites.blockers.join('；'))
  const context = loadChapterContractAuditContext(prerequisites.chapterId)
  // Scene order is narrative segmentOrder, which can differ from insertion IDs after reordering.
  const sceneRows = listSceneContracts(context.chapter.id)
  const policy = buildContextVisibilityPolicy(loadContextVisibilityPolicyInput(novelId, context.chapter.id, chapterNum, 'writer', { scenes: sceneRows }))
  if (policy.unresolvedPovLabels.length || !policy.povCharacterIds.length) fail('CHAPTER_POV_UNRESOLVED', '场景视角必须对应现有人物的唯一姓名。')
  const allowed = new Set(ids(context.chapter.allowedFactIdsJson))
  const revealed = new Set(ids(context.chapter.revealedFactIdsJson))
  const factIds = new Set([...policy.allowedFacts, ...policy.deniedFacts].map(item => item.fact.id))
  for (const id of [...allowed, ...revealed]) if (!factIds.has(id)) fail('CHAPTER_FACT_REFERENCE_INVALID', `章节引用的信息点 fact:${id} 不属于当前项目。`)
  for (const directive of policy.revealDirectives) {
    if (!allowed.has(directive.factId) || !revealed.has(directive.factId)) fail('CHAPTER_REVEAL_NOT_AUTHORIZED', `场景揭示 fact:${directive.factId} 未同时登记到本章 allowedFactIds 与 revealedFactIds。`)
  }
  for (const id of revealed) if (!policy.revealDirectives.some(directive => directive.factId === id)) fail('CHAPTER_REVEAL_SCENE_MISSING', `本章揭示 fact:${id} 缺少对应的可执行场景指令。`)
  return { context, policy }
}

// Reuse the established writer visibility filter; only this one field is populated.
function visibleText(text: string, policy: ContextVisibilityPolicy): string {
  const empty = {
    storyCore: text, continuityNotes: '', writingContractSummary: '', hardConstraintContext: '', hardConstraintSummary: '',
    hardConstraintEntries: [], recalledMemorySources: [], previousChapterSampleReport: { segments: [] },
  } as unknown as Parameters<typeof filterChapterContextByVisibility>[0]
  return filterChapterContextByVisibility(empty, policy).storyCore
}
const publicAttributes = new Set([
  'roleType', 'age', 'gender', 'occupation', 'appearance', 'personalityTraits', 'flaws', 'speechPattern',
  'subtype', 'terrain', 'climate', 'waterSource', 'livelihood', 'access', 'x', 'y',
  'category', 'function', 'abilities', 'limitations', 'culture', 'publicGoal',
  'distanceKm', 'travelHours', 'travelMode', 'direction', 'condition', 'relationType',
])
function publicFields(attributes: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => publicAttributes.has(key)))
}

/** The chapter writer never receives raw expanded background, private attributes or future graph states. */
export async function compileCreativeChapterContext(
  input: CreativeWorkflowInput,
  limits: { maxInputTokens: number; outputReserve: number },
): Promise<CreativeContextReport> {
  const chapterRows = listChapters(input.novelId)
  const chapterNum = input.atChapter ?? chapterRows.filter(row => row.content?.trim()).reduce((n, row) => Math.max(n, row.chapterNum), 0) + 1
  const { context, policy } = loadChapterBoundary(input.novelId, chapterNum)
  const novel = getNovel(input.novelId)
  if (!novel) fail('PROJECT_NOT_FOUND', '项目不存在。')
  const atlas = queryStoryAtlas({ novelId: input.novelId, atChapter: chapterNum - 1, includePlanned: false })
  const sources: Partial<ContextPackSource>[] = []
  const omitted = ['expanded_background:author_only', 'world_rules:unscoped_author_material']
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
  add('task', { chapterNum, request: input.request, rule: '只使用本章已知资料。场景限定揭示不得提前或移入其他视角。新增图谱事实必须逐条附 attributes.evidenceQuote，引用本次正文原句；不改写既往事实。' }, true, 'plan')
  // Public project premise is useful in the first chapter; retain only whole safe paragraphs.
  for (const [index, paragraph] of (novel.userBackground || '').split(/\r?\n+/).entries()) add(`background:${index}`, paragraph)
  const revealIds = new Set(policy.revealDirectives.map(directive => directive.factId))
  const contractPolicy = { ...policy, deniedFacts: policy.deniedFacts.filter(item => !revealIds.has(item.fact.id)) }
  add(`chapter:${context.chapter.id}:contract`, {
    chapterNum, title: context.chapter.title, ...context.chapterContract,
    forbiddenActions: context.chapterContractRow?.forbiddenActionsJson,
    scenes: context.sceneSnapshots,
  }, true, 'plan', contractPolicy)
  for (const fact of policy.allowedFacts) add(`fact:${fact.fact.id}`, [fact.fact.title, fact.fact.summary].filter(Boolean).join('：'))
  for (const directive of policy.revealDirectives) {
    add(`reveal:${directive.sceneId}:${directive.factId}`, `仅限指定场景，不能作为章首已知事实。${directive.text}`, true, 'plan', contractPolicy)
  }
  const safeEntityIds = new Set<string>()
  const dependency = `${input.request}\n${JSON.stringify(context.sceneSnapshots)}`
  const ordered = [...atlas.entities].sort((a, b) => Number(dependency.includes(b.name)) - Number(dependency.includes(a.name)))
  for (const entity of ordered) {
    // Identity/public description are filtered too; provenance and arbitrary attribute payloads stay out.
    const attributes = Object.fromEntries(Object.entries(publicFields(entity.attributes)).filter(([key, value]) => {
      const allowed = Boolean(visibleText(JSON.stringify(value), policy))
      if (!allowed) omitted.push(`${entity.id}:attributes.${key}:pov_forbidden_fact`)
      return allowed
    }))
    const summary = visibleText(entity.summary, policy)
    if (entity.summary && !summary) omitted.push(`${entity.id}:summary:pov_forbidden_fact`)
    const value = { id: entity.id, kind: entity.kind, name: entity.name, summary, parentId: entity.parentId, attributes }
    if (visibleText(JSON.stringify(value), policy)) safeEntityIds.add(entity.id)
    add(entity.id, value, dependency.includes(entity.name))
  }
  for (const edge of atlas.relations) if (safeEntityIds.has(edge.fromId) && safeEntityIds.has(edge.toId)) {
    add(`relation:${edge.id}`, { id: edge.id, kind: edge.kind, fromId: edge.fromId, toId: edge.toId, label: edge.label, attributes: publicFields(edge.attributes) })
  }
  const previous = chapterRows.filter(row => row.chapterNum < chapterNum && row.content?.trim()).sort((a, b) => b.chapterNum - a.chapterNum)[0]
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
