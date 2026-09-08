import { estimateTokens } from './token-budget'

export type ContextPackStage = 'scenePlan' | 'draft' | 'review' | 'rewrite' | 'planning'
export type ContextPackVisibility = 'canon' | 'draft' | 'plan'

export interface ContextPackSource {
  key: string
  sourceKind: string
  sourceId: string
  sourceVersion: string
  artifactHash?: string
  start?: number
  end?: number
  visibility: ContextPackVisibility
  text: string
  required: boolean
  included: boolean
  reason: string
  estimatedTokens: number
}

export interface ContextPackV1 {
  schemaVersion: 1
  id: string
  novelId: number
  chapterId: number | null
  chapterNum: number | null
  stage: ContextPackStage
  contextVersion: number
  inputHash: string
  contractVersion: string
  modelProfile: string
  sources: ContextPackSource[]
  estimatedInputTokens: number
  outputReserve: number
}

export interface ContextPackCompileInput {
  novelId: number
  chapterId?: number | null
  chapterNum?: number | null
  stage: ContextPackStage
  contextVersion: number
  contractVersion?: string
  modelProfile?: string
  /** Prompt/template fingerprint participates in identity without expanding the persisted v1 DTO. */
  templateVersion?: string
  sources: Array<Partial<ContextPackSource> & Pick<ContextPackSource, 'text'>>
  inputHash?: string
  outputReserve?: number
  budget?: number
}

export class ContextPackValidationError extends Error {
  readonly code = 'NF_CONTEXT_PACK_INVALID' as const

  constructor(message: string) {
    super(`NF_CONTEXT_PACK_INVALID: ${message}`)
    this.name = 'ContextPackValidationError'
  }
}

export interface ContextPackCompileDependencies {
  loadSources?: () => Promise<ContextPackCompileInput['sources']> | ContextPackCompileInput['sources']
}

export interface ContextPackCompileResult {
  pack: ContextPackV1
  rendered: string
  diagnostics: {
    droppedOptional: string[]
    deduped: string[]
    requiredOverflow: boolean
    requiredTokens: number
    budget: number | null
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]))
  }
  return value
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

export function stableHash(value: unknown): string {
  const input = typeof value === 'string' ? value : stableSerialize(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function sourceIdentity(source: ContextPackSource): string {
  return [source.key, source.sourceVersion, source.start ?? '', source.end ?? ''].join('|')
}

function normalizeSource(source: ContextPackCompileInput['sources'][number], index: number): ContextPackSource {
  const text = typeof source.text === 'string' ? source.text.trim() : ''
  const key = String(source.key || `legacy:${index}:${stableHash(text)}`)
  const sourceVersion = String(source.sourceVersion || 'legacy')
  return {
    key,
    sourceKind: String(source.sourceKind || 'legacy'),
    sourceId: String(source.sourceId || key),
    sourceVersion,
    ...(source.artifactHash ? { artifactHash: source.artifactHash } : {}),
    ...(typeof source.start === 'number' ? { start: source.start } : {}),
    ...(typeof source.end === 'number' ? { end: source.end } : {}),
    visibility: source.visibility || 'canon',
    text,
    required: source.required === true,
    included: source.included !== false,
    reason: source.reason || 'budget_pending',
    estimatedTokens: Number.isFinite(source.estimatedTokens) ? Number(source.estimatedTokens) : estimateTokens(text),
  }
}

export function selectContextSources(
  sources: ContextPackCompileInput['sources'],
  budget?: number,
): ContextPackCompileResult['diagnostics'] & { sources: ContextPackSource[] } {
  const normalized = sources.map(normalizeSource).filter((source) => source.text.length > 0)
  const selected: ContextPackSource[] = []
  const droppedOptional: string[] = []
  const deduped: string[] = []
  const seen = new Set<string>()
  let used = 0
  let requiredTokens = 0
  const ordered = [...normalized].sort((left, right) => (
    Number(right.required) - Number(left.required)
    || left.key.localeCompare(right.key)
    || left.sourceVersion.localeCompare(right.sourceVersion)
    || (left.start ?? -1) - (right.start ?? -1)
    || left.text.localeCompare(right.text)
  ))
  for (const source of ordered) {
    const identity = sourceIdentity(source)
    if (seen.has(identity)) {
      deduped.push(source.key)
      selected.push({ ...source, included: false, reason: 'deduped_same_source' })
      continue
    }
    seen.add(identity)
    if (!source.included) {
      selected.push(source)
      continue
    }
    if (source.required) {
      requiredTokens += source.estimatedTokens
      used += source.estimatedTokens
      selected.push({ ...source, included: true, reason: 'required' })
      continue
    }
    if (budget !== undefined && Number.isFinite(budget) && used + source.estimatedTokens > Math.max(0, budget)) {
      droppedOptional.push(source.key)
      selected.push({ ...source, included: false, reason: 'budget_insufficient' })
      continue
    }
    used += source.estimatedTokens
    selected.push({ ...source, included: true, reason: 'budget_fit' })
  }
  return {
    sources: selected,
    droppedOptional,
    deduped,
    requiredOverflow: budget !== undefined && requiredTokens > Math.max(0, budget),
    requiredTokens,
    budget: budget === undefined ? null : Math.max(0, budget),
  }
}

export function renderContextPack(pack: ContextPackV1): string {
  return pack.sources
    .filter((source) => source.included)
    .map((source) => `[${source.visibility}] ${source.key}: ${source.text}`)
    .join('\n')
}

export async function compileContextPack(
  input: ContextPackCompileInput,
  dependencies: ContextPackCompileDependencies = {},
): Promise<ContextPackCompileResult> {
  if (!Number.isInteger(input.novelId) || input.novelId <= 0) {
    throw new ContextPackValidationError('novelId must be a positive integer')
  }
  if (!Number.isInteger(input.contextVersion) || input.contextVersion <= 0) {
    throw new ContextPackValidationError('contextVersion must be a positive integer')
  }
  const chapterId = input.chapterId ?? null
  const chapterNum = input.chapterNum ?? null
  if (input.stage === 'planning') {
    if (chapterId !== null || chapterNum !== null) {
      throw new ContextPackValidationError('planning packs must not claim a chapter')
    }
  } else if (
    !Number.isInteger(chapterId) || Number(chapterId) <= 0
    || !Number.isInteger(chapterNum) || Number(chapterNum) <= 0
  ) {
    throw new ContextPackValidationError(`${input.stage} packs require positive chapterId and chapterNum`)
  }
  const loadedSources = dependencies.loadSources ? await dependencies.loadSources() : input.sources
  const diagnostics = selectContextSources(loadedSources, input.budget)
  const contractVersion = input.contractVersion || ''
  const modelProfile = input.modelProfile || 'default'
  const contextVersion = input.contextVersion
  const identity = {
    novelId: input.novelId,
    chapterId,
    chapterNum,
    stage: input.stage,
    contextVersion,
    contractVersion,
    modelProfile,
    templateVersion: input.templateVersion || '',
    sources: diagnostics.sources,
  }
  const inputHash = input.inputHash || stableHash(identity)
  const pack: ContextPackV1 = {
    schemaVersion: 1,
    id: stableHash({ ...identity, inputHash }),
    novelId: input.novelId,
    chapterId,
    chapterNum,
    stage: input.stage,
    contextVersion,
    inputHash,
    contractVersion,
    modelProfile,
    sources: diagnostics.sources,
    estimatedInputTokens: diagnostics.sources.filter((source) => source.included).reduce((sum, source) => sum + source.estimatedTokens, 0),
    outputReserve: Math.max(0, Math.floor(input.outputReserve || 0)),
  }
  return { pack, rendered: renderContextPack(pack), diagnostics }
}

export function serializeContextPack(pack: ContextPackV1): string {
  return JSON.stringify(pack)
}

export function deserializeContextPack(value: string | null | undefined): ContextPackV1 | null {
  if (!value?.trim()) return null
  try {
    const parsed = JSON.parse(value) as ContextPackV1
    return parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.sources) ? parsed : null
  } catch {
    return null
  }
}
