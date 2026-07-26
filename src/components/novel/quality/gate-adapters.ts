/**
 * Adapters that normalize the three chapter-optimization gate results into a
 * single GateReport shape so QualityGateReport can render them uniformly.
 * Pure functions — no React, fully unit-testable.
 */

import type {
  ChapterOptimizationFactGuard,
  ChapterOptimizationQualityGate,
  ChapterStructuralRepairGate,
} from '../../../types'

export type GateItemSeverity = 'blocker' | 'warning' | 'info'

export interface GateReportItem {
  severity: GateItemSeverity
  message: string
  suggestion?: string
}

export interface GateReport {
  gateName: string
  passed: boolean
  items: GateReportItem[]
}

/** Warnings are the blocking reasons when a gate failed, advisory otherwise. */
function warningItems(warnings: string[], passed: boolean, suggestion?: string): GateReportItem[] {
  return (warnings || []).filter(Boolean).map((message) => ({
    severity: passed ? 'warning' as const : 'blocker' as const,
    message,
    suggestion,
  }))
}

function listItem(label: string, values: string[] | undefined, severity: GateItemSeverity, suggestion?: string): GateReportItem[] {
  const filtered = (values || []).filter(Boolean)
  if (filtered.length === 0) return []
  return [{ severity, message: `${label}：${filtered.join('、')}`, suggestion }]
}

export function fromStructuralGate(gate: ChapterStructuralRepairGate): GateReport {
  const passed = gate.safeToApply
  const items: GateReportItem[] = [
    ...(gate.required
      ? []
      : [{ severity: 'info' as const, message: '本章未触发结构修复条件，此门按通过处理。' }]),
    ...warningItems(gate.warnings, passed, passed ? undefined : '结构修复稿改动越界，建议不采纳或人工比对后局部合并。'),
    ...listItem('状态变化信号', gate.stateChangeSignals, 'info'),
    ...listItem('兑现信号', gate.payoffSignals, 'info'),
    ...listItem('代价信号', gate.costSignals, 'info'),
    ...listItem('选择信号', gate.choiceSignals, 'info'),
    ...listItem('配角能动性信号', gate.supportingAgencySignals, 'info'),
    ...listItem('误判信号', gate.misjudgmentSignals, 'info'),
    {
      severity: 'info',
      message: `句级改动率 ${Math.round((gate.changedSentenceRate || 0) * 100)}%，范围扩张比 ${Math.round((gate.scopeExpansionRatio || 0) * 100)}%`,
    },
  ]
  return { gateName: '结构修复门', passed, items }
}

export function fromOptimizationQualityGate(gate: ChapterOptimizationQualityGate): GateReport {
  const passed = gate.safeToApply
  const items: GateReportItem[] = [
    ...warningItems(gate.warnings, passed, passed ? undefined : '优化稿语言质量劣化，建议重新优化或人工修订。'),
    {
      severity: gate.optimizedStrongAiFlavorCount > gate.originalStrongAiFlavorCount ? 'warning' : 'info',
      message: `强 AI 味句式：${gate.originalStrongAiFlavorCount} → ${gate.optimizedStrongAiFlavorCount}`,
    },
    {
      severity: gate.optimizedHighSeverityCount > gate.originalHighSeverityCount ? 'warning' : 'info',
      message: `高危语言问题：${gate.originalHighSeverityCount} → ${gate.optimizedHighSeverityCount}`,
    },
    {
      severity: gate.optimizedDriftScore > gate.originalDriftScore ? 'warning' : 'info',
      message: `语言漂移分：${gate.originalDriftScore} → ${gate.optimizedDriftScore}`,
    },
    ...listItem('原稿护栏命中', gate.originalGuardrailHits, 'info'),
    ...listItem(
      '优化稿护栏命中',
      gate.optimizedGuardrailHits,
      (gate.optimizedGuardrailHits || []).length > (gate.originalGuardrailHits || []).length ? 'warning' : 'info',
    ),
  ]
  return { gateName: '后验质量门', passed, items }
}

export function fromFactGuard(guard: ChapterOptimizationFactGuard): GateReport {
  const passed = guard.safeToApply
  const items: GateReportItem[] = [
    ...warningItems(guard.warnings, passed, passed ? undefined : '优化稿疑似改动了剧情事实，请人工比对后再决定是否采纳。'),
    ...listItem('优化稿新引入实体', guard.introducedTrackedEntities, 'warning', '确认新实体是否属于捏造设定。'),
    ...listItem('优化稿丢失实体', guard.removedTrackedEntities, 'warning', '确认关键人物/道具是否被误删。'),
    ...listItem('数字被改动', guard.changedNumbers, 'warning', '核对时间、数量、金额等硬事实。'),
    ...listItem('缺乏支撑的新事实', guard.unsupportedNarrativeFacts, 'warning', '结构修复稿新增的实质事实需前文支撑。'),
    ...(guard.endingHookChanged
      ? [{ severity: 'warning' as const, message: '结尾钩子被改动', suggestion: '确认新结尾是否保留追读钩子。' }]
      : []),
    ...(guard.aiProcessLeakCount > 0
      ? [{ severity: 'warning' as const, message: `检测到 ${guard.aiProcessLeakCount} 处 AI 过程语言泄漏`, suggestion: '删除“作为AI/以下是优化后”等过程句。' }]
      : []),
  ]
  if (items.length === 0) {
    items.push({ severity: 'info', message: '未发现事实层改动风险。' })
  }
  return { gateName: '事实保护门', passed, items }
}
