import { Button, InputNumber, Select } from 'antd'
import {
  DEFAULT_QUALITY_FILTERS,
  hasActiveQualityFilters,
  type QualityCategoryFilter,
  type QualityDashboardFilters,
  type QualitySeverityFilter,
} from '../quality-dashboard-presentation'

const SEVERITY_OPTIONS: Array<{ value: QualitySeverityFilter; label: string }> = [
  { value: 'all', label: '全部严重度' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

const CATEGORY_OPTIONS: Array<{ value: QualityCategoryFilter; label: string }> = [
  { value: 'all', label: '全部指标类别' },
  { value: 'overview', label: '总览' },
  { value: 'language', label: '语言与对白' },
  { value: 'structure', label: '结构与推进' },
  { value: 'stability', label: '召回与状态' },
]

/** 顶部筛选条：章节范围 + 严重度 + 指标类别，状态由 index 持有并作用于各区块。 */
export default function QualityFilterBar({
  filters,
  onChange,
}: {
  filters: QualityDashboardFilters
  onChange: (next: QualityDashboardFilters) => void
}) {
  return (
    <div className="quality-dashboard-page__filter-bar">
      <span className="quality-dashboard-page__filter-bar-label">章节范围</span>
      <InputNumber
        size="small"
        min={1}
        placeholder="起始章"
        value={filters.chapterStart ?? undefined}
        onChange={(value) => onChange({ ...filters, chapterStart: typeof value === 'number' ? value : null })}
      />
      <span className="quality-dashboard-page__filter-bar-label">至</span>
      <InputNumber
        size="small"
        min={1}
        placeholder="结束章"
        value={filters.chapterEnd ?? undefined}
        onChange={(value) => onChange({ ...filters, chapterEnd: typeof value === 'number' ? value : null })}
      />
      <Select
        size="small"
        value={filters.severity}
        options={SEVERITY_OPTIONS}
        popupMatchSelectWidth={false}
        className="quality-dashboard-page__filter-bar-select"
        onChange={(severity) => onChange({ ...filters, severity })}
      />
      <Select
        size="small"
        value={filters.category}
        options={CATEGORY_OPTIONS}
        popupMatchSelectWidth={false}
        className="quality-dashboard-page__filter-bar-select quality-dashboard-page__filter-bar-select--wide"
        onChange={(category) => onChange({ ...filters, category })}
      />
      {hasActiveQualityFilters(filters) ? (
        <Button size="small" type="link" onClick={() => onChange(DEFAULT_QUALITY_FILTERS)}>
          清除筛选
        </Button>
      ) : null}
    </div>
  )
}
