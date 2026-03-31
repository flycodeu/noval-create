import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { EditOutlined, PlusOutlined, ReloadOutlined, DeleteOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type { NovelConsistencyReport, NovelContextStatus, RevisionTask } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'

interface Props {
  novelId: number
}

interface RevisionTaskFormValues {
  taskType: string
  title: string
  description: string
  fixBrief: string
  status: RevisionTask['status']
  severity: RevisionTask['severity']
  relatedPage: string
}

const STATUS_OPTIONS = [
  { value: 'open', label: '待处理' },
  { value: 'in_progress', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'ignored', label: '忽略' },
]

const SEVERITY_OPTIONS = [
  { value: 'high', label: '高优先' },
  { value: 'medium', label: '中优先' },
  { value: 'low', label: '低优先' },
]

const RELATED_PAGE_OPTIONS = [
  { value: 'project-brief', label: '项目立项' },
  { value: 'core-settings', label: '基础设定' },
  { value: 'theme-voice', label: '主题与文风' },
  { value: 'world-rules', label: '世界规则' },
  { value: 'map', label: '地图结构' },
  { value: 'characters', label: '角色系统' },
  { value: 'items', label: '物品装备' },
  { value: 'threads', label: '故事线程' },
  { value: 'story-design', label: '故事设计' },
  { value: 'outline', label: '故事大纲' },
  { value: 'timeline', label: '时间轴' },
  { value: 'writing', label: '正文写作' },
  { value: 'revision', label: '修订中心' },
]

const EMPTY_VALUES: RevisionTaskFormValues = {
  taskType: 'continuity',
  title: '',
  description: '',
  fixBrief: '',
  status: 'open',
  severity: 'medium',
  relatedPage: 'writing',
}

function getStatusColor(status: RevisionTask['status']) {
  if (status === 'resolved') return 'success'
  if (status === 'in_progress') return 'processing'
  if (status === 'ignored') return 'default'
  return 'blue'
}

function getSeverityColor(severity: RevisionTask['severity']) {
  if (severity === 'high') return 'error'
  if (severity === 'low') return 'default'
  return 'gold'
}

function getSourceColor(source: RevisionTask['taskSource']) {
  return source === 'system' ? 'purple' : 'cyan'
}

function getSourceLabel(source: RevisionTask['taskSource']) {
  return source === 'system' ? '系统' : '人工'
}

function getStatusLabel(status: RevisionTask['status']) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status
}

function getSeverityLabel(severity: RevisionTask['severity']) {
  return SEVERITY_OPTIONS.find((item) => item.value === severity)?.label || severity
}

function buildIssueSummary(report: NovelConsistencyReport | null) {
  if (!report || report.issues.length === 0) return '当前没有高价值诊断摘要。'
  return report.issues.slice(0, 5).map((issue) => `${issue.severity}：${issue.title}`).join('\n')
}

export default function RevisionCenterPage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel } = useNovelStore()
  const [form] = Form.useForm<RevisionTaskFormValues>()
  const [tasks, setTasks] = useState<RevisionTask[]>([])
  const [stats, setStats] = useState({ total: 0, openCount: 0, inProgressCount: 0, resolvedCount: 0, blockerCount: 0 })
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionKey, setActionKey] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<RevisionTask | null>(null)
  const [sourceFilter, setSourceFilter] = useState<'all' | RevisionTask['taskSource']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | RevisionTask['status']>('all')
  const [keyword, setKeyword] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [snapshot, nextContextStatus, report] = await Promise.all([
        window.electron.revision.getSnapshot(novelId),
        window.electron.novel.getContextStatus(novelId),
        window.electron.novel.runConsistencyCheck(novelId),
      ])
      setTasks(snapshot.tasks)
      setStats(snapshot.stats)
      setContextStatus(nextContextStatus)
      setConsistencyReport(report)
    } catch (error) {
      console.error(error)
      message.error('修订中心加载失败。')
    } finally {
      setLoading(false)
    }
  }, [novelId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visibleTasks = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    return tasks.filter((task) => {
      if (sourceFilter !== 'all' && task.taskSource !== sourceFilter) return false
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (!normalizedKeyword) return true
      const haystack = [task.title, task.description, task.fixBrief, task.relatedPage]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedKeyword)
    })
  }, [keyword, sourceFilter, statusFilter, tasks])

  const manualCount = useMemo(
    () => tasks.filter((task) => task.taskSource === 'manual').length,
    [tasks],
  )
  const systemCount = tasks.length - manualCount
  const taskDraftButton = (
    <AIGenerateButton
      label="AI 起草任务"
      isJson
      buildMessages={() => {
        const values = form.getFieldsValue(true)
        return buildDraftMessages({
          task: '人工修订任务',
          mode: values.title ? 'optimize' : 'replace',
          context: [
            { label: '小说名', value: currentNovel?.title || '' },
            { label: '题材', value: currentNovel?.genreName || '' },
            { label: '待同步章节', value: contextStatus?.staleChapterCount ?? 0 },
            { label: '高优先问题', value: consistencyReport?.highCount ?? 0 },
            { label: '诊断摘要', value: buildIssueSummary(consistencyReport) },
          ],
          fields: [
            { key: 'taskType', label: '任务类型', value: values.taskType, hint: '例如 continuity、timeline、character、map。' },
            { key: 'title', label: '任务标题', value: values.title, hint: '一句话说清要修什么。' },
            { key: 'description', label: '问题描述', value: values.description, hint: '写清问题和影响范围。' },
            { key: 'fixBrief', label: '修订方案', value: values.fixBrief, hint: '写成可执行的检查清单或修订动作。' },
            { key: 'status', label: '状态', value: values.status, hint: '只用 open、in_progress、resolved、ignored 之一。' },
            { key: 'severity', label: '优先级', value: values.severity, hint: '只用 high、medium、low 之一。' },
            { key: 'relatedPage', label: '关联页面', value: values.relatedPage, hint: '只填已有页面键，例如 writing、timeline、outline。' },
          ],
          requirements: [
            '只生成人工任务，不要复述系统提示原文。',
            '标题和方案都要具体，不要写空泛的“完善设定”“优化逻辑”。',
          ],
        })
      }}
      onResult={(raw) => {
        const draft = parseDraftJson<Record<string, unknown>>(raw)
        const currentValues = form.getFieldsValue(true)
        form.setFieldsValue({
          ...currentValues,
          taskType: typeof draft.taskType === 'string' ? draft.taskType : currentValues.taskType,
          title: typeof draft.title === 'string' ? draft.title : currentValues.title,
          description: typeof draft.description === 'string' ? draft.description : currentValues.description,
          fixBrief: typeof draft.fixBrief === 'string' ? draft.fixBrief : currentValues.fixBrief,
          status: typeof draft.status === 'string' ? draft.status as RevisionTask['status'] : currentValues.status,
          severity: typeof draft.severity === 'string' ? draft.severity as RevisionTask['severity'] : currentValues.severity,
          relatedPage: typeof draft.relatedPage === 'string' ? draft.relatedPage : currentValues.relatedPage,
        })
      }}
    />
  )

  const openEditor = (task?: RevisionTask) => {
    setEditingTask(task || null)
    form.setFieldsValue(task ? {
      taskType: task.taskType || 'continuity',
      title: task.title,
      description: task.description || '',
      fixBrief: task.fixBrief || '',
      status: task.status,
      severity: task.severity,
      relatedPage: task.relatedPage || 'writing',
    } : EMPTY_VALUES)
    setModalOpen(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)

    try {
      if (editingTask) {
        await window.electron.revision.update(editingTask.id, values)
      } else {
        await window.electron.revision.create(novelId, values)
      }
      setModalOpen(false)
      setEditingTask(null)
      message.success(editingTask ? '修订任务已更新。' : '修订任务已创建。')
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(editingTask ? '修订任务更新失败。' : '修订任务创建失败。')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (task: RevisionTask) => {
    if (task.taskSource !== 'manual') return
    try {
      await window.electron.revision.delete(task.id)
      message.success('修订任务已删除。')
      await refresh()
    } catch (error) {
      console.error(error)
      message.error('修订任务删除失败。')
    }
  }

  const handleQuickStatus = async (task: RevisionTask, status: RevisionTask['status']) => {
    setActionKey(`status:${task.id}:${status}`)
    try {
      await window.electron.revision.update(task.id, { status })
      message.success('修订任务状态已更新。')
      await refresh()
    } catch (error) {
      console.error(error)
      message.error('修订任务状态更新失败。')
    } finally {
      setActionKey(null)
    }
  }

  const handleAutoFix = async (task: RevisionTask) => {
    setActionKey(`autofix:${task.id}`)
    try {
      const result = await window.electron.revision.autoFix(task.id)
      if (result.status === 'failed') {
        message.error(result.message)
      } else if (result.status === 'unsupported') {
        message.warning(result.message)
      } else {
        message.success(result.message)
      }
      await refresh()
    } catch (error) {
      console.error(error)
      message.error('AI 修复执行失败。')
    } finally {
      setActionKey(null)
    }
  }

  const openRelatedPage = (task: RevisionTask) => {
    navigate(`/novels/${novelId}/${task.relatedPage || 'revision'}`)
  }

  const columns = useMemo<ColumnsType<RevisionTask>>(() => [
    {
      title: '任务',
      key: 'title',
      render: (_, record) => (
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{record.title}</strong>
            <Tag color={getSourceColor(record.taskSource)}>{getSourceLabel(record.taskSource)}</Tag>
            <Tag color={getSeverityColor(record.severity)}>{getSeverityLabel(record.severity)}</Tag>
            <Tag color={getStatusColor(record.status)}>{getStatusLabel(record.status)}</Tag>
          </div>
          <div style={{ marginTop: 6, color: 'var(--color-text-muted)', fontSize: 12 }}>
            {record.description || record.fixBrief || '当前还没有补充说明。'}
          </div>
          {record.fixBrief ? (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              <strong>建议：</strong>
              {record.fixBrief}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '定位页',
      dataIndex: 'relatedPage',
      key: 'relatedPage',
      width: 150,
      render: (value) => RELATED_PAGE_OPTIONS.find((item) => item.value === value)?.label || value || '修订中心',
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (value) => value ? new Date(value).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 320,
      render: (_, record) => (
        <Space wrap>
          <Button size="small" icon={<ArrowRightOutlined />} onClick={() => openRelatedPage(record)}>
            打开页面
          </Button>
          {record.taskSource === 'manual' ? (
            <>
              <Button size="small" onClick={() => openEditor(record)}>编辑</Button>
              {record.status !== 'resolved' ? (
                <Button
                  size="small"
                  loading={actionKey === `status:${record.id}:resolved`}
                  onClick={() => void handleQuickStatus(record, 'resolved')}
                >
                  标记解决
                </Button>
              ) : null}
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDelete(record)} />
            </>
          ) : (
            <>
              {record.autoFixable ? (
                <Button
                  size="small"
                  type="primary"
                  loading={actionKey === `autofix:${record.id}`}
                  onClick={() => void handleAutoFix(record)}
                >
                  AI 修复
                </Button>
              ) : null}
              {record.status === 'ignored' ? (
                <Button
                  size="small"
                  loading={actionKey === `status:${record.id}:open`}
                  onClick={() => void handleQuickStatus(record, 'open')}
                >
                  恢复
                </Button>
              ) : (
                <Button
                  size="small"
                  loading={actionKey === `status:${record.id}:ignored`}
                  onClick={() => void handleQuickStatus(record, 'ignored')}
                >
                  忽略
                </Button>
              )}
              {record.status !== 'resolved' ? (
                <Button
                  size="small"
                  loading={actionKey === `status:${record.id}:resolved`}
                  onClick={() => void handleQuickStatus(record, 'resolved')}
                >
                  标记完成
                </Button>
              ) : null}
            </>
          )}
        </Space>
      ),
    },
  ], [actionKey, handleAutoFix, handleDelete, handleQuickStatus, openRelatedPage])

  return (
    <WorkspacePage
      className="novel-revision-center-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="修订中心"
      title="修订中心"
      description="系统诊断和人工修订任务放在同一张任务板里。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新建人工任务
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新诊断
          </Button>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/writing`)}>
            去正文页
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '未处理任务', value: stats.openCount + stats.inProgressCount },
            { label: '待同步章节', value: contextStatus ? contextStatus.staleChapterCount : '加载中' },
            { label: '高优先问题', value: consistencyReport ? consistencyReport.highCount : '加载中' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="阻塞项" value={stats.blockerCount} tone="warm" hint="高优先且仍未解决的问题，会直接影响后续章节稳定性。" />
          <WorkspaceMetric label="待处理" value={stats.openCount} hint="还没有开始处理的任务。" />
          <WorkspaceMetric label="处理中" value={stats.inProgressCount} hint="正在回查和修正的任务。" />
          <WorkspaceMetric label="人工 / 系统" value={`${manualCount} / ${systemCount}`} hint="系统任务支持忽略、恢复和 AI 修复；人工任务支持自由编辑。" />
        </>
      )}
      aside={(
        <>
          {consistencyReport && (
            <WorkspacePanel title="当前体检" description={consistencyReport.overview}>
              <div className="novel-note-list">
                <div className="novel-note-list__item">{`体检分数：${consistencyReport.readinessScore}`}</div>
                <div className="novel-note-list__item">{`高优先：${consistencyReport.highCount}`}</div>
                <div className="novel-note-list__item">{`中优先：${consistencyReport.mediumCount}`}</div>
                <div className="novel-note-list__item">{`低优先：${consistencyReport.lowCount}`}</div>
              </div>
            </WorkspacePanel>
          )}
        </>
      )}
    >
      {stats.blockerCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`当前有 ${stats.blockerCount} 个阻塞项需要优先处理`}
          description="建议优先处理。"
        />
      ) : null}

      {contextStatus && contextStatus.staleChapterCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`有 ${contextStatus.staleChapterCount} 章仍在引用旧上下文`}
          description="建议先回查这些章节。"
        />
      ) : null}

      <WorkspacePanel title="修订任务板" description="按来源、状态和关键词过滤。">
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Select
              value={sourceFilter}
              style={{ width: 140 }}
              options={[
                { value: 'all', label: '全部来源' },
                { value: 'system', label: '系统任务' },
                { value: 'manual', label: '人工任务' },
              ]}
              onChange={(value) => setSourceFilter(value)}
            />
            <Select
              value={statusFilter}
              style={{ width: 140 }}
              options={[
                { value: 'all', label: '全部状态' },
                ...STATUS_OPTIONS,
              ]}
              onChange={(value) => setStatusFilter(value)}
            />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索任务标题、说明或建议"
              style={{ maxWidth: 320 }}
            />
          </div>

          <Table
            rowKey="id"
            loading={loading}
            columns={columns}
            dataSource={visibleTasks}
            pagination={false}
          />
        </div>
      </WorkspacePanel>

      {consistencyReport ? (
        <WorkspacePanel title="系统体检摘要" description="系统任务会根据这些结果自动生成。">
          <div className="novel-issue-list">
            {consistencyReport.issues.slice(0, 6).map((issue) => (
              <div key={issue.id} className="novel-issue-item">
                <div className="novel-issue-item__head">
                  <Tag color={getSeverityColor(issue.severity)}>{getSeverityLabel(issue.severity)}</Tag>
                  <strong>{issue.title}</strong>
                </div>
                <div className="novel-issue-item__desc">{issue.description}</div>
                <div className="novel-issue-item__suggestion">建议：{issue.suggestion}</div>
              </div>
            ))}
          </div>
        </WorkspacePanel>
      ) : null}

      <Modal
        title={editingTask ? '编辑人工修订任务' : '新建人工修订任务'}
        open={modalOpen}
        forceRender
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText={editingTask ? '保存修改' : '创建任务'}
        width={760}
      >
        <div style={{ marginBottom: 12 }}>
          {taskDraftButton}
        </div>
        <Form form={form} layout="vertical" initialValues={EMPTY_VALUES}>
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="taskType" label="任务类型" rules={[{ required: true, message: '请填写任务类型' }]}>
                <Input placeholder="例如：continuity / character / timeline" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="status" label="当前状态" rules={[{ required: true, message: '请选择状态' }]}>
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="severity" label="优先级" rules={[{ required: true, message: '请选择优先级' }]}>
                <Select options={SEVERITY_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请填写任务标题' }]}>
                <Input placeholder="例如：回查第 18 章人物动机 / 统一补给线时间顺序" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="description" label="问题描述">
                <Input.TextArea rows={4} placeholder="写清具体问题、影响范围和现状。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="fixBrief" label="修订方案 / 检查清单">
                <Input.TextArea rows={4} placeholder="写清修订动作，例如需要回查哪些章节、人物、时间轴或线程。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="relatedPage" label="关联页面">
                <Select options={RELATED_PAGE_OPTIONS} />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
