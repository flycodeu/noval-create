import React, { useEffect, useState, useCallback } from 'react'
import {
  Button, Input, Select, Dropdown, Modal, Steps, Form, Radio,
  Tag, Progress, Empty, Spin, message, Tooltip, Card, Row, Col
} from 'antd'
import {
  PlusOutlined, SearchOutlined, MoreOutlined, DeleteOutlined,
  ExportOutlined, EditOutlined, LoadingOutlined, ReloadOutlined,
  CheckOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import { Novel, Genre, Template } from '../../types'
import { useNovelStore } from '../../stores/novel.store'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#5c6378' },
  writing: { label: '写作中', color: '#2E86AB' },
  completed: { label: '已完成', color: '#52c41a' },
  archived: { label: '已归档', color: '#3d4155' },
}

const GENRE_GRADIENTS: Record<string, string> = {
  '现代都市': 'linear-gradient(135deg, #2E86AB, #1E3A5F)',
  '古代言情': 'linear-gradient(135deg, #E84393, #8B1A5C)',
  '玄幻修真': 'linear-gradient(135deg, #9B59B6, #4A235A)',
  '悬疑推理': 'linear-gradient(135deg, #2C3E50, #1A252F)',
  '科幻未来': 'linear-gradient(135deg, #1ABC9C, #0E6655)',
  '架空历史': 'linear-gradient(135deg, #D35400, #784212)',
  '赛博朋克': 'linear-gradient(135deg, #8E44AD, #1A5276)',
  '武侠': 'linear-gradient(135deg, #C0392B, #641E16)',
  '历史正剧': 'linear-gradient(135deg, #7D6608, #4D4004)',
  '末世求生': 'linear-gradient(135deg, #5D4037, #3E2723)',
  '丧尸末日': 'linear-gradient(135deg, #37474F, #263238)',
  '盗墓探秘': 'linear-gradient(135deg, #4E342E, #1B0000)',
}

const TARGET_WORDS_OPTIONS = [
  { label: '短篇 10 万字', value: 100000 },
  { label: '中篇 30 万字', value: 300000 },
  { label: '长篇 50 万字', value: 500000 },
  { label: '超长篇 100 万字', value: 1000000 },
]

function formatWordCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万字`
  return `${value.toLocaleString()} 字`
}

const GENRE_DESCRIPTIONS: Record<number, string> = {
  1: '都市生活与现代情感',
  2: '古典爱情与宫廷风云',
  3: '仙法修炼与玄幻世界',
  4: '烧脑推理与心理博弈',
  5: '未来科技与星际探索',
  6: '另一种历史演进轨迹',
  7: '高科技与低生活并存',
  8: '侠义江湖与武林争霸',
  9: '正史叙事与家国情怀',
  10: '末日灾变后的生存重建',
  11: '病毒蔓延的生死逃亡',
  12: '古墓机关与寻宝探秘',
}

export default function NovelList() {
  const navigate = useNavigate()
  const { novels, setNovels } = useNovelStore()

  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('updatedAt')
  const [styleTemplates, setStyleTemplates] = useState<Template[]>([])
  const [worldTemplates, setWorldTemplates] = useState<Template[]>([])
  const [modelConfigs, setModelConfigs] = useState<{ id: number; name: string }[]>([])

  // 向导状态
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [wizardLoading, setWizardLoading] = useState(false)
  const [wizardForm] = Form.useForm()
  const [expandedData, setExpandedData] = useState<{
    expanded_background: string; titles: string[]; synopsis: string
  } | null>(null)
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null)

  const loadNovels = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electron.novel.list()
      setNovels(list)
    } catch {
      message.error('加载失败')
    } finally {
      setLoading(false)
    }
  }, [setNovels])

  useEffect(() => {
    loadNovels()
    window.electron.template.list('style').then(setStyleTemplates)
    window.electron.template.list('world').then(setWorldTemplates)
    window.electron.model.list().then(setModelConfigs)
  }, [loadNovels])

  const filteredNovels = novels
    .filter(n => {
      if (search && !n.title.includes(search)) return false
      if (statusFilter !== 'all' && n.status !== statusFilter) return false
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'updatedAt') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      if (sortBy === 'totalWords') return b.totalWords - a.totalWords
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh')
      return 0
    })

  const handleDelete = async (id: number, title: string) => {
    Modal.confirm({
      title: `确认删除《${title}》？`,
      content: '删除后所有章节、人物、地图数据将一并删除，无法恢复。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await window.electron.novel.delete(id)
        loadNovels()
        message.success('已删除')
      },
    })
  }

  const handleExport = async (id: number, format: string) => {
    try {
      const filePath = await window.electron.novel.export(id, format)
      message.success(`已导出到 ${filePath}`)
    } catch (e: unknown) {
      if (e instanceof Error && e.message !== '用户取消') {
        message.error('导出失败')
      }
    }
  }

  // 向导处理
  const handleWizardNext = async () => {
    if (wizardStep === 0) {
      await wizardForm.validateFields(['genreId', 'styleTemplateId', 'worldTemplateId'])
      setWizardStep(1)
    } else if (wizardStep === 1) {
      const values = await wizardForm.validateFields(['userBackground'])
      setWizardLoading(true)
      try {
        const { genreId, worldTemplateId, modelConfigId } = wizardForm.getFieldsValue()
        const data = await window.electron.ai.expandBackground({
          userBackground: values.userBackground,
          genreId,
          worldTemplateId,
          modelConfigId,
        })
        setExpandedData(data)
        wizardForm.setFieldsValue({
          expandedBackground: data.expanded_background,
          synopsis: data.synopsis,
          title: data.titles[0] || '',
        })
        setWizardStep(2)
      } catch (e: unknown) {
        message.error(`AI 扩充失败：${e instanceof Error ? e.message : '未知错误'}`)
      } finally {
        setWizardLoading(false)
      }
    } else if (wizardStep === 2) {
      setWizardStep(3)
    } else if (wizardStep === 3) {
      const values = await wizardForm.validateFields(['title', 'synopsis', 'targetWords'])
      const allValues = wizardForm.getFieldsValue(true)
      try {
        const novelId = await window.electron.novel.create({
          title: values.title,
          synopsis: values.synopsis,
          genreId: allValues.genreId,
          userBackground: allValues.userBackground,
          expandedBackground: allValues.expandedBackground,
          styleTemplateId: allValues.styleTemplateId,
          worldTemplateId: allValues.worldTemplateId,
          modelConfigId: allValues.modelConfigId,
          targetWords: values.targetWords,
        })
        setWizardOpen(false)
        wizardForm.resetFields()
        setWizardStep(0)
        setExpandedData(null)
        setSelectedGenreId(null)
        await loadNovels()
        navigate(`/novels/${novelId}/overview`)
      } catch {
        message.error('创建失败')
      }
    }
  }

  const genreOptions = [
    { value: 1, label: '现代都市' },
    { value: 2, label: '古代言情' },
    { value: 3, label: '玄幻修真' },
    { value: 4, label: '悬疑推理' },
    { value: 5, label: '科幻未来' },
    { value: 6, label: '架空历史' },
    { value: 7, label: '赛博朋克' },
    { value: 8, label: '武侠' },
    { value: 9, label: '历史正剧' },
    { value: 10, label: '末世求生' },
    { value: 11, label: '丧尸末日' },
    { value: 12, label: '盗墓探秘' },
  ]

  return (
    <div style={{ padding: '20px 24px', height: '100%', overflow: 'auto' }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索小说..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 240 }}
          allowClear
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'draft', label: '草稿' },
            { value: 'writing', label: '写作中' },
            { value: 'completed', label: '已完成' },
            { value: 'archived', label: '已归档' },
          ]}
        />
        <Select
          value={sortBy}
          onChange={setSortBy}
          style={{ width: 140 }}
          options={[
            { value: 'updatedAt', label: '最近修改' },
            { value: 'totalWords', label: '按字数排序' },
            { value: 'title', label: '按标题排序' },
          ]}
        />
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setWizardOpen(true)}
        >
          新建小说
        </Button>
      </div>

      {/* 小说卡片网格 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : filteredNovels.length === 0 ? (
        <Empty
          description={search ? '没有找到匹配的小说' : '还没有小说，点击「新建小说」开始创作'}
          style={{ paddingTop: 80 }}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {filteredNovels.map(novel => (
            <Col key={novel.id} xs={24} sm={12} md={8} lg={6}>
              <NovelCard
                novel={novel}
                onClick={() => navigate(`/novels/${novel.id}/overview`)}
                onDelete={() => handleDelete(novel.id, novel.title)}
                onExport={(format) => handleExport(novel.id, format)}
              />
            </Col>
          ))}
        </Row>
      )}

      {/* 初始化向导 Modal */}
      <Modal
        title="新建小说"
        open={wizardOpen}
        onCancel={() => { setWizardOpen(false); setWizardStep(0); wizardForm.resetFields(); setSelectedGenreId(null) }}
        footer={null}
        width={800}
        destroyOnHidden
      >
        <Steps
          current={wizardStep}
          items={[
            { title: '题材选择' },
            { title: '背景录入' },
            { title: 'AI 扩充' },
            { title: '基础信息' },
          ]}
          style={{ marginBottom: 32 }}
        />

        <Form form={wizardForm} layout="vertical">
          {/* Step 0: 题材与模板 */}
          {wizardStep === 0 && (
            <>
              <Form.Item
                name="genreId"
                label="选择题材"
                rules={[{ required: true, message: '请选择题材' }]}
              >
                <div>
                  <Row gutter={[10, 10]}>
                    {genreOptions.map(genre => {
                      const isSelected = selectedGenreId === genre.value
                      const gradient = GENRE_GRADIENTS[genre.label] || 'linear-gradient(135deg, #1a1d27, #252840)'
                      return (
                        <Col span={8} key={genre.value}>
                          <div
                            onClick={() => {
                              setSelectedGenreId(genre.value)
                              wizardForm.setFieldValue('genreId', genre.value)
                            }}
                            style={{
                              background: gradient,
                              borderRadius: 8,
                              padding: '12px 14px',
                              cursor: 'pointer',
                              border: isSelected ? '2px solid #2E86AB' : '2px solid transparent',
                              position: 'relative',
                              transition: 'border-color 0.2s',
                            }}
                          >
                            {isSelected && (
                              <CheckOutlined style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                color: '#2E86AB',
                                fontSize: 14,
                                fontWeight: 700,
                              }} />
                            )}
                            <div style={{ fontWeight: 600, color: 'white', marginBottom: 4 }}>
                              {genre.label}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
                              {GENRE_DESCRIPTIONS[genre.value] || ''}
                            </div>
                          </div>
                        </Col>
                      )
                    })}
                  </Row>
                </div>
              </Form.Item>
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item name="styleTemplateId" label="文风模板">
                    <Select
                      options={styleTemplates.map(t => ({ value: t.id, label: t.name }))}
                      placeholder="选择写作风格（可选）"
                      allowClear
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="worldTemplateId" label="世界观模板">
                    <Select
                      options={worldTemplates.map(t => ({ value: t.id, label: t.name }))}
                      placeholder="选择世界观体系（可选）"
                      allowClear
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="modelConfigId" label="使用模型">
                    <Select
                      options={modelConfigs.map(m => ({ value: m.id, label: m.name }))}
                      placeholder="使用默认模型"
                      allowClear
                    />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          {/* Step 1: 背景录入 */}
          {wizardStep === 1 && (
            <Form.Item
              name="userBackground"
              label="故事背景"
              rules={[{ required: true, message: '请输入背景' }, { min: 20, message: '至少20字' }]}
              extra="用你自己的话描述故事背景，不需要完整，关键词也行（建议50字以上）"
            >
              <Input.TextArea
                rows={6}
                placeholder="例如：一个现代城市的侦探，意外卷入了一起连环失踪案，发现背后隐藏着一个存在了百年的秘密组织..."
                showCount
              />
            </Form.Item>
          )}

          {/* Step 2: AI 扩充确认 */}
          {wizardStep === 2 && (
            <div style={{ display: 'flex', gap: 20 }}>
              <div style={{ flex: 1 }}>
                <Form.Item name="expandedBackground" label="AI 扩充背景（可编辑）">
                  <Input.TextArea rows={10} />
                </Form.Item>
              </div>
              <div style={{ width: 260 }}>
                <div style={{ marginBottom: 8, color: 'var(--color-text-secondary)', fontSize: 12 }}>选择标题</div>
                <Form.Item name="title">
                  <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {expandedData?.titles.map((t, i) => (
                      <Radio key={i} value={t} style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>
                        {t}
                      </Radio>
                    ))}
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="synopsis" label="AI 生成简介（可编辑）">
                  <Input.TextArea rows={5} />
                </Form.Item>
                <Button
                  icon={<ReloadOutlined />}
                  loading={wizardLoading}
                  onClick={() => { setWizardStep(1); setExpandedData(null) }}
                >
                  重新生成
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: 基础信息完善 */}
          {wizardStep === 3 && (
            <>
              <Form.Item name="title" label="最终标题" rules={[{ required: true }]}>
                <Input placeholder="小说标题" />
              </Form.Item>
              <Form.Item name="synopsis" label="最终简介">
                <Input.TextArea rows={5} />
              </Form.Item>
              <Form.Item name="targetWords" label="目标字数" initialValue={200000}>
                <Select options={TARGET_WORDS_OPTIONS} />
              </Form.Item>
            </>
          )}
        </Form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          {wizardStep > 0 && (
            <Button onClick={() => setWizardStep(s => s - 1)}>上一步</Button>
          )}
          <Button
            type="primary"
            onClick={handleWizardNext}
            loading={wizardLoading}
            icon={wizardLoading ? <LoadingOutlined /> : undefined}
          >
            {wizardStep === 3 ? '创建小说' : wizardStep === 1 ? 'AI 扩充' : '下一步'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// 单张小说卡片组件
function NovelCard({
  novel,
  onClick,
  onDelete,
  onExport,
}: {
  novel: Novel
  onClick: () => void
  onDelete: () => void
  onExport: (format: string) => void
}) {
  const status = STATUS_LABELS[novel.status] || STATUS_LABELS.draft
  const progress = novel.targetWords > 0
    ? Math.min(100, Math.round((novel.totalWords / novel.targetWords) * 100))
    : 0
  const gradient = GENRE_GRADIENTS[novel.genreName || ''] || 'linear-gradient(135deg, #1a1d27, #252840)'
  const synopsis = novel.synopsis?.trim()
    || novel.expandedBackground?.trim()
    || novel.userBackground?.trim()
    || '还没有补充简介，进入工作台后可以继续完善背景、设定和结构。'

  const menuItems = [
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: '继续创作',
      onClick: onClick,
    },
    {
      key: 'export-txt',
      icon: <ExportOutlined />,
      label: '导出 TXT',
      onClick: () => onExport('txt'),
    },
    {
      key: 'export-md',
      icon: <ExportOutlined />,
      label: '导出 Markdown',
      onClick: () => onExport('md'),
    },
    {
      key: 'export-docx',
      icon: <ExportOutlined />,
      label: '导出 DOCX',
      onClick: () => onExport('docx'),
    },
    { type: 'divider' as const },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: '删除',
      danger: true,
      onClick: onDelete,
    },
  ]

  return (
    <Card
      className="novel-home-card"
      hoverable
      styles={{ body: { padding: 0 } }}
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
      onClick={onClick}
    >
      {/* 封面 */}
      <div className="novel-home-card__cover" style={{
        height: 156,
        background: gradient,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}>
        <span style={{ fontSize: 40, opacity: 0.3 }}>✦</span>
        <div style={{ position: 'absolute', top: 8, right: 8 }} onClick={e => e.stopPropagation()}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined style={{ color: 'white' }} />}
              style={{ background: 'rgba(0,0,0,0.3)' }}
            />
          </Dropdown>
        </div>
        <Tag
          style={{
            position: 'absolute', bottom: 8, left: 8,
            background: 'rgba(0,0,0,0.4)', border: 'none',
            color: 'white', fontSize: 11,
          }}
        >
          {novel.genreName || '未分类'}
        </Tag>
      </div>

      {/* 卡片内容 */}
      <div className="novel-home-card__body">
        <div className="novel-home-card__title">
          {novel.title}
        </div>

        <div className="novel-home-card__meta">
          <Tag
            style={{
              background: 'transparent',
              border: `1px solid ${status.color}`,
              color: status.color,
              fontSize: 11,
              padding: '0 6px',
            }}
          >
            {status.label}
          </Tag>
          <span className="novel-home-card__meta-copy">
            {formatWordCount(novel.totalWords)}
          </span>
          <span style={{ flex: 1 }} />
          <span className="novel-home-card__meta-copy">
            {dayjs(novel.updatedAt).fromNow()}
          </span>
        </div>

        <div className="novel-home-card__synopsis">
          {synopsis}
        </div>

        <div className="novel-home-card__progress">
          <Tooltip title={`${novel.totalWords.toLocaleString()} / ${novel.targetWords.toLocaleString()} 字`}>
            <Progress
              percent={progress}
              size="small"
              strokeColor="var(--color-blue-primary)"
              trailColor="rgba(255,255,255,0.08)"
              showInfo={false}
            />
          </Tooltip>
          <div className="novel-home-card__progress-meta">
            <span>目标 {formatWordCount(novel.targetWords)}</span>
            <strong>{progress}%</strong>
          </div>
        </div>
      </div>
    </Card>
  )
}
