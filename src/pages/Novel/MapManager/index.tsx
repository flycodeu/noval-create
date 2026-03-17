import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Tree,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  ShareAltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useNovelStore } from '../../../stores/novel.store'
import { WorldMapItem } from '../../../types'
import {
  getBlueprintLevelByDepth,
  getMapBlueprintDepth,
  getFactionNameOptions,
  getMapNodeTypeOptions,
  parseWorldRulesJson,
} from '../../../shared/genre-system'
import {
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceTip,
} from '../components/WorkspaceShell'

interface Props { novelId: number }

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

function countTreeNodes(items: WorldMapItem[]): number {
  return items.reduce((total, item) => total + 1 + countTreeNodes(item.children || []), 0)
}

function mapToTreeData(items: WorldMapItem[]): DataNode[] {
  return items.map((item) => ({
    key: item.id,
    title: (
      <span>
        {item.level === 1 ? '⛰' : item.level === 2 ? '◈' : '•'} {item.name}
        <span style={{ color: 'var(--color-text-muted)', fontSize: 11, marginLeft: 6 }}>
          {item.nodeType || item.locationType || `第 ${item.level} 层`}
        </span>
      </span>
    ),
    children: item.children ? mapToTreeData(item.children) : [],
  }))
}

function buildFlowGraph(items: WorldMapItem[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const levelColors: Record<number, string> = {
    1: '#2E86AB',
    2: '#9b59b6',
    3: '#e67e22',
    4: '#16a085',
  }

  function traverse(list: WorldMapItem[], parentId: number | null, depth: number, offsetX: number) {
    let xCursor = offsetX
    for (const item of list) {
      const x = xCursor
      const y = depth * 170 + 40
      nodes.push({
        id: String(item.id),
        position: { x, y },
        data: {
          label: (
            <div style={{ textAlign: 'center', fontSize: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 11 }}>{item.name}</div>
              <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 10, marginTop: 4 }}>
                {item.nodeType || item.locationType || `第 ${item.level} 层`}
              </div>
              {item.structureRole && (
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 2 }}>
                  {item.structureRole}
                </div>
              )}
            </div>
          ),
        },
        style: {
          background: 'var(--color-bg-card)',
          border: `2px solid ${levelColors[item.level] || '#5c6378'}`,
          borderRadius: 8,
          color: 'var(--color-text-primary)',
          width: 140,
          padding: 8,
        },
      })

      if (parentId !== null) {
        edges.push({
          id: `e${parentId}-${item.id}`,
          source: String(parentId),
          target: String(item.id),
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: levelColors[item.level] || '#5c6378' },
        })
      }

      if (item.children && item.children.length > 0) {
        traverse(item.children, item.id, depth + 1, xCursor)
        xCursor += Math.max(item.children.length, 1) * 180
      } else {
        xCursor += 180
      }
    }
  }

  traverse(items, null, 0, 50)
  return { nodes, edges }
}

export default function MapManager({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [treeData, setTreeData] = useState<WorldMapItem[]>([])
  const [selected, setSelected] = useState<WorldMapItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'tree' | 'graph'>('tree')
  const [detailForm] = Form.useForm()
  const [batchForm] = Form.useForm()

  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const blueprintLevels = useMemo(
    () => [...worldRules.mapBlueprint.levels].sort((left, right) => left.depth - right.depth),
    [worldRules.mapBlueprint.levels],
  )
  const maxDepth = getMapBlueprintDepth(worldRules)
  const factionOptions = getFactionNameOptions(worldRules)
  const nodeTypeOptions = getMapNodeTypeOptions(worldRules)

  const loadTree = useCallback(async () => {
    setLoading(true)
    const data = await window.electron.map.getTree(novelId)
    setTreeData(data)
    setLoading(false)
  }, [novelId])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  useEffect(() => {
    const initialValues: Record<string, number> = {}
    for (const level of blueprintLevels) {
      initialValues[`layer_${level.depth}`] = level.suggestedCount
    }
    batchForm.setFieldsValue(initialValues)
  }, [batchForm, blueprintLevels])

  const findItem = (items: WorldMapItem[], id: number): WorldMapItem | null => {
    for (const item of items) {
      if (item.id === id) return item
      if (item.children) {
        const found = findItem(item.children, id)
        if (found) return found
      }
    }
    return null
  }

  const handleSelect = (keys: React.Key[]) => {
    if (keys.length === 0) {
      setSelected(null)
      return
    }

    const item = findItem(treeData, Number(keys[0]))
    if (item) {
      setSelected(item)
      detailForm.setFieldsValue({
        name: item.name,
        locationType: item.locationType,
        nodeType: item.nodeType,
        structureRole: item.structureRole,
        parentRuleType: item.parentRuleType,
        description: item.description,
        atmosphere: item.atmosphere,
        plotRelevance: item.plotRelevance,
        dangerLevel: item.dangerLevel,
        tags: parseStringArrayJson(item.tagsJson),
        affiliatedFactions: parseStringArrayJson(item.affiliatedFactionIdsJson),
      })
    }
  }

  const handleSaveDetail = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const values = detailForm.getFieldsValue()
      const { tags, affiliatedFactions, ...restValues } = values
      await window.electron.map.update(selected.id, {
        ...restValues,
        tagsJson: JSON.stringify(tags || []),
        affiliatedFactionIdsJson: JSON.stringify(affiliatedFactions || []),
      })
      message.success('地图节点已保存')
      await loadTree()
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    Modal.confirm({
      title: `确认删除「${selected.name}」？`,
      content: '会同时删除所有子节点。',
      okType: 'danger',
      onOk: async () => {
        await window.electron.map.delete(selected.id)
        setSelected(null)
        await loadTree()
      },
    })
  }

  const handleAddRoot = async () => {
    const rootLevel = blueprintLevels[0]
    await window.electron.map.create(novelId, {
      level: 1,
      name: rootLevel?.examples?.[0] || '新区域',
      nodeType: rootLevel?.nodeTypes?.[0] || '区域',
      structureRole: rootLevel?.relationHint || '',
    })
    await loadTree()
  }

  const handleAddChild = async (parentItem: WorldMapItem) => {
    const newLevel = parentItem.level + 1
    if (newLevel > maxDepth) {
      message.warning('当前题材蓝图下已经是最深层级')
      return
    }

    const levelRule = getBlueprintLevelByDepth(worldRules, newLevel)
    await window.electron.map.create(novelId, {
      level: newLevel,
      parentId: parentItem.id,
      name: levelRule?.examples?.[0] || `新${levelRule?.label || '地点'}`,
      nodeType: levelRule?.nodeTypes?.[0] || '地点',
      parentRuleType: parentItem.nodeType || parentItem.locationType || '',
      structureRole: levelRule?.relationHint || '',
    })
    await loadTree()
  }

  const handleBatchGenerate = async () => {
    setBatchLoading(true)
    try {
      const values = batchForm.getFieldsValue()
      await window.electron.map.batchGenerate(novelId, {
        layerCounts: blueprintLevels.map((level) => ({
          depth: level.depth,
          count: values[`layer_${level.depth}`] || level.suggestedCount,
        })),
        namedPlaces: values.namedPlaces || '',
      })
      setBatchOpen(false)
      batchForm.resetFields()
      await loadTree()
      message.success('地图生成完成')
    } catch (error: unknown) {
      message.error(`生成失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setBatchLoading(false)
    }
  }

  const { nodes, edges } = buildFlowGraph(treeData)
  const nodeCount = countTreeNodes(treeData)
  const selectedRule = selected ? getBlueprintLevelByDepth(worldRules, selected.level) : null

  return (
    <WorkspacePage
      eyebrow="Atlas Blueprint"
      title="地图与势力结构"
      description="这一步负责给故事安排空间骨架。不同题材需要不同的层级结构，例如国家 / 势力 / 宗门 / 场景，或者城市 / 区域 / 基地 / 建筑。后面的事件、人物和物品都会从这里取落点。"
      actions={(
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            type={viewMode === 'tree' ? 'primary' : 'default'}
            icon={<UnorderedListOutlined />}
            onClick={() => setViewMode('tree')}
          >
            树形视图
          </Button>
          <Button
            type={viewMode === 'graph' ? 'primary' : 'default'}
            icon={<ShareAltOutlined />}
            onClick={() => setViewMode('graph')}
          >
            图谱视图
          </Button>
          <Button icon={<ApartmentOutlined />} onClick={() => setBatchOpen(true)}>
            按蓝图生成
          </Button>
          <Button icon={<PlusOutlined />} onClick={handleAddRoot}>
            添加根节点
          </Button>
        </div>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="地图节点" value={nodeCount} tone="warm" hint="当前已创建的全部地区与场景" />
          <WorkspaceMetric label="地图层级" value={blueprintLevels.length} hint={`最深 ${maxDepth} 层`} />
          <WorkspaceMetric label="节点类型库" value={nodeTypeOptions.length} tone="cool" hint="来源于世界规则的地图蓝图" />
          <WorkspaceMetric label="关联势力" value={factionOptions.length} hint="可挂接到地图节点的势力标签" />
        </>
      )}
      aside={(
        <>
          <WorkspaceTip title="地图页该怎么用">
            <div>先用蓝图生成一个能工作的空间骨架，再逐个补重要节点的职责、氛围和剧情用途。</div>
            <div>地图不是景点清单，而是故事发生的结构容器。每个节点都最好能回答“谁会来这里、为什么会来、来这里会发生什么”。</div>
          </WorkspaceTip>

          <WorkspacePanel title="蓝图摘要" description="当前题材的空间组织方式">
            <div className="novel-note-list">
              <div className="novel-note-list__item">{worldRules.mapBlueprint.overview || '尚未设置地图蓝图概述。'}</div>
            </div>
          </WorkspacePanel>

          <WorkspacePanel title={selected ? `当前节点 · ${selected.name}` : '节点编辑提示'} description="右侧表单会继承层级规则">
            <div className="novel-note-list">
              <div className="novel-note-list__item">
                {selected
                  ? `当前位于第 ${selected.level} 层，建议优先补“蓝图职责”“剧情关联”和“关联势力”。`
                  : '先从左侧选一个节点，再在右侧补细节。'}
              </div>
              <div className="novel-note-list__item">
                {selectedRule
                  ? `这一层推荐作为「${selectedRule.label}」使用，建议数量 ${selectedRule.suggestedCount}。`
                  : '如果还没有节点，可以先按蓝图生成一版基础地图。'}
              </div>
            </div>
          </WorkspacePanel>
        </>
      )}
    >
      <WorkspacePanel
        title="地图编辑台"
        description="上半区先看当前题材的地图蓝图，下半区根据视图模式切换树形编辑或全局图谱。"
        extra={<div className="novel-pill">{viewMode === 'tree' ? '当前为树形编辑模式' : '当前为图谱总览模式'}</div>}
      >
        <div className="novel-map-shell">
          <div className="novel-map-blueprint">
            {blueprintLevels.map((level) => (
              <div key={level.depth} className="novel-map-blueprint-card">
                <strong>第 {level.depth} 层 · {level.label}</strong>
                <span>节点类型：{level.nodeTypes.join('、') || '未设置'}</span>
                <span>建议数量：{level.suggestedCount}</span>
                <span>{level.relationHint}</span>
              </div>
            ))}
          </div>

          <div className="novel-map-main" style={viewMode === 'graph' ? { gridTemplateColumns: '1fr' } : undefined}>
            {viewMode === 'tree' ? (
              <>
                <div className="novel-map-tree">
                  <div style={{ padding: 16, borderBottom: '1px solid rgba(122, 93, 52, 0.12)' }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <div style={{ color: 'var(--workspace-ink)', fontSize: 16, fontWeight: 700 }}>地图节点</div>
                      <div style={{ color: 'var(--workspace-ink-soft)', fontSize: 12 }}>
                        {nodeCount > 0 ? `已生成 ${nodeCount} 个节点` : '还没有地图数据'}
                      </div>
                    </div>
                  </div>
                  <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
                    {loading ? (
                      <div className="novel-empty"><Spin /></div>
                    ) : treeData.length === 0 ? (
                      <Empty description="暂无地图数据" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '40px 0' }} />
                    ) : (
                      <Tree
                        treeData={mapToTreeData(treeData)}
                        onSelect={handleSelect}
                        defaultExpandAll
                        style={{ background: 'transparent', color: 'var(--color-text-primary)' }}
                      />
                    )}
                  </div>
                </div>

                <div className="novel-map-detail">
                  {selected ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <h3 style={{ color: 'var(--workspace-ink)', margin: 0 }}>
                            编辑：{selected.name}
                            <span style={{ color: 'var(--workspace-ink-soft)', fontSize: 12, marginLeft: 8 }}>
                              第 {selected.level} 层
                            </span>
                          </h3>
                          <div style={{ color: 'var(--workspace-ink-soft)', fontSize: 12, marginTop: 4 }}>
                            {selected.nodeType || selected.locationType || '未设置节点类型'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {selected.level < maxDepth && (
                            <Button icon={<PlusOutlined />} onClick={() => handleAddChild(selected)}>
                              添加子节点
                            </Button>
                          )}
                          <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
                            删除
                          </Button>
                          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveDetail}>
                            保存
                          </Button>
                        </div>
                      </div>

                      <Form form={detailForm} layout="vertical">
                        <div className="novel-grid novel-grid--3">
                          <Form.Item name="name" label="名称">
                            <Input />
                          </Form.Item>
                          <Form.Item name="nodeType" label="节点类型">
                            <Select
                              showSearch
                              allowClear
                              options={nodeTypeOptions.map((value) => ({ value, label: value }))}
                            />
                          </Form.Item>
                          <Form.Item name="dangerLevel" label="危险等级">
                            <Input placeholder="例如：低 / 中 / 高 / 禁入" />
                          </Form.Item>
                        </div>
                        <div className="novel-grid novel-grid--2">
                          <Form.Item name="structureRole" label="蓝图职责">
                            <Input placeholder="例如：顶级势力、补给点、高风险区、试炼地" />
                          </Form.Item>
                          <Form.Item name="locationType" label="地点细分">
                            <Input placeholder="例如：医院、洞府、宗门大殿、研究楼" />
                          </Form.Item>
                        </div>
                        <Form.Item name="description" label="描述">
                          <Input.TextArea rows={5} placeholder="地点的外观、规则和使用方式。" />
                        </Form.Item>
                        <Form.Item name="atmosphere" label="氛围基调">
                          <Input placeholder="例如：繁华喧嚣、死寂封锁、灵气浓郁、审讯感强" />
                        </Form.Item>
                        <Form.Item name="plotRelevance" label="剧情关联">
                          <Input.TextArea rows={4} placeholder="这个地方承担什么剧情事件、冲突或回收。" />
                        </Form.Item>
                        <Form.Item name="tags" label="地图标签">
                          <Select mode="tags" placeholder="例如：势力核心、补给点、禁区、秘境入口" />
                        </Form.Item>
                        <Form.Item name="affiliatedFactions" label="关联势力">
                          <Select mode="tags" options={factionOptions.map((value) => ({ value, label: value }))} />
                        </Form.Item>
                      </Form>
                    </>
                  ) : (
                    <div className="novel-empty">选择左侧节点后，再在这里补充职责、氛围和剧情用途。</div>
                  )}
                </div>
              </>
            ) : (
              <div className="novel-map-graph">
                {loading ? (
                  <div className="novel-empty" style={{ height: '100%' }}><Spin /></div>
                ) : treeData.length === 0 ? (
                  <div className="novel-empty" style={{ height: '100%' }}>暂无地图数据，请先添加或按蓝图生成。</div>
                ) : (
                  <ReactFlowProvider>
                    <ReactFlow nodes={nodes} edges={edges} fitView style={{ background: 'transparent' }}>
                      <Background color="rgba(122, 93, 52, 0.14)" gap={20} />
                      <Controls />
                    </ReactFlow>
                  </ReactFlowProvider>
                )}
              </div>
            )}
          </div>
        </div>
      </WorkspacePanel>

      <Modal
        title="按题材蓝图生成地图"
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={handleBatchGenerate}
        confirmLoading={batchLoading}
        okText="开始生成"
      >
        <Form form={batchForm} layout="vertical">
          {blueprintLevels.map((level) => (
            <Form.Item
              key={level.depth}
              name={`layer_${level.depth}`}
              label={`${level.label} 数量`}
              initialValue={level.suggestedCount}
            >
              <InputNumber min={1} max={12} style={{ width: '100%' }} />
            </Form.Item>
          ))}
          <Form.Item name="namedPlaces" label="已知地点名称（每行一个，可留空）">
            <Input.TextArea rows={5} placeholder="如：长安城&#10;临港基地&#10;九焰秘境" />
          </Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
