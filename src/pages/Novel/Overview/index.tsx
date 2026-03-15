import React, { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Progress, Tag, Typography, Button } from 'antd'
import { EditOutlined, BookOutlined, TeamOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'

const { Title, Paragraph } = Typography

interface Props { novelId: number }

export default function Overview({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel } = useNovelStore()
  const [stats, setStats] = useState({ totalChapters: 0, completedChapters: 0, totalWords: 0, characterCount: 0 })

  useEffect(() => {
    window.electron.novel.stats(novelId).then(setStats)
  }, [novelId])

  const progress = currentNovel?.targetWords
    ? Math.min(100, Math.round((stats.totalWords / currentNovel.targetWords) * 100))
    : 0

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Title level={3} style={{ color: 'var(--color-text-primary)', margin: 0 }}>
            {currentNovel?.title}
          </Title>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            {currentNovel?.genreId && (
              <Tag color="blue">{currentNovel.genreName}</Tag>
            )}
            <Tag>{currentNovel?.status === 'writing' ? '写作中' : currentNovel?.status === 'completed' ? '已完成' : '草稿'}</Tag>
          </div>
        </div>
        <Button
          type="primary"
          icon={<EditOutlined />}
          onClick={() => navigate(`/novels/${novelId}/writing`)}
        >
          继续创作
        </Button>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card style={{ background: 'var(--color-bg-card)' }}>
            <Statistic
              title={<span style={{ color: 'var(--color-text-secondary)' }}>总字数</span>}
              value={stats.totalWords}
              suffix="字"
              valueStyle={{ color: 'var(--color-blue-light)' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: 'var(--color-bg-card)' }}>
            <Statistic
              title={<span style={{ color: 'var(--color-text-secondary)' }}>总章节</span>}
              value={stats.totalChapters}
              valueStyle={{ color: 'var(--color-text-primary)' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: 'var(--color-bg-card)' }}>
            <Statistic
              title={<span style={{ color: 'var(--color-text-secondary)' }}>已完成</span>}
              value={stats.completedChapters}
              suffix={`/ ${stats.totalChapters}`}
              valueStyle={{ color: 'var(--color-success)' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: 'var(--color-bg-card)' }}>
            <Statistic
              title={<span style={{ color: 'var(--color-text-secondary)' }}>人物数量</span>}
              value={stats.characterCount}
              suffix="位"
              valueStyle={{ color: 'var(--color-purple)' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 进度 */}
      <Card style={{ background: 'var(--color-bg-card)', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>创作进度</span>
          <span style={{ color: 'var(--color-text-primary)' }}>
            {(stats.totalWords / 10000).toFixed(1)} 万 / {((currentNovel?.targetWords || 0) / 10000).toFixed(0)} 万字
          </span>
        </div>
        <Progress
          percent={progress}
          strokeColor={{
            '0%': '#2E86AB',
            '100%': '#52c41a',
          }}
          trailColor="rgba(255,255,255,0.08)"
        />
      </Card>

      {/* 简介 */}
      {currentNovel?.synopsis && (
        <Card title="简介" style={{ background: 'var(--color-bg-card)', marginBottom: 16 }}>
          <Paragraph style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
            {currentNovel.synopsis}
          </Paragraph>
        </Card>
      )}

      {/* 扩充背景 */}
      {currentNovel?.expandedBackground && (
        <Card title="世界背景" style={{ background: 'var(--color-bg-card)' }}>
          <Paragraph style={{ color: 'var(--color-text-secondary)', margin: 0, whiteSpace: 'pre-wrap' }}>
            {currentNovel.expandedBackground}
          </Paragraph>
        </Card>
      )}
    </div>
  )
}
