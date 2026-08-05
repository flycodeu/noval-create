import React, { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, Col, Row } from 'antd'
import type { QualityDashboardData } from '@/types'

interface QualityChartsProps {
  data: QualityDashboardData
}

const STATUS_LABELS: Record<string, string> = {
  worsening: '恶化',
  stable: '稳定',
  improving: '改善',
}

export const QualityCharts: React.FC<QualityChartsProps> = ({ data }) => {
  const storyArcProgressData = useMemo(
    () =>
      (data.storyArcProgressTrend ?? []).map((item) => ({
        chapter: `第${item.chapterNum}章`,
        推进: item.progressCount,
        空转: item.stalledCount,
      })),
    [data.storyArcProgressTrend],
  )

  const driftDistributionData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const alert of data.chapterGateDriftAlerts ?? []) {
      counts.set(alert.status, (counts.get(alert.status) ?? 0) + 1)
    }
    return Array.from(counts, ([status, count]) => ({
      status: STATUS_LABELS[status] ?? status,
      数量: count,
    }))
  }, [data.chapterGateDriftAlerts])

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card title="故事弧推进与空转趋势" bordered={false}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={storyArcProgressData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="chapter" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="推进" stroke="#1677ff" strokeWidth={2} />
              <Line type="monotone" dataKey="空转" stroke="#fa541c" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="章节质量漂移分布" bordered={false}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={driftDistributionData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="数量" fill="#722ed1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </Col>
    </Row>
  )
}

export default QualityCharts
