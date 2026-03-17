import React, { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tabs,
  message,
} from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { useNovelStore } from '../../../stores/novel.store'
import { normalizeWorldRules, parseWorldRulesJson, type GenreWorldRules } from '../../../shared/genre-system'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceTip,
} from '../components/WorkspaceShell'

interface Props { novelId: number }

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

export default function WorldRules({ novelId }: Props) {
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [form] = Form.useForm<GenreWorldRules>()
  const [saving, setSaving] = useState(false)
  const [tokenCount, setTokenCount] = useState(0)

  const parsedRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )

  useEffect(() => {
    form.setFieldsValue(parsedRules)
    setTokenCount(estimateTokens(JSON.stringify(parsedRules)))
  }, [form, parsedRules])

  const updateTokenCount = (values: Record<string, unknown>) => {
    const normalized = normalizeFormRules(values, currentNovel?.genreName)
    setTokenCount(estimateTokens(JSON.stringify(normalized)))
  }

  const tokenStatusText = tokenCount > 1400 ? '规则较重，建议继续压缩' : `预计占用 ${tokenCount} token`
  const activeLanguageRules = [
    parsedRules.writingConstraints.antiQuoteEmphasis,
    parsedRules.writingConstraints.antiConceptSlogans,
    parsedRules.writingConstraints.antiSymmetricLines,
  ].filter(Boolean).length

  const handleSave = async () => {
    setSaving(true)
    try {
      const values = normalizeFormRules(form.getFieldsValue(true), currentNovel?.genreName)
      await window.electron.novel.update(novelId, { worldRulesJson: JSON.stringify(values) })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      updateTokenCount(values as unknown as Record<string, unknown>)
      message.success('世界规则已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const tabItems = [
    {
      key: 'overview',
      label: '题材概览',
      children: (
        <>
          <Form.Item name={['genreProfile', 'name']} label="题材名称">
            <Input placeholder="例如：丧尸末日、仙侠修真、玄幻升级" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'subgenre']} label="子题材/定位">
            <Input placeholder="例如：病毒爆发 / 宗门成长 / 帝国争霸" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'worldviewTone']} label="世界底色">
            <Input.TextArea rows={4} placeholder="用 2-4 句写清这个题材世界真正怎么运转。" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'socialFrame']} label="社会结构">
            <Input.TextArea rows={4} placeholder="写国家、势力、阶层、资源秩序如何影响人物选择。" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'narrativeFocus']} label="叙事焦点">
            <Select mode="tags" placeholder="输入后回车添加，例如：感染规则、宗门秩序、家族斗争" />
          </Form.Item>
          <Form.Item name={['genreProfile', 'languageAvoidances']} label="题材禁忌表达">
            <Select mode="tags" placeholder="输入后回车添加，例如：概念口号、现代网络词、引号着重" />
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
                  新增体系
                </Button>
              </div>
              {fields.map((field, index) => (
                <RuleListCard
                  key={field.key}
                  title={`体系 ${index + 1}`}
                  extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                >
                  <Form.Item name={[field.name, 'name']} label="体系名称" rules={[{ required: true, message: '请填写体系名称' }]}>
                    <Input placeholder="例如：感染等级、修炼境界、异能评级" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'appliesTo']} label="适用对象">
                    <Select mode="tags" placeholder="例如：人类、灵兽、感染者、宗门成员" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'levels']} label="等级划分">
                    <Select mode="tags" placeholder="输入后回车添加，如：炼气、筑基、金丹" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'advancementRule']} label="晋升规则">
                    <Input.TextArea rows={3} placeholder="写清升级依赖什么，不要只写会升级。" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'limitations']} label="限制条件">
                    <Input.TextArea rows={2} placeholder="例如：资源不足、血脉门槛、心魔、暴露风险" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'cost']} label="代价">
                    <Input.TextArea rows={2} placeholder="例如：失控、反噬、社会代价、关系代价" />
                  </Form.Item>
                  <Form.Item name={[field.name, 'taboo']} label="禁区">
                    <Input.TextArea rows={2} placeholder="例如：不能无代价越阶、不能跳过组织规则" />
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
      label: '种族与势力',
      children: (
        <>
          <Divider orientation="left">种族/存在类型</Divider>
          <Form.List name="speciesSystem">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ traits: [], commonIdentities: [] })}>
                    新增种族
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`种族 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'name']} label="种族名称" rules={[{ required: true, message: '请填写种族名称' }]}>
                        <Input placeholder="例如：人类、感染者、灵兽、仙界来者" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'entityType']} label="实体类型">
                        <Select
                          options={[
                            { value: 'human', label: 'human' },
                            { value: 'undead', label: 'undead' },
                            { value: 'beast', label: 'beast' },
                            { value: 'immortal', label: 'immortal' },
                            { value: 'nonhuman', label: 'nonhuman' },
                          ]}
                        />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'summary']} label="定位摘要">
                      <Input.TextArea rows={2} placeholder="这个种族在世界里的位置和作用。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'traits']} label="典型特征">
                      <Select mode="tags" placeholder="例如：攻击性高、寿命长、血脉压制" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'commonIdentities']} label="常见身份">
                      <Select mode="tags" placeholder="例如：宗门弟子、基地居民、秘境守卫" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'relationToHumans']} label="与人类关系">
                      <Input.TextArea rows={2} placeholder="写清合作、敌对、依附、猎食等关系。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'storyUse']} label="剧情功能">
                      <Input.TextArea rows={2} placeholder="写清这种角色通常承担什么戏剧作用。" />
                    </Form.Item>
                  </RuleListCard>
                ))}
              </>
            )}
          </Form.List>

          <Divider orientation="left">势力结构</Divider>
          <Form.List name="factionSystem">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ notableSites: [] })}>
                    新增势力
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`势力 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'name']} label="势力名称" rules={[{ required: true, message: '请填写势力名称' }]}>
                        <Input placeholder="例如：幸存者基地、太玄宗、帝国、教会" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'factionType']} label="势力类型">
                        <Input placeholder="例如：宗门、国家、基地、学院、机构、家族" />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'summary']} label="定位摘要">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'structure']} label="组织结构">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'resources']} label="掌控资源">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'externalRelations']} label="对外关系">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'recruitFrom']} label="成员来源">
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'notableSites']} label="标志地点">
                      <Select mode="tags" placeholder="例如：山门、仓储区、帝都、实验楼" />
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
      label: '角色生态',
      children: (
        <>
          <Form.Item name={['characterEcology', 'overview']} label="生态总述">
            <Input.TextArea rows={3} placeholder="写清这个题材需要哪些角色槽位，为什么需要。" />
          </Form.Item>
          <Form.List name={['characterEcology', 'slots']}>
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ preferredFactions: [], powerBias: [] })}>
                    新增角色槽位
                  </Button>
                </div>
                {fields.map((field, index) => (
                  <RuleListCard
                    key={field.key}
                    title={`角色槽位 ${index + 1}`}
                    extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                      <Form.Item name={[field.name, 'label']} label="槽位名称" rules={[{ required: true, message: '请填写槽位名称' }]}>
                        <Input placeholder="例如：生存主角、宗门上位者、高阶感染体" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'entityType']} label="实体类型">
                        <Select
                          options={[
                            { value: 'human', label: 'human' },
                            { value: 'undead', label: 'undead' },
                            { value: 'beast', label: 'beast' },
                            { value: 'immortal', label: 'immortal' },
                            { value: 'nonhuman', label: 'nonhuman' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name={[field.name, 'species']} label="默认种族">
                        <Input placeholder="例如：幸存者、灵兽、人族修士" />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'narrativeFunction']} label="剧情功能">
                      <Input.TextArea rows={2} placeholder="这个槽位在故事里负责什么。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'contextLink']} label="与主题/背景/主线的关联">
                      <Input.TextArea rows={2} placeholder="写清它为什么必须存在，而不是可有可无。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'preferredFactions']} label="优先势力">
                      <Select mode="tags" placeholder="例如：宗门、基地、学院" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'powerBias']} label="优先力量体系">
                      <Select mode="tags" placeholder="例如：修炼境界、感染等级" />
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
          <Form.Item name={['mapBlueprint', 'overview']} label="地图总述">
            <Input.TextArea rows={3} placeholder="写清这个题材地图是按什么层级拆的，以及为什么这样拆。" />
          </Form.Item>
          <Form.List name={['mapBlueprint', 'levels']}>
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Button icon={<PlusOutlined />} onClick={() => add({ nodeTypes: [], examples: [], suggestedCount: 3 })}>
                    新增地图层级
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
                      <Form.Item name={[field.name, 'label']} label="层级名称" rules={[{ required: true, message: '请填写层级名称' }]}>
                        <Input placeholder="例如：国家/大区、宗门势力、秘境/设施" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'suggestedCount']} label="建议数量">
                        <InputNumber min={1} max={12} style={{ width: '100%' }} />
                      </Form.Item>
                    </div>
                    <Form.Item name={[field.name, 'nodeTypes']} label="允许节点类型">
                      <Select mode="tags" placeholder="例如：基地、城市、宗门、秘境、仓库、洞府" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'relationHint']} label="层级职责">
                      <Input.TextArea rows={2} placeholder="写清这一层主要承载什么剧情和结构职责。" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'examples']} label="示例节点">
                      <Select mode="tags" placeholder="例如：临港基地、太玄宗、九焰秘境" />
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
      label: '时间轴规则',
      children: (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Form.Item name={['timelineConfig', 'calendarType']} label="时间制类型">
              <Select
                options={[
                  { value: 'gregorian', label: '公历时间' },
                  { value: 'regnal', label: '年号 / 王朝纪年' },
                  { value: 'relative-disaster', label: '灾变相对时间' },
                  { value: 'custom-era', label: '虚构纪元' },
                  { value: 'future-date', label: '未来时间' },
                ]}
              />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'eraName']} label="纪年体系名">
              <Input placeholder="例如：修真历 / 灾变纪年 / 王历" />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'epochLabel']} label="时代标签">
              <Input placeholder="例如：纪元 / 公元 / 在位纪年" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name={['timelineConfig', 'baseYearLabel']} label="起始标记">
              <Input placeholder="例如：元年 / 爆发前 / 2298" />
            </Form.Item>
            <Form.Item name={['timelineConfig', 'relativeZeroLabel']} label="时间零点">
              <Input placeholder="例如：爆发当日 / 开篇之前 / 新王登基" />
            </Form.Item>
          </div>
          <Form.Item name={['timelineConfig', 'displayPattern']} label="展示格式">
            <Input.TextArea rows={3} placeholder="例如：灾变后第X天 / 第X周 / 第X月；或 玄霄纪三年仲秋。" />
          </Form.Item>
          <Form.Item name={['timelineConfig', 'precisionOptions']} label="常用时间精度">
            <Select mode="tags" placeholder="例如：年、月、日、周、阶段、旬" />
          </Form.Item>
          <Form.Item name={['timelineConfig', 'recommendedEventTypes']} label="推荐事件类型">
            <Select mode="tags" placeholder="例如：爆发、试炼、破境、背叛、决战、收束" />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'language',
      label: '语言约束',
      children: (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiQuoteEmphasis']} label="禁止概念引号" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </Card>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiConceptSlogans']} label="禁止空洞口号" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </Card>
            <Card size="small" style={{ background: 'var(--color-bg-card)' }}>
              <Form.Item name={['writingConstraints', 'antiSymmetricLines']} label="禁止对称句堆砌" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </Card>
          </div>
          <Form.Item name={['writingConstraints', 'narrationStyle']} label="叙述风格约束">
            <Input.TextArea rows={3} placeholder="例如：先写局势与动作，再写情绪判断；避免解释腔。" />
          </Form.Item>
          <Form.Item name={['writingConstraints', 'dialogueStyle']} label="对话风格约束">
            <Input.TextArea rows={3} placeholder="例如：允许停顿和回避，不要每句都完整总结。" />
          </Form.Item>
          <Form.Item name={['writingConstraints', 'forbiddenPhrases']} label="禁用高 AI 味词句">
            <Select mode="tags" placeholder="例如：所谓、命运、这一刻、真正的成长、无法言说" />
          </Form.Item>
          <Form.Item name={['writingConstraints', 'extraRules']} label="额外语言规则">
            <Select mode="tags" placeholder="例如：普通概念不要加引号、不要写百科说明腔" />
          </Form.Item>
        </>
      ),
    },
  ]

  return (
    <WorkspacePage
      eyebrow="World Systems"
      title="世界规则"
      description="把题材专属的等级体系、种族生态、势力结构、地图蓝图、时间制和语言约束锁成一套规则。后面的人物、地图、物品、时间轴和写作都会沿用这里的判断。"
      actions={(
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
          保存规则
        </Button>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="力量体系" value={parsedRules.powerSystems.length} tone="warm" hint="等级、晋升与代价" />
          <WorkspaceMetric label="种族生态" value={parsedRules.speciesSystem.length} hint="人类与非人存在类型" />
          <WorkspaceMetric label="势力结构" value={parsedRules.factionSystem.length} tone="cool" hint="国家、宗门、基地或机构" />
          <WorkspaceMetric label="地图层级" value={parsedRules.mapBlueprint.levels.length} hint={tokenStatusText} />
        </>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材名称', value: parsedRules.genreProfile.name || currentNovel?.genreName || '未定义' },
            { label: '子类型定位', value: parsedRules.genreProfile.subgenre || '未填写' },
            { label: '时间制', value: parsedRules.timelineConfig.calendarType || '未设置' },
            { label: '语言限制', value: `${activeLanguageRules} 项硬限制 / ${parsedRules.writingConstraints.forbiddenPhrases.length} 条禁用词句` },
          ]}
        />
      )}
      aside={(
        <>
          <WorkspaceTip title="这一页最重要的作用">
            <div>这里不是补百科，而是给所有后续生成模块定边界。</div>
            <div>人物、地图、物品、时间轴如果要贴合题材，必须先在这里把等级、种族、势力和语言限制说清。</div>
          </WorkspaceTip>

          <WorkspacePanel title="联动提醒" description="这套规则会影响后续哪些页面">
            <div className="novel-note-list">
              <div className="novel-note-list__item">人物页会引用种族、身份、阵营和力量体系。</div>
              <div className="novel-note-list__item">地图页会继承国家 / 势力 / 门派 / 基地等蓝图层级。</div>
              <div className="novel-note-list__item">时间轴会继承纪年方式、常用精度和推荐事件类型。</div>
              <div className="novel-note-list__item">正文写作会继承语言禁忌与表达风格约束。</div>
            </div>
          </WorkspacePanel>

          <WorkspacePanel title="当前摘要" description="给你一个快速检查口径">
            <div className="novel-note-list">
              <div className="novel-note-list__item">叙事焦点：{parsedRules.genreProfile.narrativeFocus.slice(0, 4).join('、') || '未填写'}</div>
              <div className="novel-note-list__item">地图概览：{parsedRules.mapBlueprint.overview || '未填写'}</div>
              <div className="novel-note-list__item">纪年体系：{parsedRules.timelineConfig.eraName || '未填写'}</div>
              <div className="novel-note-list__item">Token 状态：{tokenStatusText}</div>
            </div>
          </WorkspacePanel>
        </>
      )}
    >
      {tokenCount > 1400 ? (
        <Alert
          type="warning"
          message={`当前世界规则预计占用 ${tokenCount} token，建议继续压缩层级描述和重复规则。`}
          showIcon
        />
      ) : (
        <div className="novel-pill">{tokenCount > 0 ? `当前规则较轻，预计占用 ${tokenCount} token` : '开始填写后会实时估算 token 占用'}</div>
      )}

      <WorkspacePanel
        title="规则编辑台"
        description="建议先填题材总览，再补力量体系、种族与势力、地图蓝图，最后锁时间制与语言约束。"
        extra={<div className="novel-pill">统一驱动后续生成逻辑</div>}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(_, allValues) => updateTokenCount(allValues as unknown as Record<string, unknown>)}
        >
          <Tabs className="novel-editor-tabs" items={tabItems} />
        </Form>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
