import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Form, Input, Select, Space, Spin, Tag, message } from 'antd'
import { SaveOutlined, EditOutlined } from '@ant-design/icons'
import { useNovelStore } from '../../../stores/novel.store'
import type {
  Chapter,
  ChapterContractAsset,
  EndgameCommitment,
  ForeshadowLedgerEntry,
  SceneContractAsset,
  StoryThread,
} from '../../../types'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceStepGuide,
} from '../components/WorkspaceShell'

interface Props {
  novelId: number
}

interface ChapterContractFormValues {
  chapterGoal: string
  servedThreadIds: number[]
  requiredArcProgressText: string
  requiredAssetRefsText: string
  requiredEndgameCommitmentIds: number[]
  requiredForeshadowIds: number[]
  hookType: string
  forbiddenActionsText: string
  acceptanceNotesText: string
  status: string
}

function splitLines(value?: string): string[] {
  return (value || '')
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildChapterFormValues(contract?: ChapterContractAsset | null): ChapterContractFormValues {
  return {
    chapterGoal: contract?.chapterGoal || '',
    servedThreadIds: contract?.servedThreadIds || [],
    requiredArcProgressText: (contract?.requiredArcProgress || []).join('\n'),
    requiredAssetRefsText: (contract?.requiredAssetRefs || []).join('\n'),
    requiredEndgameCommitmentIds: contract?.requiredEndgameCommitmentIds || [],
    requiredForeshadowIds: contract?.requiredForeshadowIds || [],
    hookType: contract?.hookType || '',
    forbiddenActionsText: (contract?.forbiddenActions || []).join('\n'),
    acceptanceNotesText: (contract?.acceptanceNotes || []).join('\n'),
    status: contract?.status || 'draft',
  }
}

export default function ContractsPage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel } = useNovelStore()
  const [form] = Form.useForm<ChapterContractFormValues>()
  const [loading, setLoading] = useState(true)
  const [savingChapter, setSavingChapter] = useState(false)
  const [sceneSavingId, setSceneSavingId] = useState<number | 'chapterless' | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [threads, setThreads] = useState<StoryThread[]>([])
  const [commitments, setCommitments] = useState<EndgameCommitment[]>([])
  const [foreshadows, setForeshadows] = useState<ForeshadowLedgerEntry[]>([])
  const [chapterContract, setChapterContract] = useState<ChapterContractAsset | null>(null)
  const [sceneContracts, setSceneContracts] = useState<SceneContractAsset[]>([])
  const [activeChapterId, setActiveChapterId] = useState<number | null>(null)

  const loadBaseData = async () => {
    const [chapterRows, threadRows, commitmentRows, foreshadowRows] = await Promise.all([
      window.electron.chapter.list(novelId),
      window.electron.thread.list(novelId),
      window.electron.endgameAsset.listCommitments(novelId),
      window.electron.foreshadow.listLedger(novelId),
    ])
    setChapters(chapterRows)
    setThreads(threadRows)
    setCommitments(commitmentRows.filter((item) => item.derivedStatus !== 'waived'))
    setForeshadows(foreshadowRows)
    setActiveChapterId((current) => current ?? chapterRows[0]?.id ?? null)
  }

  const loadChapterData = async (chapterId: number) => {
    const [contract, scenes] = await Promise.all([
      window.electron.contract.getChapter(chapterId),
      window.electron.contract.listScenes(chapterId),
    ])
    setChapterContract(contract)
    setSceneContracts(scenes)
    form.setFieldsValue(buildChapterFormValues(contract))
  }

  const refreshAll = async () => {
    setLoading(true)
    try {
      await loadBaseData()
    } catch (error) {
      console.error(error)
      message.error('合同数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [novelId])

  useEffect(() => {
    if (!activeChapterId) return
    void loadChapterData(activeChapterId).catch((error) => {
      console.error(error)
      message.error('章节合同加载失败')
    })
  }, [activeChapterId])

  const activeChapter = useMemo(
    () => chapters.find((item) => item.id === activeChapterId) || null,
    [activeChapterId, chapters],
  )

  const handleSaveChapterContract = async () => {
    if (!activeChapterId) return
    const values = await form.validateFields()
    setSavingChapter(true)
    try {
      const result = await window.electron.contract.upsertChapter(activeChapterId, {
        chapterGoal: values.chapterGoal,
        servedThreadIds: values.servedThreadIds,
        requiredArcProgress: splitLines(values.requiredArcProgressText),
        requiredAssetRefs: splitLines(values.requiredAssetRefsText),
        requiredEndgameCommitmentIds: values.requiredEndgameCommitmentIds,
        requiredForeshadowIds: values.requiredForeshadowIds,
        hookType: values.hookType,
        forbiddenActions: splitLines(values.forbiddenActionsText),
        acceptanceNotes: splitLines(values.acceptanceNotesText),
        status: values.status,
      })
      setChapterContract(result)
      message.success('章节合同已保存')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '章节合同保存失败')
    } finally {
      setSavingChapter(false)
    }
  }

  const handleSceneChange = (
    sceneId: number | undefined,
    patch: Partial<SceneContractAsset>,
  ) => {
    setSceneContracts((current) => current.map((item) => (
      item.segmentId === sceneId
        ? { ...item, ...patch }
        : item
    )))
  }

  const handleSaveScene = async (scene: SceneContractAsset) => {
    if (!activeChapterId) return
    setSceneSavingId(scene.segmentId ?? 'chapterless')
    try {
      const result = await window.electron.contract.upsertScene(activeChapterId, scene.segmentId ?? null, {
        pov: scene.pov,
        timeLocation: scene.timeLocation,
        sceneGoal: scene.sceneGoal,
        obstacle: scene.obstacle,
        conflictType: scene.conflictType,
        emotionShift: scene.emotionShift,
        revealPayload: scene.revealPayload,
        resultState: scene.resultState,
        linkageMode: scene.linkageMode,
        requiredEndgameCommitmentIds: scene.requiredEndgameCommitmentIds,
        requiredForeshadowIds: scene.requiredForeshadowIds,
        status: scene.status,
      })
      setSceneContracts(result)
      message.success(`场景合同已保存${scene.segmentOrder ? ` · 场景 ${scene.segmentOrder}` : ''}`)
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '场景合同保存失败')
    } finally {
      setSceneSavingId(null)
    }
  }

  if (loading) {
    return (
      <WorkspacePage title="章节合同与场景合同">
        <WorkspacePanel title="正在加载合同数据">
          <Spin />
        </WorkspacePanel>
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage
      eyebrow="章节合同 / 场景合同"
      title="章节合同与场景合同"
      description="把大纲前的约束变成显式合同，让写作链路优先遵守本章目标、终局承诺和场景限制。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={savingChapter} onClick={() => void handleSaveChapterContract()}>
            保存章节合同
          </Button>
          <Button icon={<EditOutlined />} onClick={() => navigate(`/novels/${novelId}/writing`)}>
            去正文写作
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '章节数', value: chapters.length > 0 ? `${chapters.length} 章` : '未建章' },
            { label: '终局承诺', value: commitments.length > 0 ? `${commitments.length} 条` : '未同步' },
            { label: '伏笔账本', value: foreshadows.length > 0 ? `${foreshadows.length} 条` : '未建立' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="当前章节" value={activeChapter ? `第${activeChapter.chapterNum}章` : '未选择'} tone="warm" />
          <WorkspaceMetric label="场景合同数" value={sceneContracts.length} />
          <WorkspaceMetric label="章节绑定终局项" value={chapterContract?.requiredEndgameCommitmentIds.length || 0} tone="cool" />
        </>
      )}
      guide={(
        <WorkspaceStepGuide
          steps={[
            { title: '先定本章目标', description: '先把本章目标、禁止事项和验收要求写清。', status: 'focus' },
            { title: '绑定终局与伏笔', description: '直接选择本章必须服务的终局承诺和伏笔账本条目。', status: 'todo' },
            { title: '逐场景拆合同', description: '每个场景至少锁 POV、目标、障碍和结果状态。', status: 'todo' },
          ]}
        />
      )}
    >
      {commitments.length <= 0 ? (
        <Alert
          type="warning"
          showIcon
          message="终局承诺还没同步"
          description="先去终局设计保存并同步承诺，否则章节合同无法直接绑定终局约束。"
        />
      ) : null}

      <WorkspacePanel title="章节选择" description="合同按章维护。写作前先把当前章的显式约束补齐。">
        <Select
          value={activeChapterId ?? undefined}
          onChange={(value) => setActiveChapterId(value)}
          style={{ minWidth: 320 }}
          options={chapters.map((item) => ({
            value: item.id,
            label: `第${item.chapterNum}章 ${item.title || ''}`.trim(),
          }))}
          placeholder="选择章节"
        />
      </WorkspacePanel>

      <WorkspacePanel title="章节合同" description="本章必须完成什么、不能做什么、验收时要看什么。">
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="chapterGoal" label="本章目标">
                <Input.TextArea rows={4} placeholder="写这一章写完后，主线、人物或局势必须发生什么变化。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="servedThreadIds" label="服务的故事线程">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章直接推进的线程"
                  options={threads.map((item) => ({
                    value: item.id,
                    label: item.title,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="hookType" label="结尾钩子类型">
                <Input placeholder="例如：信息反转 / 危机升级 / 情绪留钩" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredArcProgressText" label="必须推进的弧线">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n主角第一次承认自身代价\n反派开始反向布局'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredAssetRefsText" label="必须出现的资产 / 线索">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n旧城通行证\n失灵通讯器\n第八章留下的血迹'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredEndgameCommitmentIds" label="必须服务的终局承诺">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章必须服务的终局承诺"
                  options={commitments.map((item) => ({
                    value: item.id,
                    label: `${item.commitmentKind === 'payoff' ? '回收' : '承诺'} · ${item.title}`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredForeshadowIds" label="必须处理的伏笔账本">
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="选择本章必须埋设或回收的伏笔"
                  options={foreshadows.map((item) => ({
                    value: item.id,
                    label: item.title,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="forbiddenActionsText" label="本章禁止做什么">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n不能提前揭穿幕后真相\n不能让主角无代价脱困'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="acceptanceNotesText" label="章节验收要求">
                <Input.TextArea rows={5} placeholder={'建议每行一条，例如：\n结尾必须留下下一章的紧迫问题\n本章冲突必须真实付出代价'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="status" label="合同状态">
                <Select
                  options={[
                    { value: 'draft', label: '草稿' },
                    { value: 'ready', label: '可执行' },
                    { value: 'locked', label: '锁定' },
                  ]}
                />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel title="场景合同" description="按场景锁 POV、目标、障碍、揭示和结果状态。">
        {sceneContracts.length <= 0 ? (
          <Alert type="info" showIcon message="当前章节还没有场景" description="先在结构规划里拆好场景，再回来逐场景补合同。" />
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {sceneContracts.map((scene) => (
              <div
                key={scene.segmentId || scene.id || scene.segmentTitle}
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.03)',
                  padding: 16,
                  display: 'grid',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong>{scene.segmentTitle}</strong>
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      {`章节 ${scene.chapterNum}${typeof scene.segmentOrder === 'number' ? ` · 场景 ${scene.segmentOrder}` : ''}`}
                    </span>
                  </div>
                  <Space wrap>
                    <Tag color={scene.status === 'locked' ? 'green' : scene.status === 'ready' ? 'blue' : 'default'}>
                      {scene.status || 'draft'}
                    </Tag>
                    <Button
                      type="primary"
                      size="small"
                      loading={sceneSavingId === (scene.segmentId ?? 'chapterless')}
                      onClick={() => void handleSaveScene(scene)}
                    >
                      保存场景合同
                    </Button>
                  </Space>
                </div>

                <div className="guided-step__field-grid">
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>POV</div>
                    <Input value={scene.pov} onChange={(event) => handleSceneChange(scene.segmentId, { pov: event.target.value })} placeholder="写当前场景视角人物" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>时间 / 地点</div>
                    <Input value={scene.timeLocation} onChange={(event) => handleSceneChange(scene.segmentId, { timeLocation: event.target.value })} placeholder="写当前场景的时间与地点" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>场景目标</div>
                    <Input.TextArea rows={3} value={scene.sceneGoal} onChange={(event) => handleSceneChange(scene.segmentId, { sceneGoal: event.target.value })} placeholder="这一场要拿到什么、推进什么。" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>障碍</div>
                    <Input.TextArea rows={3} value={scene.obstacle} onChange={(event) => handleSceneChange(scene.segmentId, { obstacle: event.target.value })} placeholder="阻碍当前场景目标实现的压力或代价。" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>冲突类型</div>
                    <Input value={scene.conflictType} onChange={(event) => handleSceneChange(scene.segmentId, { conflictType: event.target.value })} placeholder="外部对撞 / 心理冲突 / 信息博弈" />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>情绪变化</div>
                    <Input value={scene.emotionShift} onChange={(event) => handleSceneChange(scene.segmentId, { emotionShift: event.target.value })} placeholder="紧绷 -> 失衡 -> 硬撑" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>信息揭示</div>
                    <Input.TextArea
                      rows={4}
                      value={scene.revealPayload.join('\n')}
                      onChange={(event) => handleSceneChange(scene.segmentId, { revealPayload: splitLines(event.target.value) })}
                      placeholder={'建议每行一条，例如：\n反派提前知道路线\n旧伤不是意外造成'}
                    />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>结果状态</div>
                    <Input.TextArea rows={3} value={scene.resultState} onChange={(event) => handleSceneChange(scene.segmentId, { resultState: event.target.value })} placeholder="这一场结束后人物和局势处于什么状态。" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>衔接方式</div>
                    <Input value={scene.linkageMode} onChange={(event) => handleSceneChange(scene.segmentId, { linkageMode: event.target.value })} placeholder="悬念续接 / 情绪余波 / 行动转场" />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>终局承诺绑定</div>
                    <Select
                      mode="multiple"
                      allowClear
                      value={scene.requiredEndgameCommitmentIds}
                      onChange={(value) => handleSceneChange(scene.segmentId, { requiredEndgameCommitmentIds: value })}
                      options={commitments.map((item) => ({
                        value: item.id,
                        label: `${item.commitmentKind === 'payoff' ? '回收' : '承诺'} · ${item.title}`,
                      }))}
                    />
                  </div>
                  <div className="guided-step__field-card">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>伏笔账本绑定</div>
                    <Select
                      mode="multiple"
                      allowClear
                      value={scene.requiredForeshadowIds}
                      onChange={(value) => handleSceneChange(scene.segmentId, { requiredForeshadowIds: value })}
                      options={foreshadows.map((item) => ({
                        value: item.id,
                        label: item.title,
                      }))}
                    />
                  </div>
                  <div className="guided-step__field-card guided-step__field-card--compact">
                    <div style={{ marginBottom: 8, fontWeight: 600 }}>状态</div>
                    <Select
                      value={scene.status}
                      onChange={(value) => handleSceneChange(scene.segmentId, { status: value })}
                      options={[
                        { value: 'draft', label: '草稿' },
                        { value: 'ready', label: '可执行' },
                        { value: 'locked', label: '锁定' },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </WorkspacePanel>
    </WorkspacePage>
  )
}
