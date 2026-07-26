/**
 * 上下文变更原因的中文映射。
 *
 * 历史上各服务用英文短语调用 markNovelContextChanged / markSubsequentChaptersStale，
 * 这些原因会直落 chapters.stale_reason_json 并原样出现在发布检查、章节状态等
 * 用户可见文案里。此表在「写入」与「读取」两个咽喉点各套一层：写入时新数据
 * 直接落中文，读取时兜底翻译存量英文。未知原因原样透传（可能已是中文）。
 */

const CONTEXT_CHANGE_REASON_LABELS: Record<string, string> = {
  'Chapter contract updated': '章节合同已更新',
  'Chapter numbering normalized': '章节编号已重排',
  'Chapter segments changed': '章节分段已调整',
  'Chapter segments compiled': '章节分段已合稿',
  'Chapter writeback applied': '章节回写已应用',
  'Character arc auto-sync updated': '人物弧自动同步已更新',
  'Character arcs changed': '人物弧已变更',
  'Character draft artifact committed': '人物草稿已提交',
  'Character profiles changed': '人物档案已变更',
  'Character relations changed': '人物关系已变更',
  'Draft entities discovered from new content': '正文中发现了新实体草稿',
  'Endgame commitment updated': '终局承诺已更新',
  'External source grounding updated': '外部资料锚定已更新',
  'Factions changed': '势力设定已变更',
  'Foreshadow ledger deleted': '伏笔账本条目已删除',
  'Foreshadow ledger updated': '伏笔账本已更新',
  'Glossary changed': '设定词典已变更',
  'Growth assets bound to chapter contract': '成长资产已绑定章节合同',
  'Growth assets bound to volume design': '成长资产已绑定卷设计',
  'Growth track deleted': '成长轨道已删除',
  'Growth tracks updated': '成长轨道已更新',
  'Info gap board changed': '信息差板已变更',
  'Map relations changed': '地图关系已变更',
  'Map structure changed': '地图结构已变更',
  'Resistance tracks changed': '阻力轨道已变更',
  'Resource pool deleted': '资源池已删除',
  'Resource pools updated': '资源池已更新',
  'Reward/cost event deleted': '奖惩事件已删除',
  'Reward/cost events updated': '奖惩事件已更新',
  'Scene contract updated': '场景合同已更新',
  'Scene templates changed': '场景模板已变更',
  'Story item character links repaired': '物品与人物关联已修复',
  'Story item links changed': '物品关联已变更',
  'Story items changed': '物品设定已变更',
  'Story outline changed': '故事大纲已变更',
  'Story structure changed': '故事结构已变更',
  'Story threads changed': '故事线程已变更',
  'Story threads restored': '故事线程已恢复',
  'Timeline events changed': '时间轴事件已变更',
  'Timeline events restored': '时间轴事件已恢复',
  'Volume audit executed': '卷级审计已执行',
  'Volume constraints synced to chapter contracts': '卷级约束已同步到章节合同',
  'Volume design updated': '卷设计已更新',
  'World rules changed': '世界规则已变更',
}

export function translateContextChangeReason(reason: string): string {
  const normalized = String(reason || '').trim()
  if (!normalized) return normalized
  return CONTEXT_CHANGE_REASON_LABELS[normalized] || normalized
}

export function translateContextChangeReasons(reasons: string[]): string[] {
  return [...new Set(reasons.map(translateContextChangeReason).filter(Boolean))]
}

/**
 * 把过期原因压成一句简洁提示：最多展示 maxShown 项，其余折叠为「等 N 项」。
 */
export function formatStaleReasonsSummary(reasons: string[], maxShown = 3): string {
  const translated = translateContextChangeReasons(reasons)
  if (translated.length === 0) return '上下文版本落后于当前设定。'
  const shown = translated.slice(0, maxShown).join('；')
  const restCount = translated.length - maxShown
  return restCount > 0
    ? `${shown} 等 ${translated.length} 项变更。请刷新本章上下文后重试。`
    : `${shown}。请刷新本章上下文后重试。`
}
