import { stableHash, stableSerialize } from './context-pack'

export type NarrativePolicyVersion = 'legacy' | 'reader-first-v1'
export interface ReaderFirstSettings {
  schemaVersion: 1
  policyVersion: NarrativePolicyVersion
  revision: number
}
export interface NarrativePolicyResolution {
  policyVersion: NarrativePolicyVersion
  policyRevision: string
  configDigest: string
  diagnostics: string[]
}
export interface NarrativeInputIdentity extends NarrativePolicyResolution {
  schemaVersion: 1
  styleSourceDigest: string
  /** Empty until the Planner checkpoint; never changes the root request key. */
  scenePlanDigest: string
  inputSourceDigest: string
  overrideDigest: string
  modelDigest: string
  compilerMode: string
}

function settingsObject(raw?: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

export function resolveNarrativePolicy(raw?: string | null, readerFirstAvailable = false): NarrativePolicyResolution {
  const config = settingsObject(raw).readerFirst
  const base = { policyVersion: 'legacy' as const, policyRevision: '0', configDigest: stableHash(config ?? null) }
  if (config === undefined) return { ...base, diagnostics: ['legacy_project_without_readerFirst'] }
  const record = config as Partial<ReaderFirstSettings> | null
  if (!record || record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 1
    || !['legacy', 'reader-first-v1'].includes(record.policyVersion || '')) {
    return { ...base, diagnostics: ['unknown_or_invalid_readerFirst_config'] }
  }
  if (record.policyVersion === 'reader-first-v1' && !readerFirstAvailable) {
    return { ...base, diagnostics: ['reader_first_implementation_unavailable'] }
  }
  return { ...base, policyVersion: record.policyVersion!, policyRevision: String(record.revision), diagnostics: [] }
}

/** A settings form may omit the policy, but may not overwrite a newer policy revision. */
export function mergeNarrativePolicySettings(currentRaw: string | null | undefined, incomingRaw: string): string {
  const current = settingsObject(currentRaw)
  const incoming = settingsObject(incomingRaw)
  if (Object.prototype.hasOwnProperty.call(incoming, 'readerFirst')
    && stableSerialize(incoming.readerFirst) !== stableSerialize(current.readerFirst ?? null)) {
    const currentRevision = Number((current.readerFirst as Partial<ReaderFirstSettings> | undefined)?.revision) || 0
    const nextRevision = (incoming.readerFirst as Partial<ReaderFirstSettings> | null)?.revision
    if (!Number.isSafeInteger(nextRevision) || Number(nextRevision) !== currentRevision + 1) {
      throw new Error('作品写作策略版本已变化，请刷新设置后重试。')
    }
  }
  return JSON.stringify({ ...current, ...incoming })
}

export function buildNarrativeInputIdentity(input: {
  policy: NarrativePolicyResolution
  styleSource: unknown
  inputSource: unknown
  overrides: unknown
  models: unknown
  compilerMode: string
  scenePlan?: unknown
}): NarrativeInputIdentity {
  return { ...input.policy, schemaVersion: 1, styleSourceDigest: stableHash(input.styleSource),
    inputSourceDigest: stableHash(input.inputSource), overrideDigest: stableHash(input.overrides),
    modelDigest: stableHash(input.models), compilerMode: input.compilerMode,
    scenePlanDigest: input.scenePlan === undefined ? '' : stableHash(input.scenePlan) }
}

export function narrativeRequestIdentity(identity: NarrativeInputIdentity): string {
  const { scenePlanDigest: _scenePlanDigest, diagnostics: _diagnostics, ...root } = identity
  return stableHash(root)
}

export function assertNarrativeResumeIdentity(saved: NarrativeInputIdentity | undefined, current: NarrativeInputIdentity): void {
  if (!saved || saved.schemaVersion !== 1) throw new Error('旧任务缺少可复现的策略与来源身份，请保留现稿并从 Planner 新建任务。')
  if (narrativeRequestIdentity(saved) !== narrativeRequestIdentity(current)
    || (saved.scenePlanDigest && saved.scenePlanDigest !== current.scenePlanDigest)) {
    throw new Error('策略、场景、样稿、提示覆盖或模型依据已变化，不能混用旧稿恢复；请保留现稿并从 Planner 新建任务。')
  }
}
