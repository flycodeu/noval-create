import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Radio,
  Row,
  Select,
  Skeleton,
  Spin,
  Steps,
    Tag,
    message,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  CheckOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  LoadingOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage, isUserFacingMessage } from '@/utils/user-facing-message'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import type { Novel, NovelLaunchMode, Template } from '../../types'
import { useNovelStore } from '../../stores/novel.store'
import { buildThemeVoicePayload } from '../../shared/theme-voice'
import { WRITING_CONTRACT_PRESETS, getWritingContractValidationError, normalizeWritingContractTags } from '../../shared/writing-contract'
import { buildFastLaunchBootstrapPlan, NOVEL_LAUNCH_MODE_OPTIONS } from './fast-launch'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../Novel/components/WorkspaceShell'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface WizardFormValues {
  genreId: number
  launchMode: NovelLaunchMode
  styleTemplateId?: number
  worldTemplateId?: number
  modelConfigId?: number
  writingContractTags?: string[]
  userBackground: string
  expandedBackground: string
  synopsis: string
  title: string
  targetWords: number
  protagonistStart: string
  coreHook: string
  coreConflict: string
  tabooRules: string
  endgameDirection: string
}

interface ExpandBackgroundResult {
  expanded_background: string
  titles: string[]
  synopsis: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: '#5c6378' },
  writing: { label: '写作中', color: '#2E86AB' },
  completed: { label: '已完成', color: '#52c41a' },
  archived: { label: '已归档', color: '#3d4155' },
}

const GENRE_OPTIONS = [
  { value: 1, label: '现代都市', description: '都市生活、职场、生存压力与现代关系。' },
  { value: 2, label: '古代言情', description: '古典情感、宫廷关系与时代规训。' },
  { value: 3, label: '玄幻修真', description: '修炼体系、宗门势力与超凡成长。' },
  { value: 4, label: '悬疑推理', description: '谜案、线索追查与心理博弈。' },
  { value: 5, label: '科幻未来', description: '未来科技、社会变迁与宏观设定。' },
  { value: 6, label: '架空历史', description: '虚构历史路线下的家国与权力演化。' },
  { value: 7, label: '赛博朋克', description: '高科技、低生活与秩序失衡。' },
  { value: 8, label: '武侠', description: '江湖秩序、门派冲突与侠义选择。' },
  { value: 9, label: '历史正剧', description: '历史叙事、人物命运与时代结构。' },
  { value: 10, label: '末世求生', description: '灾变后的生存、重建与资源竞争。' },
  { value: 11, label: '丧尸末日', description: '感染蔓延、逃亡协作与社会崩塌。' },
  { value: 12, label: '盗墓探秘', description: '古墓机关、线索破解与冒险探索。' },
] as const

const GENRE_GRADIENTS: Record<string, string> = {
  现代都市: 'linear-gradient(135deg, #2E86AB, #1E3A5F)',
  古代言情: 'linear-gradient(135deg, #E84393, #8B1A5C)',
  玄幻修真: 'linear-gradient(135deg, #9B59B6, #4A235A)',
  悬疑推理: 'linear-gradient(135deg, #2C3E50, #1A252F)',
  科幻未来: 'linear-gradient(135deg, #1ABC9C, #0E6655)',
  架空历史: 'linear-gradient(135deg, #D35400, #784212)',
  赛博朋克: 'linear-gradient(135deg, #8E44AD, #1A5276)',
  武侠: 'linear-gradient(135deg, #C0392B, #641E16)',
  历史正剧: 'linear-gradient(135deg, #7D6608, #4D4004)',
  末世求生: 'linear-gradient(135deg, #5D4037, #3E2723)',
  丧尸末日: 'linear-gradient(135deg, #37474F, #263238)',
  盗墓探秘: 'linear-gradient(135deg, #4E342E, #1B0000)',
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

function normalizeTargetWords(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function getWizardStepItems(launchMode: NovelLaunchMode) {
  if (launchMode === 'fast_launch') {
    return [
      { title: '路径与题材' },
      { title: '极速开书字段' },
    ]
  }

  return [
    { title: '题材与模板' },
    { title: '原始背景' },
    { title: 'AI 补全背景' },
    { title: '最终确认' },
  ]
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
  const [modelConfigs, setModelConfigs] = useState<Array<{ id: number; name: string }>>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [wizardLoading, setWizardLoading] = useState(false)
  const [wizardForm] = Form.useForm<WizardFormValues>()
  const [expandedData, setExpandedData] = useState<ExpandBackgroundResult | null>(null)
  const [selectedGenreId, setSelectedGenreId] = useState<number | null>(null)
  const selectedLaunchMode = Form.useWatch('launchMode', wizardForm) || 'professional_longform'

  const resetWizard = useCallback(() => {
    setWizardOpen(false)
    setWizardStep(0)
    setWizardLoading(false)
    setExpandedData(null)
    setSelectedGenreId(null)
    wizardForm.resetFields()
    wizardForm.setFieldsValue({ launchMode: 'professional_longform', targetWords: 200000 })
  }, [wizardForm])

  const loadNovels = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electron.novel.list()
      setNovels(list)
    } catch (error) {
      message.error(getErrorMessage(error, 'novel.listLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [setNovels])

  useEffect(() => {
    void loadNovels()
    void window.electron.template.list('style').then(setStyleTemplates)
    void window.electron.template.list('world').then(setWorldTemplates)
    void window.electron.model.list().then(setModelConfigs)
    wizardForm.setFieldsValue({ launchMode: 'professional_longform', targetWords: 200000 })
  }, [loadNovels, wizardForm])

  const filteredNovels = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return [...novels]
      .filter((novel) => {
        if (statusFilter !== 'all' && novel.status !== statusFilter) return false
        if (!keyword) return true
        return [novel.title, novel.synopsis, novel.genreName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      })
      .sort((left, right) => {
        if (sortBy === 'updatedAt') return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        if (sortBy === 'totalWords') return right.totalWords - left.totalWords
        if (sortBy === 'title') return left.title.localeCompare(right.title, 'zh')
        return 0
      })
  }, [novels, search, sortBy, statusFilter])

  const handleDelete = async (id: number, title: string) => {
    Modal.confirm({
      title: `确认删除《${title}》？`,
      content: '删除后章节、人物、地图、线程和结构数据都会一并删除，无法恢复。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await window.electron.novel.delete(id)
        await loadNovels()
        message.success(getUserFacingMessage('novel.deleted'))
      },
    })
  }

  const handleExport = async (id: number, format: string) => {
    try {
      const filePath = await window.electron.novel.export(id, format)
      message.success(getUserFacingMessage('novel.exportedTo', { path: filePath }))
    } catch (error) {
      if (!isUserFacingMessage(error, 'common.userCancelled')) {
        message.error(getErrorMessage(error, 'novel.exportFailed'))
      }
    }
  }

  const handleFastLaunchCreate = useCallback(async () => {
    const values = await wizardForm.validateFields([
      'genreId',
      'protagonistStart',
      'coreHook',
      'coreConflict',
      'tabooRules',
      'endgameDirection',
    ])
    const allValues = wizardForm.getFieldsValue(true) as Partial<WizardFormValues>
    const writingContractTags = normalizeWritingContractTags(allValues.writingContractTags)
    const writingContractError = getWritingContractValidationError(writingContractTags)
    if (writingContractError) {
      message.error(writingContractError)
      return
    }

    const genreLabel = GENRE_OPTIONS.find((option) => option.value === values.genreId)?.label || '未分类'
    const targetWords = allValues.targetWords || 200000
    const plan = buildFastLaunchBootstrapPlan({
      genreLabel,
      protagonistStart: values.protagonistStart.trim(),
      coreHook: values.coreHook.trim(),
      coreConflict: values.coreConflict.trim(),
      tabooRules: values.tabooRules.trim(),
      endgameDirection: values.endgameDirection.trim(),
      targetWords,
      writingContractTags,
    })

    setWizardLoading(true)
    try {
      const novelId = await window.electron.novel.create({
        title: plan.novel.title,
        synopsis: plan.novel.synopsis,
        genreId: values.genreId,
        launchMode: 'fast_launch',
        userBackground: plan.novel.userBackground,
        expandedBackground: plan.novel.expandedBackground,
        projectBriefJson: plan.novel.projectBriefJson,
        styleTemplateId: allValues.styleTemplateId,
        worldTemplateId: allValues.worldTemplateId,
        modelConfigId: allValues.modelConfigId,
        targetWords: plan.novel.targetWords,
      })

      await window.electron.novel.update(novelId, {
        title: plan.novel.title,
        synopsis: plan.novel.synopsis,
        userBackground: plan.novel.userBackground,
        expandedBackground: plan.novel.expandedBackground,
        projectBriefJson: plan.novel.projectBriefJson,
        settingsJson: plan.novel.settingsJson,
        themeVoiceJson: plan.novel.themeVoiceJson,
        targetWords: plan.novel.targetWords,
      })

      const volumeId = await window.electron.structure.createVolume(novelId, plan.volume)
      const arcId = await window.electron.outline.createArc(novelId, plan.outlineArc)

      await Promise.all([
        window.electron.character.create(novelId, plan.protagonist),
        window.electron.character.create(novelId, plan.antagonist),
        window.electron.thread.create(novelId, {
          threadType: 'main',
          title: plan.thread.title,
          summary: plan.thread.summary,
          premise: plan.thread.premise,
          status: 'planned',
          priority: 'high',
          currentState: '前三章内必须完成主线起势。',
        }),
      ])

      for (const chapter of plan.chapters) {
        await window.electron.chapter.create(novelId, {
          ...chapter,
          status: 'outline',
          volumeId,
          arcId,
        })
      }

      for (const event of plan.timelineEvents) {
        await window.electron.timeline.create(novelId, {
          ...event,
          timeMode: 'relative-disaster',
          volumeId,
          isMajorEvent: 1,
          protagonistPresent: 1,
        })
      }

      await loadNovels()
      resetWizard()
      navigate(`/novels/${novelId}/overview`)
        message.success(getUserFacingMessage('novel.fastLaunchCreated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'novel.createFailed'))
    } finally {
      setWizardLoading(false)
    }
  }, [loadNovels, navigate, resetWizard, wizardForm])

  const handleWizardNext = async () => {
    if (selectedLaunchMode === 'fast_launch') {
      if (wizardStep === 0) {
        await wizardForm.validateFields(['genreId', 'writingContractTags'])
        setWizardStep(1)
        return
      }

      await handleFastLaunchCreate()
      return
    }

    if (wizardStep === 0) {
      await wizardForm.validateFields(['genreId', 'writingContractTags'])
      setWizardStep(1)
      return
    }

    if (wizardStep === 1) {
      const values = await wizardForm.validateFields(['userBackground'])
      setWizardLoading(true)
      try {
        const allValues = wizardForm.getFieldsValue(true) as Partial<WizardFormValues>
        const data = await window.electron.ai.expandBackground({
          userBackground: values.userBackground,
          genreId: allValues.genreId,
          worldTemplateId: allValues.worldTemplateId,
          modelConfigId: allValues.modelConfigId,
        }) as ExpandBackgroundResult

        setExpandedData(data)
        wizardForm.setFieldsValue({
          expandedBackground: data.expanded_background,
          synopsis: data.synopsis,
          title: data.titles[0] || '',
        })
        setWizardStep(2)
      } catch (error) {
        console.error(error)
        message.error(getErrorMessage(error, 'novel.expandFailed'))
      } finally {
        setWizardLoading(false)
      }
      return
    }

    if (wizardStep === 2) {
      setWizardStep(3)
      return
    }

    const values = await wizardForm.validateFields(['title', 'synopsis', 'targetWords'])
    const allValues = wizardForm.getFieldsValue(true) as Partial<WizardFormValues>
    const writingContractTags = normalizeWritingContractTags(allValues.writingContractTags)
    const writingContractError = getWritingContractValidationError(writingContractTags)
    if (writingContractError) {
      message.error(writingContractError)
      return
    }
    try {
      const novelId = await window.electron.novel.create({
        title: values.title.trim(),
        synopsis: values.synopsis.trim(),
        genreId: allValues.genreId,
        launchMode: 'professional_longform',
        userBackground: allValues.userBackground?.trim(),
        expandedBackground: allValues.expandedBackground?.trim(),
        styleTemplateId: allValues.styleTemplateId,
        worldTemplateId: allValues.worldTemplateId,
        modelConfigId: allValues.modelConfigId,
        targetWords: values.targetWords,
      })
      if (writingContractTags.length > 0) {
        await window.electron.novel.update(novelId, {
          themeVoiceJson: buildThemeVoicePayload({ writingContractTags }),
        })
      }
      await loadNovels()
      resetWizard()
      navigate(`/novels/${novelId}/overview`)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'novel.createFailed'))
    }
  }

  const wizardSteps = useMemo(
    () => getWizardStepItems(selectedLaunchMode),
    [selectedLaunchMode],
  )
  const totalWordCount = useMemo(
    () => novels.reduce((sum, novel) => sum + normalizeTargetWords(novel.totalWords), 0),
    [novels],
  )
  const writingCount = useMemo(
    () => novels.filter((novel) => novel.status === 'writing').length,
    [novels],
  )
  const completedCount = useMemo(
    () => novels.filter((novel) => novel.status === 'completed').length,
    [novels],
  )

  return (
    <>
      <WorkspacePage
        className="admin-page novel-library-page"
        layout="wide"
        heroVariant="compact"
        eyebrow="项目入口"
        title="我的小说"
        description="集中查看项目状态、字数进度与最近修改时间，从同一入口继续创作、导出或快速开书。"
        actions={(
          <div className="admin-toolbar">
            <Input
              className="admin-toolbar__grow"
              prefix={<SearchOutlined />}
              placeholder="搜索小说、简介或题材"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 280, maxWidth: '100%' }}
              allowClear
            />
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              style={{ width: 150 }}
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
              style={{ width: 160 }}
              options={[
                { value: 'updatedAt', label: '最近修改' },
                { value: 'totalWords', label: '按字数排序' },
                { value: 'title', label: '按标题排序' },
              ]}
            />
            <div className="admin-toolbar__actions">
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>
                新建小说
              </Button>
            </div>
          </div>
        )}
        metrics={(
          <>
            <WorkspaceMetric label="项目总数" value={novels.length} tone="cool" />
            <WorkspaceMetric label="写作中" value={writingCount} />
            <WorkspaceMetric label="已完结" value={completedCount} tone="warm" />
            <WorkspaceMetric label="总字数" value={formatWordCount(totalWordCount)} />
          </>
        )}
      >
        <WorkspacePanel
          title="项目列表"
          description="支持按状态、关键字和排序方式快速筛选。卡片内可直接继续创作、导出或删除项目。"
        >
          {loading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : filteredNovels.length === 0 ? (
            <Empty
              description={search ? '没有找到匹配的小说。' : '还没有小说，点击“新建小说”开始创作。'}
              style={{ paddingTop: 80 }}
            />
          ) : (
            <div className="admin-card-grid">
              {filteredNovels.map((novel) => (
                <NovelCard
                  key={novel.id}
                  novel={novel}
                  onClick={() => navigate(`/novels/${novel.id}/overview`)}
                  onDelete={() => void handleDelete(novel.id, novel.title)}
                  onExport={(format) => void handleExport(novel.id, format)}
                />
              ))}
            </div>
          )}
        </WorkspacePanel>
      </WorkspacePage>

      <Modal
        title="新建小说"
        open={wizardOpen}
        onCancel={resetWizard}
        footer={null}
        width={820}
        destroyOnHidden
      >
        <Steps
          current={wizardStep}
          items={wizardSteps}
          style={{ marginBottom: 32 }}
        />

        <Form form={wizardForm} layout="vertical">
          {wizardStep === 0 && (
            <>
              <Form.Item
                name="launchMode"
                label="开书路径"
                rules={[{ required: true, message: '请选择开书路径' }]}
              >
                <Row gutter={[12, 12]}>
                  {NOVEL_LAUNCH_MODE_OPTIONS.map((option) => {
                    const active = selectedLaunchMode === option.value
                    return (
                      <Col span={12} key={option.value}>
                        <div
                          onClick={() => wizardForm.setFieldValue('launchMode', option.value)}
                          style={{
                            padding: '14px 16px',
                            borderRadius: 14,
                            cursor: 'pointer',
                            border: active ? '1px solid #2E86AB' : '1px solid rgba(255,255,255,0.08)',
                            background: active
                              ? 'linear-gradient(135deg, rgba(46,134,171,0.18), rgba(30,58,95,0.22))'
                              : 'rgba(255,255,255,0.03)',
                            minHeight: 110,
                            display: 'grid',
                            gap: 10,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                            <strong style={{ color: 'var(--color-text)' }}>{option.label}</strong>
                            <Tag color={active ? 'processing' : 'default'}>{option.badge}</Tag>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                            {option.description}
                          </div>
                        </div>
                      </Col>
                    )
                  })}
                </Row>
              </Form.Item>

              <Form.Item
                name="genreId"
                label="选择题材"
                rules={[{ required: true, message: '请选择题材' }]}
              >
                <div>
                  <Row gutter={[10, 10]}>
                    {GENRE_OPTIONS.map((genre) => {
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
                              borderRadius: 10,
                              padding: '12px 14px',
                              cursor: 'pointer',
                              border: isSelected ? '2px solid #2E86AB' : '2px solid transparent',
                              position: 'relative',
                              minHeight: 90,
                            }}
                          >
                            {isSelected ? (
                              <CheckOutlined style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                color: '#fff',
                                fontSize: 14,
                              }} />
                            ) : null}
                            <div style={{ fontWeight: 600, color: '#fff', marginBottom: 6 }}>{genre.label}</div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5 }}>
                              {genre.description}
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
                      options={styleTemplates.map((template) => ({ value: template.id, label: template.name }))}
                      placeholder="可选"
                      allowClear
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="worldTemplateId" label="世界模板">
                    <Select
                      options={worldTemplates.map((template) => ({ value: template.id, label: template.name }))}
                      placeholder="可选"
                      allowClear
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="modelConfigId" label="使用模型">
                    <Select
                      options={modelConfigs.map((model) => ({ value: model.id, label: model.name }))}
                      placeholder="默认模型"
                      allowClear
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="writingContractTags"
                label="写作类型"
                extra={selectedLaunchMode === 'fast_launch'
                  ? '极速开书会把这些标签直接压进文风护栏与前三章骨架。'
                  : '“爽文 / 写实”只能选一个；其余标签可叠加，自定义标签只作为弱提示。'}
                rules={[{
                  validator: async (_, value?: string[]) => {
                    const error = getWritingContractValidationError(normalizeWritingContractTags(value))
                    if (error) throw new Error(error)
                  },
                }]}
              >
                <Select
                  mode="tags"
                  allowClear
                  options={WRITING_CONTRACT_PRESETS.map((preset) => ({
                    value: preset.value,
                    label: preset.label,
                  }))}
                  placeholder="例如：爽文、言情，或补充自定义短标签"
                  tokenSeparators={[',', '，', '、']}
                />
              </Form.Item>
            </>
          )}

          {selectedLaunchMode === 'professional_longform' && wizardStep === 1 && (
            <Form.Item
              name="userBackground"
              label="故事背景"
              rules={[
                { required: true, message: '请输入故事背景' },
                { min: 20, message: '至少写 20 个字' },
              ]}
              extra="用你自己的话描述故事处境、冲突、氛围或关键设定，写得越具体，AI 补全背景越稳。"
            >
              <Input.TextArea
                rows={7}
                placeholder="例如：一座沿海城市的冷案记者，意外卷入二十年前的沉船旧案，发现幸存者名单里藏着她父亲失踪的线索。"
                showCount
              />
            </Form.Item>
          )}

          {selectedLaunchMode === 'fast_launch' && wizardStep === 1 && (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item
                    name="protagonistStart"
                    label="主角起点"
                    rules={[{ required: true, message: '请填写主角起点' }]}
                    extra="写主角现在处于什么处境、身份或困局。"
                  >
                    <Input.TextArea rows={4} placeholder="例如：被逐出主城的维修员，只能靠黑市零工维生。" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="coreHook"
                    label="核心钩子"
                    rules={[{ required: true, message: '请填写核心钩子' }]}
                    extra="开篇立刻抓住读者的异常事件、秘密或倒计时。"
                  >
                    <Input.TextArea rows={4} placeholder="例如：他修复的一枚芯片里，藏着主城即将熄火的真相。" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item
                    name="coreConflict"
                    label="核心冲突"
                    rules={[{ required: true, message: '请填写核心冲突' }]}
                    extra="写主角必须面对的主线阻力，而不是泛泛主题。"
                  >
                    <Input.TextArea rows={4} placeholder="例如：想救城就必须和曾经出卖他的旧同伴合作。 " />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="tabooRules"
                    label="禁区"
                    rules={[{ required: true, message: '请填写禁区' }]}
                    extra="用于自动生成文风护栏和剧情边界。"
                  >
                    <Input.TextArea rows={4} placeholder="例如：禁止全知旁白解释；禁止一章解决主线；禁止爽点无代价。" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                name="endgameDirection"
                label="终局方向"
                rules={[{ required: true, message: '请填写终局方向' }]}
                extra="先给一个方向，不要求现在就写完整终局。"
              >
                <Input.TextArea rows={4} placeholder="例如：主角救下主城，但必须放弃原本想夺回的身份和归属。" />
              </Form.Item>

              <div
                style={{
                  marginTop: 8,
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.7,
                  fontSize: 13,
                }}
              >
                系统会自动补出：基础立项、文风护栏、第一卷目标、前三章骨架、主角/反派简版卡，以及可直接进入写作的最小结构。
              </div>
            </>
          )}

          {selectedLaunchMode === 'professional_longform' && wizardStep === 2 && (
            <div style={{ display: 'flex', gap: 20 }}>
              <div style={{ flex: 1 }}>
                <Form.Item name="expandedBackground" label="AI 补全背景（可编辑）">
                  <Input.TextArea rows={10} />
                </Form.Item>
              </div>
              <div style={{ width: 280 }}>
                <div style={{ marginBottom: 8, color: 'var(--color-text-secondary)', fontSize: 12 }}>标题建议</div>
                <Form.Item name="title">
                  <Radio.Group style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {expandedData?.titles.map((title) => (
                      <Radio key={title} value={title} style={{ whiteSpace: 'normal', lineHeight: 1.5 }}>
                        {title}
                      </Radio>
                    ))}
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="synopsis" label="AI 生成·简介（可编辑）">
                  <Input.TextArea rows={5} />
                </Form.Item>
                <Button
                  icon={<ReloadOutlined />}
                  loading={wizardLoading}
                  onClick={() => {
                    setWizardStep(1)
                    setExpandedData(null)
                  }}
                >
                  重新生成
                </Button>
              </div>
            </div>
          )}

          {selectedLaunchMode === 'professional_longform' && wizardStep === 3 && (
            <>
              <Form.Item name="title" label="最终标题" rules={[{ required: true, message: '请填写标题' }]}>
                <Input placeholder="小说标题" />
              </Form.Item>
              <Form.Item name="synopsis" label="最终简介" rules={[{ required: true, message: '请填写简介' }]}>
                <Input.TextArea rows={5} />
              </Form.Item>
              <Form.Item name="targetWords" label="目标字数" initialValue={200000}>
                <Select options={TARGET_WORDS_OPTIONS} />
              </Form.Item>
            </>
          )}
        </Form>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
          {wizardStep > 0 ? (
            <Button onClick={() => setWizardStep((step) => step - 1)}>上一步</Button>
          ) : null}
          <Button
            type="primary"
            onClick={() => void handleWizardNext()}
            loading={wizardLoading}
            icon={wizardLoading ? <LoadingOutlined /> : undefined}
          >
            {selectedLaunchMode === 'fast_launch'
              ? (wizardStep === wizardSteps.length - 1 ? '创建并生成骨架' : '下一步')
              : (wizardStep === 3 ? '创建小说' : wizardStep === 1 ? 'AI 补全背景' : '下一步')}
          </Button>
        </div>
      </Modal>
    </>
  )
}

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
  const targetWords = normalizeTargetWords(novel.targetWords)
  const progress = targetWords > 0
    ? Math.min(100, Math.round((novel.totalWords / targetWords) * 100))
    : 0
  const gradient = GENRE_GRADIENTS[novel.genreName || ''] || 'linear-gradient(135deg, #1a1d27, #252840)'
  const synopsis = novel.synopsis?.trim()
    || novel.expandedBackground?.trim()
    || novel.userBackground?.trim()
    || '还没有补充简介，进入工作台后可以继续完善背景、设定和结构。'

  const menuItems: MenuProps['items'] = [
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: '继续创作',
      onClick,
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
    {
      key: 'export-epub',
      icon: <ExportOutlined />,
      label: '导出 EPUB',
      onClick: () => onExport('epub'),
    },
    { type: 'divider' },
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
      <div
        className="novel-home-card__cover"
        style={{
          height: 156,
          background: gradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <span style={{ fontSize: 40, opacity: 0.3 }}>✦</span>
        <div style={{ position: 'absolute', top: 8, right: 8 }} onClick={(event) => event.stopPropagation()}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button
              type="text"
              size="small"
              icon={<MoreOutlined style={{ color: 'white' }} />}
              style={{ background: 'rgba(0, 0, 0, 0.3)' }}
            />
          </Dropdown>
        </div>
        <Tag
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            background: 'rgba(0, 0, 0, 0.4)',
            border: 'none',
            color: 'white',
            fontSize: 11,
          }}
        >
          {novel.genreName || '未分类'}
        </Tag>
      </div>

      <div className="novel-home-card__body">
        <div className="novel-home-card__title">{novel.title}</div>

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
          <span className="novel-home-card__meta-copy">{formatWordCount(novel.totalWords)}</span>
          <span style={{ flex: 1 }} />
          <span className="novel-home-card__meta-copy">{dayjs(novel.updatedAt).fromNow()}</span>
        </div>

        <div className="novel-home-card__synopsis">{synopsis}</div>

          <div className="novel-home-card__progress">
            <Progress
              percent={progress}
              size="small"
              strokeColor="var(--color-blue-primary)"
              trailColor="rgba(255,255,255,0.08)"
              showInfo={false}
            />
            <div className="novel-home-card__progress-meta">
              <span>目标 {formatWordCount(targetWords)}</span>
              <strong>{progress}%</strong>
          </div>
        </div>
      </div>
    </Card>
  )
}
