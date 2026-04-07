import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, List, Select, Space, Tag, message } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { getErrorMessage } from '@/utils/user-facing-message'
import type { Character, Faction, FactionExternalRelation, MapNodeSummary } from '../../../types'
import { buildFactionExternalRelationsPayload, parseFactionExternalRelations } from '../../../shared/factions'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { loadWorkflowStats } from '../workflow'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

const FACTION_TYPE_OPTIONS = [
  { value: 'organization', label: '组织' },
  { value: 'faction', label: '势力' },
  { value: 'family', label: '家族' },
  { value: 'sect', label: '宗门' },
  { value: 'company', label: '公司' },
  { value: 'government', label: '政体' },
  { value: 'other', label: '其他' },
] as const

const RELATION_OPTIONS = [
  { value: 'ally', label: '盟友' },
  { value: 'enemy', label: '敌对' },
  { value: 'neutral', label: '中立' },
  { value: 'subordinate', label: '从属' },
] as const

interface Props {
  novelId: number
}

interface FactionFormValues {
  name: string
  type: Faction['type']
  goal: string
  resources: string
  territoryMapNodeIds: number[]
  leaderCharacterId?: number
  memberPolicy: string
  currentPhase: string
  externalRelations: FactionExternalRelation[]
  notes: string
}

const EMPTY_VALUES: FactionFormValues = {
  name: '',
  type: 'faction',
  goal: '',
  resources: '',
  territoryMapNodeIds: [],
  leaderCharacterId: undefined,
  memberPolicy: '',
  currentPhase: '',
  externalRelations: [],
  notes: '',
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed
        .map((item) => (typeof item === 'number' ? item : Number(item)))
        .filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

function buildFormValues(item?: Faction | null): FactionFormValues {
  if (!item) return EMPTY_VALUES
  return {
    name: item.name,
    type: item.type,
    goal: item.goal || '',
    resources: item.resources || '',
    territoryMapNodeIds: parseNumberArray(item.territoryMapNodeIdsJson),
    leaderCharacterId: item.leaderCharacterId,
    memberPolicy: item.memberPolicy || '',
    currentPhase: item.currentPhase || '',
    externalRelations: parseFactionExternalRelations(item.externalRelationsJson),
    notes: item.notes || '',
  }
}

export default function FactionsPage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const { mutationToken, notifyWorkspaceMutation, registerSaveHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<FactionFormValues>()
  const [items, setItems] = useState<Faction[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [stats, setStats] = useState({ total: 0, withLeaderCount: 0, territoryBoundCount: 0, relationCount: 0 })
  const [workflowStats, setWorkflowStats] = useState({ characterCount: 0, mapCount: 0 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [characterOptions, setCharacterOptions] = useState<Character[]>([])
  const [mapOptions, setMapOptions] = useState<MapNodeSummary[]>([])

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [page, nextStats, nextWorkflowStats, nextCharacters, nextMaps] = await Promise.all([
        window.electron.faction.query({ novelId, keyword, page: 1, pageSize: 200 }),
        window.electron.faction.getStats({ novelId }),
        loadWorkflowStats(novelId),
        window.electron.character.search(novelId, '', 80),
        window.electron.map.searchNodes(novelId, '', 80),
      ])
      setItems(page.items)
      setStats(nextStats)
      setWorkflowStats({ characterCount: nextWorkflowStats.characterCount, mapCount: nextWorkflowStats.mapCount })
      setCharacterOptions(nextCharacters)
      setMapOptions(nextMaps)
      setSelectedId((current) => {
        if (current && page.items.some((item) => item.id === current)) return current
        return page.items[0]?.id || null
      })
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [keyword, novelId])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  useEffect(() => {
    form.setFieldsValue(buildFormValues(selectedItem))
  }, [form, selectedItem])

  useEffect(() => {
    registerSaveHandler(selectedId ? () => { void handleSave() } : null)
    return () => registerSaveHandler(null)
  })

  const handleCreate = () => {
    setSelectedId(null)
    form.setFieldsValue(EMPTY_VALUES)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const payload: Partial<Faction> = {
        name: values.name.trim(),
        type: values.type,
        goal: values.goal.trim(),
        resources: values.resources.trim(),
        territoryMapNodeIdsJson: JSON.stringify(values.territoryMapNodeIds || []),
        leaderCharacterId: values.leaderCharacterId || undefined,
        memberPolicy: values.memberPolicy.trim(),
        currentPhase: values.currentPhase.trim(),
        externalRelationsJson: buildFactionExternalRelationsPayload(values.externalRelations || []),
        notes: values.notes.trim(),
      }

      if (selectedId) {
        await window.electron.faction.update(selectedId, payload)
        message.success('势力已更新')
      } else {
        const id = await window.electron.faction.create(novelId, payload)
        setSelectedId(id)
        message.success('势力已创建')
      }
      notifyWorkspaceMutation()
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedItem) return
    try {
      await window.electron.faction.delete(selectedItem.id)
      message.success('势力已删除')
      setSelectedId(null)
      form.setFieldsValue(EMPTY_VALUES)
      notifyWorkspaceMutation()
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.deleteFailed'))
    }
  }

  return (
    <WorkspacePage
      className="novel-factions-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="世界与资源"
      title="势力系统"
      description="把组织、家族、宗门和政体从世界规则里拆成可维护资产，让角色归属、地图控制区和外部关系都能落到结构化记录。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存势力
          </Button>
          <Button icon={<PlusOutlined />} onClick={handleCreate}>
            新建势力
          </Button>
          <Button danger icon={<DeleteOutlined />} disabled={!selectedItem} onClick={() => void handleDelete()}>
            删除势力
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '角色池', value: `${workflowStats.characterCount} 人` },
            { label: '地图节点', value: `${workflowStats.mapCount} 处` },
            { label: '当前选中', value: selectedItem?.name || '新建中' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="势力总数" value={stats.total} tone="warm" hint="建议先把真正影响主线的主体录进去。" />
          <WorkspaceMetric label="领袖已绑定" value={stats.withLeaderCount} hint="领袖绑定后，角色页会更容易保持归属一致。" />
          <WorkspaceMetric label="地盘已绑定" value={stats.territoryBoundCount} hint="地盘绑定可以直接复用地图节点。" />
          <WorkspaceMetric label="外部关系" value={stats.relationCount} hint="敌对、盟友、从属都应在这里收口。" />
        </>
      )}
    >
      {!workflowStats.characterCount || !workflowStats.mapCount ? (
        <Alert
          type="info"
          showIcon
          message="角色或地图资产还不完整"
          description="势力页已经可以先录入目标、资源和阶段；领袖与地盘绑定可以等角色和地图补齐后再回填。"
        />
      ) : null}

      <WorkspacePanel title="势力清单" description="左侧筛选，右侧编辑。">
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <Input.Search value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索势力、目标或资源" allowClear />
            <List
              loading={loading}
              size="small"
              dataSource={items}
              locale={{ emptyText: '当前没有势力记录' }}
              renderItem={(item) => (
                <List.Item
                  onClick={() => setSelectedId(item.id)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: 12,
                    padding: 12,
                    background: selectedId === item.id ? 'rgba(24, 144, 255, 0.08)' : 'transparent',
                    border: '1px solid rgba(120, 120, 120, 0.18)',
                    marginBottom: 8,
                  }}
                >
                  <List.Item.Meta
                    title={(
                      <Space wrap>
                        <strong>{item.name}</strong>
                        <Tag>{FACTION_TYPE_OPTIONS.find((option) => option.value === item.type)?.label || item.type}</Tag>
                      </Space>
                    )}
                    description={item.goal || item.currentPhase || '还没有写清目标与阶段。'}
                  />
                </List.Item>
              )}
            />
          </div>

          <Form form={form} layout="vertical" initialValues={EMPTY_VALUES}>
            <div className="guided-step__field-grid">
              <div className="guided-step__field-card">
                <Form.Item name="name" label="势力名称" rules={[{ required: true, message: '请填写势力名称' }]}>
                  <Input placeholder="例如：南城巡防队 / 云岚宗 / 第七码头商会" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--compact">
                <Form.Item name="type" label="势力类型" rules={[{ required: true, message: '请选择势力类型' }]}>
                  <Select options={FACTION_TYPE_OPTIONS as unknown as Array<{ value: string; label: string }>} />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="leaderCharacterId" label="领袖角色">
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))}
                    placeholder="可留空"
                  />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="territoryMapNodeIds" label="地盘节点">
                  <Select
                    mode="multiple"
                    allowClear
                    optionFilterProp="label"
                    options={mapOptions.map((item) => ({ value: item.id, label: item.name }))}
                    placeholder="选择地图节点"
                  />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="goal" label="目标">
                  <Input.TextArea rows={3} placeholder="写这股势力当前最现实的目标和主推进方向。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="resources" label="资源">
                  <Input.TextArea rows={3} placeholder="写人手、物资、资金、情报、制度或地缘优势。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="memberPolicy" label="成员规则">
                  <Input.TextArea rows={3} placeholder="写成员来源、晋升方式、惩罚和忠诚结构。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card">
                <Form.Item name="currentPhase" label="当前阶段">
                  <Input.TextArea rows={3} placeholder="写当下阶段、内外压力和正在发生的变化。" />
                </Form.Item>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.List name="externalRelations">
                  {(fields, { add, remove }) => (
                    <div style={{ display: 'grid', gap: 12 }}>
                      <div style={{ fontWeight: 600 }}>外部关系</div>
                      {fields.map((field) => (
                        <div key={field.key} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr auto', gap: 12, alignItems: 'start' }}>
                          <Form.Item name={[field.name, 'targetFactionName']} rules={[{ required: true, message: '请填写目标势力' }]}>
                            <Input placeholder="目标势力名称" />
                          </Form.Item>
                          <Form.Item name={[field.name, 'relation']} rules={[{ required: true, message: '请选择关系' }]}>
                            <Select options={RELATION_OPTIONS as unknown as Array<{ value: string; label: string }>} placeholder="关系" />
                          </Form.Item>
                          <Form.Item name={[field.name, 'note']}>
                            <Input placeholder="补充说明" />
                          </Form.Item>
                          <Button danger onClick={() => remove(field.name)}>删除</Button>
                        </div>
                      ))}
                      <Button onClick={() => add({ relation: 'neutral' })}>新增关系</Button>
                    </div>
                  )}
                </Form.List>
              </div>
              <div className="guided-step__field-card guided-step__field-card--full">
                <Form.Item name="notes" label="补充说明">
                  <Input.TextArea rows={4} placeholder="补充与主线、角色、地图、资源链的关系。" />
                </Form.Item>
              </div>
            </div>
          </Form>
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
