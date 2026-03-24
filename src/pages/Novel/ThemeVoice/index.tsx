import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Select, Space, Tag, message } from 'antd'
import { ArrowRightOutlined, RobotOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import {
  buildThemeVoicePayload,
  parseThemeVoiceSnapshot,
  type ThemeVoicePov,
  type ThemeVoiceTense,
} from '../../../shared/theme-voice'
import type {
  ThemeVoiceGenerationMode,
  ThemeVoiceGenerationResult,
} from '../../../shared/theme-voice-generation'
import { useNovelStore } from '../../../stores/novel.store'
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

interface ThemeVoiceFormValues {
  theme: string
  motifs: string
  emotionalCore: string
  pov: ThemeVoicePov | ''
  tense: ThemeVoiceTense | ''
  narratorDistance: string
  voiceKeywords: string
  styleRules: string
  dialogueRules: string
  descriptionRules: string
  forbiddenPhrases: string
}

const POV_OPTIONS: Array<{ value: ThemeVoicePov; label: string }> = [
  { value: 'first_person', label: '第一人称' },
  { value: 'third_limited', label: '第三人称限知' },
  { value: 'third_omniscient', label: '第三人称全知' },
  { value: 'multi_pov', label: '多视角' },
]

const TENSE_OPTIONS: Array<{ value: ThemeVoiceTense; label: string }> = [
  { value: 'past', label: '过去时' },
  { value: 'present', label: '现在时' },
  { value: 'mixed', label: '混合时态' },
]

function compactText(value?: string | null, max = 44): string {
  const text = value?.trim() || ''
  if (!text) return '待补充'
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function isFilled(value?: string | null): boolean {
  return Boolean(value && value.trim())
}

function normalizeFormValues(values: ThemeVoiceFormValues): ThemeVoiceFormValues {
  return {
    theme: values.theme.trim(),
    motifs: values.motifs.trim(),
    emotionalCore: values.emotionalCore.trim(),
    pov: values.pov,
    tense: values.tense,
    narratorDistance: values.narratorDistance.trim(),
    voiceKeywords: values.voiceKeywords.trim(),
    styleRules: values.styleRules.trim(),
    dialogueRules: values.dialogueRules.trim(),
    descriptionRules: values.descriptionRules.trim(),
    forbiddenPhrases: values.forbiddenPhrases.trim(),
  }
}

function buildCurrentFormValues(
  snapshot: ThemeVoiceFormValues,
  formValues: Partial<ThemeVoiceFormValues>,
): ThemeVoiceFormValues {
  return {
    ...snapshot,
    ...formValues,
    pov: formValues.pov ?? snapshot.pov,
    tense: formValues.tense ?? snapshot.tense,
  }
}

function mergeGeneratedValues(
  current: ThemeVoiceFormValues,
  result: ThemeVoiceGenerationResult,
  mode: ThemeVoiceGenerationMode,
): ThemeVoiceFormValues {
  const pick = (existing: string, next: string) => {
    if (mode === 'fill_blanks' && existing.trim()) return existing
    return next
  }

  return {
    theme: pick(current.theme, result.theme),
    motifs: pick(current.motifs, result.motifs),
    emotionalCore: pick(current.emotionalCore, result.emotionalCore),
    pov: mode === 'fill_blanks' && current.pov ? current.pov : (result.pov || current.pov),
    tense: mode === 'fill_blanks' && current.tense ? current.tense : (result.tense || current.tense),
    narratorDistance: pick(current.narratorDistance, result.narratorDistance),
    voiceKeywords: pick(current.voiceKeywords, result.voiceKeywords),
    styleRules: pick(current.styleRules, result.styleRules),
    dialogueRules: pick(current.dialogueRules, result.dialogueRules),
    descriptionRules: pick(current.descriptionRules, result.descriptionRules),
    forbiddenPhrases: pick(current.forbiddenPhrases, result.forbiddenPhrases),
  }
}

export default function ThemeVoicePage({ novelId }: Props) {
  const navigate = useNavigate()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [form] = Form.useForm<ThemeVoiceFormValues>()
  const [saving, setSaving] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<ThemeVoiceGenerationMode | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [stats, setStats] = useState({ totalWords: 0, revisionTaskCount: 0 })

  const snapshot = useMemo(
    () => parseThemeVoiceSnapshot(currentNovel?.themeVoiceJson),
    [currentNovel?.themeVoiceJson],
  )

  useEffect(() => {
    form.setFieldsValue(snapshot)
  }, [form, snapshot])

  useEffect(() => {
    let active = true
    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (!active) return
      setStats({
        totalWords: workflowStats.totalWords,
        revisionTaskCount: workflowStats.revisionTaskCount,
      })
    })
    return () => {
      active = false
    }
  }, [novelId])

  const watchedValues = (Form.useWatch([], form) as Partial<ThemeVoiceFormValues> | undefined) || {}
  const currentValues = buildCurrentFormValues(snapshot, watchedValues)
  const foundationCount = [
    currentValues.theme,
    currentValues.emotionalCore,
    currentValues.pov,
    currentValues.tense,
    currentValues.styleRules,
    currentValues.dialogueRules,
  ].filter((value) => typeof value === 'string' ? isFilled(value) : Boolean(value)).length
  const detailCount = [
    currentValues.motifs,
    currentValues.narratorDistance,
    currentValues.voiceKeywords,
    currentValues.descriptionRules,
    currentValues.forbiddenPhrases,
  ].filter(isFilled).length

  const handleSave = async () => {
    const values = normalizeFormValues(await form.validateFields())
    setSaving(true)

    try {
      await window.electron.novel.update(novelId, {
        themeVoiceJson: buildThemeVoicePayload(values, currentNovel?.themeVoiceJson),
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      message.success('主题与文风已保存。')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '主题与文风保存失败。')
    } finally {
      setSaving(false)
    }
  }

  const handleGenerate = async (mode: ThemeVoiceGenerationMode) => {
    setGeneratingMode(mode)
    setWarnings([])

    try {
      const result = await window.electron.ai.generateThemeVoice({
        novelId,
        mode,
        requirements: '优先生成自然、具体、可执行的中文规则，重点压制总结腔、模板句和不符合人物身份的空泛对白。',
      })

      const merged = mergeGeneratedValues(
        buildCurrentFormValues(snapshot, form.getFieldsValue(true)),
        result,
        mode,
      )
      form.setFieldsValue(merged)
      setWarnings(result.warnings)

      if (result.warnings.length > 0) {
        message.warning(`AI 已填入表单，但还有 ${result.warnings.length} 条提醒，保存前请复核。`)
      } else if (mode === 'fill_blanks') {
        message.success('空白字段已补齐到表单，当前尚未保存。')
      } else {
        message.success('主题与文风草稿已生成到表单，当前尚未保存。')
      }
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '主题与文风生成失败。')
    } finally {
      setGeneratingMode(null)
    }
  }

  return (
    <WorkspacePage
      className="novel-theme-voice-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="主题与文风"
      title="Theme & Voice Bible"
      description="把主题、情感核心、视角、时态、口吻和禁用表达固定下来。这一页负责统一正文口径，也是减少 AI 味、降低修订返工的重要约束层。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存主题与文风
          </Button>
          <Button
            icon={<RobotOutlined />}
            loading={generatingMode === 'replace'}
            disabled={Boolean(generatingMode)}
            onClick={() => void handleGenerate('replace')}
          >
            AI 生成首版
          </Button>
          <Button
            loading={generatingMode === 'fill_blanks'}
            disabled={Boolean(generatingMode)}
            onClick={() => void handleGenerate('fill_blanks')}
          >
            AI 只补空白
          </Button>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/world-rules`)}>
            去世界规则
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: 'Project Brief', value: currentNovel?.projectBriefJson ? '已存在' : '建议先补项目立项' },
            { label: '背景摘要', value: compactText(currentNovel?.expandedBackground || currentNovel?.synopsis) },
            { label: '当前字数', value: `${stats.totalWords.toLocaleString()} 字` },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="基础约束" value={`${foundationCount}/6`} tone="warm" hint="主题、情感核心、视角、时态、风格、对白。" />
          <WorkspaceMetric label="补充细则" value={`${detailCount}/5`} hint="母题、叙述距离、口吻词、描写规则、禁用表达。" />
          <WorkspaceMetric label="修订压力" value={stats.revisionTaskCount} hint="文风规则越清楚，后面修订中心的返工越少。" />
        </>
      )}
    >
      {!currentNovel?.projectBriefJson ? (
        <Alert
          type="info"
          showIcon
          message="建议先完成 Project Brief，再来定义主题与文风。这样文风规则会更贴合目标读者和产品承诺。"
        />
      ) : null}

      {warnings.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="本轮 AI 结果附带提醒"
          description={(
            <div>
              {warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}
        />
      ) : null}

      <WorkspacePanel title="使用原则" description="不要写空泛的审美判断，要写成正文生成时真的能执行的规则。">
        <div className="guided-step__checklist">
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>先定视角和时态</strong></div>
            <p>长篇最容易在这里漂移。视角和时态不稳，后面的段落修订会越来越贵。</p>
          </div>
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>规则要能判断</strong></div>
            <p>少写“高级感”“文学性”，多写句式、解释比例、对白密度和禁用表达模式。</p>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        title="主题与文风表"
        description="先生成到表单，再手动复核和保存。"
        extra={<Tag color={generatingMode ? 'gold' : 'blue'}>{generatingMode ? 'AI 生成中' : '手动保存生效'}</Tag>}
      >
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card">
              <Form.Item name="theme" label="主题" rules={[{ required: true, message: '请写清主题' }]}>
                <Input.TextArea rows={4} placeholder="写作品持续回答的命题，不要写成宣传口号。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="emotionalCore" label="情感核心" rules={[{ required: true, message: '请写清情感核心' }]}>
                <Input.TextArea rows={4} placeholder="写读者最稳定收到的情绪回报和压强。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="motifs" label="母题 / 重复意象">
                <Input.TextArea rows={3} placeholder="写会反复出现的母题、意象和回响，建议每行一条。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="pov" label="叙事视角" rules={[{ required: true, message: '请选择叙事视角' }]}>
                <Select options={POV_OPTIONS} placeholder="选择视角" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="tense" label="时态" rules={[{ required: true, message: '请选择时态' }]}>
                <Select options={TENSE_OPTIONS} placeholder="选择时态" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="narratorDistance" label="叙述距离">
                <Input.TextArea rows={3} placeholder="写叙述者与人物之间的距离，以及解释密度。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="voiceKeywords" label="口吻关键词">
                <Input.TextArea rows={3} placeholder="建议 4-8 个词，每行一条，描述整体口吻而非营销词。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="styleRules" label="风格规则" rules={[{ required: true, message: '请补充风格规则' }]}>
                <Input.TextArea rows={5} placeholder="把句式、节奏和信息暴露方式写成规则，建议每行一条。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="dialogueRules" label="对白规则" rules={[{ required: true, message: '请补充对白规则' }]}>
                <Input.TextArea rows={5} placeholder="写潜台词密度、句长控制、留白方式和人物区分度。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="descriptionRules" label="描写规则">
                <Input.TextArea rows={4} placeholder="写场景、动作、心理描写的比例和取舍。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="forbiddenPhrases" label="禁用表达">
                <Input.TextArea rows={4} placeholder="写应避免的总结腔、模板句、空泛抒情和引号强调。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
