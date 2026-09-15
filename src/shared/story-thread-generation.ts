export interface StoryThreadBatchGenerateOptions {
  count?: number
  batchSize?: number
  focus?: string
}

export interface StoryThreadBatchGenerationResult {
  ids: number[]
  requestedCount: number
  createdCount: number
  warnings: string[]
}

export type ExpectationAction = 'raise' | 'advance' | 'respond' | 'defer'
export interface SceneStoryDesign {
  choices?: Array<{ character: string; wants: string; options: string[]; stake: string }>
  expectations?: Array<{ thread_id: number | null; action: ExpectationAction; expected_payoff: string; outcome: string }>
  state_uses?: Array<{ source_id: string; source_hash: string; expected_state: string; resulting_state: string;
    interpretation: 'belief' | 'fact'; change_source_id?: string }>
  result?: string
  aftermath?: string
  causal_pattern?: string
}

export interface StoryDesignThread {
  id: number
  title: string
  payoff: string
  state: string
  status: string
  dueChapter: number | null
  provenance: 'registered-unconfirmed' | 'author-confirmed'
}
export interface StoryDesignStateSource {
  id: string
  hash: string
  kind: 'belief' | 'ability' | 'relationship' | 'rule'
  state: string
  authority: 'confirmed' | 'belief' | 'candidate'
}
export interface StoryDesignScene {
  scene_order: number
  purpose: string
  conflict: string
  beat: string
  location: string
  present_characters: string[]
  story_design?: SceneStoryDesign
}
export interface RecentStoryDesignProjection {
  novelId: number
  chapterNum: number
  threads: StoryDesignThread[]
  sources: StoryDesignStateSource[]
  recentPlans: Array<{ chapterNum: number; hash: string; scenes: StoryDesignScene[] }>
  diagnostics: string[]
}
export interface StoryDesignFinding {
  code: 'expectation_reference' | 'unanswered_expectation' | 'repeated_structure' | 'state_source' | 'belief_promoted' | 'state_reset'
  sceneOrder: number
  evidence: string
  suggestion: string
  route: 'contract_replan'
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 12 && value.every((item) => typeof item === 'string' && item.length <= 1200)
const stringFields = (value: Record<string, unknown>, keys: string[]) => keys.every((key) => typeof value[key] === 'string' && (value[key] as string).length <= 1200)
const onlyKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key))

/** Optional extension; when supplied its nested contract is strict as well. */
export function isSceneStoryDesign(value: unknown): value is SceneStoryDesign {
  if (!isRecord(value) || !onlyKeys(value, ['choices', 'expectations', 'state_uses', 'result', 'aftermath', 'causal_pattern'])) return false
  if (['result', 'aftermath', 'causal_pattern'].some((key) => key in value && !stringFields(value, [key]))) return false
  const list = (key: string, check: (entry: Record<string, unknown>) => boolean) => !(key in value)
    || (Array.isArray(value[key]) && value[key].length <= 12 && value[key].every((entry) => isRecord(entry) && check(entry)))
  return list('choices', (entry) => onlyKeys(entry, ['character', 'wants', 'options', 'stake'])
    && stringFields(entry, ['character', 'wants', 'stake']) && texts(entry.options))
    && list('expectations', (entry) => onlyKeys(entry, ['thread_id', 'action', 'expected_payoff', 'outcome'])
      && ((Number.isSafeInteger(entry.thread_id) && Number(entry.thread_id) > 0) || (entry.thread_id === null && entry.action === 'raise'))
      && ['raise', 'advance', 'respond', 'defer'].includes(String(entry.action)) && stringFields(entry, ['expected_payoff', 'outcome']))
    && list('state_uses', (entry) => onlyKeys(entry, ['source_id', 'source_hash', 'expected_state', 'resulting_state', 'interpretation', 'change_source_id'])
      && stringFields(entry, ['source_id', 'source_hash', 'expected_state', 'resulting_state'])
      && ['belief', 'fact'].includes(String(entry.interpretation))
      && (!('change_source_id' in entry) || stringFields(entry, ['change_source_id'])))
}

export function formatSceneStoryDesign(design?: SceneStoryDesign): string {
  if (!design) return ''
  const actions: Record<ExpectationAction, string> = { raise: '提出', advance: '进展', respond: '回应', defer: '延后' }
  return [
    ...(design.choices || []).map((choice) => `${choice.character}想要：${choice.wants}；可选：${choice.options.join(' / ')}；自身顾虑：${choice.stake}`),
    ...(design.expectations || []).map((move) => `拟${actions[move.action]}${move.thread_id === null ? '新期待（推断）' : `故事线 ${move.thread_id}`}（不是已兑现）：${move.expected_payoff}；本场安排：${move.outcome}`),
    ...(design.state_uses || []).map((use) => `${use.interpretation === 'belief' ? '人物认识，非客观事实' : '沿用有依据状态'}：${use.expected_state} → ${use.resulting_state}`),
    design.result ? `本场结果：${design.result}` : '',
    design.aftermath ? `后续余波：${design.aftermath}` : '',
  ].filter(Boolean).join('\n')
}

function pattern(scene: StoryDesignScene, names: string[]): string {
  let value = [scene.story_design?.causal_pattern || `${scene.conflict}|${scene.beat}`, scene.story_design?.result].filter(Boolean).join('|')
  for (const name of [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)) value = value.split(name).join('某方')
  return value.replace(/[\s\p{P}]/gu, '')
}

type AddStoryFinding = (code: StoryDesignFinding['code'], scene: StoryDesignScene, evidence: string, suggestion: string) => unknown

function reviewUniversalRescue(scene: StoryDesignScene, projection: RecentStoryDesignProjection, add: AddStoryFinding): void {
  const resolution = [scene.beat, scene.story_design?.result].filter(Boolean).join('；')
  const universalRescue = /(?:凭借|使用|启用|突然获得|临时获得)[^。！？\n]{0,24}(?:万能权限|全能权限|无条件通行)[^。！？\n]{0,24}(?:打开|解除|通过|脱困|解决)/u.exec(resolution)?.[0]
  if (universalRescue && !/(?:不能|无法|拒绝|没有|不曾)/u.test(resolution)
    && !(scene.story_design?.state_uses || []).some((use) => projection.sources.some((source) => source.id === use.source_id
      && source.kind === 'rule' && source.authority === 'confirmed' && /万能权限|全能权限|无条件通行/u.test(source.state)))) {
    add('state_source', scene, `候选解围动作：${universalRescue}；当前规则依据：${projection.sources.filter((source) => source.kind === 'rule').map((source) => source.state).join('；') || '未提供'}`,
      '先说明权限的既有来源和限制；不能用临时万能规则直接解决当前难题。')
  }
}

function reviewStateUses(scene: StoryDesignScene, projection: RecentStoryDesignProjection, add: AddStoryFinding): void {
  for (const use of scene.story_design?.state_uses || []) {
    const source = projection.sources.find((item) => item.id === use.source_id)
    if (!source || source.hash !== use.source_hash || source.state !== use.expected_state) {
      add('state_source', scene, `状态引用 ${use.source_id}：${use.expected_state}`, '关键能力、权限或规则须引用本轮可见依据；缺少依据先修改计划，不临时救场。')
      continue
    }
    if (use.interpretation === 'fact' && source.authority !== 'confirmed') {
      add('belief_promoted', scene, `${source.kind}/${source.authority}：${source.state}`, '保留人物误信或计划的认识层级，不提升成世界事实。')
    }
    if (use.resulting_state !== source.state) {
      const change = projection.sources.find((item) => item.id === use.change_source_id)
      if (!change || change.authority !== 'confirmed' || change.state !== use.resulting_state || change.id === source.id) {
        add('state_reset', scene, `${source.kind} 已有状态：${source.state}；拟改成：${use.resulting_state}`, '已获能力和已达成关系不能无故归零；若确需改变，先提供有依据的转变事件。')
      }
    }
  }
}

/** Planning diagnostics only. This never resolves a thread or changes canon. */
export function reviewRecentStoryDesign(scenes: StoryDesignScene[], projection: RecentStoryDesignProjection): StoryDesignFinding[] {
  const findings: StoryDesignFinding[] = []
  const add = (code: StoryDesignFinding['code'], scene: StoryDesignScene, evidence: string, suggestion: string) =>
    findings.push({ code, sceneOrder: scene.scene_order, evidence, suggestion, route: 'contract_replan' })
  for (const scene of scenes) {
    reviewUniversalRescue(scene, projection, add)
    for (const move of scene.story_design?.expectations || []) {
      if (move.thread_id === null && move.action === 'raise' && move.expected_payoff.trim() && move.outcome.trim()) continue
      const thread = projection.threads.find((item) => item.id === move.thread_id)
      if (!thread || !move.outcome.trim() || move.expected_payoff !== thread.payoff) {
        add('expectation_reference', scene, `故事线 ${move.thread_id}；登记条件：${thread?.payoff || '不在本轮投影中'}；拟回应：${move.expected_payoff}`,
          '回到对应故事线的具体约定，区分取得资格、参与和最终结果；不能批量宣称其他期待完成。')
      }
    }
    reviewStateUses(scene, projection, add)
    const past = projection.recentPlans.flatMap((plan) => plan.scenes.map((previous) => ({ plan, previous })))
    for (const { plan, previous } of past) {
      const names = [...scene.present_characters, ...previous.present_characters, scene.location, previous.location]
      const signature = pattern(scene, names)
      if (scene.conflict.trim() && signature.length >= 12 && signature === pattern(previous, names)) {
        add('repeated_structure', scene, `第${plan.chapterNum}章场景${previous.scene_order}（${plan.hash}）：${previous.conflict}；${previous.beat}`,
          '改变人物选择、双方利益或事件结果，并承接上次余波；只换地名、等级或角色名不能构成阶段变化。')
        break
      }
    }
  }
  const moves = scenes.flatMap((scene) => scene.story_design?.expectations || [])
  if (moves.some((move) => move.action === 'raise')) {
    for (const thread of projection.threads.filter((item) => item.status !== 'resolved' && item.status !== 'abandoned'
      && item.dueChapter !== null && item.dueChapter <= projection.chapterNum)) {
      const recentRaises = projection.recentPlans.filter((plan) => plan.scenes.some((scene) => scene.story_design?.expectations?.some((move) => move.action === 'raise')))
      if (recentRaises.length >= 2 && !moves.some((move) => move.thread_id === thread.id && move.action !== 'raise')) {
        add('unanswered_expectation', scenes[0], `故事线 ${thread.id}：${thread.payoff}，约定第${thread.dueChapter}章回应；前${recentRaises.map((plan) => plan.chapterNum).join('、')}章计划持续提出新问题。`,
          '给旧问题具体进展、局部回应或有原因的延后；不要再用更大的悬念抵消它。')
      }
    }
  }
  return findings
}

export const STORY_DESIGN_SCHEMA = '可选 story_design 对象（不要求每场全填）：choices:[{character,wants,options:字符串数组,stake}]；expectations:[{thread_id:登记故事线ID（仅raise新推断可为null）,action:raise|advance|respond|defer,expected_payoff:逐字登记条件或新推断,outcome:本场安排或延后原因}]；state_uses:[{source_id,source_hash,expected_state,resulting_state,interpretation:belief|fact,change_source_id:可选转变依据ID}]；result/aftermath/causal_pattern 为字符串。所有文本字段用字符串，不增加未声明键；此处全是候选规划，不能写成已完成事实。'
