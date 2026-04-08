import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Progress, Select, Space, message } from 'antd'
import {
  BarsOutlined,
  ClockCircleOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  SaveOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { buildNovelBlurbPayload, parseNovelBlurbDocument, type NovelBlurbDocument } from '../../../shared/blurb'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import { buildProjectBriefSummary, parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { buildPremiseSummary, buildStoryDesignSummary, parseStorySettingsSnapshot } from '../../../shared/story-settings'
import { buildThemeVoiceSummary, parseThemeVoiceSnapshot } from '../../../shared/theme-voice'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import { generateOverviewDraft } from '../shared/planning-ai-service'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import { loadWorkflowStats } from '../workflow'

interface Props {
  novelId: number
}

interface OverviewFormValues {
  title: string
  synopsis: string
  userBackground: string
  expandedBackground: string
  targetWords: number
}

interface OverviewStats {
  mapCount: number
  characterCount: number
  itemCount: number
  threadCount: number
  outlineCount: number
  timelineCount: number
  revisionTaskCount: number
  chapterCount: number
  completedChapterCount: number
  totalWords: number
  hasProtagonist: boolean
}

const EMPTY_STATS: OverviewStats = {
  mapCount: 0,
  characterCount: 0,
  itemCount: 0,
  threadCount: 0,
  outlineCount: 0,
  timelineCount: 0,
  revisionTaskCount: 0,
  chapterCount: 0,
  completedChapterCount: 0,
  totalWords: 0,
  hasProtagonist: false,
}

type PackagingDraft = NovelBlurbDocument

function normalizeTargetWords(value: unknown): number {
  const next = normalizeOptionalNumber(value)
  if (!next) return 200000
  return Math.max(1000, next)
}

export default function Overview({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [form] = Form.useForm<OverviewFormValues>()
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<OverviewStats>(EMPTY_STATS)
  const [draftWarnings, setDraftWarnings] = useState<string[]>([])
  const [packagingDraft, setPackagingDraft] = useState<PackagingDraft>(parseNovelBlurbDocument(currentNovel?.blurbJson))
  const [packagingGenerating, setPackagingGenerating] = useState(false)
  const draftWarningsRef = useRef<string[]>([])
  const draftObservabilityRef = useRef<{ inputSummary: string; lintWarnings: string[]; rawOutputs: string[] } | null>(null)

  useEffect(() => {
    form.setFieldsValue({
      title: currentNovel?.title || '',
      synopsis: currentNovel?.synopsis || '',
      userBackground: currentNovel?.userBackground || '',
      expandedBackground: currentNovel?.expandedBackground || '',
      targetWords: currentNovel?.targetWords ?? 200000,
    })
  }, [currentNovel, form])

  useEffect(() => {
    setPackagingDraft(parseNovelBlurbDocument(currentNovel?.blurbJson))
  }, [currentNovel?.blurbJson])

  useEffect(() => {
    let active = true

    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (active) setStats(workflowStats)
    })

    return () => {
      active = false
    }
  }, [novelId])

  const projectBrief = useMemo(
    () => parseProjectBriefSnapshot(currentNovel?.projectBriefJson),
    [currentNovel?.projectBriefJson],
  )
  const storySettings = useMemo(
    () => parseStorySettingsSnapshot(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )
  const themeVoice = useMemo(
    () => parseThemeVoiceSnapshot(currentNovel?.themeVoiceJson),
    [currentNovel?.themeVoiceJson],
  )
  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )

  const targetWords = currentNovel?.targetWords ?? 0
  const wordProgress = targetWords > 0 ? Math.min(100, Math.round((stats.totalWords / targetWords) * 100)) : 0
  const chapterProgress = stats.chapterCount > 0
    ? Math.round((stats.completedChapterCount / stats.chapterCount) * 100)
    : 0

  const readinessItems = [
    {
      key: 'project-brief',
      title: '项目立项',
      ready: projectBrief.readyCount >= 4,
      summary: `${projectBrief.readyCount}/6`,
      icon: <EditOutlined />,
      action: () => navigate(`/novels/${novelId}/project-brief`),
    },
    {
      key: 'core-settings',
      title: '基础设定',
      ready: storySettings.premiseReadyCount >= 4,
      summary: `${storySettings.premiseReadyCount}/5`,
      icon: <SettingOutlined />,
      action: () => navigate(`/novels/${novelId}/core-settings`),
    },
    {
      key: 'theme-voice',
      title: '主题与文风',
      ready: themeVoice.readyCount >= 4,
      summary: `${themeVoice.readyCount}/6`,
      icon: <EditOutlined />,
      action: () => navigate(`/novels/${novelId}/theme-voice`),
    },
    {
      key: 'world-rules',
      title: '世界规则',
      ready: Boolean(currentNovel?.worldRulesJson),
      summary: `${worldRules.factionSystem.length} 势力 / ${worldRules.speciesSystem.length} 种族`,
      icon: <GlobalOutlined />,
      action: () => navigate(`/novels/${novelId}/world-rules`),
    },
    {
      key: 'map',
      title: '地图结构',
      ready: stats.mapCount > 0,
      summary: `${stats.mapCount} 个节点`,
      icon: <EnvironmentOutlined />,
      action: () => navigate(`/novels/${novelId}/map`),
    },
    {
      key: 'characters',
      title: '角色系统',
      ready: stats.characterCount > 0 && stats.hasProtagonist,
      summary: `${stats.characterCount} 位角色`,
      icon: <TeamOutlined />,
      action: () => navigate(`/novels/${novelId}/characters`),
    },
    {
      key: 'threads',
      title: '故事线程',
      ready: stats.threadCount > 0,
      summary: `${stats.threadCount} 条线程`,
      icon: <BarsOutlined />,
      action: () => navigate(`/novels/${novelId}/threads`),
    },
    {
      key: 'timeline',
      title: '时间轴',
      ready: stats.timelineCount > 0,
      summary: `${stats.timelineCount} 个事件`,
      icon: <ClockCircleOutlined />,
      action: () => navigate(`/novels/${novelId}/timeline`),
    },
  ]

  const nextFocus = readinessItems.find((item) => !item.ready)?.title
    || (stats.revisionTaskCount > 0 ? '修订中心' : '正文写作')

  const applyOverviewDraft = (draft: Partial<OverviewFormValues>) => {
    const currentValues = form.getFieldsValue(true)

    form.setFieldsValue({
      ...currentValues,
      title: typeof draft.title === 'string' ? draft.title : currentValues.title,
      synopsis: typeof draft.synopsis === 'string' ? draft.synopsis : currentValues.synopsis,
      userBackground: typeof draft.userBackground === 'string' ? draft.userBackground : currentValues.userBackground,
      expandedBackground: typeof draft.expandedBackground === 'string' ? draft.expandedBackground : currentValues.expandedBackground,
      targetWords: normalizeTargetWords(draft.targetWords ?? currentValues.targetWords),
    })
  }

  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<OverviewFormValues>({
    novelId,
    pageKey: 'overview',
    applyDraft: applyOverviewDraft,
  })

  const handleApplyDraft = (raw: string) => {
    const parsedDraft = parseDraftJson<OverviewFormValues>(raw)
    const currentValues = form.getFieldsValue(true)
    const mergedDraft: OverviewFormValues = {
      ...currentValues,
      title: typeof parsedDraft.title === 'string' ? parsedDraft.title : currentValues.title,
      synopsis: typeof parsedDraft.synopsis === 'string' ? parsedDraft.synopsis : currentValues.synopsis,
      userBackground: typeof parsedDraft.userBackground === 'string' ? parsedDraft.userBackground : currentValues.userBackground,
      expandedBackground: typeof parsedDraft.expandedBackground === 'string' ? parsedDraft.expandedBackground : currentValues.expandedBackground,
      targetWords: normalizeTargetWords(parsedDraft.targetWords ?? currentValues.targetWords),
    }

    applyOverviewDraft(mergedDraft)
    void saveAppliedDraft(mergedDraft, draftWarningsRef.current, 'overview', draftObservabilityRef.current || undefined).catch(console.error)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)

    try {
      const finalPayload = {
        title: values.title.trim(),
        synopsis: values.synopsis.trim(),
        userBackground: values.userBackground.trim(),
        expandedBackground: values.expandedBackground.trim(),
        targetWords: values.targetWords,
        blurbJson: buildNovelBlurbPayload(packagingDraft, currentNovel?.blurbJson),
      }
      await window.electron.novel.update(novelId, finalPayload)

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      await finalizeDraft(finalPayload)
      await clearDraft()
      message.success(getUserFacingMessage('overview.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'overview.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <WorkspacePage
      className="novel-overview-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="基础总览"
      title="项目总览"
      description="统一查看底盘、资产和下一步重点。"
      actions={(
        <Space wrap>
          <AIGenerateButton
            label="AI 生成基础信息"
            isJson
            runGeneration={async (input) => {
              const result = await generateOverviewDraft(input, { genre: currentNovel?.genreName })
              draftWarningsRef.current = result.warnings
              draftObservabilityRef.current = result.observability
              setDraftWarnings(result.warnings)
              return result.outputs
            }}
            buildMessages={() => {
              const values = form.getFieldsValue(true)

              return buildDraftMessages({
                task: '小说基础信息',
                mode: 'replace',
                context: [
                  { label: '题材', value: currentNovel?.genreName || '' },
                  { label: '项目立项', value: buildProjectBriefSummary(projectBrief) },
                  { label: '基础设定', value: buildPremiseSummary(storySettings.premise) },
                  { label: '故事设计', value: buildStoryDesignSummary(storySettings.storyDesign) },
                  { label: '主题与文风', value: buildThemeVoiceSummary(themeVoice) },
                  {
                    label: '世界规则',
                    value: [
                      worldRules.mapBlueprint.overview,
                      worldRules.factionSystem.length > 0 ? `${worldRules.factionSystem.length} 个势力` : '',
                      worldRules.speciesSystem.length > 0 ? `${worldRules.speciesSystem.length} 个种族` : '',
                    ].filter(Boolean).join('；'),
                  },
                ],
                fields: [
                  { key: 'title', label: '书名', value: values.title, hint: '能体现题材和冲突，不要像占位名。' },
                  { key: 'synopsis', label: '一句话简介', value: values.synopsis, hint: '一句话交代主角处境、目标和最大阻碍。' },
                  { key: 'userBackground', label: '原始背景', value: values.userBackground, hint: '保留灵感来源，写清氛围和人物起点。' },
                  { key: 'expandedBackground', label: '扩展背景', value: values.expandedBackground, hint: '补齐资源、制度、环境压力和社会结构。' },
                  { key: 'targetWords', label: '目标字数', type: 'number', value: values.targetWords, hint: '给出适合当前题材的合理整数。' },
                ],
                requirements: [
                  '不要另起一套故事。',
                  '不要写口号和平台宣传语。',
                ],
              })
            }}
            onResult={handleApplyDraft}
          />
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存基础信息
          </Button>
          <Button
            icon={<EditOutlined />}
            onClick={() => navigate(`/novels/${novelId}/${stats.revisionTaskCount > 0 ? 'revision' : 'writing'}`)}
          >
            {stats.revisionTaskCount > 0 ? '打开修订中心' : '进入正文写作'}
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '当前重点', value: nextFocus },
            { label: '章节', value: `${stats.completedChapterCount}/${stats.chapterCount || 0}` },
            { label: '目标字数', value: `${targetWords.toLocaleString()} 字` },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric
            label="累计字数"
            value={`${stats.totalWords.toLocaleString()} 字`}
            tone="warm"
            hint={targetWords > 0 ? `目标 ${targetWords.toLocaleString()} 字` : '还没有设置目标字数'}
          />
          <WorkspaceMetric
            label="章节进度"
            value={`${stats.completedChapterCount}/${stats.chapterCount || 0}`}
            hint={`完成率 ${chapterProgress}%`}
          />
          <WorkspaceMetric
            label="结构资产"
            value={stats.mapCount + stats.characterCount + stats.itemCount + stats.threadCount + stats.timelineCount}
            tone="cool"
            hint="地图、角色、物品、线程和时间轴总和"
          />
          <WorkspaceMetric
            label="修订压力"
            value={stats.revisionTaskCount}
            hint={stats.revisionTaskCount > 0 ? '建议先处理未闭环问题。' : '当前没有未处理修订任务。'}
          />
        </>
      )}
    >
      {!currentNovel?.synopsis || !currentNovel?.expandedBackground ? (
        <Alert
          type="warning"
          showIcon
          message="简介或扩展背景还不完整。"
        />
      ) : null}
      {draftWarnings.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="本轮 AI 草稿带有提醒"
          description={draftWarnings.map((warning) => <div key={warning}>{warning}</div>)}
        />
      ) : null}
      {draft?.appliedAt ? (
        <Alert
          type="info"
          showIcon
          message="已恢复最近一次未保存的 AI 草稿"
          description="当前表单包含最近一次已应用但尚未保存的 Overview 草稿。保存基础信息后会自动清除。"
        />
      ) : null}

      <WorkspacePanel title="推进热度" description="先看进度。">
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>字数进度</strong>
              <span>{wordProgress}%</span>
            </div>
            <Progress percent={wordProgress} showInfo={false} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>章节进度</strong>
              <span>{chapterProgress}%</span>
            </div>
            <Progress percent={chapterProgress} showInfo={false} />
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="基础信息" description="后续生成会直接继承这里的内容。">
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid guided-step__field-grid--basics">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="title" label="书名" rules={[{ required: true, message: '请填写书名' }]}>
                <Input placeholder="例如：北境回潮" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="targetWords" label="目标字数" rules={[{ required: true, message: '请填写目标字数' }]}>
                <InputNumber min={1000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="synopsis" label="一句话简介" rules={[{ required: true, message: '请填写简介' }]}>
                <Input.TextArea rows={4} placeholder="写清主角处境、目标和最大阻碍。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="userBackground" label="原始背景" rules={[{ required: true, message: '请填写原始背景' }]}>
                <Input.TextArea rows={7} placeholder="写灵感起点、氛围和人物困局。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="expandedBackground" label="扩展背景" rules={[{ required: true, message: '请填写扩展背景' }]}>
                <Input.TextArea rows={7} placeholder="补齐环境压力、制度成本和社会结构。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel
        title="包装助手"
        description="生成书名候选、平台简介和卷名风格。这里只影响包装展示，不进入章节写作上下文。"
        extra={(
          <Button
            loading={packagingGenerating}
            onClick={() => void (async () => {
              setPackagingGenerating(true)
              try {
                const outputs = await window.electron.ai.runPrompt({
                  modelConfigId: currentNovel?.modelConfigId,
                  messages: [{
                    role: 'user',
                    content: [
                      '你是中文网络小说包装编辑，只输出 JSON，不要解释，不要 Markdown。',
                      `书名：${form.getFieldValue('title') || currentNovel?.title || ''}`,
                      `一句话简介：${form.getFieldValue('synopsis') || currentNovel?.synopsis || ''}`,
                      `扩展背景：${form.getFieldValue('expandedBackground') || currentNovel?.expandedBackground || ''}`,
                      projectBrief.readyCount > 0 ? `项目立项：${buildProjectBriefSummary(projectBrief)}` : '',
                      storySettings.storyDesign.mainPlot ? `故事设计：${buildStoryDesignSummary(storySettings.storyDesign)}` : '',
                      themeVoice.readyCount > 0 ? `主题与文风：${buildThemeVoiceSummary(themeVoice)}` : '',
                      '返回：',
                      '- titleCandidates: 5 个可上架书名候选',
                      '- oneLineHook: 1 句导语',
                      '- platformBlurbs.qidian / tomato / publishing: 3 种平台简介',
                      '- volumeNamingStyle: 卷名风格规范',
                      '{"titleCandidates":[""],"oneLineHook":"","platformBlurbs":{"qidian":"","tomato":"","publishing":""},"volumeNamingStyle":""}',
                    ].filter(Boolean).join('\n'),
                  }],
                })
                const first = Array.isArray(outputs) ? outputs[0] : ''
                if (!first) return
                const parsed = parseDraftJson<PackagingDraft>(first)
                setPackagingDraft((current) => ({
                  titleCandidates: Array.isArray(parsed.titleCandidates)
                    ? parsed.titleCandidates.filter((item): item is string => typeof item === 'string')
                    : current.titleCandidates,
                  oneLineHook: typeof parsed.oneLineHook === 'string' ? parsed.oneLineHook : current.oneLineHook,
                  platformBlurbs: {
                    qidian: typeof parsed.platformBlurbs?.qidian === 'string' ? parsed.platformBlurbs.qidian : current.platformBlurbs.qidian,
                    tomato: typeof parsed.platformBlurbs?.tomato === 'string' ? parsed.platformBlurbs.tomato : current.platformBlurbs.tomato,
                    publishing: typeof parsed.platformBlurbs?.publishing === 'string' ? parsed.platformBlurbs.publishing : current.platformBlurbs.publishing,
                  },
                  volumeNamingStyle: typeof parsed.volumeNamingStyle === 'string' ? parsed.volumeNamingStyle : current.volumeNamingStyle,
                }))
                message.success('包装文案已生成，可直接保存基础信息。')
              } catch (error) {
                console.error(error)
                message.error(getErrorMessage(error, 'overview.aiDraftFailed'))
              } finally {
                setPackagingGenerating(false)
              }
            })()}
          >
            生成包装文案
          </Button>
        )}
      >
        <div className="guided-step__field-grid">
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>书名候选</strong>
            <Select
              mode="tags"
              value={packagingDraft.titleCandidates}
              onChange={(value: string[]) => setPackagingDraft((current) => ({ ...current, titleCandidates: value }))}
              tokenSeparators={[',', '，', '、']}
              placeholder="输入或微调候选书名"
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>一句话钩子</strong>
            <Input.TextArea
              rows={3}
              value={packagingDraft.oneLineHook}
              onChange={(event) => setPackagingDraft((current) => ({ ...current, oneLineHook: event.target.value }))}
              placeholder="一句话概括主角、目标和最大阻碍。"
            />
          </div>
          <div className="guided-step__field-card">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>起点版简介</strong>
            <Input.TextArea
              rows={6}
              value={packagingDraft.platformBlurbs.qidian}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, qidian: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>番茄版简介</strong>
            <Input.TextArea
              rows={6}
              value={packagingDraft.platformBlurbs.tomato}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, tomato: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>出版版简介</strong>
            <Input.TextArea
              rows={4}
              value={packagingDraft.platformBlurbs.publishing}
              onChange={(event) => setPackagingDraft((current) => ({
                ...current,
                platformBlurbs: { ...current.platformBlurbs, publishing: event.target.value },
              }))}
            />
          </div>
          <div className="guided-step__field-card guided-step__field-card--full">
            <strong style={{ display: 'block', marginBottom: 8, color: 'var(--workspace-ink)' }}>卷名风格</strong>
            <Input.TextArea
              rows={3}
              value={packagingDraft.volumeNamingStyle}
              onChange={(event) => setPackagingDraft((current) => ({ ...current, volumeNamingStyle: event.target.value }))}
              placeholder="例如：统一采用 地点 + 局势 / 代价 + 目标 的组合。"
            />
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="故事底盘快照" description="只看关键底盘是否收口。">
        <div className="guided-step__fact-grid">
          <div className="guided-step__fact-card">
            <span>项目立项</span>
            <strong>{projectBrief.readyCount}/6</strong>
            <small>{projectBrief.readerPromise || '还没有写清读者承诺。'}</small>
          </div>
          <div className="guided-step__fact-card">
            <span>基础设定</span>
            <strong>{storySettings.premiseReadyCount}/5</strong>
            <small>{storySettings.premise.constraints || '还没有写清底层约束。'}</small>
          </div>
          <div className="guided-step__fact-card">
            <span>主题与文风</span>
            <strong>{themeVoice.readyCount}/6</strong>
            <small>{themeVoice.styleRules || '还没有固定文风与句式规则。'}</small>
          </div>
          <div className="guided-step__fact-card">
            <span>世界规则</span>
            <strong>{currentNovel?.worldRulesJson ? '已建立' : '待建立'}</strong>
            <small>{worldRules.mapBlueprint.overview || '还没有统一地点层级和行动边界。'}</small>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="工作流就绪度" description="优先补齐还没就绪的模块。">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {readinessItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.action}
              style={{
                textAlign: 'left',
                border: '1px solid rgba(15, 23, 42, 0.08)',
                borderRadius: 16,
                padding: 16,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong>{item.title}</strong>
                <span>{item.icon}</span>
              </div>
              <div style={{ fontSize: 12, color: item.ready ? '#0f766e' : '#b45309', marginBottom: 8 }}>
                {item.ready ? '已就绪' : '待补齐'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{item.summary}</div>
            </button>
          ))}
        </div>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
