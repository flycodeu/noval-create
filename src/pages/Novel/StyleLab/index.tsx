import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Select,
  Tabs,
  Tag,
  message,
} from 'antd'
import {
  DeleteOutlined,
  ExperimentOutlined,
  PlusOutlined,
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
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const [fingerprints, setFingerprints] = useState<StyleFingerprintRecord[]>([])
  const [resolved, setResolved] = useState<ResolvedStyleFingerprintPayload | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [switchingId, setSwitchingId] = useState<number | null>(null)
  const [activeView, setActiveView] = useState<'fingerprints' | 'ab'>('fingerprints')
  const [drawerMode, setDrawerMode] = useState<'create' | 'ab' | null>(null)

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
      setAbFingerprintId((current) => {
        if (current && list.some((item) => item.id === current)) return current
        return resolvedPayload?.record.id || list[0]?.id || null
      })
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
      setDrawerMode(null)
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

  const hasUnsavedCandidate = Boolean(
    pasteName.trim()
    || pasteText.trim()
    || chapterName.trim()
    || selectedChapterIds.length > 0
    || sceneBrief.trim()
    || abResult,
  )

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedCandidate) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedCandidate])

  return (
    <WorkspacePage
      className="novel-style-lab-page"
      layout="wide"
      heroVariant="compact"
      chrome="shared"
      title="文风实验室"
      actionContract={{
        primary: {
          key: activeView === 'ab' ? 'ab-settings' : 'create-fingerprint',
          label: activeView === 'ab' ? '设置试写参数' : '新建风格指纹',
          icon: activeView === 'ab' ? <ExperimentOutlined /> : <PlusOutlined />,
          onClick: () => setDrawerMode(activeView === 'ab' ? 'ab' : 'create'),
        },
        secondary: [
          {
            key: 'switch-view',
            label: activeView === 'ab' ? '查看指纹库' : '进入 A/B 对照',
            icon: <ExperimentOutlined />,
            onClick: () => setActiveView(activeView === 'ab' ? 'fingerprints' : 'ab'),
          },
          {
            key: 'refresh',
            label: '刷新',
            icon: <ReloadOutlined />,
            onClick: () => void loadData(),
          },
        ],
      }}
    >
      <div className="style-lab__status-rail" data-style-lab-view={activeView}>
        <div>
          <strong>{activeView === 'ab' ? 'A/B 试写对照' : '风格指纹库'}</strong>
          <span>{currentNovel?.title || '未命名小说'} · {currentNovel?.genreName || '未设置题材'}</span>
        </div>
        <div className="style-lab__status-meta">
          <span>{fingerprints.length} 条指纹</span>
          <span>{resolved ? `${RESOLVE_SOURCE_LABEL[resolved.source]} · ${resolved.record.name}` : '当前无生效指纹'}</span>
        </div>
      </div>

      <Tabs
        className="style-lab__view-tabs"
        activeKey={activeView}
        onChange={(key) => setActiveView(key as 'fingerprints' | 'ab')}
        items={[
          { key: 'fingerprints', label: `指纹库 ${fingerprints.length}` },
          { key: 'ab', label: abResult ? 'A/B 对照 · 已生成' : 'A/B 对照' },
        ]}
      />

      {activeView === 'fingerprints' ? (
      <WorkspacePanel
        className="style-lab__main-surface"
        title="风格指纹库"
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
          <div className="style-lab__fingerprint-list">
            {fingerprints.map((fingerprint) => {
              const stats = parseFingerprintCardStats(fingerprint)
              const sourceMeta = SOURCE_TYPE_META[fingerprint.sourceType || 'pasted'] || SOURCE_TYPE_META.pasted
              const isActive = activeFingerprintId === fingerprint.id
              return (
                <article
                  key={fingerprint.id}
                  className={`style-lab__fingerprint-row${isActive ? ' is-active' : ''}`}
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
                    <Popconfirm
                      title={isActive ? '停用当前风格指纹？' : `将「${fingerprint.name}」设为当前指纹？`}
                      description={isActive ? '停用后会回退到最新指纹或题材默认声线。' : '确认后，后续写作流水线会注入这条指纹。'}
                      okText={isActive ? '确认停用' : '确认生效'}
                      cancelText="取消"
                      onConfirm={() => void handleToggleActive(fingerprint.id, !isActive)}
                    >
                      <Button size="small" type={isActive ? 'default' : 'primary'} loading={switchingId === fingerprint.id}>
                        {isActive ? '当前生效 · 停用' : '设为当前'}
                      </Button>
                    </Popconfirm>
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
      ) : null}

      <Drawer
        title="新建风格指纹"
        width={680}
        open={drawerMode === 'create'}
        onClose={() => setDrawerMode(null)}
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
      </Drawer>

      {activeView === 'ab' ? (
      <WorkspacePanel
        className="style-lab__main-surface style-lab__ab-surface"
        title="A/B 试写对照"
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
          <div className="style-lab__ab-brief">
            <div>
              <strong>{fingerprints.find((item) => item.id === abFingerprintId)?.name || '尚未选择指纹'}</strong>
              <span>{sceneBrief.trim() || '尚未填写试写场景；打开参数后再开始对照。'}</span>
            </div>
            <Button icon={<ExperimentOutlined />} onClick={() => setDrawerMode('ab')}>调整试写参数</Button>
          </div>
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
              <details className="style-lab__diagnostics">
                <summary>查看对照诊断指标</summary>
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
              </details>
            </div>
          ) : (
            <div className="style-lab__ab-empty">
              <span>A / B</span>
              <strong>先确定指纹与场景，再生成第一组对照</strong>
              <Button type="primary" icon={<ExperimentOutlined />} onClick={() => setDrawerMode('ab')}>设置试写参数</Button>
            </div>
          )}
        </div>
      </WorkspacePanel>
      ) : null}

      <Drawer
        title="A/B 试写参数"
        width={620}
        open={drawerMode === 'ab'}
        onClose={() => setDrawerMode(null)}
      >
        <div className="style-lab__drawer-form">
          <label htmlFor="style-lab-ab-fingerprint">对照指纹</label>
          <Select
            id="style-lab-ab-fingerprint"
            className="style-lab__ab-select"
            placeholder="选择用于对照的风格指纹"
            value={abFingerprintId ?? undefined}
            onChange={(value) => setAbFingerprintId(value)}
            options={fingerprints.map((fingerprint) => ({ value: fingerprint.id, label: fingerprint.name }))}
          />
          <label htmlFor="style-lab-scene-brief">场景梗概</label>
          <Input.TextArea
            id="style-lab-scene-brief"
            rows={7}
            placeholder="例如：主角在酒馆被三个人围住，他要在不惊动官府的情况下脱身。"
            value={sceneBrief}
            onChange={(event) => setSceneBrief(event.target.value)}
          />
          {abGeneration.running ? <Alert type="info" showIcon message="正在生成两段对照文本，通常需要一到两分钟。" /> : null}
          <Button
            type="primary"
            icon={<ExperimentOutlined />}
            loading={abGeneration.running}
            disabled={!abFingerprintId || !sceneBrief.trim()}
            onClick={() => void handleRunAbTest()}
          >
            开始 A/B 试写
          </Button>
        </div>
      </Drawer>
    </WorkspacePage>
  )
}
