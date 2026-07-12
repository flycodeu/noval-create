import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  message,
} from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type {
  Chapter,
  Character,
  StoryFact,
  StoryFactCharacterKnowledge,
  StoryVolume,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import './index.css'

interface Props {
  novelId: number
}

interface StoryFactFormValues {
  kind: StoryFact['kind']
  title: string
  summary: string
  status: StoryFact['status']
  volumeId?: number
  relatedPuzzleId?: number
  readerKnownChapterId?: number
  protagonistKnownChapterId?: number
  forbiddenBeforeVolume?: number
  plannedRevealVolume?: number
  targetRevealChapterId?: number
  isKeyTruth: boolean
  notes: string
  characterKnowledgeList: StoryFactCharacterKnowledge[]
}

interface StoryFactAIDraft {
  kind: StoryFact['kind']
  title: string
  summary: string
  status: StoryFact['status']
  plannedRevealVolume?: number
  targetRevealChapterNum?: number
  notes: string
  isKeyTruth?: boolean | string
}

const STATUS_LANES: Array<{ key: StoryFact['status']; label: string; hint: string }> = [
  { key: 'introduced', label: '已出现', hint: '读者已见到，但尚未形成完整解释。' },
  { key: 'partial_reveal', label: '半揭示', hint: '已有关键信息泄露，但真相未闭环。' },
  { key: 'pending_payoff', label: '待回收', hint: '线索或假线索需要后续章节回收。' },
  { key: 'explained', label: '已解释', hint: '谜题已被完整解释或真相已落地。' },
]

const KIND_OPTIONS: Array<{ value: StoryFact['kind']; label: string }> = [
  { value: 'puzzle', label: '谜题' },
  { value: 'clue', label: '线索' },
  { value: 'truth', label: '真相' },
  { value: 'red_herring', label: '假线索' },
]

const STATUS_OPTIONS: Array<{ value: StoryFact['status']; label: string }> = [
  { value: 'introduced', label: '已出现' },
  { value: 'partial_reveal', label: '半揭示' },
  { value: 'pending_payoff', label: '待回收' },
  { value: 'explained', label: '已解释' },
]

const EMPTY_FACT_FORM: StoryFactFormValues = {
  kind: 'clue',
  title: '',
  summary: '',
  status: 'introduced',
  volumeId: undefined,
  relatedPuzzleId: undefined,
  readerKnownChapterId: undefined,
  protagonistKnownChapterId: undefined,
  forbiddenBeforeVolume: undefined,
  plannedRevealVolume: undefined,
  targetRevealChapterId: undefined,
  isKeyTruth: true,
  notes: '',
  characterKnowledgeList: [],
}

function parseCharacterKnowledgeJson(raw?: string | null): StoryFactCharacterKnowledge[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const normalized: StoryFactCharacterKnowledge[] = []
    parsed.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const record = entry as Record<string, unknown>
      const characterId = Number(record.characterId)
      if (!Number.isFinite(characterId) || characterId <= 0) return
      const knownChapterId = Number(record.knownChapterId)
      normalized.push({
        characterId,
        knownChapterId: Number.isFinite(knownChapterId) && knownChapterId > 0
          ? knownChapterId
          : null,
      })
    })
    return normalized
  } catch {
    return []
  }
}

function stringifyCharacterKnowledgeJson(values: StoryFactCharacterKnowledge[]): string {
  return JSON.stringify(
    values
      .map((entry) => ({
        characterId: Number(entry.characterId),
        knownChapterId: entry.knownChapterId ? Number(entry.knownChapterId) : null,
      }))
      .filter((entry) => Number.isFinite(entry.characterId) && entry.characterId > 0),
  )
}

function toFormValues(fact?: StoryFact | null): StoryFactFormValues {
  if (!fact) return EMPTY_FACT_FORM
  return {
    kind: fact.kind,
    title: fact.title,
    summary: fact.summary || '',
    status: fact.status,
    volumeId: fact.volumeId || undefined,
    relatedPuzzleId: fact.relatedPuzzleId || undefined,
    readerKnownChapterId: fact.readerKnownChapterId || undefined,
    protagonistKnownChapterId: fact.protagonistKnownChapterId || undefined,
    forbiddenBeforeVolume: fact.forbiddenBeforeVolume || undefined,
    plannedRevealVolume: fact.plannedRevealVolume || undefined,
    targetRevealChapterId: fact.targetRevealChapterId || undefined,
    isKeyTruth: fact.isKeyTruth !== 0,
    notes: fact.notes || '',
    characterKnowledgeList: parseCharacterKnowledgeJson(fact.characterKnowledgeJson),
  }
}

function normalizeValues(values: StoryFactFormValues): StoryFactFormValues {
  return {
    ...values,
    title: values.title.trim(),
    summary: values.summary.trim(),
    notes: values.notes.trim(),
    characterKnowledgeList: (values.characterKnowledgeList || [])
      .filter((entry) => Number.isFinite(Number(entry.characterId)) && Number(entry.characterId) > 0)
      .map((entry) => ({
        characterId: Number(entry.characterId),
        knownChapterId: entry.knownChapterId ? Number(entry.knownChapterId) : undefined,
      })),
  }
}

function truthMetricsForVolume(volume: StoryVolume, facts: StoryFact[]) {
  const truthFacts = facts.filter((fact) => fact.kind === 'truth' && fact.isKeyTruth !== 0)
  const totalTruths = truthFacts.length
  const plannedTruths = truthFacts.filter((fact) => fact.plannedRevealVolume === volume.volumeNumber).length
  const ratio = totalTruths > 0 ? plannedTruths / totalTruths : 0
  const limit = typeof volume.maxTruthRevealRatio === 'number' ? volume.maxTruthRevealRatio : null
  const overLimit = limit !== null && ratio > limit
  return {
    totalTruths,
    plannedTruths,
    ratio,
    limit,
    overLimit,
  }
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function kindTagColor(kind: StoryFact['kind']) {
  if (kind === 'truth') return 'gold'
  if (kind === 'red_herring') return 'volcano'
  if (kind === 'puzzle') return 'blue'
  return 'processing'
}

function normalizeFactKind(value: unknown, fallback: StoryFact['kind'] = 'clue'): StoryFact['kind'] {
  if (value === 'puzzle' || value === 'clue' || value === 'truth' || value === 'red_herring') return value
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.includes('谜')) return 'puzzle'
  if (text.includes('真相')) return 'truth'
  if (text.includes('假')) return 'red_herring'
  if (text.includes('线索')) return 'clue'
  return fallback
}

function normalizeFactStatus(value: unknown, fallback: StoryFact['status'] = 'introduced'): StoryFact['status'] {
  if (value === 'introduced' || value === 'partial_reveal' || value === 'pending_payoff' || value === 'explained') return value
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.includes('半')) return 'partial_reveal'
  if (text.includes('回收') || text.includes('待')) return 'pending_payoff'
  if (text.includes('解释') || text.includes('已解释')) return 'explained'
  return fallback
}

export default function InfoGapBoardPage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const { mutationToken, notifyWorkspaceMutation, registerSaveHandler, registerEscapeHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<StoryFactFormValues>()
  const [facts, setFacts] = useState<StoryFact[]>([])
  const [volumes, setVolumes] = useState<StoryVolume[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingVolumeRatio, setSavingVolumeRatio] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingFact, setEditingFact] = useState<StoryFact | null>(null)
  const [activeVolumeId, setActiveVolumeId] = useState<number | null>(null)
  const [ratioDraft, setRatioDraft] = useState<number | null>(null)
  const refreshRequestRef = React.useRef(0)

  const sortedVolumes = useMemo(
    () => [...volumes].sort((left, right) => (left.volumeNumber || 0) - (right.volumeNumber || 0)),
    [volumes],
  )
  const puzzleFacts = useMemo(
    () => facts.filter((fact) => fact.kind === 'puzzle'),
    [facts],
  )

  const volumeById = useMemo(
    () => new Map(sortedVolumes.map((volume) => [volume.id, volume])),
    [sortedVolumes],
  )

  const activeVolume = useMemo(
    () => (activeVolumeId ? volumeById.get(activeVolumeId) || null : null),
    [activeVolumeId, volumeById],
  )

  const filteredFacts = useMemo(() => {
    if (!activeVolume) return facts
    return facts.filter((fact) => (
      (!fact.volumeId && !fact.plannedRevealVolume && !fact.forbiddenBeforeVolume)
      || fact.volumeId === activeVolume.id
      || fact.plannedRevealVolume === activeVolume.volumeNumber
      || fact.forbiddenBeforeVolume === activeVolume.volumeNumber
    ))
  }, [activeVolume, facts])
  const displayedVolumeLabel = useMemo(
    () => (activeVolume ? activeVolume.title?.trim() || `第${activeVolume.volumeNumber}卷` : '全部卷'),
    [activeVolume],
  )

  const volumeMetrics = useMemo(
    () => sortedVolumes.map((volume) => ({
      volume,
      metrics: truthMetricsForVolume(volume, facts),
    })),
    [facts, sortedVolumes],
  )

  const overLimitCount = useMemo(
    () => volumeMetrics.filter((item) => item.metrics.overLimit).length,
    [volumeMetrics],
  )

  const currentVolumeMetrics = useMemo(
    () => (activeVolume ? truthMetricsForVolume(activeVolume, facts) : null),
    [activeVolume, facts],
  )

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current
    setLoading(true)
    try {
      const [factRows, volumeRows, chapterRows, characterRows] = await Promise.all([
        window.electron.storyFact.list(novelId),
        window.electron.structure.listVolumes(novelId),
        window.electron.chapter.list(novelId),
        window.electron.character.list(novelId),
      ])
      if (refreshRequestRef.current !== requestId) return
      setFacts(factRows)
      setVolumes(volumeRows)
      setChapters(chapterRows)
      setCharacters(characterRows)
      setActiveVolumeId((current) => {
        if (current && volumeRows.some((volume) => volume.id === current)) return current
        const firstVolume = [...volumeRows].sort((left, right) => left.volumeNumber - right.volumeNumber)[0]
        return firstVolume?.id || null
      })
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (refreshRequestRef.current === requestId) setLoading(false)
    }
  }, [novelId])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  useEffect(() => {
    setRatioDraft(activeVolume?.maxTruthRevealRatio ?? null)
  }, [activeVolume?.id, activeVolume?.maxTruthRevealRatio])

  const openEditor = useCallback((fact?: StoryFact) => {
    const target = fact || null
    setEditingFact(target)
    form.resetFields()
    form.setFieldsValue(toFormValues(target))
    setEditorOpen(true)
  }, [form])

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingFact(null)
  }, [])

  const handleDelete = useCallback((fact: StoryFact) => {
    Modal.confirm({
      title: `删除信息点「${fact.title}」`,
      content: '删除后会立即从谜题板移除，且章节中的引用不会自动改写。',
      okType: 'danger',
      onOk: async () => {
        await window.electron.storyFact.delete(fact.id)
        await refresh()
        notifyWorkspaceMutation()
      },
    })
  }, [notifyWorkspaceMutation, refresh])

  const handleSave = useCallback(async () => {
    const rawValues = await form.validateFields().catch(() => null)
    if (!rawValues) return
    const values = normalizeValues(rawValues)
    if (!values.title) {
      message.warning(getUserFacingMessage('infoGapBoard.titleRequired'))
      return
    }
    setSaving(true)
    try {
      const payload: Partial<StoryFact> = {
        kind: values.kind,
        title: values.title,
        summary: values.summary || undefined,
        status: values.status,
        volumeId: values.volumeId || null,
        relatedPuzzleId: values.relatedPuzzleId || null,
        readerKnownChapterId: values.readerKnownChapterId || null,
        protagonistKnownChapterId: values.protagonistKnownChapterId || null,
        forbiddenBeforeVolume: values.forbiddenBeforeVolume || null,
        plannedRevealVolume: values.plannedRevealVolume || null,
        targetRevealChapterId: values.targetRevealChapterId || null,
        isKeyTruth: values.isKeyTruth ? 1 : 0,
        notes: values.notes || undefined,
        characterKnowledgeJson: stringifyCharacterKnowledgeJson(values.characterKnowledgeList || []),
      }

      if (editingFact) {
        await window.electron.storyFact.update(editingFact.id, payload)
      } else {
        await window.electron.storyFact.create(novelId, payload)
      }

      closeEditor()
      await refresh()
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage(editingFact ? 'infoGapBoard.updated' : 'infoGapBoard.created'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [closeEditor, editingFact, form, novelId, notifyWorkspaceMutation, refresh])

  const handleSaveVolumeRatio = useCallback(async () => {
    if (!activeVolume) return
    setSavingVolumeRatio(true)
    try {
      const normalized = ratioDraft == null
        ? null
        : Math.max(0, Math.min(1, Number(ratioDraft)))
      await window.electron.structure.updateVolume(activeVolume.id, {
        maxTruthRevealRatio: normalized,
      })
      await refresh()
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('infoGapBoard.ratioUpdated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSavingVolumeRatio(false)
    }
  }, [activeVolume, notifyWorkspaceMutation, ratioDraft, refresh])

  const applyAIDraft = useCallback((raw: string) => {
    const draft = parseDraftJson<StoryFactAIDraft>(raw)
    const targetRevealChapterNumDraft = normalizeOptionalNumber(draft.targetRevealChapterNum)
    const targetRevealChapterNum = targetRevealChapterNumDraft && targetRevealChapterNumDraft > 0 ? targetRevealChapterNumDraft : undefined
    const targetChapter = targetRevealChapterNum
      ? chapters.find((chapter) => chapter.chapterNum === targetRevealChapterNum) || null
      : null
    const kind = normalizeFactKind(draft.kind)
    const plannedRevealVolumeDraft = normalizeOptionalNumber(draft.plannedRevealVolume)
    const plannedRevealVolume = plannedRevealVolumeDraft && plannedRevealVolumeDraft > 0 ? plannedRevealVolumeDraft : undefined
    const isKeyTruth = typeof draft.isKeyTruth === 'boolean'
      ? draft.isKeyTruth
      : typeof draft.isKeyTruth === 'string'
        ? /^(true|yes|1|是|关键)$/i.test(draft.isKeyTruth.trim())
        : kind === 'truth'

    setEditingFact(null)
    form.resetFields()
    form.setFieldsValue({
      ...EMPTY_FACT_FORM,
      kind,
      title: typeof draft.title === 'string' ? draft.title.trim() : '',
      summary: typeof draft.summary === 'string' ? draft.summary.trim() : '',
      status: normalizeFactStatus(draft.status, kind === 'truth' ? 'pending_payoff' : 'introduced'),
      plannedRevealVolume,
      targetRevealChapterId: targetChapter?.id,
      isKeyTruth,
      notes: typeof draft.notes === 'string' ? draft.notes.trim() : '',
      characterKnowledgeList: [],
    })
    setEditorOpen(true)
  }, [chapters, form])

  useEffect(() => {
    registerSaveHandler(editorOpen ? () => { void handleSave() } : null)
    return () => registerSaveHandler(null)
  }, [editorOpen, handleSave, registerSaveHandler])

  useEffect(() => {
    registerEscapeHandler(() => {
      if (editorOpen) closeEditor()
    })
    return () => registerEscapeHandler(null)
  }, [closeEditor, editorOpen, registerEscapeHandler])

  return (
    <WorkspacePage
      className="novel-info-gap-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="信息差与谜题板"
      title="信息差与谜题板"
      description="独立维护谜题、线索、真相、假线索，并控制“谁何时知道什么”。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新建信息点
          </Button>
          <AIGenerateButton
            novelId={novelId}
            label="AI 草拟信息差"
            intent="generate"
            isJson
            buildMessages={() => buildDraftMessages({
              task: '信息差与谜题板条目',
              mode: 'replace',
              context: [
                { label: '小说名', value: currentNovel?.title || '' },
                { label: '题材', value: currentNovel?.genreName || '' },
                { label: '简介', value: currentNovel?.synopsis || '' },
                { label: '当前卷', value: activeVolume ? activeVolume.title || `第${activeVolume.volumeNumber}卷` : displayedVolumeLabel },
                { label: '已有信息点', value: facts.slice(0, 10).map((fact) => `${fact.title}(${fact.kind}/${fact.status})`).join('、') },
                { label: '已有谜题', value: puzzleFacts.slice(0, 8).map((fact) => fact.title).join('、') },
                { label: '可用章节', value: chapters.slice(0, 12).map((chapter) => `第${chapter.chapterNum}章:${chapter.title || '未命名'}`).join('、') },
                { label: '主要人物', value: characters.slice(0, 10).map((character) => character.fullName).join('、') },
              ],
              fields: [
                { key: 'kind', label: '信息类型', hint: '只能输出 puzzle、clue、truth、red_herring 之一。' },
                { key: 'title', label: '标题', hint: '像小说策划里的真实谜题或线索名，不要写泛泛主题。' },
                { key: 'summary', label: '摘要', hint: '写清它让读者知道什么、误会什么，或暂时不能知道什么。' },
                { key: 'status', label: '状态', hint: '只能输出 introduced、partial_reveal、pending_payoff、explained 之一。' },
                { key: 'plannedRevealVolume', label: '计划揭示卷号', type: 'number', hint: '没有明确卷号可输出 0。' },
                { key: 'targetRevealChapterNum', label: '计划揭示章号', type: 'number', hint: '优先使用可用章节中的章号，没有明确章号可输出 0。' },
                { key: 'isKeyTruth', label: '是否关键真相', hint: '输出 true 或 false。' },
                { key: 'notes', label: '控制备注', hint: '说明如何避免提前泄露，以及它要服务的冲突或反转。' },
              ],
              requirements: [
                '不要重复已有信息点或已有谜题。',
                '必须服务当前小说的主线、人物选择或伏笔回收，不要生成无关设定。',
                '真相、假线索、线索之间要有可执行的揭示顺序，避免一次性解释完。',
              ],
            })}
            onResult={applyAIDraft}
          />
          <Button icon={<SaveOutlined />} onClick={() => void handleSaveVolumeRatio()} loading={savingVolumeRatio} disabled={!activeVolume}>
            保存卷级比例
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '当前项目', value: currentNovel?.title || '未命名小说' },
            { label: '卷数量', value: sortedVolumes.length },
            { label: '章节数量', value: chapters.length },
            { label: '角色数量', value: characters.length },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="信息点总数" value={facts.length} tone="warm" hint="谜题/线索/真相/假线索总量。" />
          <WorkspaceMetric label="真相条目" value={facts.filter((item) => item.kind === 'truth').length} hint="可参与卷级揭示比例控制。" />
          <WorkspaceMetric label="超限卷数" value={overLimitCount} tone={overLimitCount > 0 ? 'warm' : 'cool'} hint="超出卷级真相揭示比例上限的卷。" />
          <WorkspaceMetric label="当前卷比例" value={currentVolumeMetrics ? `${toPercent(currentVolumeMetrics.ratio)}` : '未选择'} hint={currentVolumeMetrics?.limit != null ? `上限 ${toPercent(currentVolumeMetrics.limit)}` : '当前卷未设置上限'} />
        </>
      )}
    >
      {overLimitCount > 0 ? (
        <Alert
          showIcon
          type="warning"
          message={`当前有 ${overLimitCount} 卷超出真相揭示比例上限`}
          description="系统允许超限但会持续警告，请在章节揭示安排前先调整计划。"
          className="novel-info-gap-board__alert"
        />
      ) : null}

      <WorkspacePanel title="卷级真相揭示比例">
        <div className="novel-info-gap-board__section-stack">
          <div className="novel-info-gap-board__toolbar">
            <Select
              className="novel-info-gap-board__volume-select"
              value={activeVolumeId || undefined}
              onChange={(value) => setActiveVolumeId(value)}
              options={sortedVolumes.map((volume) => ({
                value: volume.id,
                label: volume.title?.trim() || `第${volume.volumeNumber}卷`,
              }))}
              placeholder="选择卷"
            />
            <InputNumber
              min={0}
              max={1}
              step={0.05}
              value={ratioDraft == null ? undefined : ratioDraft}
              onChange={(value) => setRatioDraft(typeof value === 'number' ? value : null)}
              placeholder="上限比例(0~1)"
              className="novel-info-gap-board__ratio-input"
            />
            <Tag color="blue">{activeVolume ? `当前卷：${activeVolume.title || `第${activeVolume.volumeNumber}卷`}` : '未选择卷'}</Tag>
          </div>
          <div className="novel-note-list">
            {volumeMetrics.map(({ volume, metrics }) => (
              <div key={volume.id} className="novel-note-list__item novel-info-gap-board__volume-row">
                <strong>{volume.title?.trim() || `第${volume.volumeNumber}卷`}</strong>
                <Tag>{`真相 ${metrics.plannedTruths}/${metrics.totalTruths}`}</Tag>
                <Tag color={metrics.overLimit ? 'error' : 'processing'}>
                  {`比例 ${toPercent(metrics.ratio)}`}
                </Tag>
                <Tag color={metrics.limit == null ? 'default' : 'gold'}>
                  {metrics.limit == null ? '未设上限' : `上限 ${toPercent(metrics.limit)}`}
                </Tag>
                {metrics.overLimit ? <Tag color="error">超限</Tag> : null}
              </div>
            ))}
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="谜题板看板">
        {loading ? (
          <div className="novel-info-gap-board__loading"><Spin /></div>
        ) : (
          <div className="novel-info-gap-board__board-stack">
            <div className="novel-info-gap-board__muted">
              当前筛选：{displayedVolumeLabel}
            </div>
            <div className="novel-info-gap-board__lane-grid">
              {STATUS_LANES.map((lane) => {
                const laneFacts = filteredFacts.filter((fact) => fact.status === lane.key)
                return (
                  <section key={lane.key} className="novel-panel novel-info-gap-board__lane-card">
                    <div>
                      <div className="novel-kicker">{lane.label}</div>
                      <strong>{laneFacts.length} 条</strong>
                      <div className="novel-info-gap-board__lane-hint">{lane.hint}</div>
                    </div>
                    {laneFacts.length === 0 ? (
                      <div className="novel-empty">当前没有条目。</div>
                    ) : (
                      laneFacts.map((fact) => (
                        <article key={fact.id} className="novel-panel novel-info-gap-board__fact-card">
                          <div className="novel-info-gap-board__fact-head">
                            <strong>{fact.title}</strong>
                            <Tag color={kindTagColor(fact.kind)}>{KIND_OPTIONS.find((item) => item.value === fact.kind)?.label || fact.kind}</Tag>
                          </div>
                          <div className="novel-info-gap-board__fact-summary">
                            {fact.summary || '暂无摘要'}
                          </div>
                          <div className="novel-info-gap-board__fact-tags">
                            {fact.plannedRevealVolume ? <Tag>{`计划揭示：第${fact.plannedRevealVolume}卷`}</Tag> : null}
                            {fact.forbiddenBeforeVolume ? <Tag color="warning">{`禁止提前到第${fact.forbiddenBeforeVolume}卷`}</Tag> : null}
                            {fact.kind === 'truth' ? <Tag color={fact.isKeyTruth ? 'gold' : 'default'}>{fact.isKeyTruth ? '计入比例' : '不计入比例'}</Tag> : null}
                          </div>
                          <div className="novel-info-gap-board__fact-actions">
                            <Button size="small" onClick={() => openEditor(fact)}>编辑</Button>
                            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(fact)}>删除</Button>
                          </div>
                        </article>
                      ))
                    )}
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </WorkspacePanel>

      <Modal
        title={editingFact ? '编辑信息点' : '新建信息点'}
        open={editorOpen}
        width={860}
        destroyOnHidden
        onCancel={closeEditor}
        onOk={() => void handleSave()}
        confirmLoading={saving}
      >
        <Form form={form} layout="vertical" initialValues={EMPTY_FACT_FORM}>
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="kind" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
                <Select options={KIND_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="title" label="标题" rules={[{ required: true, message: '请填写标题' }]}>
                <Input placeholder="例如：凶手为何知道密室结构？" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="summary" label="说明">
                <Input.TextArea rows={6} placeholder="写清楚这条信息点如何服务谜题推进。" />
              </Form.Item>
            </div>

            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="volumeId" label="所属卷">
                <Select
                  allowClear
                  options={sortedVolumes.map((volume) => ({
                    value: volume.id,
                    label: volume.title?.trim() || `第${volume.volumeNumber}卷`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="relatedPuzzleId" label="关联谜题">
                <Select
                  allowClear
                  options={puzzleFacts.map((item) => ({ value: item.id, label: item.title }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="readerKnownChapterId" label="读者已知章节">
                <Select
                  allowClear
                  options={chapters.map((chapter) => ({
                    value: chapter.id,
                    label: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim(),
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="protagonistKnownChapterId" label="主角已知章节">
                <Select
                  allowClear
                  options={chapters.map((chapter) => ({
                    value: chapter.id,
                    label: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim(),
                  }))}
                />
              </Form.Item>
            </div>

            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="forbiddenBeforeVolume" label="禁止提前到第几卷">
                <InputNumber min={1} className="novel-info-gap-board__full-width-input" placeholder="例如 2" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="plannedRevealVolume" label="计划揭示卷">
                <InputNumber min={1} className="novel-info-gap-board__full-width-input" placeholder="例如 3" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="targetRevealChapterId" label="目标揭示章节">
                <Select
                  allowClear
                  options={chapters.map((chapter) => ({
                    value: chapter.id,
                    label: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim(),
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="isKeyTruth" valuePropName="checked" label="计入真相比例">
                <Checkbox>这条真相计入卷级揭示比例统计</Checkbox>
              </Form.Item>
            </div>

            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.List name="characterKnowledgeList">
                {(fields, { add, remove }) => (
                  <div className="novel-info-gap-board__knowledge-stack">
                    <div className="novel-info-gap-board__knowledge-head">
                      <strong>角色已知信息</strong>
                      <Button size="small" onClick={() => add({})}>新增角色</Button>
                    </div>
                    {fields.length === 0 ? <div className="novel-empty">尚未设置角色已知信息。</div> : null}
                    {fields.map((field) => (
                      <div key={field.key} className="novel-info-gap-board__knowledge-row">
                        <Form.Item
                          {...field}
                          name={[field.name, 'characterId']}
                          rules={[{ required: true, message: '请选择角色' }]}
                        >
                          <Select
                            placeholder="角色"
                            options={characters.map((character) => ({
                              value: character.id,
                              label: character.fullName,
                            }))}
                          />
                        </Form.Item>
                        <Form.Item
                          {...field}
                          name={[field.name, 'knownChapterId']}
                        >
                          <Select
                            allowClear
                            placeholder="已知章节"
                            options={chapters.map((chapter) => ({
                              value: chapter.id,
                              label: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim(),
                            }))}
                          />
                        </Form.Item>
                        <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      </div>
                    ))}
                  </div>
                )}
              </Form.List>
            </div>

            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="notes" label="备注">
                <Input.TextArea rows={6} placeholder="补充该信息点的风险、铺垫策略和回收规则。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
