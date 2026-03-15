import React, { useEffect, useState, useCallback } from 'react'
import {
  Tree, Button, Form, Input, Select, Modal, message, Spin, Empty
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, ApartmentOutlined,
  UnorderedListOutlined, ShareAltOutlined
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import ReactFlow, {
  Node, Edge, Background, Controls, MarkerType, ReactFlowProvider
} from 'reactflow'
import 'reactflow/dist/style.css'
import { WorldMapItem } from '../../../types'

interface Props { novelId: number }

function mapToTreeData(items: WorldMapItem[]): DataNode[] {
  return items.map(item => ({
    key: item.id,
    title: (
      <span>
        {item.level === 1 ? '🌍' : item.level === 2 ? '📍' : '🏛️'} {item.name}
        {item.atmosphere ? <span style={{ color: 'var(--color-text-muted)', fontSize: 11, marginLeft: 6 }}>· {item.atmosphere}</span> : null}
      </span>
    ),
    children: item.children ? mapToTreeData(item.children) : [],
  }))
}

// 把层级树展平为节点+边
function buildFlowGraph(items: WorldMapItem[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const levelColors: Record<number, string> = {
    1: '#2E86AB',
    2: '#9b59b6',
    3: '#e67e22',
  }

  function traverse(list: WorldMapItem[], parentId: number | null, depth: number, offsetX: number) {
    let xCursor = offsetX
    for (const item of list) {
      const x = xCursor
      const y = depth * 160 + 40
      nodes.push({
        id: String(item.id),
        position: { x, y },
        data: {
          label: (
            <div style={{ textAlign: 'center', fontSize: 12 }}>
              <div style={{ fontSize: 16 }}>
                {item.level === 1 ? '🌍' : item.level === 2 ? '📍' : '🏛️'}
              </div>
              <div style={{ fontWeight: 600, fontSize: 11 }}>{item.name}</div>
              {item.atmosphere && (
                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 2 }}>
                  {item.atmosphere}
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
          width: 110,
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
        xCursor += item.children.length * 150
      } else {
        xCursor += 150
      }
    }
  }

  traverse(items, null, 0, 50)
  return { nodes, edges }
}

export default function MapManager({ novelId }: Props) {
  const [treeData, setTreeData] = useState<WorldMapItem[]>([])
  const [selected, setSelected] = useState<WorldMapItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'tree' | 'graph'>('tree')
  const [detailForm] = Form.useForm()
  const [batchForm] = Form.useForm()

  const loadTree = useCallback(async () => {
    setLoading(true)
    const data = await window.electron.map.getTree(novelId)
    setTreeData(data)
    setLoading(false)
  }, [novelId])

  useEffect(() => { loadTree() }, [loadTree])

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
    if (keys.length === 0) { setSelected(null); return }
    const item = findItem(treeData, Number(keys[0]))
    if (item) {
      setSelected(item)
      detailForm.setFieldsValue({
        name: item.name,
        locationType: item.locationType,
        description: item.description,
        atmosphere: item.atmosphere,
        plotRelevance: item.plotRelevance,
      })
    }
  }

  const handleSaveDetail = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const values = detailForm.getFieldsValue()
      await window.electron.map.update(selected.id, values)
      message.success('已保存')
      loadTree()
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
      content: '同时删除所有子节点',
      okType: 'danger',
      onOk: async () => {
        await window.electron.map.delete(selected.id)
        setSelected(null)
        loadTree()
      },
    })
  }

  const handleAddRoot = async () => {
    await window.electron.map.create(novelId, { level: 1, name: '新区域' })
    loadTree()
  }

  const handleAddChild = async (parentItem: WorldMapItem) => {
    const newLevel = parentItem.level + 1
    if (newLevel > 3) { message.warning('最多支持三级地图'); return }
    await window.electron.map.create(novelId, {
      level: newLevel,
      parentId: parentItem.id,
      name: newLevel === 2 ? '新区域' : '新地点',
    })
    loadTree()
  }

  const handleBatchGenerate = async () => {
    setBatchLoading(true)
    try {
      const values = batchForm.getFieldsValue()
      await window.electron.map.batchGenerate(novelId, {
        level1Count: values.level1Count || 2,
        level2Count: values.level2Count || 3,
        level3Count: values.level3Count || 3,
        namedPlaces: values.namedPlaces || '',
      })
      setBatchOpen(false)
      batchForm.resetFields()
      loadTree()
      message.success('地图生成完成')
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setBatchLoading(false)
    }
  }

  const { nodes, edges } = buildFlowGraph(treeData)

  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      {/* 顶部视图切换 */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>地图管理</span>
        <div style={{ flex: 1 }} />
        <Button.Group>
          <Button
            type={viewMode === 'tree' ? 'primary' : 'default'}
            icon={<UnorderedListOutlined />}
            onClick={() => setViewMode('tree')}
          >
            树形
          </Button>
          <Button
            type={viewMode === 'graph' ? 'primary' : 'default'}
            icon={<ShareAltOutlined />}
            onClick={() => setViewMode('graph')}
          >
            图谱
          </Button>
        </Button.Group>
        <Button size="small" icon={<ApartmentOutlined />} onClick={() => setBatchOpen(true)}>
          批量生成
        </Button>
        <Button size="small" icon={<PlusOutlined />} onClick={handleAddRoot} />
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {viewMode === 'tree' ? (
          <>
            {/* 左侧树形 */}
            <div style={{
              width: 260,
              borderRight: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--color-bg-secondary)',
            }}>
              <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
                ) : treeData.length === 0 ? (
                  <Empty
                    description="暂无地图数据"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    style={{ margin: '40px 0' }}
                  />
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

            {/* 右侧详情 */}
            <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
              {selected ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                    <h3 style={{ color: 'var(--color-text-primary)', margin: 0 }}>
                      编辑：{selected.name}
                      <span style={{ color: 'var(--color-text-muted)', fontSize: 12, marginLeft: 8 }}>
                        第{selected.level}级
                      </span>
                    </h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {selected.level < 3 && (
                        <Button size="small" icon={<PlusOutlined />} onClick={() => handleAddChild(selected)}>
                          添加子节点
                        </Button>
                      )}
                      <Button size="small" danger icon={<DeleteOutlined />} onClick={handleDelete}>删除</Button>
                      <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveDetail}>保存</Button>
                    </div>
                  </div>

                  <Form form={detailForm} layout="vertical">
                    <Form.Item name="name" label="名称">
                      <Input />
                    </Form.Item>
                    {selected.level === 3 && (
                      <Form.Item name="locationType" label="地点类型">
                        <Input placeholder="城市/建筑/自然地貌/星球等" />
                      </Form.Item>
                    )}
                    <Form.Item name="description" label="描述">
                      <Input.TextArea rows={5} placeholder="地点的外观、特征描述" />
                    </Form.Item>
                    <Form.Item name="atmosphere" label="氛围基调">
                      <Input placeholder="例如：神秘压抑、繁华喧嚣、荒凉萧瑟" />
                    </Form.Item>
                    <Form.Item name="plotRelevance" label="剧情关联">
                      <Input.TextArea rows={5} placeholder="这个地点在故事中的作用，会发生什么重要事件" />
                    </Form.Item>
                  </Form>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <Empty description="选择左侧地点进行编辑" />
                </div>
              )}
            </div>
          </>
        ) : (
          /* 图谱视图 */
          <div style={{ flex: 1, position: 'relative' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
            ) : treeData.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Empty description="暂无地图数据，请先添加或批量生成" />
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
        )}
      </div>

      {/* 批量生成 Modal */}
      <Modal
        title="批量生成地图"
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={handleBatchGenerate}
        confirmLoading={batchLoading}
        okText="开始生成"
      >
        <Form form={batchForm} layout="vertical">
          <Form.Item name="level1Count" label="第一级数量（国家/大区域）" initialValue={2}>
            <Select options={[1,2,3,4,5].map(n => ({ value: n, label: `${n} 个` }))} />
          </Form.Item>
          <Form.Item name="level2Count" label="每个一级下的二级数量（区域）" initialValue={3}>
            <Select options={[2,3,4,5].map(n => ({ value: n, label: `${n} 个` }))} />
          </Form.Item>
          <Form.Item name="level3Count" label="每个二级下的三级数量（具体地点）" initialValue={3}>
            <Select options={[2,3,4,5].map(n => ({ value: n, label: `${n} 个` }))} />
          </Form.Item>
          <Form.Item name="namedPlaces" label="已知地点名称（每行一个，可留空）">
            <Input.TextArea rows={5} placeholder="如：长安城&#10;西域&#10;蓬莱仙岛" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
