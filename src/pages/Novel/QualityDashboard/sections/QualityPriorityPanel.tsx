import { Button, Empty, Tag } from 'antd'
import type { QualityDashboardData, TaskPipelineStats } from '../../../../types'
import { getQualityRiskSeverityColor, getQualityRiskSeverityLabel } from '../../shared/revision-quality'
import {
  filterQualityRisks,
  qualityRiskKindLabel,
  type QualityDashboardFilters,
  type QualityRiskEntry,
} from '../quality-dashboard-presentation'

interface Props {
  data: QualityDashboardData
  pipelineStats: TaskPipelineStats | null
  filters: QualityDashboardFilters
  onOpenRevisionQueue: (risk?: QualityRiskEntry) => void
}

function readinessTone(rate: number): 'success' | 'warning' | 'error' {
  if (rate >= 80) return 'success'
  return rate >= 60 ? 'warning' : 'error'
}

/** 首屏只承担发现风险与进入修订队列，完整诊断、图表与章节明细留给按需分析。 */
export default function QualityPriorityPanel({ data, pipelineStats, filters, onOpenRevisionQueue }: Props) {
  const risks = filterQualityRisks(data.novelQualityMetrics.topRisks, filters).slice(0, 3)
  const styleWarningCount = data.styleCompliance.warningCount + data.styleCompliance.rewriteCount

  return (
    <div className="quality-dashboard-page__priority" data-quality-priority>
      <section className="quality-dashboard-page__priority-metrics" aria-label="关键质量信号">
        <div className="quality-dashboard-page__priority-metric">
          <span>生产就绪度</span>
          <strong>{data.productionReadiness.readyRate}%</strong>
          <Tag color={readinessTone(data.productionReadiness.readyRate)}>{data.productionReadiness.status}</Tag>
        </div>
        <div className="quality-dashboard-page__priority-metric">
          <span>全书健康</span>
          <strong>{data.novelQualityMetrics.healthScore} 分</strong>
          <small>{`已分析 ${data.novelQualityMetrics.analyzedChapterCount}/${data.novelQualityMetrics.totalChapterCount} 章`}</small>
        </div>
        <div className="quality-dashboard-page__priority-metric">
          <span>高优先风险</span>
          <strong>{data.novelQualityMetrics.criticalRiskCount} 项</strong>
          <small>{`中优先 ${data.novelQualityMetrics.warningRiskCount} 项`}</small>
        </div>
        <div className="quality-dashboard-page__priority-metric">
          <span>当前流水线</span>
          <strong>{pipelineStats?.activePipelineCount || 0} 条</strong>
          <small>{styleWarningCount > 0 ? `风格预警 ${styleWarningCount} 项` : '无风格预警'}</small>
        </div>
      </section>

      <section className="quality-dashboard-page__priority-risks" data-quality-priority-risks>
        <div className="quality-dashboard-page__priority-heading">
          <div>
            <span className="quality-dashboard-page__priority-kicker">优先处理</span>
            <h3>最高风险</h3>
          </div>
          <Button type="primary" onClick={() => onOpenRevisionQueue()}>进入修订队列</Button>
        </div>
        {risks.length > 0 ? risks.map((risk) => (
          <article key={`${risk.kind}-${risk.title}`} className="quality-dashboard-page__priority-risk">
            <div className="quality-dashboard-page__priority-risk-head">
              <div>
                <Tag color={getQualityRiskSeverityColor(risk.severity)}>{getQualityRiskSeverityLabel(risk.severity)}</Tag>
                <Tag color="blue">{qualityRiskKindLabel(risk.kind)}</Tag>
              </div>
              <Button size="small" onClick={() => onOpenRevisionQueue(risk)}>处理此问题</Button>
            </div>
            <strong>{risk.title}</strong>
            <p>{risk.detail}</p>
            <small>{risk.chapterNums.length > 0 ? `涉及：${risk.chapterNums.slice(0, 4).map((chapterNum) => `第${chapterNum}章`).join('、')}` : '尚未绑定具体章节'}</small>
          </article>
        )) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有需立即处理的风险" />
        )}
      </section>
    </div>
  )
}
