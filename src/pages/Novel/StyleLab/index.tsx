import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  message,
} from 'antd'
import {
  DeleteOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type {
  Chapter,
  ResolvedStyleFingerprintPayload,
  StyleAbTestResult,
  StyleFingerprintRecord,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useTrackedGeneration } from '../../../hooks/useTrackedGeneration'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import './index.css'

interface Props {
  novelId: number
}

const SOURCE_TYPE_META: Record<string, { label: string; color: string }> = {
  pasted: { label: '粘贴样本', color: 'blue' },
  chapters: { label: '章节采样', color: 'green' },
  'genre-default': { label: '题材默认', color: 'gold' },
}

const RESOLVE_SOURCE_LABEL: Record<ResolvedStyleFingerprintPayload['source'], string> = {
  active: '手动激活',
  latest: '最新指纹自动兜底',
  'genre-default': '题材默认声线兜底',
}

interface FingerprintCardStats {
  avgSentenceLength: number | null
  avgParagraphLength: number | null
  dialogueLineRate: number | null
  histogram: { short: number; medium: number; long: number; xlong: number } | null
}

function parseFingerprintCardStats(record: StyleFingerprintRecord): FingerprintCardStats {
  const empty: FingerprintCardStats = {
    avgSentenceLength: null,
    avgParagraphLength: null,
    dialogueLineRate: null,
    histogram: null,
  }
  const readNumber = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) ? value : null
  )

  try {
    if (record.statsJson) {
      const stats = JSON.parse(record.statsJson) as Record<string, unknown>
      const histogram = stats.sentenceLengthHistogram as Record<string, unknown> | undefined
      return {
        avgSentenceLength: readNumber(stats.avgSentenceLength),
        avgParagraphLength: readNumber(stats.avgParagraphLength),
        dialogueLineRate: readNumber(stats.dialogueLineRate),
        histogram: histogram && typeof histogram === 'object'
          ? {
            short: readNumber(histogram.short) ?? 0,
            medium: readNumber(histogram.medium) ?? 0,
            long: readNumber(histogram.long) ?? 0,
            xlong: readNumber(histogram.xlong) ?? 0,
          }
          : null,
      }
    }
  } catch { /* fall through to fingerprintJson */ }

  try {
    if (record.fingerprintJson) {
      const fingerprint = JSON.parse(record.fingerprintJson) as Record<string, unknown>
      return {
        avgSentenceLength: readNumber(fingerprint.avgSentenceLength),
        avgParagraphLength: readNumber(fingerprint.avgParagraphLength),
        dialogueLineRate: readNumber(fingerprint.dialogueLineRate),
        histogram: null,
      }
    }
  } catch { /* ignore */ }
  return empty
}

function formatMetric(value: number | null, unit: string): string {
  return value === null ? '—' : `${value}${unit}`
}

function HistogramBar({ histogram }: { histogram: NonNullable<FingerprintCardStats['histogram']> }) {
  const segments = [
    { key: 'short', label: '短句', value: histogram.short },
    { key: 'medium', label: '中句', value: histogram.medium },
    { key: 'long', label: '长句', value: histogram.long },
    { key: 'xlong', label: '超长句', value: histogram.xlong },
  ]
  return (
    <div
      className="style-lab__histogram"
      title={segments.map((item) => `${item.label} ${item.value}%`).join(' / ')}
    >
      {segments.map((item) => (
        <span
          key={item.key}
          className={`style-lab__histogram-segment style-lab__histogram-segment--${item.key}`}
          style={{ width: `${Math.max(item.value, 0)}%` }}
        />
      ))}
    </div>
  )
}

export default function StyleLabPage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [fingerprints, setFingerprints] = useState<StyleFingerprintRecord[]>([])
  const [resolved, setResolved] = useState<ResolvedStyleFingerprintPayload | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [switchingId, setSwitchingId] = useState<number | null>(null)

  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const pasteGeneration = useTrackedGeneration<number | null>()

  const [chapterName, setChapterName] = useState('')
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([])
  const chapterGeneration = useTrackedGeneration<number | null>()

  const [abFingerprintId, setAbFingerprintId] = useState<number | null>(null)
  const [sceneBrief, setSceneBrief] = useState('')
  const [abResult, setAbResult] = useState<StyleAbTestResult | null>(null)
  const abGeneration = useTrackedGeneration<StyleAbTestResult | null>()

  const loadData = useCallback(async () => {
    try {
      const [list, resolvedPayload, chapterList] = await Promise.all([
        window.electron.style.list(novelId),
        window.electron.style.resolveActive(novelId),
        window.electron.chapter.list(novelId),
      ])
      setFingerprints([...list].sort((left, right) => right.id - left.id))
      setResolved(resolvedPayload)
      setChapters(chapterList)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'styleLab.loadFailed'))
    }
  }, [novelId])

  useEffect(() => { void loadData() }, [loadData])

  const activeFingerprintId = resolved?.source === 'active' ? resolved.record.id : null

  const handleToggleActive = async (fingerprintId: number, next: boolean) => {
    setSwitchingId(fingerprintId)
    try {
      await window.electron.style.setActive(novelId, next ? fingerprintId : null)
      message.success(getUserFacingMessage(next ? 'styleLab.activated' : 'styleLab.deactivated'))
      await loadData()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'styleLab.operationFailed'))
    } finally {
      setSwitchingId(null)
    }
  }

  const handleDelete = async (fingerprintId: number) => {
    try {
      await window.electron.style.delete(fingerprintId)
      message.success(getUserFacingMessage('styleLab.fingerprintDeleted'))
      if (abFingerprintId === fingerprintId) setAbFingerprintId(null)
      await loadData()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'styleLab.operationFailed'))
    }
  }

  const handleCreateFromPaste = async () => {
    if (!pasteName.trim()) {
      message.warning(getUserFacingMessage('styleLab.nameRequired'))
      return
    }
    if (pasteText.trim().length < 500) {
      message.warning(getUserFacingMessage('styleLab.referenceTextTooShort'))
      return
    }
    const created = await pasteGeneration.run(
      () => window.electron.style.create(novelId, pasteName.trim(), pasteText),
    )
    if (created !== null) {
      message.success(getUserFacingMessage('styleLab.fingerprintCreated'))
      setPasteName('')
      setPasteText('')
      await loadData()
    }
  }

  const selectableChapters = useMemo(
    () => chapters.filter((chapter) => (chapter.wordCount || 0) > 0 || Boolean(chapter.content?.trim())),
    [chapters],
  )

  const handleCreateFromChapters = async () => {
    if (!chapterName.trim()) {
      message.warning(getUserFacingMessage('styleLab.nameRequired'))
      return
    }
    if (selectedChapterIds.length === 0) {
      message.warning(getUserFacingMessage('styleLab.chapterSelectionRequired'))
      return
    }
    const created = await chapterGeneration.run(
      () => window.electron.style.createFromChapters(novelId, chapterName.trim(), selectedChapterIds),
    )
    if (created !== null) {
      message.success(getUserFacingMessage('styleLab.fingerprintCreated'))
      setChapterName('')
      setSelectedChapterIds([])
      await loadData()
    }
  }

  const handleRunAbTest = async () => {
    if (!abFingerprintId) {
      message.warning(getUserFacingMessage('styleLab.fingerprintNotFound'))
      return
    }
    if (!sceneBrief.trim()) {
      message.warning(getUserFacingMessage('styleLab.sceneBriefRequired'))
      return
    }
    const result = await abGeneration.run(
      () => window.electron.style.abTest(novelId, abFingerprintId, sceneBrief.trim()),
    )
    if (result) {
      setAbResult(result)
      message.success(getUserFacingMessage('styleLab.abTestDone'))
    }
  }

  const abDiffRows = useMemo(() => {
    if (!abResult) return []
    const withStats = abResult.withFingerprint.stats
    const withoutStats = abResult.without.stats
    const reference = abResult.withFingerprint.compliance.referenceMetrics
    return [
      {
        key: 'sentence',
        label: '平均句长',
        withValue: `${withStats.avgSentenceLength} 字`,
        withoutValue: `${withoutStats.avgSentenceLength} 字`,
        referenceValue: `${reference.avgSentenceLength} 字`,
      },
      {
        key: 'paragraph',
        label: '平均段长',
        withValue: `${withStats.avgParagraphLength} 字`,
        withoutValue: `${withoutStats.avgParagraphLength} 字`,
        referenceValue: `${reference.avgParagraphLength} 字`,
      },
      {
        key: 'dialogue',
        label: '对白段占比',
        withValue: `${withStats.dialogueLineRate}%`,
        withoutValue: `${withoutStats.dialogueLineRate}%`,
        referenceValue: `${reference.dialogueLineRate}%`,
      },
      {
        key: 'compliance',
        label: '风格合规分',
        withValue: `${abResult.withFingerprint.compliance.score} 分（${abResult.withFingerprint.compliance.status}）`,
        withoutValue: `${abResult.without.compliance.score} 分（${abResult.without.compliance.status}）`,
        referenceValue: '100 分',
      },
      {
        key: 'forbidden',
        label: '禁用模式命中',
        withValue: `${abResult.withFingerprint.compliance.forbiddenPatternHitCount} 处`,
        withoutValue: `${abResult.without.compliance.forbiddenPatternHitCount} 处`,
        referenceValue: '0 处',
      },
    ]
  }, [abResult])

  return (
    <WorkspacePage
      className="novel-style-lab-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="文风实验室"
      title="文风实验室"
      description="管理风格指纹、切换生效声线，并用 A/B 试写验证指纹对生成文本的真实影响。"
      actions={(
        <Button icon={<ReloadOutlined />} onClick={() => void loadData()}>
          刷新
        </Button>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            {
              label: '当前生效指纹',
              value: resolved ? `${resolved.record.name}` : '暂无（生成时不注入风格约束）',
            },
            {
              label: '生效来源',
              value: resolved ? RESOLVE_SOURCE_LABEL[resolved.source] : '—',
            },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="本书指纹数" value={fingerprints.length} />
          <WorkspaceMetric
            label="生效方式"
            value={resolved ? RESOLVE_SOURCE_LABEL[resolved.source] : '未生效'}
            tone={resolved?.source === 'active' ? 'warm' : 'default'}

          />
        </>
      )}
    >
      <WorkspacePanel
        title="风格指纹库"
        description="卡片展示每条指纹的来源与统计摘要；打开「设为当前」后写作流水线会注入该指纹。"
      >
        {resolved && resolved.source !== 'active' ? (
          <Alert
            type="info"
            showIcon
            message={`当前按「${RESOLVE_SOURCE_LABEL[resolved.source]}」生效：${resolved.record.name}`}
            description="尚未手动激活指纹。打开任一卡片上的「设为当前」可以固定生效指纹。"
          />
        ) : null}
        {fingerprints.length === 0 ? (
          <Empty description="还没有风格指纹。可以在下方粘贴范文或勾选章节生成第一条指纹。" />
        ) : (
          <div className="style-lab__card-grid">
            {fingerprints.map((fingerprint) => {
              const stats = parseFingerprintCardStats(fingerprint)
              const sourceMeta = SOURCE_TYPE_META[fingerprint.sourceType || 'pasted'] || SOURCE_TYPE_META.pasted
              const isActive = activeFingerprintId === fingerprint.id
              return (
                <article
                  key={fingerprint.id}
                  className={`style-lab__card${isActive ? ' style-lab__card--active' : ''}`}
                >
                  <div className="style-lab__card-head">
                    <strong className="style-lab__card-name">{fingerprint.name}</strong>
                    <Tag color={sourceMeta.color}>{sourceMeta.label}</Tag>
                  </div>
                  <div className="style-lab__card-meta">
                    创建于 {fingerprint.createdAt || '未知时间'}
                  </div>
                  <div className="style-lab__card-stats">
                    <span>句长 {formatMetric(stats.avgSentenceLength, ' 字')}</span>
                    <span>段长 {formatMetric(stats.avgParagraphLength, ' 字')}</span>
                    <span>对白 {formatMetric(stats.dialogueLineRate, '%')}</span>
                  </div>
                  {stats.histogram ? <HistogramBar histogram={stats.histogram} /> : null}
                  <div className="style-lab__card-actions">
                    <Space size={6}>
                      <Switch
                        size="small"
                        checked={isActive}
                        loading={switchingId === fingerprint.id}
                        onChange={(next) => void handleToggleActive(fingerprint.id, next)}
                      />
                      <span className="style-lab__card-switch-label">
                        {isActive ? '当前生效' : '设为当前'}
                      </span>
                    </Space>
                    <Popconfirm
                      title="删除这条风格指纹？"
                      description="删除后无法恢复；若它正在生效，会自动回退到兜底顺序。"
                      okText="删除"
                      okType="danger"
                      cancelText="取消"
                      onConfirm={() => void handleDelete(fingerprint.id)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </WorkspacePanel>

      <WorkspacePanel
        title="新建风格指纹"
        description="两种来源：粘贴参考范文，或直接从本书章节采样。生成后可在上方列表中激活。"
      >
        <Tabs
          defaultActiveKey="paste"
          items={[
            {
              key: 'paste',
              label: '粘贴样本',
              children: (
                <div className="workspace-stack-16">
                  {pasteGeneration.error ? (
                    <Alert
                      type="error"
                      showIcon
                      closable
                      onClose={pasteGeneration.dismissError}
                      message="指纹生成失败"
                      description={pasteGeneration.error.message}
                      action={(
                        <Button size="small" onClick={() => void pasteGeneration.retry()}>重试</Button>
                      )}
                    />
                  ) : null}
                  <Input
                    placeholder={'指纹名称，如"冷硬短句·参考某某"'}
                    value={pasteName}
                    onChange={(event) => setPasteName(event.target.value)}
                    className="workspace-max-400"
                  />
                  <Input.TextArea
                    rows={8}
                    placeholder="粘贴参考文本（建议500字以上，越多越准）"
                    value={pasteText}
                    onChange={(event) => setPasteText(event.target.value)}
                  />
                  <div>
                    <Button
                      type="primary"
                      icon={<RobotOutlined />}
                      loading={pasteGeneration.running}
                      disabled={!pasteText.trim() || !pasteName.trim()}
                      onClick={() => void handleCreateFromPaste()}
                    >
                      分析并生成风格指纹
                    </Button>
                    <span className="workspace-text-small workspace-text-muted workspace-margin-left-12">
                      {pasteText.length} 字
                    </span>
                  </div>
                </div>
              ),
            },
            {
              key: 'chapters',
              label: '勾选章节采样',
              children: (
                <div className="workspace-stack-16">
                  {chapterGeneration.error ? (
                    <Alert
                      type="error"
                      showIcon
                      closable
                      onClose={chapterGeneration.dismissError}
                      message="章节采样失败"
                      description={chapterGeneration.error.message}
                      action={(
                        <Button size="small" onClick={() => void chapterGeneration.retry()}>重试</Button>
                      )}
                    />
                  ) : null}
                  <Input
                    placeholder={'指纹名称，如"本书定稿声线 · 第1-5章"'}
                    value={chapterName}
                    onChange={(event) => setChapterName(event.target.value)}
                    className="workspace-max-400"
                  />
                  {selectableChapters.length === 0 ? (
                    <Empty description="暂无有正文的章节可供采样。" />
                  ) : (
                    <div className="style-lab__chapter-list">
                      <Checkbox.Group
                        value={selectedChapterIds}
                        onChange={(values) => setSelectedChapterIds(values as number[])}
                      >
                        {selectableChapters.map((chapter) => (
                          <div key={chapter.id} className="style-lab__chapter-item">
                            <Checkbox value={chapter.id}>
                              第{chapter.chapterNum}章 {chapter.title || '未命名'}
                              <span className="workspace-text-small workspace-text-muted workspace-margin-left-12">
                                {chapter.status === 'final' ? '已定稿' : chapter.status === 'draft' ? '草稿' : chapter.status}
                                {chapter.wordCount ? ` · ${chapter.wordCount}字` : ''}
                              </span>
                            </Checkbox>
                          </div>
                        ))}
                      </Checkbox.Group>
                    </div>
                  )}
                  <Button
                    type="primary"
                    icon={<RobotOutlined />}
                    loading={chapterGeneration.running}
                    disabled={selectedChapterIds.length === 0 || !chapterName.trim()}
                    onClick={() => void handleCreateFromChapters()}
                  >
                    从所选 {selectedChapterIds.length} 章采样生成指纹
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </WorkspacePanel>

      <WorkspacePanel
        title="A/B 试写对照"
        description="同一场景梗概生成两段约 400 字的文本：A 注入所选指纹约束，B 不注入，用统计指标验证指纹的真实影响。"
      >
        <div className="workspace-stack-16">
          {abGeneration.error ? (
            <Alert
              type="error"
              showIcon
              closable
              onClose={abGeneration.dismissError}
              message="A/B 试写失败"
              description={abGeneration.error.message}
              action={(
                <Button size="small" onClick={() => void abGeneration.retry()}>重试</Button>
              )}
            />
          ) : null}
          <Space wrap>
            <Select
              className="style-lab__ab-select"
              placeholder="选择用于对照的风格指纹"
              value={abFingerprintId ?? undefined}
              onChange={(value) => setAbFingerprintId(value)}
              options={fingerprints.map((fingerprint) => ({
                value: fingerprint.id,
                label: fingerprint.name,
              }))}
            />
            <Button
              type="primary"
              icon={<ExperimentOutlined />}
              loading={abGeneration.running}
              disabled={!abFingerprintId || !sceneBrief.trim()}
              onClick={() => void handleRunAbTest()}
            >
              开始 A/B 试写
            </Button>
          </Space>
          <Input.TextArea
            rows={4}
            placeholder="输入场景梗概，例如：主角在酒馆被三个人围住，他要在不惊动官府的情况下脱身。"
            value={sceneBrief}
            onChange={(event) => setSceneBrief(event.target.value)}
          />
          {abGeneration.running ? (
            <Alert type="info" showIcon message="正在生成两段对照文本，通常需要一到两分钟，请勿离开本页。" />
          ) : null}
          {abResult ? (
            <div className="workspace-stack-16">
              <div className="style-lab__ab-columns">
                <div className="style-lab__ab-column style-lab__ab-column--with">
                  <div className="style-lab__ab-column-head">
                    <Tag color="green">A · 注入指纹</Tag>
                    <span className="workspace-text-small workspace-text-muted">{abResult.fingerprintName}</span>
                  </div>
                  <div className="style-lab__ab-text">{abResult.withFingerprint.text}</div>
                </div>
                <div className="style-lab__ab-column">
                  <div className="style-lab__ab-column-head">
                    <Tag>B · 不注入</Tag>
                  </div>
                  <div className="style-lab__ab-text">{abResult.without.text}</div>
                </div>
              </div>
              <div className="style-lab__ab-table-wrap">
                <table className="style-lab__ab-table">
                  <thead>
                    <tr>
                      <th>指标</th>
                      <th>A · 注入指纹</th>
                      <th>B · 不注入</th>
                      <th>指纹参考值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abDiffRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{row.withValue}</td>
                        <td>{row.withoutValue}</td>
                        <td>{row.referenceValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
