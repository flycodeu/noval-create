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
  const hasAnalyzedProse = data.novelQualityMetrics.analyzedChapterCount > 0

  return (
    <div className="quality-dashboard-page__priority" data-quality-priority>
      <section className="quality-dashboard-page__priority-metrics" aria-label="关键质量信号">
        <div className="quality-dashboard-page__priority-metric">
          <span>续批条件</span>
          <strong>{hasAnalyzedProse ? `${data.productionReadiness.readyRate}%` : '待验证'}</strong>
          <Tag color={hasAnalyzedProse ? readinessTone(data.productionReadiness.readyRate) : 'default'}>
            {hasAnalyzedProse ? data.productionReadiness.status : '尚无正文评估'}
          </Tag>
        </div>
        <div className="quality-dashboard-page__priority-metric">
          <span>正文健康</span>
          <strong>{hasAnalyzedProse ? `${data.novelQualityMetrics.healthScore} 分` : '待评估'}</strong>
          <small>{hasAnalyzedProse
            ? `已分析 ${data.novelQualityMetrics.analyzedChapterCount}/${data.novelQualityMetrics.totalChapterCount} 章`
            : `${data.novelQualityMetrics.totalChapterCount} 章草案，尚无已分析正文`}</small>
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
        {!hasAnalyzedProse ? (
          <p className="quality-dashboard-page__body-copy">尚无正文分析，当前显示设定与草案风险。</p>
        ) : null}
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
