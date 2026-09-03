import { buildMiniTrendGeometry, languageDriftRiskColor, qualityScoreToneColor } from '../quality-dashboard-presentation'

export default function MiniTrendRow({
  label,
  points,
  tone = 'risk',
}: {
  label: string
  points: Array<{ chapterNum: number; value: number }>
  tone?: 'risk' | 'score'
}) {
  if (points.length === 0) {
    return (
      <div className="quality-dashboard-page__mini-trend-empty">
        <span>{label}</span>
        <span>等待分解结果</span>
      </div>
    )
  }

  const { width, height, path, latest } = buildMiniTrendGeometry(points)
  const color = tone === 'score' ? qualityScoreToneColor(latest) : languageDriftRiskColor(latest)

  return (
    <div className="quality-dashboard-page__mini-trend-row">
      <span className="quality-dashboard-page__mini-trend-label">{label}</span>
      <div className="quality-dashboard-page__mini-trend-scroll">
        <svg width={width} height={height + 4} className="quality-dashboard-page__mini-trend-svg">
          <path d={path} fill="none" stroke={color} strokeWidth={2} />
        </svg>
      </div>
      <span className="quality-dashboard-page__mini-trend-value" style={{ color }}>{latest}</span>
    </div>
  )
}
