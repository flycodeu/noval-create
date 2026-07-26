import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, characters, glossary, storyItems, worldMap } from '../database/schema'
import { cleanAiFieldText } from '../../src/utils/text'
import { escapeRegExp } from '../../src/shared/chapter-optimization-quality'
import { collectQualityGuardrailFindings } from '../../src/shared/content-guardrails'
import type { ChapterOptimizeResult } from '../../src/types'

export function buildChapterOptimizationPrompt(params: {
  chapter: typeof chapters.$inferSelect
  novelTitle: string
  genreName?: string | null
  content: string
  issueSummary: string[]
  extraRequirements?: string
  repairMode?: 'language' | 'structural'
  supportingCastNames?: string[]
}): string {
  const supportingCastText = (params.supportingCastNames || []).length > 0
    ? `${(params.supportingCastNames || []).slice(0, 6).join('、')} 等出场配角`
    : '本章出场配角'
  const structuralRepair = params.repairMode === 'structural'
  const lockedNarrativeNumbers = extractNarrativeNumbers(params.content)
  const maxStructuralChars = Math.ceil(params.content.length * MAX_STRUCTURAL_REPAIR_EXPANSION_RATIO)
  const immutableStateExcerpt = params.content.trim().slice(-700)
  return [
    structuralRepair
      ? '你是一名长篇网文结构修订编辑。请对当前章节做“局部结构性质量修订”，必须修复给定的冲突链、人物选择、状态变化和代价；不能只替换词句，也不能整章重写。'
      : '你是一名长篇网文精修编辑。请对当前章节做“整章语言与读感优化”，不要重写剧情。',
    '',
    '硬性要求：',
    '- 保留原章节既有事实、人物、地点、道具、能力边界、事件顺序和结尾钩子。',
    '- 不新增角色、势力、武器、物资、地名、设定规则或背景真相。',
    '- 原文中的日期、年份、数量、编号、距离、等级和时间表达必须逐字保留；拿不准时保留原句，不得把数字改写成新数字或同义数量。',
    structuralRepair
      ? '- 允许重写场景内动作、对白、判断和结果，只要不破坏既有事实；必须让修复目标落到正文事件，而不是作者说明或段尾总结。'
      : '- 不改变章节核心剧情，只修语言自然度、连贯性、AI味、空泛细节和读者理解阻力。',
    structuralRepair
      ? '- 局部替换合同：保留原文大部分句子和段落原样，只改与修复目标直接相关的 1—3 个局部段落；不得把全章改写成同义复述，不得为了增加篇幅重排事件。'
      : '',
    structuralRepair
      ? '- 既有事实锁定：原文已经写明的物件持有者、证据归属、谁是否阻拦、人物是否离开以及章尾状态不得倒置；不能为了制造代价让角色突然没收、夺回、销毁原文中未被夺走的物件，也不能把原文的含蓄警告改成强制行动。代价必须来自原事实下的新选择。'
      : '',
    structuralRepair
      ? '- 叙事事实锁定：不得新增原文没有的物证折痕、撕裂、日期截断、字迹变化、备忘录/便签/字条或钥匙与照片等物件的交换关系。若需要状态变化，只能沿用原文已出现的物件和动作，通过拒绝、隐瞒、追问、离开或保留选择制造后果。'
      : '',
    structuralRepair
      ? `- 章尾不可逆状态参考（原文末段，必须保持物件归属、是否阻拦和离开状态；不要新增或替换物件）：\n${immutableStateExcerpt}`
      : '',
    structuralRepair
      ? '- 主角的未经核实判断必须落成一个实际行动，并让该行动造成可持续的资源、关系或安全损失；同时让配角因自己的目的主动隐瞒、交换或阻止一件事，导致关系或关键资源发生不可逆变化。'
      : '',
    structuralRepair
      ? `- 必须先用具体事实兑现本章大纲或前文已建立的局部问题（悬置的证据、约定或未答的疑问），再让这个兑现直接导致证据暴露、追查失败、关系破裂或现实损失；${supportingCastText}必须有不服务于主角的独立目的。`
      : '',
    structuralRepair
      ? '- 不要用“误判、代价、主动选择、状态变化”等作者标签交差；必须写出人物说了什么、拿走/交出/隐瞒了什么、行动造成了什么后果。'
      : '',
    structuralRepair
      ? '- 严禁新增原文没有的日期、楼层、金额、次数、数量、年龄或其他数字事实；数字/数量/编号相关句子尽量原样保留，结构修订只改动作、对白和结果。'
      : '',
    structuralRepair
      ? `- 数字事实白名单：${lockedNarrativeNumbers.length > 0 ? lockedNarrativeNumbers.join('、') : '原文没有可复用的数字事实'}。输出不得出现白名单之外的数字、数量或计数表达；当前正文约 ${params.content.length} 字，输出不得超过约 ${maxStructuralChars} 字，不要靠新增背景扩写。`
      : '',
    structuralRepair
      ? '- 不要补写新的楼层或时间定位（例如“一层、负一层、某月某日”）；已有地点描述保持原样，若不需要就不要新增地点数字。'
      : '',
    '- 删除 AI 过程文字、提示词残留、括号说明、破折号解释腔。',
    '- 避免“不是……而是……”或“并非……实际是……”、双重比喻、排比堆叠、手指/指节/指腹/瞳孔/声音很轻等低价值细节。',
    '- 避免“他睁眼/闭眼/抬头/低头”单独成段。',
    '- 段落之间空一行，直接输出优化后的完整章节正文，不要 Markdown，不要解释。',
    '',
    `小说：${params.novelTitle}`,
    params.genreName ? `题材：${params.genreName}` : '',
    `章节：第${params.chapter.chapterNum}章 ${params.chapter.title || ''}`.trim(),
    params.chapter.outline ? `章节大纲：${params.chapter.outline}` : '',
    params.chapter.summary ? `现有摘要：${params.chapter.summary}` : '',
    params.issueSummary.length > 0 ? `本轮优先修复：\n${params.issueSummary.slice(0, 10).map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    params.extraRequirements ? `用户追加要求：${params.extraRequirements}` : '',
    '',
    '【当前完整正文】',
    params.content,
  ].filter(Boolean).join('\n')
}

export function normalizeOptimizedChapterContent(raw: string): string {
  const normalized = cleanAiFieldText(raw)
    .replace(/^(?:优化后的完整章节正文|优化后的正文|正文)[:：]\s*/u, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  // Do not rewrite definition sentences with a regex. A previous cleanup turned
  // “不是……而是……” into the equally templated “并非……实际是……”, and could
  // also damage sentence grammar. Let the quality gate feed the original issue
  // back to the model for a contextual rewrite instead.
  return normalized
}

export const MAX_STRUCTURAL_REPAIR_EXPANSION_RATIO = 1.6

export function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

export function collectTrackedEntityNames(novelId: number): string[] {
  const db = getDb()
  const names = [
    ...db.select({ name: characters.fullName }).from(characters).where(eq(characters.novelId, novelId)).all().map((row) => row.name),
    ...db.select({ name: storyItems.itemName }).from(storyItems).where(eq(storyItems.novelId, novelId)).all().map((row) => row.name),
    ...db.select({ name: worldMap.name }).from(worldMap).where(eq(worldMap.novelId, novelId)).all().map((row) => row.name),
    ...db.select({ name: glossary.term }).from(glossary).where(eq(glossary.novelId, novelId)).all().map((row) => row.name),
  ]
  return uniqueNonEmpty(names)
    .filter((name) => name.length >= 2)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
}

export function findTrackedNamesInText(names: string[], text: string): string[] {
  return names.filter((name) => text.includes(name))
}

// Object nouns that participate in the tail-state guard for any novel. Novel
// specific props (named artifacts, documents, weapons) are injected from the
// story item and glossary tables instead of being hardcoded here.
export const GENERIC_NARRATIVE_OBJECT_MARKERS = [
  '钥匙', '复印件', '文件袋', '照片', '语音', '签名', '文件', '记录',
]

export const MAX_INJECTED_NARRATIVE_OBJECTS = 16

export function collectTrackedObjectNames(novelId: number): string[] {
  const db = getDb()
  const names = [
    ...db.select({ name: storyItems.itemName }).from(storyItems).where(eq(storyItems.novelId, novelId)).all().map((row) => row.name),
    ...db.select({ name: glossary.term }).from(glossary).where(eq(glossary.novelId, novelId)).all().map((row) => row.name),
  ]
  return uniqueNonEmpty(names).filter((name) => name.length >= 2)
}

export function buildNarrativeObjectMarkers(novelId: number): string[] {
  return uniqueNonEmpty([
    ...GENERIC_NARRATIVE_OBJECT_MARKERS,
    ...collectTrackedObjectNames(novelId).slice(0, MAX_INJECTED_NARRATIVE_OBJECTS),
  ])
}

export function collectProtagonistAliases(novelId: number): string[] {
  const db = getDb()
  const rows = db
    .select({ fullName: characters.fullName, givenName: characters.givenName, roleType: characters.roleType })
    .from(characters)
    .where(eq(characters.novelId, novelId))
    .all()
  const aliases = rows
    .filter((row) => row.roleType === 'protagonist')
    .flatMap((row) => [row.fullName, row.givenName])
    .map((name) => String(name || '').trim())
    .filter((name) => name.length >= 2)
  return uniqueNonEmpty(aliases).slice(0, 6)
}

export function collectSupportingCastNames(novelId: number): string[] {
  const db = getDb()
  const rows = db
    .select({ fullName: characters.fullName, roleType: characters.roleType })
    .from(characters)
    .where(eq(characters.novelId, novelId))
    .all()
  const names = rows
    .filter((row) => row.roleType !== 'protagonist')
    .map((row) => String(row.fullName || '').trim())
    .filter((name) => name.length >= 2)
  return uniqueNonEmpty(names).slice(0, 12)
}

export interface NarrativeGuardContext {
  protagonistAliases: string[]
  objectMarkers: string[]
}

export const DEFAULT_NARRATIVE_GUARD_CONTEXT: NarrativeGuardContext = {
  protagonistAliases: [],
  objectMarkers: GENERIC_NARRATIVE_OBJECT_MARKERS,
}

export function buildNarrativeGuardContext(novelId: number): NarrativeGuardContext {
  return {
    protagonistAliases: collectProtagonistAliases(novelId),
    objectMarkers: buildNarrativeObjectMarkers(novelId),
  }
}

export function extractNarrativeNumbers(text: string): string[] {
  // Repeated measure words such as “一层层/一只只” are descriptive
  // reduplications, not changed numeric facts. Exclude the repeated unit
  // while retaining concrete facts like “地下二层” and “三次”。
  const units = '公里|年|月|日|章|岁|个人|个|名|人|只|柄|把|枚|颗|米|丈|里|天|夜|次|回|层|阶|级'
  // “这两个数字/这两个字” is a descriptive reference to a token, not a
  // narrative quantity. Do not reject a candidate merely because it
  // paraphrased that wording while preserving the actual fact.
  const descriptiveTail = '(?:数字|字|词|方面|原因|问题|选项)'
  const arabic = text.match(new RegExp(`\\d+(?:\\.\\d+)?(?:\\s*(${units})(?!\\1|${descriptiveTail}))?`, 'gu')) || []
  const chinese = text.match(new RegExp(`[零一二三四五六七八九十百千万两]+(${units})(?!\\1|${descriptiveTail})`, 'gu')) || []
  return uniqueNonEmpty([...arabic, ...chinese]).slice(0, 80)
}

export function getSymmetricDiff(left: string[], right: string[]): string[] {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return [
    ...left.filter((item) => !rightSet.has(item)).map((item) => `缺失 ${item}`),
    ...right.filter((item) => !leftSet.has(item)).map((item) => `新增 ${item}`),
  ]
}

export function textOverlapRatio(left: string, right: string): number {
  const leftChars = new Set([...left.replace(/\s/g, '')])
  const rightChars = new Set([...right.replace(/\s/g, '')])
  if (leftChars.size === 0 || rightChars.size === 0) return 1
  let overlap = 0
  leftChars.forEach((char) => {
    if (rightChars.has(char)) overlap += 1
  })
  return overlap / Math.max(leftChars.size, rightChars.size)
}

// Structural repair may add a visible choice or consequence, but it must not
// silently invent a new evidence state, record, or transaction. These signals
// are intentionally narrow: ordinary action verbs remain available to the
// repair model, while material facts such as a new crease, memo, date damage,
// or exchange relationship are rejected unless the source chapter already
// contains the same fact.
export const UNSUPPORTED_NARRATIVE_FACT_PATTERNS: Array<{ key: string; label: string; pattern: RegExp }> = [
  {
    key: 'evidence_mutation',
    label: '物证形变或损伤',
    pattern: /折痕|折皱|撕裂|撕去|撕掉|缺页|缺角|烧毁|烧掉|截断|截去|被剪掉|划掉|涂黑/u,
  },
  {
    key: 'new_record_object',
    label: '新增书写或记录物件',
    pattern: /备忘录|便签|字条|写下一行|记下一行|补写一行|留下一张纸|新写的记录/u,
  },
  {
    key: 'evidence_legibility_change',
    label: '证据可读性变化',
    pattern: /(?:日期|编号|签名|字迹|文字|记录)[^。！？!?\n]{0,16}(?:模糊|看不清|不完整|缺失|被截断|断掉)/u,
  },
  {
    key: 'new_exchange_relation',
    label: '新增交换或交易关系',
    pattern: /交换|换取|换来|作为交换|拿[^。！？!?\n]{0,20}换|用[^。！？!?\n]{0,20}换/u,
  },
  {
    key: 'new_legal_submission_context',
    label: '新增法律、证人或提交关系',
    pattern: /律师|证人身份|产权异议|产权材料|提交(?:材料|资料)|对方律师/u,
  },
  {
    key: 'new_external_event',
    label: '新增外部事件或环境结果',
    pattern: /脚步声[^。！？!?\n]{0,16}(?:停|响)|路灯(?:坏|熄)|拨号界面|打出去|楼下(?:的)?/u,
  },
]

export function narrativeTailSentences(text: string): string[] {
  return String(text || '')
    .split(/[。！？!?；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    // A structural candidate may append several paragraphs after changing an
    // object's state. Eight sentences let that change fall out of the window;
    // twenty keeps the check local while covering a full scene tail.
    .slice(-20)
}

export type NarrativeObjectState = 'held' | 'reversed'

export function lastNarrativeObjectState(sentences: string[], objectName: string): NarrativeObjectState | null {
  const object = escapeRegExp(objectName)
  const heldPattern = new RegExp(
    `(?:${object}[^。！？!?\\n]{0,24}(?:带走|拿走|收进(?:包|袋)|装进(?:包|袋)|带在身上|收回(?:文件袋)?|拿在手里)|(?:带走|拿走|收进(?:包|袋)|装进(?:包|袋)|带在身上|收回(?:文件袋)?|拿在手里)[^。！？!?\\n]{0,24}${object})`,
    'gu',
  )
  const reversedPattern = new RegExp(
    `(?:${object}[^。！？!?\\n]{0,24}(?:留在|留下|放回|退回|交回|收进抽屉|没有带走|没带走|未带走|没有拿走|没拿走|未拿走)|(?:留在|留下|放回|退回|交回|收进抽屉|没有带走|没带走|未带走|没有拿走|没拿走|未拿走)[^。！？!?\\n]{0,24}${object})`,
    'gu',
  )
  let state: NarrativeObjectState | null = null
  for (const sentence of sentences) {
    const events = [
      ...Array.from(sentence.matchAll(heldPattern), (match) => ({ state: 'held' as const, index: match.index ?? 0 })),
      ...Array.from(sentence.matchAll(reversedPattern), (match) => ({ state: 'reversed' as const, index: match.index ?? 0 })),
    ].sort((left, right) => left.index - right.index)
    for (const event of events) state = event.state
  }
  return state
}

export function lastNarrativeExitState(sentences: string[], guardContext: NarrativeGuardContext): 'permissive' | 'blocking' | null {
  const permissivePattern = /(?:没有拦|没拦|让[她他]走|让[她他]离开|放[她他]走)/u
  // “按住纸角” is an evidence action, not a departure block. Require the
  // action to target the protagonist, or to act on a named narrative object.
  const subjectAlternatives = uniqueNonEmpty(['她', '他', '主角', ...guardContext.protagonistAliases.map(escapeRegExp)])
  const objectAlternatives = uniqueNonEmpty(guardContext.objectMarkers.map(escapeRegExp))
  const blockingPattern = new RegExp(
    `(?:拦住|不让|按住)[^。！？!?；;\\n]{0,8}(?:${subjectAlternatives.join('|')})`
    + `|(?:没收|夺回|抢走|收走|扣住)[^。！？!?；;\\n]{0,8}(?:${objectAlternatives.join('|')})`,
    'u',
  )
  let state: 'permissive' | 'blocking' | null = null
  for (const sentence of sentences) {
    if (permissivePattern.test(sentence)) state = 'permissive'
    if (blockingPattern.test(sentence)) state = 'blocking'
  }
  return state
}

export function collectNarrativeStateWarnings(
  originalContent: string,
  optimizedContent: string,
  guardContext: NarrativeGuardContext = DEFAULT_NARRATIVE_GUARD_CONTEXT,
): string[] {
  const originalSentences = narrativeTailSentences(originalContent)
  const optimizedSentences = narrativeTailSentences(optimizedContent)
  const originalTail = originalSentences.join('。')
  const warnings: string[] = []

  for (const object of guardContext.objectMarkers) {
    if (!originalTail.includes(object)) continue
    const originalState = lastNarrativeObjectState(originalSentences, object)
    const candidateState = lastNarrativeObjectState(optimizedSentences, object)
    if (originalState === 'held' && candidateState === 'reversed') {
      warnings.push(`优化稿改变了原文末段物件持有状态：${object} 原本由主角带走或收存，候选稿改为留置、退回或由他人收回。`)
    }
  }

  const originalExitState = lastNarrativeExitState(originalSentences, guardContext)
  const candidateExitState = lastNarrativeExitState(optimizedSentences, guardContext)
  if (originalExitState === 'permissive' && candidateExitState === 'blocking') {
    warnings.push('优化稿把原文中未阻拦主角离开的章尾状态改成了阻拦、扣留或夺回。')
  }
  return [...new Set(warnings)]
}

export function collectUnsupportedNarrativeFactWarnings(originalContent: string, optimizedContent: string): string[] {
  const introducedSignals = UNSUPPORTED_NARRATIVE_FACT_PATTERNS
    .filter(({ pattern }) => pattern.test(optimizedContent) && !pattern.test(originalContent))
    .map(({ label, pattern }) => `${label}（${optimizedContent.match(pattern)?.[0] || '新增信号'}）`)

  if (introducedSignals.length === 0) return []
  return [
    `结构修订候选新增了原文未验证的叙事事实：${introducedSignals.join('、')}。不得凭空改变物证状态、记录内容、证据可读性或人物交易关系；请删除新增事实，改用原文已有事实下的动作、对白和后果。`,
  ]
}

export function buildChapterOptimizationFactGuard(
  novelId: number,
  originalContent: string,
  optimizedContent: string,
  options: { allowEndingHookChange?: boolean; structuralRepair?: boolean } = {},
): ChapterOptimizeResult['factGuard'] {
  const trackedNames = collectTrackedEntityNames(novelId)
  const originalNames = findTrackedNamesInText(trackedNames, originalContent)
  const optimizedNames = findTrackedNamesInText(trackedNames, optimizedContent)
  const introducedTrackedEntities = optimizedNames.filter((name) => !originalNames.includes(name)).slice(0, 12)
  const removedTrackedEntities = originalNames.filter((name) => !optimizedNames.includes(name)).slice(0, 12)
  const changedNumbers = getSymmetricDiff(
    extractNarrativeNumbers(originalContent),
    extractNarrativeNumbers(optimizedContent),
  ).slice(0, 12)
  const originalEnding = originalContent.trim().slice(-300)
  const optimizedEnding = optimizedContent.trim().slice(-300)
  const endingHookChanged = originalEnding.length >= 80
    && optimizedEnding.length >= 80
    && textOverlapRatio(originalEnding, optimizedEnding) < 0.42
  const narrativeStateWarnings = collectNarrativeStateWarnings(
    originalContent,
    optimizedContent,
    buildNarrativeGuardContext(novelId),
  )
  const unsupportedNarrativeFacts = options.structuralRepair
    ? collectUnsupportedNarrativeFactWarnings(originalContent, optimizedContent)
    : []
  const optimizedFindings = collectQualityGuardrailFindings(optimizedContent)
  const aiProcessLeakCount = optimizedFindings.filter((finding) => finding.code === 'ai_process_leak' || finding.code === 'prompt_leak').length
  const warnings = [
    introducedTrackedEntities.length > 0 ? `优化稿引入了原正文未出现的已登记实体：${introducedTrackedEntities.join('、')}。` : '',
    removedTrackedEntities.length > 0 ? `优化稿移除了原正文中的已登记实体：${removedTrackedEntities.join('、')}。` : '',
    changedNumbers.length > 0 ? `优化稿改变了关键数字或数量表达：${changedNumbers.join('、')}。` : '',
    ...narrativeStateWarnings,
    ...unsupportedNarrativeFacts,
    endingHookChanged && !options.allowEndingHookChange ? '优化稿章尾钩子与原文差异过大，需要人工核对后再应用。' : '',
    aiProcessLeakCount > 0 ? `优化稿仍含 ${aiProcessLeakCount} 处 AI 过程或提示词残留。` : '',
  ].filter(Boolean)
  return {
    safeToApply: warnings.length === 0,
    warnings,
    introducedTrackedEntities,
    removedTrackedEntities,
    changedNumbers,
    unsupportedNarrativeFacts,
    endingHookChanged,
    aiProcessLeakCount,
  }
}
