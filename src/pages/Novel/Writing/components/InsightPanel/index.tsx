import React from 'react'
import ContractPanel, { type ContractPanelSection } from '../../../../../components/novel/writing/ContractPanel'
import SectionHeader from '../../../../../components/novel/common/SectionHeader'

export type WritingRouteKey = 'editor' | 'context' | 'review' | 'history'

export { InsightCard, StringList } from './InsightCard'
export {
  AiExplainabilityCard,
  ChapterBridgeMemoryCard,
  ChapterFocusCard,
  ConstraintInjectionCard,
  ContextUsageImpactCard,
  PreviousChapterFeedCard,
  RecallDiagnosticsCard,
  WriterToolsTraceCard,
} from './context-cards'
export {
  AiCheckResult,
  CharacterStateMemoryCard,
  DialogueFingerprintHealthCard,
  HumanizationHealthCard,
  LanguageDriftHealthCard,
  StoryDynamicsHealthCard,
  WorldStateHealthCard,
} from './health-cards'
export {
  ChapterForeshadowWritebackCard,
  ChapterRevealConstraintCard,
} from './writeback-cards'
export {
  computeVolumeTruthRevealStats,
  formatRatioPercent,
  getCurrentVolumeNumber,
  normalizeIdArray,
} from './insight-utils'

const UTILITY_TABS: Array<{ key: WritingRouteKey; label: string }> = [
  { key: 'editor', label: '焦点 / 合同' },
  { key: 'context', label: '上下文' },
  { key: 'history', label: '版本' },
  { key: 'review', label: '审校' },
]

interface InsightPanelProps {
  open: boolean
  activeRoute: WritingRouteKey
  chapterContractSections: ContractPanelSection[]
  sceneContractSections: ContractPanelSection[]
  onNavigate: (route: WritingRouteKey) => void
  children: React.ReactNode
}

/** 写作页右栏辅助区：合同 / 上下文 / 审校 / 版本 tab 切换 + 各 insight 内容。 */
export default function InsightPanel({
  open,
  activeRoute,
  chapterContractSections,
  sceneContractSections,
  onNavigate,
  children,
}: InsightPanelProps) {
  return (
    <aside className={`chapter-console-page__column chapter-console-page__column--right${open ? '' : ' is-hidden'}`}>
      <section className="chapter-console-page__panel">
        <SectionHeader
          eyebrow="辅助区"
          title="合同 / 上下文 / 审校 / 版本"
          description="按需展开辅助内容，避免持续压缩正文编辑器。"
        />
        <div className="chapter-console-page__route-switch">
          {UTILITY_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={activeRoute === tab.key ? 'is-active' : ''}
              onClick={() => onNavigate(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>
      <ContractPanel
        title="章节合同"
        sections={chapterContractSections}
      />
      <ContractPanel
        title="场景合同"
        sections={sceneContractSections.length > 0 ? sceneContractSections : [{
          key: 'empty-scene',
          title: '场景合同缺失',
          items: ['建议先补场景计划，避免正文只剩大段泛写。'],
          tone: 'danger',
        }]}
      />
      {open ? children : null}
    </aside>
  )
}
