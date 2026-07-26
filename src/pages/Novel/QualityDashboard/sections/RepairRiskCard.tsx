import { Button, Tag } from 'antd'
import type { QualityRepairAction } from '../../../../types'
import { getQualityRiskSeverityColor, getQualityRiskSeverityLabel } from '../../shared/revision-quality'
import {
  qualityRepairMetricLabel,
  qualityRiskKindLabel,
  type QualityRiskEntry,
} from '../quality-dashboard-presentation'

export default function RepairRiskCard({
  risk,
  onSelectRisk,
  onRunAction,
  repairingActionId,
  compact = false,
}: {
  risk: QualityRiskEntry
  onSelectRisk: (risk: QualityRiskEntry) => void
  onRunAction: (action: QualityRepairAction) => void
  repairingActionId: string | null
  compact?: boolean
}) {
  return (
    <div className="quality-dashboard-page__panel-card quality-dashboard-page__panel-card--tight">
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
        <Tag color={getQualityRiskSeverityColor(risk.severity)} className="quality-dashboard-page__tag-reset">
          {getQualityRiskSeverityLabel(risk.severity)}
        </Tag>
        <Tag color="blue" className="quality-dashboard-page__tag-reset">{qualityRiskKindLabel(risk.kind)}</Tag>
        {risk.metricKey ? <Tag color="purple" className="quality-dashboard-page__tag-reset">{qualityRepairMetricLabel(risk.metricKey)}</Tag> : null}
        <strong>{risk.title}</strong>
      </div>
      <div className="quality-dashboard-page__body-copy">{risk.detail}</div>
      <div className="quality-dashboard-page__dimension quality-dashboard-page__body-copy--strong">
        <div><strong>原因：</strong>{risk.whyItHappened}</div>
        <div><strong>修法：</strong>{risk.howToFix}</div>
      </div>
      <div className="quality-dashboard-page__body-copy--soft">
        {risk.chapterNums.length > 0 ? `涉及章节：${risk.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}` : '当前风险没有绑定具体章节。'}
      </div>
      <div className="quality-dashboard-page__row quality-dashboard-page__row--wrap">
        <Button size="small" onClick={() => onSelectRisk(risk)}>定位风险</Button>
        {risk.suggestedActions.slice(0, compact ? 2 : 3).map((action) => (
          <Button
            key={action.id}
            size="small"
            type={action.safeToExecute ? 'primary' : 'default'}
            loading={repairingActionId === action.id}
            onClick={() => onRunAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
