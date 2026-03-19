import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Tabs,
  message,
} from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useNovelStore } from '../../../stores/novel.store'
import {
  normalizeWorldRules,
  parseWorldRulesJson,
  type GenreWorldRules,
} from '../../../shared/genre-system'
import {
  WORLD_RULE_SECTION_DEFINITIONS,
  type WorldRuleSectionKey,
  type WorldRulesGenerationProgressEvent,
} from '../../../shared/world-rules-generation'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'

interface Props {
  novelId: number
}

type RunningAction = 'all-generate' | 'section-generate' | 'section-expand' | null

const ENTITY_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'human', label: '人类' },
  { value: 'undead', label: '亡者' },
  { value: 'beast', label: '异兽' },
  { value: 'immortal', label: '长生种' },
  { value: 'nonhuman', label: '非人智慧体' },
]

const CALENDAR_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'gregorian', label: '公历' },
  { value: 'regnal', label: '年号 / 王朝纪年' },
  { value: 'relative-disaster', label: '灾变相对时间' },
  { value: 'custom-era', label: '自定义纪元' },
  { value: 'future-date', label: '未来日期' },
]

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 1.5)
}

function RuleListCard({
  title,
  extra,
  children,
}: {
  title: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="novel-subpanel">
      <div className="novel-subpanel__header">
        <div className="novel-subpanel__title">{title}</div>
        {extra ? <div>{extra}</div> : null}
      </div>
      <div className="novel-subpanel__body">{children}</div>
    </section>
  )
}

function normalizeFormRules(formValues: Record<string, unknown>, genreName?: string) {
  return normalizeWorldRules(formValues, genreName)
}

function getProgressType(progress: WorldRulesGenerationProgressEvent | null): 'info' | 'success' | 'error' {
  if (!progress) return 'info'
  if (progress.status === 'failed') return 'error'
  if (progress.status === 'success') return 'success'
  return 'info'
}

export default function WorldRules({ novelId }: Props) {
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [form] = Form.useForm<GenreWorldRules>()
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<WorldRuleSectionKey>('overview')
  const [runningAction, setRunningAction] = useState<RunningAction>(null)
  const [generationProgress, setGenerationProgress] = useState<WorldRulesGenerationProgressEvent | null>(null)

  const parsedRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const blankRules = useMemo(
    () => normalizeWorldRules({}, currentNovel?.genreName),
    [currentNovel?.genreName],
  )
  const watchedValues = Form.useWatch([], form) as GenreWorldRules | undefined
  const liveRules = useMemo(
    () => normalizeFormRules((watchedValues || parsedRules) as unknown as Record<string, unknown>, currentNovel?.genreName),
    [currentNovel?.genreName, parsedRules, watchedValues],
  )

  useEffect(() => {
    form.setFieldsValue(parsedRules)
  }, [form, parsedRules])

  useEffect(() => {
    const unsubscribe = window.electron.on('ai:world-rules-progress', (...args) => {
      const payload = args[0] as WorldRulesGenerationProgressEvent | undefined
      if (!payload || payload.novelId !== novelId) return
      setGenerationProgress(payload)
    })
    return unsubscribe
  }, [novelId])

  const tokenCount = useMemo(() => estimateTokens(JSON.stringify(liveRules)), [liveRules])
  const tokenStatusText = tokenCount > 1400
    ? '规则体量较大，建议优先按分区生成'
    : `~ ${tokenCount} token`
  const activeLanguageRules = [
    liveRules.writingConstraints.antiQuoteEmphasis,
    liveRules.writingConstraints.antiConceptSlogans,
    liveRules.writingConstraints.antiSymmetricLines,
  ].filter(Boolean).length
  const activeSectionMeta = useMemo(
    () => WORLD_RULE_SECTION_DEFINITIONS.find((item) => item.key === activeTab) || WORLD_RULE_SECTION_DEFINITIONS[0],
    [activeTab],
  )
  const generationPercent = generationProgress
    ? Math.max(0, Math.min(100, Math.round((generationProgress.completed / Math.max(generationProgress.total, 1)) * 100)))
    : 0
  const isGenerating = Boolean(runningAction)
  const calendarLabel = CALENDAR_OPTIONS.find((item) => item.value === liveRules.timelineConfig.calendarType)?.label
    || liveRules.timelineConfig.calendarType
    || '未设置'

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = normalizeFormRules(form.getFieldsValue(true) as unknown as Record<string, unknown>, currentNovel?.genreName)
      await window.electron.novel.update(novelId, { worldRulesJson: JSON.stringify(values) })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      message.success('世界规则已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const resetWorldRulesEditor = useCallback(() => {
    form.resetFields()
    form.setFieldsValue(blankRules)
    setActiveTab('overview')
    setRunningAction(null)
    setGenerationProgress(null)
    message.success('当前流程内容已清空，未保存前不会影响已保存规则')
  }, [blankRules, form])

  const handleClearCurrentFlow = useCallback(() => {
    if (isGenerating) return

    Modal.confirm({
      title: '清空当前流程内容？',
      content: '会清空当前页的世界规则编辑内容并回到世界概览，但不会直接覆盖已保存规则。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: resetWorldRulesEditor,
    })
  }, [isGenerating, resetWorldRulesEditor])

  const handleGenerateWorldRules = useCallback(async (mode: 'all' | 'section', action: 'generate' | 'expand') => {
    const nextAction: RunningAction = mode === 'all'
      ? 'all-generate'
      : action === 'expand'
        ? 'section-expand'
        : 'section-generate'

    setRunningAction(nextAction)
    setGenerationProgress(null)

    try {
      const result = await window.electron.ai.generateWorldRules({
        novelId,
        mode,
        action,
        section: mode === 'section' ? activeTab : undefined,
        currentRules: liveRules,
      })

      if (result.hasPartialResult) {
        form.setFieldsValue(result.rules)
      }

      const actionLabel = action === 'expand' ? '扩写' : '生成'
      const sectionLabel = mode === 'all'
        ? '世界规则分批生成'
        : `${activeSectionMeta.label}${actionLabel}`

      if (result.failedSteps > 0 && result.hasPartialResult) {
        message.warning(`${sectionLabel}已完成，但仍有部分分区失败，可以单独重试。`)
      } else if (result.failedSteps > 0) {
        message.error(`${sectionLabel}失败，请检查当前设定后重试。`)
      } else {
        message.success(
          mode === 'all'
            ? '世界规则分批生成完成，请确认后保存。'
            : `${activeSectionMeta.label}${actionLabel}完成。`,
        )
      }
    } catch (error) {
      message.error(`AI 生成失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    } finally {
      setRunningAction(null)
    }
  }, [activeSectionMeta.label, activeTab, form, liveRules, novelId])

  const tabItems = [
    {
      key: 'overview',
      label: '世界概览',
      children: (
        <>
          <Form.Item name={['genreProfile', 'name']} label="题材名称">
            <Input placeholder="例如：都市异能、修真仙侠" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'subgenre']} label="子类型 / 题材">
            <Input placeholder="例如：悬疑成长、宗门争霸" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'worldviewTone']} label="世界观基调">
            <Input.TextArea rows={4} placeholder="概括这个世界整体的气质、运行逻辑和主要矛盾。" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'socialFrame']} label="社会框架">
            <Input.TextArea rows={4} placeholder="写清权力结构、阶层秩序、组织关系和资源分配方式。" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'narrativeFocus']} label="叙事焦点">
            <Select mode="tags" placeholder="输入叙事重点后回车" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'languageAvoidances']} label="语言避让">
            <Select mode="tags" placeholder="输入需要避开的表达后回车" />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'power',
      label: '力量体系',
      children: (
        <Form.List name="powerSystems">
          {(fields, { add, remove }) => (
            <>
              <div style={{ marginBottom: 12 }}>
                <Button icon={<PlusOutlined />} onClick={() => add({ appliesTo: [], levels: [] })}>
                  {'添加体系'}
                </Button>
              </div>
              {fields.map((field, index) => (
                <RuleListCard
                  key={field.key}
                  title={`体系 ${index + 1}`}
                  extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                >
                  <Form.Item name={[field.name, 'name']} label="体系名称" rules={[{ required: true, message: '请输入体系名称' }]}>
                    <Input placeholder="例如：修为体系、军阶体系、异能评级" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'appliesTo']} label="适用对象">
                    <Select mode="tags" placeholder="输入适用对象后回车" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'levels']} label="等级阶段">
                    <Select mode="tags" placeholder="输入等级阶段后回车" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'advancementRule']} label="晋升规则">
                    <Input.TextArea rows={3} placeholder="写清如何升级、需要什么条件、由谁决定晋升。" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'limitations']} label="限制条件">
                    <Input.TextArea rows={2} placeholder="写清不能做什么、会被什么卡住。" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'cost']} label="代价">
                    <Input.TextArea rows={2} placeholder="写清获得力量或资源后要付出的代价。" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'taboo']} label="禁忌">
                    <Input.TextArea rows={2} placeholder="写清绝不能触碰的规则或后果。" />
                  </Form.Item>
                </RuleListCard>
              ))}
            </>
          )}
        </Form.List>
      ),
    },
    {
      key: 'species',
      label: '种族势力',
      children: (
        <>
          <Divider orientation="left">{'种族 / 实体'}</Divider>
          <Form.List name="speciesSystem">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ traits: [], commonIdentities: [] })}>
                    {'添加种族'}
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`种族 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'name']} label="种族名称" rules={[{ required: true, message: '请输入种族名称' }]}>
                        <Input placeholder="例如：人类、血裔、雾灵" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'entityType']} label="实体类型">
                        <Select options={ENTITY_TYPE_OPTIONS} />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'summary']} label="简述">
                      <Input.TextArea rows={2} placeholder="用两三句话概括这个种族的定位和存在感。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'traits']} label="特征">
                      <Select mode="tags" placeholder="输入种族特征后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'commonIdentities']} label="常见身份">
                      <Select mode="tags" placeholder="输入常见身份后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'relationToHumans']} label="与主流社会关系">
                      <Input.TextArea rows={2} placeholder="写清和主流秩序是合作、对立、依附还是隔绝。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'storyUse']} label="剧情用途">
                      <Input.TextArea rows={2} placeholder="写清这个种族通常承担什么剧情功能。" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>

          <Divider orientation="left">{'势力'}</Divider>
          <Form.List name="factionSystem">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ notableSites: [] })}>
                    {'添加势力'}
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`势力 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'name']} label="势力名称" rules={[{ required: true, message: '请输入势力名称' }]}>
                        <Input placeholder="例如：监察司、九曜宗、北境军团" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'factionType']} label="势力类型">
                        <Input placeholder="例如：宗门、官方机构、商会、军团" />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'summary']} label="简述">
                      <Input.TextArea rows={2} placeholder="概括这个势力的定位、立场和影响力。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'structure']} label="组织结构">
                      <Input.TextArea rows={2} placeholder="写清内部层级、决策方式和执行链条。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'resources']} label="核心资源">
                      <Input.TextArea rows={2} placeholder="写清这个势力掌握的关键资源、情报或人手。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'externalRelations']} label="对外关系">
                      <Input.TextArea rows={2} placeholder="写清它与其他势力、社会和主角线的关系。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'recruitFrom']} label="吸纳来源">
                      <Input.TextArea rows={2} placeholder="写清成员主要来自哪里、通过什么路径进入。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'notableSites']} label="重要据点">
                      <Select mode="tags" placeholder="输入重要据点后回车" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>
        </>
      ),
    },
    {
      key: 'ecology',
      label: '人物生态',
      children: (
        <>
          <Form.Item name={['characterEcology', 'overview']} label="生态概览">
            <Input.TextArea rows={3} placeholder="概括这个题材下的人物生态、功能分层和角色来源。" />
          </Form.Item>
          <Form.List name={['characterEcology', 'slots']}>
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ preferredFactions: [], powerBias: [] })}>
                    {'添加槽位'}
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`槽位 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'label']} label="槽位名称" rules={[{ required: true, message: '请输入槽位名称' }]}>
                        <Input placeholder="例如：主视角、压迫源、关系纽带" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'entityType']} label="实体类型">
                        <Select options={ENTITY_TYPE_OPTIONS} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'species']} label="对应种族">
                        <Input placeholder="例如：人类、异兽、长生种" />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'narrativeFunction']} label="叙事功能">
                      <Input.TextArea rows={2} placeholder="写清这个槽位在主线里承担什么作用。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'contextLink']} label="关联设定 / 冲突 / 场景">
                      <Input.TextArea rows={2} placeholder="写清它通常和哪些设定、冲突或场景绑定。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'preferredFactions']} label="偏向势力">
                      <Select mode="tags" placeholder="输入偏向势力后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'powerBias']} label="力量倾向">
                      <Select mode="tags" placeholder="输入力量倾向后回车" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>
        </>
      ),
    },
    {
      key: 'map',
      label: '地图蓝图',
      children: (
        <>
          <Form.Item name={['mapBlueprint', 'overview']} label="蓝图概览">
            <Input.TextArea rows={3} placeholder="概括地图层级、空间分布和主要冲突区域。" />
          </Form.Item>
          <Form.List name={['mapBlueprint', 'levels']}>
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ nodeTypes: [], examples: [], suggestedCount: 3 })}>
                    {'添加层级'}
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`层级 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 140px', gap: 12 }}>
                      <Form.Item name={[field.name, 'depth']} label="层级深度">
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'label']} label="层级名称" rules={[{ required: true, message: '请输入层级名称' }]}>
                        <Input placeholder="例如：国家、区域、据点、场景" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'suggestedCount']} label="建议数量">
                        <InputNumber min={1} max={12} style={{ width: '100%' }} />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'nodeTypes']} label="节点类型">
                      <Select mode="tags" placeholder="输入节点类型后回车" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'relationHint']} label="结构提示">
                      <Input.TextArea rows={2} placeholder="写清这一层主要负责什么结构作用。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'examples']} label="示例">
                      <Select mode="tags" placeholder="输入示例地点后回车" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>
        </>
      ),
    },
    {
      key: 'timeline',
      label: '时间规则',
      children: (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name={['timelineConfig', 'calendarType']} label="时间制度">
              <Select options={CALENDAR_OPTIONS} />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'eraName']} label="纪元名称">
              <Input placeholder="例如：公历、王朝纪年、修真历" />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'epochLabel']} label="纪元标签">
              <Input placeholder="例如：灾变后、王历、玄曜纪" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name={['timelineConfig', 'baseYearLabel']} label="起始年份">
              <Input placeholder="例如：元年、2026、王历元年" />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'relativeZeroLabel']} label="时间零点">
              <Input placeholder="例如：故事开始前、爆发当日、新王登基前" />
            </Form.Item>
          </div>
          <Form.Item name={['timelineConfig', 'displayPattern']} label="显示格式">
            <Input.TextArea rows={3} placeholder="例如：王历X年 / 雪月 / 战役周" />
          </Form.Item>
          <Form.Item name={['timelineConfig', 'precisionOptions']} label="时间精度">
            <Select mode="tags" placeholder="输入时间精度后回车" />
          </Form.Item>
          <Form.Item name={['timelineConfig', 'recommendedEventTypes']} label="推荐事件类型">
            <Select mode="tags" placeholder="输入事件类型后回车" />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'language',
      label: '文风约束',
      children: (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiQuoteEmphasis']} label="避免引号强调" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </Card>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiConceptSlogans']} label="避免概念口号" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </Card>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiSymmetricLines']} label="避免对称排比" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </Card>
          </div>
          <Form.Item name={['writingConstraints', 'narrationStyle']} label="叙述风格">
            <Input.TextArea rows={3} placeholder="写清叙述应偏冷静、克制、直接还是抒情。" />
          </Form.Item>
          <Form.Item name={['writingConstraints', 'dialogueStyle']} label="对话风格">
            <Input.TextArea rows={3} placeholder="写清人物说话的语气、节奏和用词边界。" />
          </Form.Item>
          <Form.Item name={['writingConstraints', 'forbiddenPhrases']} label="禁用 AI 腔">
            <Select mode="tags" placeholder="输入禁用表达后回车" />
          </Form.Item>
          <Form.Item name={['writingConstraints', 'extraRules']} label="额外规则">
            <Select mode="tags" placeholder="输入额外规则后回车" />
          </Form.Item>
        </>
      ),
    },
  ]

  return (
    <WorkspacePage
      eyebrow="世界规则"
      title="世界规则"
      description="基于基础背景、核心设定和题材，把世界运行逻辑拆成分区，再让 AI 按分区生成或扩写。"
      actions={(
        <Space wrap>
          <Button
            icon={<RobotOutlined />}
            loading={runningAction === 'all-generate'}
            disabled={saving || (isGenerating && runningAction !== 'all-generate')}
            onClick={() => void handleGenerateWorldRules('all', 'generate')}
          >
            {'AI 分批生成'}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            loading={runningAction === 'section-generate'}
            disabled={saving || (isGenerating && runningAction !== 'section-generate')}
            onClick={() => void handleGenerateWorldRules('section', 'generate')}
          >
            {'生成当前分区'}
          </Button>
          <Button
            icon={<PlusOutlined />}
            loading={runningAction === 'section-expand'}
            disabled={saving || (isGenerating && runningAction !== 'section-expand')}
            onClick={() => void handleGenerateWorldRules('section', 'expand')}
          >
            {'扩写当前分区'}
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={saving || isGenerating}
            onClick={handleClearCurrentFlow}
          >
            {'清空当前流程'}
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={isGenerating} onClick={handleSave}>
            {'保存规则'}
          </Button>
        </Space>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="力量体系" value={liveRules.powerSystems.length} tone="warm" hint="成长规则与限制条件" />
          <WorkspaceMetric label="种族实体" value={liveRules.speciesSystem.length} hint="可与人物系统联动的种族 / 实体" />
          <WorkspaceMetric label="组织势力" value={liveRules.factionSystem.length} tone="cool" hint="可与地图、人物、剧情挂接的势力" />
          <WorkspaceMetric label="地图层级" value={liveRules.mapBlueprint.levels.length} hint={tokenStatusText} />
        </>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: liveRules.genreProfile.name || currentNovel?.genreName || '未设置' },
            { label: '当前分区', value: activeSectionMeta.label },
            { label: '时间制度', value: calendarLabel },
            { label: '文风约束', value: `${activeLanguageRules} 项硬约束 / ${liveRules.writingConstraints.forbiddenPhrases.length} 条禁用语` },
          ]}
        />
      )}
      aside={(
        <WorkspacePanel title="使用建议" description="让 AI 更像共创助手，而不是一次性说明书。">
          <div className="novel-note-list">
            <div className="novel-note-list__item">{'先补齐基础背景和核心设定，再生成世界规则。'}</div>
            <div className="novel-note-list__item">{'建议优先生成世界概览、地图蓝图、时间规则。'}</div>
            <div className="novel-note-list__item">{'AI 结果只会先写入当前表单，不会自动保存。'}</div>
            <div className="novel-note-list__item">{'单个分区不满意时，可以单独重生成或继续扩写。'}</div>
          </div>
        </WorkspacePanel>
      )}
    >
      {generationProgress ? (
        <Alert
          type={getProgressType(generationProgress)}
          showIcon
          message={`${generationProgress.label} - ${generationProgress.status === 'failed' ? '失败' : generationProgress.status === 'success' ? '已完成' : '生成中'}`}
          description={(
            <div style={{ display: 'grid', gap: 12 }}>
              <Progress
                percent={generationPercent}
                size="small"
                status={generationProgress.status === 'failed' ? 'exception' : generationProgress.status === 'success' && generationProgress.completed >= generationProgress.total ? 'success' : 'active'}
              />
              <div>{generationProgress.detail || '正在处理当前分区...'}</div>
              {generationProgress.warning ? <div>{generationProgress.warning}</div> : null}
            </div>
          )}
          style={{ marginBottom: 18 }}
        />
      ) : tokenCount > 1400 ? (
        <Alert
          type="warning"
          message={`当前世界规则约 ${tokenCount} token，建议后续优先按分区生成。`}
          showIcon
          style={{ marginBottom: 18 }}
        />
      ) : (
        <div className="novel-pill" style={{ marginBottom: 18 }}>
          {tokenCount > 0 ? `当前规则体量约 ${tokenCount} token` : '当前规则体量尚未形成'}
        </div>
      )}

      <WorkspacePanel
        title="分区编辑器"
        description="按分区维护世界规则，方便和地图、人物、时间轴持续联动。"
        extra={<div className="novel-pill">{`当前分区：${activeSectionMeta.label}`}</div>}
      >
        <Form form={form} layout="vertical">
          <Tabs
            className="novel-editor-tabs"
            items={tabItems}
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as WorldRuleSectionKey)}
          />
        </Form>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
