import type { ChapterPublishCheck, ChapterPublishCheckItem } from '../../../types'

export type PublishCheckIssueStatus = 'warning' | 'blocker' | 'rewrite'

export interface PublishFinalizationDecision {
  kind: 'allow' | 'confirm-warning' | 'block'
  title?: string
  messages: string[]
  primaryIssue?: ChapterPublishCheckItem
}

function formatPublishCheckItemText(item: ChapterPublishCheckItem): string {
  const statusLabel = item.status === 'rewrite'
    ? '退回重写'
    : item.status === 'blocker'
      ? '阻塞'
      : item.status === 'warning'
        ? '预警'
        : '通过'
  const sourceLabel = item.segmentTitle
    ? ` · ${item.segmentTitle}`
    : item.source === 'scene'
      ? ' · 场景'
      : item.source === 'contract'
        ? ' · 合同'
        : item.source === 'review'
          ? ' · 审校'
          : item.source === 'thread'
            ? ' · 线程'
            : item.source === 'volume'
              ? ' · 卷目标'
              : ''
  return `${statusLabel} · ${item.label}${sourceLabel}：${item.detail}`
}

function formatContractAuditItemText(
  item: ChapterPublishCheck['contractAudit']['items'][number],
): string {
  const prefix = item.status === 'pass' ? '通过' : item.status === 'warning' ? '中优先' : '阻塞'
  return `${prefix} · ${item.label}：${item.detail}`
}

export function collectPublishCheckMessages(
  check: ChapterPublishCheck,
  status: PublishCheckIssueStatus,
): string[] {
  return [
    ...check.checklist
      .filter((item) => item.status === status)
      .map(formatPublishCheckItemText),
    ...(status === 'rewrite'
      ? []
      : check.contractAudit.items
        .filter((item) => item.status === status)
        .map((item) => `合同对账 · ${formatContractAuditItemText(item)}`)),
  ]
}

export function resolvePublishFinalizationDecision(
  check: ChapterPublishCheck,
): PublishFinalizationDecision {
  if (check.gateLevel === 'rewrite') {
    return {
      kind: 'block',
      title: '章节必须退回重写',
      messages: collectPublishCheckMessages(check, 'rewrite'),
      primaryIssue: check.checklist.find((item) => item.status === 'rewrite'),
    }
  }
  if (!check.ready || check.gateLevel === 'blocker') {
    return {
      kind: 'block',
      title: '章节验收未通过',
      messages: collectPublishCheckMessages(check, 'blocker'),
      primaryIssue: check.checklist.find((item) => item.status === 'blocker'),
    }
  }
  if (check.gateLevel === 'warning' && check.warningCount > 0) {
    return {
      kind: 'confirm-warning',
      title: '章节验收仍有预警',
      messages: collectPublishCheckMessages(check, 'warning'),
    }
  }
  return { kind: 'allow', messages: [] }
}

export function canApplyChapterOptimization(
  result: { factGuard?: { safeToApply: boolean }; qualityGate?: { safeToApply: boolean } } | null,
): boolean {
  return Boolean(
    result
    && (!result.factGuard || result.factGuard.safeToApply)
    && (!result.qualityGate || result.qualityGate.safeToApply),
  )
}
