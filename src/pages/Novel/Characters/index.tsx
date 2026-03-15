import React, { useCallback, useEffect, useState } from 'react'
import {
  Avatar,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Slider,
  Spin,
  Tabs,
  Tag,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UserOutlined,
} from '@ant-design/icons'
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Character, CharacterRelation } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'

interface Props { novelId: number }

const ROLE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  protagonist: { label: '主角', color: '#2E86AB' },
  major: { label: '主要人物', color: '#9b59b6' },
  minor: { label: '次要人物', color: '#5c6378' },
  antagonist: { label: '反派', color: '#e74c3c' },
  supporting: { label: '配角', color: '#7f8c8d' },
}

const RELATION_COLORS: Record<string, string> = {
  friend: '#52c41a',
  enemy: '#ff4d4f',
  lover: '#FF69B4',
  parent_child: '#4da8d4',
  colleague: '#faad14',
  rival: '#e67e22',
  mentor_student: '#9b59b6',
  acquaintance: '#5c6378',
}

const APPEAR_STAGE_OPTIONS = [
  { value: 'all', label: '全部阶段' },
  { value: 'early', label: '早期登场' },
  { value: 'mid', label: '中期登场' },
  { value: 'late', label: '后期登场' },
  { value: 'throughout', label: '贯穿全程' },
]

function parseStringArrayJson(raw?: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function parseAppearance(raw?: string): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && typeof parsed.description === 'string'
      ? parsed.description
      : ''
  } catch {
    return ''
  }
}

function getAppearStage(char: Character, totalChapters: number): string {
  if (!char.appearChapter) return 'throughout'
  const ratio = char.appearChapter / Math.max(totalChapters, 1)
  if (ratio < 0.2) return 'early'
  if (ratio < 0.5) return 'mid'
  if (ratio < 0.8) return 'late'
  return 'late'
}

function buildCharacterFormValues(char: Character | null) {
  if (!char) return {}
  return {
    ...char,
    personalityTraits: parseStringArrayJson(char.personalityTraitsJson),
    flaws: parseStringArrayJson(char.flawsJson),
    habits: parseStringArrayJson(char.habitsJson),
    appearance: parseAppearance(char.appearanceJson),
  }
}

function getCharacterPreview(char: Character): string {
  return char.innerConflict || char.resonancePoint || char.firstImpression || ''
}

export default function Characters({ novelId }: Props) {
  const { characters, setCharacters } = useNovelStore()
  const [relations, setRelations] = useState<CharacterRelation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedChar, setSelectedChar] = useState<Character | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')
  const [detailForm] = Form.useForm()
  const [batchForm] = Form.useForm()
  const [filterRole, setFilterRole] = useState('all')
  const [filterGender, setFilterGender] = useState('all')
  const [filterStage, setFilterStage] = useState('all')
  const [saving, setSaving] = useState(false)
  const [totalChapters, setTotalChapters] = useState(50)

  const applyCharacterToForm = useCallback((char: Character | null) => {
    setSelectedChar(char)
    if (char) {
      detailForm.setFieldsValue(buildCharacterFormValues(char))
    } else {
      detailForm.resetFields()
    }
  }, [detailForm])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [chars, rels, chapterList] = await Promise.all([
        window.electron.character.list(novelId),
        window.electron.character.getRelations(novelId),
        window.electron.chapter.list(novelId),
      ])
      setCharacters(chars)
      setRelations(rels)
      setTotalChapters(chapterList.length || 50)
    } finally {
      setLoading(false)
    }
  }, [novelId, setCharacters])

  useEffect(() => { loadData() }, [loadData])

  const handleSelectChar = (char: Character) => {
    applyCharacterToForm(char)
    setDetailOpen(true)
  }

  const handleSaveChar = async () => {
    setSaving(true)
    try {
      const values = detailForm.getFieldsValue()
      const data = {
        ...selectedChar,
        ...values,
        personalityTraitsJson: JSON.stringify(values.personalityTraits || []),
        flawsJson: JSON.stringify(values.flaws || []),
        habitsJson: JSON.stringify(values.habits || []),
        appearanceJson: JSON.stringify({ description: values.appearance || '' }),
      }

      if (selectedChar?.id) {
        await window.electron.character.update(selectedChar.id, data)
      } else {
        await window.electron.character.create(novelId, data)
      }

      message.success('已保存')
      setDetailOpen(false)
      applyCharacterToForm(null)
      await loadData()
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (char: Character) => {
    Modal.confirm({
      title: `确认删除「${char.fullName}」？`,
      content: '该人物的关联关系也会一并移除。',
      okType: 'danger',
      okText: '删除',
      onOk: async () => {
        await window.electron.character.delete(char.id)
        if (selectedChar?.id === char.id) {
          setDetailOpen(false)
          applyCharacterToForm(null)
        }
        await loadData()
        message.success('人物已删除')
      },
    })
  }

  const handleRegenerateChar = async () => {
    if (!selectedChar?.id) return

    setRegenerating(true)
    try {
      const updated = await window.electron.character.regenerate(selectedChar.id)
      await loadData()
      if (updated) {
        applyCharacterToForm(updated)
      }
      message.success('人物已根据最新设定刷新')
    } catch (error: unknown) {
      message.error(`更新失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setRegenerating(false)
    }
  }

  const handleGenerateProtagonist = async () => {
    setBatchLoading(true)
    try {
      await window.electron.character.generateProtagonist(novelId, { gender: '不限' })
      await loadData()
      message.success('主角生成完成')
    } catch (error: unknown) {
      message.error(`生成失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setBatchLoading(false)
    }
  }

  const handleBatchGenerate = async () => {
    setBatchLoading(true)
    try {
      const values = batchForm.getFieldsValue()
      await window.electron.character.batchGenerate(novelId, {
        majorCount: values.majorCount || 3,
        minorCount: values.minorCount || 5,
        genderRatio: `男${values.maleRatio || 50}%女${100 - (values.maleRatio || 50)}%`,
        specialRequirements: values.requirements || '',
        batchSize: values.batchSize || 5,
      })
      setBatchOpen(false)
      batchForm.resetFields()
      await loadData()
      message.success('人物批量生成完成')
    } catch (error: unknown) {
      message.error(`生成失败：${error instanceof Error ? error.message : ''}`)
    } finally {
      setBatchLoading(false)
    }
  }

  const handleGenerateRelations = async () => {
    setBatchLoading(true)
    try {
      await window.electron.character.generateRelations(novelId)
      await loadData()
      message.success('关系网络已生成')
    } catch (error: unknown) {
      message.error(`生成失败：${error instanceof Error ? error.message : ''}`)
    } finally {
      setBatchLoading(false)
    }
  }

  const filteredChars = characters.filter((char) => {
    if (filterRole !== 'all' && char.roleType !== filterRole) return false
    if (filterGender !== 'all' && char.gender !== filterGender) return false
    if (filterStage !== 'all' && getAppearStage(char, totalChapters) !== filterStage) return false
    return true
  })

  const buildGraphData = (charList: Character[], relList: CharacterRelation[]) => {
    const nodes: Node[] = charList.map((char, index) => ({
      id: String(char.id),
      type: 'default',
      position: {
        x: (index % 5) * 200 + 50,
        y: Math.floor(index / 5) * 150 + 50,
      },
      data: {
        label: (
          <div style={{ textAlign: 'center', fontSize: 12 }}>
            <div style={{ fontWeight: 600 }}>{char.fullName}</div>
            <div style={{ color: ROLE_TYPE_LABELS[char.roleType || 'minor']?.color, fontSize: 11 }}>
              {ROLE_TYPE_LABELS[char.roleType || 'minor']?.label}
            </div>
          </div>
        ),
      },
      style: {
        background: 'var(--color-bg-card)',
        border: `2px solid ${ROLE_TYPE_LABELS[char.roleType || 'minor']?.color || '#5c6378'}`,
        borderRadius: 8,
        color: 'var(--color-text-primary)',
        width: 120,
      },
    }))

    const charIds = new Set(charList.map((char) => String(char.id)))
    const edges: Edge[] = relList
      .filter((relation) => charIds.has(String(relation.charAId)) && charIds.has(String(relation.charBId)))
      .map((relation) => ({
        id: `${relation.charAId}-${relation.charBId}`,
        source: String(relation.charAId),
        target: String(relation.charBId),
        label: relation.relationLabel || relation.relationType,
        style: { stroke: RELATION_COLORS[relation.relationType || ''] || '#5c6378' },
        markerEnd: relation.bilateral === 0 ? { type: MarkerType.ArrowClosed } : undefined,
        labelStyle: { fill: 'var(--color-text-secondary)', fontSize: 10 },
      }))

    return { nodes, edges }
  }

  const { nodes, edges } = buildGraphData(characters, relations)

  const buildCharRelationGraph = (char: Character) => {
    const relatedRelations = relations.filter((relation) => relation.charAId === char.id || relation.charBId === char.id)
    const relatedCharIds = new Set<number>([char.id])
    relatedRelations.forEach((relation) => {
      relatedCharIds.add(relation.charAId)
      relatedCharIds.add(relation.charBId)
    })
    const relatedChars = characters.filter((character) => relatedCharIds.has(character.id))
    return buildGraphData(relatedChars, relatedRelations)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        background: 'var(--color-bg-secondary)',
        flexWrap: 'wrap',
      }}>
        <Button.Group>
          <Button type={viewMode === 'list' ? 'primary' : 'default'} onClick={() => setViewMode('list')}>人物列表</Button>
          <Button type={viewMode === 'graph' ? 'primary' : 'default'} onClick={() => setViewMode('graph')}>关系图谱</Button>
        </Button.Group>
        <Select
          value={filterRole}
          onChange={setFilterRole}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部类型' },
            { value: 'protagonist', label: '主角' },
            { value: 'major', label: '主要人物' },
            { value: 'antagonist', label: '反派' },
            { value: 'minor', label: '次要人物' },
            { value: 'supporting', label: '配角' },
          ]}
        />
        <Select
          value={filterGender}
          onChange={setFilterGender}
          style={{ width: 110 }}
          options={[
            { value: 'all', label: '全部性别' },
            { value: 'male', label: '男' },
            { value: 'female', label: '女' },
            { value: 'other', label: '其他' },
          ]}
        />
        <Select
          value={filterStage}
          onChange={setFilterStage}
          style={{ width: 120 }}
          options={APPEAR_STAGE_OPTIONS}
        />
        <div style={{ flex: 1 }} />
        <Button icon={<ReloadOutlined />} loading={batchLoading} onClick={handleGenerateRelations}>
          生成关系网络
        </Button>
        <Button icon={<UserOutlined />} loading={batchLoading} onClick={handleGenerateProtagonist}>
          生成主角
        </Button>
        <Button icon={<ApartmentOutlined />} onClick={() => setBatchOpen(true)}>
          批量生成
        </Button>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            applyCharacterToForm(null)
            detailForm.resetFields()
            setDetailOpen(true)
          }}
        >
          新建人物
        </Button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
        ) : viewMode === 'list' ? (
          <div style={{ padding: 20 }}>
            {filteredChars.length === 0 ? (
              <Empty description="暂无人物，点击「生成主角」或「批量生成」开始" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                {filteredChars.map((char) => (
                  <CharacterCard
                    key={char.id}
                    char={char}
                    onClick={() => handleSelectChar(char)}
                    onDelete={() => handleDelete(char)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              style={{ background: 'var(--color-bg-primary)' }}
            >
              <Background color="#252840" gap={20} />
              <Controls />
            </ReactFlow>
          </ReactFlowProvider>
        )}
      </div>

      <Drawer
        title={selectedChar ? `编辑：${selectedChar.fullName}` : '新建人物'}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false)
          applyCharacterToForm(null)
        }}
        width={720}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            {selectedChar && (
              <>
                <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(selectedChar)}>
                  删除
                </Button>
                <Button icon={<ReloadOutlined />} loading={regenerating} onClick={handleRegenerateChar}>
                  按最新设定重试
                </Button>
              </>
            )}
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveChar}>
              保存
            </Button>
          </div>
        }
      >
        <Form form={detailForm} layout="vertical">
          <Tabs items={[
            {
              key: 'basic',
              label: '基本信息',
              children: (
                <>
                  <Form.Item name="fullName" label="姓名" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Form.Item name="roleType" label="角色类型" style={{ flex: 1 }}>
                      <Select options={Object.entries(ROLE_TYPE_LABELS).map(([key, value]) => ({ value: key, label: value.label }))} />
                    </Form.Item>
                    <Form.Item name="gender" label="性别" style={{ flex: 1 }}>
                      <Select options={[{ value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'other', label: '其他' }]} />
                    </Form.Item>
                    <Form.Item name="age" label="年龄" style={{ flex: 1 }}>
                      <Input type="number" />
                    </Form.Item>
                  </div>
                  <Form.Item name="occupation" label="职业/身份">
                    <Input />
                  </Form.Item>
                  <Form.Item name="appearance" label="外貌描述">
                    <Input.TextArea rows={5} />
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'background',
              label: '背景经历',
              children: (
                <>
                  <Form.Item name="background" label="背景经历">
                    <Input.TextArea rows={6} />
                  </Form.Item>
                  <Form.Item name="birthplace" label="出生地">
                    <Input />
                  </Form.Item>
                  <Form.Item name="goals" label="核心追求">
                    <Input.TextArea rows={4} />
                  </Form.Item>
                  <Form.Item name="firstImpression" label="初次印象">
                    <Input.TextArea rows={4} />
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'personality',
              label: '性格特征',
              children: (
                <>
                  <Form.Item name="personalityTraits" label="性格特点">
                    <Select mode="tags" placeholder="输入后按回车添加" />
                  </Form.Item>
                  <Form.Item name="flaws" label="性格缺陷">
                    <Select mode="tags" placeholder="输入后按回车添加" />
                  </Form.Item>
                  <Form.Item name="habits" label="习惯/口头禅">
                    <Select mode="tags" placeholder="输入后按回车添加" />
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'depth',
              label: '深度档案',
              children: (
                <>
                  <Form.Item name="surfaceDesire" label="表层欲望">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="deepNeed" label="深层需要">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="coreFear" label="核心恐惧">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="innerConflict" label="内在矛盾">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="hiddenSecret" label="隐藏秘密">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="moralLine" label="道德底线">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="selfDeception" label="自我欺骗">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="trauma" label="旧伤/创伤">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="contradiction" label="反差点">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="relationshipTension" label="关系张力">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="resonancePoint" label="共鸣点">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Form.Item name="characterArc" label="人物弧光">
                    <Input.TextArea rows={3} />
                  </Form.Item>
                </>
              ),
            },
            {
              key: 'relations',
              label: '关系网络',
              children: selectedChar ? (
                <CharRelationGraph
                  char={selectedChar}
                  graphData={buildCharRelationGraph(selectedChar)}
                  relations={relations.filter((relation) => relation.charAId === selectedChar.id || relation.charBId === selectedChar.id)}
                  characters={characters}
                />
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 40 }}>
                  保存人物后查看关系网络
                </div>
              ),
            },
          ]} />
        </Form>
      </Drawer>

      <Modal
        title="批量生成人物"
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={handleBatchGenerate}
        confirmLoading={batchLoading}
        okText="开始生成"
      >
        <Form form={batchForm} layout="vertical">
          <Form.Item name="majorCount" label="主要人物数量" initialValue={3}>
            <Select options={[1, 2, 3, 4, 5].map((count) => ({ value: count, label: `${count} 人` }))} />
          </Form.Item>
          <Form.Item name="minorCount" label="次要人物数量" initialValue={5}>
            <Select options={[3, 5, 8, 10].map((count) => ({ value: count, label: `${count} 人` }))} />
          </Form.Item>
          <Form.Item name="maleRatio" label="男性比例" initialValue={50}>
            <Slider min={0} max={100} marks={{ 0: '0%', 50: '50%', 100: '100%' }} />
          </Form.Item>
          <Form.Item name="batchSize" label="每批生成数量" initialValue={5}>
            <Select options={[3, 5, 10].map((count) => ({ value: count, label: `${count} 人/批` }))} />
          </Form.Item>
          <Form.Item name="requirements" label="特殊要求">
            <Input.TextArea rows={4} placeholder="例如：需要一个反派师父、需要一个搞笑担当、人物要更灰度" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

function CharRelationGraph({
  char,
  graphData,
  relations,
  characters,
}: {
  char: Character
  graphData: { nodes: Node[]; edges: Edge[] }
  relations: CharacterRelation[]
  characters: Character[]
}) {
  if (graphData.nodes.length <= 1) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: 12, textAlign: 'center', paddingTop: 40 }}>
        暂无关系数据，点击「生成关系网络」自动生成
      </div>
    )
  }

  return (
    <div>
      <div style={{ height: 300, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={graphData.nodes}
            edges={graphData.edges}
            fitView
            style={{ background: 'var(--color-bg-primary)' }}
            nodesDraggable={false}
            zoomOnScroll={false}
          >
            <Background color="#252840" gap={20} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {relations.map((relation) => {
          const other = characters.find((character) => character.id === (relation.charAId === char.id ? relation.charBId : relation.charAId))
          return other ? (
            <div
              key={relation.id}
              style={{
                padding: '4px 8px',
                marginBottom: 4,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 4,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ color: 'var(--color-text-primary)' }}>{other.fullName}</span>
              <Tag style={{ fontSize: 10, padding: '0 4px' }}>{relation.relationLabel || relation.relationType}</Tag>
              {relation.description && <span style={{ color: 'var(--color-text-muted)' }}>{relation.description}</span>}
            </div>
          ) : null
        })}
      </div>
    </div>
  )
}

function CharacterCard({
  char,
  onClick,
  onDelete,
}: {
  char: Character
  onClick: () => void
  onDelete: () => void
}) {
  const role = ROLE_TYPE_LABELS[char.roleType || 'minor']
  const avatarColors: Record<string, string> = {
    protagonist: '#2E86AB',
    major: '#9b59b6',
    antagonist: '#e74c3c',
    minor: '#5c6378',
    supporting: '#7f8c8d',
  }
  const preview = getCharacterPreview(char)

  return (
    <div
      style={{
        position: 'relative',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        cursor: 'pointer',
        transition: 'border-color var(--transition-fast)',
        minHeight: 164,
      }}
      onClick={onClick}
      onMouseEnter={(event) => { event.currentTarget.style.borderColor = 'rgba(46,134,171,0.4)' }}
      onMouseLeave={(event) => { event.currentTarget.style.borderColor = 'var(--border-color)' }}
    >
      <Button
        type="text"
        danger
        size="small"
        icon={<DeleteOutlined />}
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        style={{ position: 'absolute', top: 6, right: 6 }}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Avatar
          size={40}
          style={{ background: avatarColors[char.roleType || 'minor'], flexShrink: 0 }}
        >
          {char.fullName[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 24 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{char.fullName}</div>
          <Tag style={{
            background: 'transparent',
            border: `1px solid ${role.color}`,
            color: role.color,
            fontSize: 11,
          }}>
            {role.label}
          </Tag>
          {char.occupation && (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 11, marginTop: 4 }}>
              {char.occupation}
            </div>
          )}
        </div>
      </div>
      {preview && (
        <div style={{
          marginTop: 10,
          color: 'var(--color-text-secondary)',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          lineHeight: 1.65,
        }}>
          {preview}
        </div>
      )}
      {char.relationshipTension && (
        <div style={{
          marginTop: 8,
          color: 'var(--color-text-muted)',
          fontSize: 11,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          关系张力：{char.relationshipTension}
        </div>
      )}
    </div>
  )
}
