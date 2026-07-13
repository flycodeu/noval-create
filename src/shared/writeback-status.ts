import type { WritebackSyncStatus } from '../types'

const WRITEBACK_PHASES: WritebackSyncStatus['phase'][] = [
  'idle',
  'preparing',
  'ready',
  'applying',
  'applied',
  'failed',
]

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
  }
  return fallback
}

function asPositiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function getWritebackPhaseDefaults(phase: WritebackSyncStatus['phase']): Pick<
  WritebackSyncStatus,
  'candidateReady' | 'canonApplied' | 'blockedGeneration' | 'readyForNextChapter'
> {
  if (phase === 'idle') {
    return { candidateReady: false, canonApplied: true, blockedGeneration: false, readyForNextChapter: true }
  }
  if (phase === 'ready') {
    return { candidateReady: true, canonApplied: false, blockedGeneration: true, readyForNextChapter: false }
  }
  if (phase === 'applying') {
    return { candidateReady: true, canonApplied: false, blockedGeneration: true, readyForNextChapter: false }
  }
  if (phase === 'applied') {
    return { candidateReady: true, canonApplied: true, blockedGeneration: false, readyForNextChapter: true }
  }
  if (phase === 'preparing') {
    return { candidateReady: false, canonApplied: false, blockedGeneration: true, readyForNextChapter: false }
  }
  return { candidateReady: false, canonApplied: false, blockedGeneration: true, readyForNextChapter: false }
}

function normalizePhase(value: unknown): WritebackSyncStatus['phase'] {
  return typeof value === 'string' && WRITEBACK_PHASES.includes(value as WritebackSyncStatus['phase'])
    ? value as WritebackSyncStatus['phase']
    : 'idle'
}

export function normalizeWritebackSyncStatus(raw: unknown, contextVersion = 1): WritebackSyncStatus {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const phase = normalizePhase(record.phase)
  const defaults = getWritebackPhaseDefaults(phase)
  const hasExplicitCandidateState = typeof record.candidateReady === 'boolean'
    || typeof record.candidateReady === 'number'
    || typeof record.candidateReady === 'string'
  const hasExplicitCanonState = typeof record.canonApplied === 'boolean'
    || typeof record.canonApplied === 'number'
    || typeof record.canonApplied === 'string'

  const candidateReady = hasExplicitCandidateState
    ? asBoolean(record.candidateReady, defaults.candidateReady)
    : defaults.candidateReady
  const canonApplied = hasExplicitCanonState
    ? asBoolean(record.canonApplied, defaults.canonApplied)
    : defaults.canonApplied
  // Before candidateReady/canonApplied existed, some records incorrectly marked
  // `phase: ready` as unblocked. Let the phase-derived contract win for those
  // legacy records; otherwise the old JSON would reopen generation incorrectly.
  const hasExplicitState = hasExplicitCandidateState || hasExplicitCanonState
  const blockedGeneration = hasExplicitState && typeof record.blockedGeneration !== 'undefined'
    ? asBoolean(record.blockedGeneration, defaults.blockedGeneration)
    : defaults.blockedGeneration

  return {
    phase,
    runId: asPositiveNumber(record.runId),
    retryCount: asPositiveNumber(record.retryCount) || 0,
    lastError: asText(record.lastError),
    candidateReady,
    canonApplied,
    blockedGeneration,
    readyForNextChapter: canonApplied && !blockedGeneration,
    contextVersion: asPositiveNumber(record.contextVersion) || contextVersion,
    lastAttemptAt: asText(record.lastAttemptAt),
    updatedAt: asText(record.updatedAt) || new Date().toISOString(),
  }
}

export function mergeWritebackSyncStatus(
  current: WritebackSyncStatus,
  patch: Partial<WritebackSyncStatus>,
): WritebackSyncStatus {
  const phase = patch.phase || current.phase
  const phaseChanged = Boolean(patch.phase && patch.phase !== current.phase)
  const defaults = getWritebackPhaseDefaults(phase)
  const candidateReady = patch.candidateReady
    ?? (phaseChanged ? (phase === 'failed' ? current.candidateReady : defaults.candidateReady) : current.candidateReady)
  const canonApplied = patch.canonApplied
    ?? (phaseChanged ? defaults.canonApplied : current.canonApplied)
  const blockedGeneration = patch.blockedGeneration
    ?? (phaseChanged ? defaults.blockedGeneration : current.blockedGeneration)

  return {
    ...current,
    ...patch,
    phase,
    candidateReady,
    canonApplied,
    blockedGeneration,
    readyForNextChapter: canonApplied && !blockedGeneration,
  }
}
