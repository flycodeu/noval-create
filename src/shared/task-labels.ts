/**
 * Human-readable Chinese labels for pipeline failure codes and generation
 * stages. UI must never surface a raw English code — always map through
 * formatFailure / formatStageLabel, both of which have safe fallbacks for
 * unknown values so new backend codes degrade gracefully.
 */

export interface FailureLabel {
  title: string
  action: string
}

const FAILURE_LABELS: Record<string, FailureLabel> = {
  contract_blocked: {
    title: '章节合同未就绪',
    action: '请先在「卷章大纲」完善本章目标与线索合同，再重新生成。',
  },
  context_overflow: {
    title: '上下文超出预算',
    action: '请减少注入上下文（如关闭部分召回项）或提高模型上下文上限。',
  },
  empty_output: {
    title: '模型返回了空结果',
    action: '可能是网络或模型波动，请重试；连续失败请检查模型配置。',
  },
  invalid_output: {
    title: '模型结果无法验证',
    action: '结构化结果为空或格式错误，当前草稿已保留；请重试对应流水线阶段。',
  },
  anti_ai_failed: {
    title: '未通过 AI 味质量门',
    action: '候选稿仍含高风险 AI 句式，请查看审校意见后重新生成或人工修订。',
  },
  gate_rewrite_required: {
    title: '验收门要求重写',
    action: '本章未达发布标准，请查看质检报告中的阻塞项并触发重写。',
  },
  canon_pending: {
    title: '世界状态回写待确认',
    action: '请在「回写质检」确认本章产生的世界/人物状态变更。',
  },
  canon_failed: {
    title: '世界状态回写失败',
    action: '回写草案生成失败，请重试；若持续失败请检查前章回写记录。',
  },
  human_review_required: {
    title: '需要人工复核',
    action: '系统无法自动判定改稿是否安全，请人工对比后决定是否采纳。',
  },
}

const STAGE_LABELS: Record<string, string> = {
  planning: '场景规划',
  drafting: '正文初稿',
  reviewing: '审校评估',
  rewriting: '重写修订',
  canonizing: '状态回写',
  completed: '已完成',
  failed: '已失败',
}

export function formatFailure(code: string | null | undefined, fallbackMessage?: string): FailureLabel {
  if (code && FAILURE_LABELS[code]) return FAILURE_LABELS[code]
  return {
    title: fallbackMessage?.trim() || '生成失败',
    action: code ? `错误代码：${code}。请重试，若持续失败请查看任务中心日志。` : '请重试，若持续失败请查看任务中心日志。',
  }
}

export function formatStageLabel(stage: string | null | undefined): string {
  if (!stage) return ''
  return STAGE_LABELS[stage] || stage
}
