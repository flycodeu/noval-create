import React, { useEffect, useState, useCallback } from 'react'
import {
  Button, Modal, Form, Input, Select, Tabs, Tag, Avatar, Empty,
  message, Spin, Slider, Drawer, Badge
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, UserOutlined,
  ApartmentOutlined, ReloadOutlined
} from '@ant-design/icons'
import ReactFlow, {
  Node, Edge, Background, Controls, MarkerType, ReactFlowProvider
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

// 判断人物登场阶段（根据 appearChapter）
function getAppearStage(char: Character, totalChapters: number): string {
  if (!char.appearChapter) return 'throughout'
  const ratio = char.appearChapter / Math.max(totalChapters, 1)
  if (ratio < 0.2) return 'early'
  if (ratio < 0.5) return 'mid'
  if (ratio < 0.8) return 'late'
  return 'late'
}

export default function Characters({ novelId }: Props) {
  const { characters, setCharacters } = useNovelStore()
  const [relations, setRelations] = useState<CharacterRelation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedChar, setSelectedChar] = useState<Character | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')
  const [detailForm] = Form.useForm()
  const [batchForm] = Form.useForm()
  const [filterRole, setFilterRole] = useState('all')
  const [filterGender, setFilterGender] = useState('all')
  const [filterStage, setFilterStage] = useState('all')
  const [saving, setSaving] = useState(false)
  const [totalChapters, setTotalChapters] = useState(50)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [chars, rels, chapterList] = await Promise.all([
      window.electron.character.list(novelId),
      window.electron.character.getRelations(novelId),
      window.electron.chapter.list(novelId),
    ])
    setCharacters(chars)
    setRelations(rels)
    setTotalChapters(chapterList.length || 50)
    setLoading(false)
  }, [novelId, setCharacters])

  useEffect(() => { loadData() }, [loadData])

  const handleSelectChar = (char: Character) => {
    setSelectedChar(char)
    detailForm.setFieldsValue({
      ...char,
      personalityTraits: char.personalityTraitsJson ? JSON.parse(char.personalityTraitsJson) : [],
      flaws: char.flawsJson ? JSON.parse(char.flawsJson) : [],
      habits: char.habitsJson ? JSON.parse(char.habitsJson) : [],
      appearance: char.appearanceJson ? JSON.parse(char.appearanceJson).description : '',
    })
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
        appearanceJson: JSON.stringify({ description: values.appearance }),
      }
      if (selectedChar?.id) {
        await window.electron.character.update(selectedChar.id, data)
      } else {
        await window.electron.character.create(novelId, data)
      }
      message.success('已保存')
      setDetailOpen(false)
      loadData()
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (char: Character) => {
    Modal.confirm({
      title: `确认删除「${char.fullName}」？`,
      okType: 'danger',
      onOk: async () => {
        await window.electron.character.delete(char.id)
        loadData()
      },
    })
  }

  const handleGenerateProtagonist = async () => {
    setBatchLoading(true)
    try {
      await window.electron.character.generateProtagonist(novelId, { gender: '不限' })
      loadData()
      message.success('主角生成完成')
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : '未知错误'}`)
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
      loadData()
      message.success('人物批量生成完成')
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : ''}`)
    } finally {
      setBatchLoading(false)
    }
  }

  const handleGenerateRelations = async () => {
    setBatchLoading(true)
    try {
      await window.electron.character.generateRelations(novelId)
      loadData()
      message.success('关系网络已生成')
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : ''}`)
    } finally {
      setBatchLoading(false)
    }
  }

  const filteredChars = characters.filter(c => {
    if (filterRole !== 'all' && c.roleType !== filterRole) return false
    if (filterGender !== 'all' && c.gender !== filterGender) return false
    if (filterStage !== 'all' && getAppearStage(c, totalChapters) !== filterStage) return false
    return true
  })

  // 构建关系图数据（全部）
  const buildGraphData = (charList: Character[], relList: CharacterRelation[]) => {
    const nodes: Node[] = charList.map((char, i) => ({
      id: String(char.id),
      type: 'default',
      position: {
        x: (i % 5) * 200 + 50,
        y: Math.floor(i / 5) * 150 + 50,
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

    const charIds = new Set(charList.map(c => String(c.id)))
    const edges: Edge[] = relList
      .filter(rel => charIds.has(String(rel.charAId)) && charIds.has(String(rel.charBId)))
      .map(rel => ({
        id: `${rel.charAId}-${rel.charBId}`,
        source: String(rel.charAId),
        target: String(rel.charBId),
        label: rel.relationLabel || rel.relationType,
        style: { stroke: RELATION_COLORS[rel.relationType || ''] || '#5c6378' },
        markerEnd: rel.bilateral === 0 ? { type: MarkerType.ArrowClosed } : undefined,
        labelStyle: { fill: 'var(--color-text-secondary)', fontSize: 10 },
      }))

    return { nodes, edges }
  }

  const { nodes, edges } = buildGraphData(characters, relations)

  // 为单个人物构建关系子图
  const buildCharRelationGraph = (char: Character) => {
    const relatedRelations = relations.filter(r => r.charAId === char.id || r.charBId === char.id)
    const relatedCharIds = new Set<number>()
    relatedCharIds.add(char.id)
    relatedRelations.forEach(r => {
      relatedCharIds.add(r.charAId)
      relatedCharIds.add(r.charBId)
    })
    const relatedChars = characters.filter(c => relatedCharIds.has(c.id))
    return buildGraphData(relatedChars, relatedRelations)
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部操作栏 */}
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
          onClick={() => { setSelectedChar(null); detailForm.resetFields(); setDetailOpen(true) }}
        >
          新建人物
        </Button>
      </div>

      {/* 主体内容 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
        ) : viewMode === 'list' ? (
          <div style={{ padding: 20 }}>
            {filteredChars.length === 0 ? (
              <Empty description="暂无人物，点击「生成主角」或「批量生成」开始" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {filteredChars.map(char => (
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

      {/* 人物详情 Drawer */}
      <Drawer
        title={selectedChar ? `编辑：${selectedChar.fullName}` : '新建人物'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={580}
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveChar}>
            保存
          </Button>
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
                      <Select options={Object.entries(ROLE_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v.label }))} />
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
                    <Input.TextArea rows={5} />
                  </Form.Item>
                  <Form.Item name="firstImpression" label="初次印象">
                    <Input.TextArea rows={5} />
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
              key: 'relations',
              label: '关系网络',
              children: selectedChar ? (
                <CharRelationGraph
                  char={selectedChar}
                  graphData={buildCharRelationGraph(selectedChar)}
                  relations={relations.filter(r => r.charAId === selectedChar.id || r.charBId === selectedChar.id)}
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

      {/* 批量生成 Modal */}
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
            <Select options={[1,2,3,4,5].map(n => ({ value: n, label: `${n} 人` }))} />
          </Form.Item>
          <Form.Item name="minorCount" label="次要人物数量" initialValue={5}>
            <Select options={[3,5,8,10].map(n => ({ value: n, label: `${n} 人` }))} />
          </Form.Item>
          <Form.Item name="maleRatio" label="男性比例" initialValue={50}>
            <Slider min={0} max={100} marks={{ 0: '0%', 50: '50%', 100: '100%' }} />
          </Form.Item>
          <Form.Item name="batchSize" label="每批生成数量" initialValue={5}>
            <Select options={[3,5,10].map(n => ({ value: n, label: `${n} 人/批` }))} />
          </Form.Item>
          <Form.Item name="requirements" label="特殊要求">
            <Input.TextArea rows={4} placeholder="例如：需要一个反派师父、需要一个搞笑担当" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// 人物关系子图
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
        {relations.map(rel => {
          const other = characters.find(c => c.id === (rel.charAId === char.id ? rel.charBId : rel.charAId))
          return other ? (
            <div key={rel.id} style={{
              padding: '4px 8px',
              marginBottom: 4,
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 4,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}>
              <span style={{ color: 'var(--color-text-primary)' }}>{other.fullName}</span>
              <Tag style={{ fontSize: 10, padding: '0 4px' }}>{rel.relationLabel || rel.relationType}</Tag>
              {rel.description && <span style={{ color: 'var(--color-text-muted)' }}>{rel.description}</span>}
            </div>
          ) : null
        })}
      </div>
    </div>
  )
}

// 人物卡片
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

  return (
    <div
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        cursor: 'pointer',
        transition: 'border-color var(--transition-fast)',
      }}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(46,134,171,0.4)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-color)')}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Avatar
          size={40}
          style={{ background: avatarColors[char.roleType || 'minor'], flexShrink: 0 }}
        >
          {char.fullName[0]}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
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
      {char.firstImpression && (
        <div style={{
          marginTop: 8,
          color: 'var(--color-text-secondary)',
          fontSize: 12,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {char.firstImpression}
        </div>
      )}
    </div>
  )
}
