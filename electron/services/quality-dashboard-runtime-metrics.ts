import type { QualityDashboardData } from '../../src/types'

type RuntimeObservability = NonNullable<QualityDashboardData['millionRuntimeObservability']>

type RuntimePolicy = Pick<RuntimeObservability,
  | 'operatingMode'
  | 'label'
  | 'strategySummary'
  | 'chapterGenerationMode'
  | 'serialOnly'
  | 'backgroundPrecomputeEnabled'
  | 'requireWritebackReady'
  | 'recallPauseThreshold'
  | 'checkpointGapWarningThreshold'
  | 'mainThreadPressureStrategy'
>

interface RuntimePrecomputeStatus {
  status: RuntimeObservability['precomputeQueueStatus']
  lastError?: string
  reason?: string
  trigger?: string
  finishedAt?: string
  startedAt?: string
  queuedAt?: string
}

export interface RuntimeObservabilityInput {
  writebackPendingCount: number
  writebackFailedCount: number
  staleCheckpointCount: number
  latestCheckpointChapterGap: number
  recallDegradedChapterCount: number
  consecutiveRecallFallbackChapters: number
  inspectionBlockedCount: number
  batchGateBlockedCount: number
  runtimePolicy: RuntimePolicy
  latestBatchGuardrailReason?: string
  latestBatchPauseReason?: string
  precomputeStatus: RuntimePrecomputeStatus
}

export function computeRuntimePressureScore(input: Omit<RuntimeObservabilityInput,
  | 'runtimePolicy'
  | 'latestBatchGuardrailReason'
  | 'latestBatchPauseReason'
  | 'precomputeStatus'
>): number {
  return Math.max(0, Math.min(100, Math.round(
    input.writebackPendingCount * 10
    + input.writebackFailedCount * 22
    + input.staleCheckpointCount * 8
    + Math.min(30, input.latestCheckpointChapterGap * 4)
    + input.recallDegradedChapterCount * 6
    + input.consecutiveRecallFallbackChapters * 12
    + input.inspectionBlockedCount * 14
    + input.batchGateBlockedCount * 14,
  )))
}

function resolveRuntimePressureLevel(score: number): RuntimeObservability['runtimePressureLevel'] {
  if (score >= 70) return 'high'
  if (score >= 35) return 'medium'
  return 'low'
}

function resolvePrecomputeSummary(status: RuntimePrecomputeStatus['status']): string {
  if (status === 'running') return 'story-memory checkpoint refresh 正在后台预计算。'
  if (status === 'queued') return 'story-memory checkpoint refresh 已排队等待执行。'
  if (status === 'failed') return 'story-memory checkpoint refresh 最近一次后台预计算失败。'
  return '当前没有排队中的 story-memory 后台预计算。'
}

function resolvePressureSummary(level: RuntimeObservability['runtimePressureLevel']): string {
  if (level === 'high') return '当前主线程压力代理偏高，继续扩批前应先清理回写、召回或检查点阻断。'
  if (level === 'medium') return '当前运行时压力可控但已有累积信号，建议先观察批次闭环再继续。'
  return '当前运行时压力代理较低，串行正文与回写顺序处于可继续状态。'
}

function resolveGuardrail(input: RuntimeObservabilityInput): { active: boolean; reason?: string } {
  const writebackActive = input.runtimePolicy.requireWritebackReady
    && (input.writebackPendingCount > 0 || input.writebackFailedCount > 0)
  const recallActive = input.consecutiveRecallFallbackChapters >= input.runtimePolicy.recallPauseThreshold
  const checkpointActive = input.latestCheckpointChapterGap >= input.runtimePolicy.checkpointGapWarningThreshold
  const inspectionActive = input.inspectionBlockedCount > 0 || input.batchGateBlockedCount > 0
  const active = writebackActive || recallActive || checkpointActive || inspectionActive || Boolean(input.latestBatchGuardrailReason)
  const reason = input.latestBatchGuardrailReason
    || (writebackActive
      ? '章后回写闸门仍在阻断继续推进，当前运行时不允许跨章乱序。'
      : recallActive
        ? `连续召回降级已达到阈值 ${input.runtimePolicy.recallPauseThreshold}，需要先恢复记忆链路。`
        : checkpointActive
          ? `检查点已落后 ${input.latestCheckpointChapterGap} 章，超过当前模式阈值 ${input.runtimePolicy.checkpointGapWarningThreshold}。`
          : inspectionActive
            ? '最近批次仍有检查阻断项，建议先清空阻断再继续扩批。'
            : undefined)
  return { active, reason }
}

export function buildRuntimeObservability(input: RuntimeObservabilityInput): RuntimeObservability {
  const runtimePressureScore = computeRuntimePressureScore(input)
  const runtimePressureLevel = resolveRuntimePressureLevel(runtimePressureScore)
  const guardrail = resolveGuardrail(input)
  const { runtimePolicy, precomputeStatus } = input
  return {
    ...runtimePolicy,
    guardrailActive: guardrail.active,
    activeGuardrailReason: guardrail.reason,
    pauseReason: input.latestBatchPauseReason,
    writebackPendingCount: input.writebackPendingCount,
    writebackFailedCount: input.writebackFailedCount,
    staleCheckpointCount: input.staleCheckpointCount,
    latestCheckpointChapterGap: input.latestCheckpointChapterGap,
    recallDegradedChapterCount: input.recallDegradedChapterCount,
    consecutiveRecallFallbackChapters: input.consecutiveRecallFallbackChapters,
    inspectionBlockedCount: input.inspectionBlockedCount,
    batchGateBlockedCount: input.batchGateBlockedCount,
    precomputeQueueStatus: precomputeStatus.status,
    precomputeLastError: precomputeStatus.lastError,
    precomputeReason: precomputeStatus.reason || precomputeStatus.trigger,
    precomputeUpdatedAt: precomputeStatus.finishedAt || precomputeStatus.startedAt || precomputeStatus.queuedAt,
    precomputeActiveTaskSummary: resolvePrecomputeSummary(precomputeStatus.status),
    runtimePressureLevel,
    runtimePressureScore,
    runtimePressureSummary: resolvePressureSummary(runtimePressureLevel),
    summary: runtimePolicy.operatingMode === 'million_longform'
      ? `百万字模式已按“正文串行 + 后台预计算 + 回写前置”运行；预计算状态 ${precomputeStatus.status}，当前压力 ${runtimePressureLevel}。`
      : `${runtimePolicy.label} 当前仍按正文串行执行；预计算状态 ${precomputeStatus.status}，运行时压力 ${runtimePressureLevel}。`,
  }
}
