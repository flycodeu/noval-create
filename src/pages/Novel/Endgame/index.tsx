import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Tag, message } from 'antd'
import { ArrowRightOutlined, ImportOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { useNovelStore } from '../../../stores/novel.store'
import type { EndgameAssetSummary } from '../../../types'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import {
  buildStorySettingsPayload,
  parseStorySettingsSnapshot,
  type StoryEndgameMode,
  type StoryEndingType,
} from '../../../shared/story-settings'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context-core'
import {
  useRegisterWorkspaceQualityController,
} from '../workspace-quality-context-core'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

interface Props {
  novelId: number
}

interface EndgameFormValues {
  endingMode: StoryEndgameMode | ''
  finalConflict: string
  themeAnswer: string
  mustDeliverPromises: string
  payoffChecklist: string
  deliberateUnknowns: string
  finalImage: string
  lastScene: string
}

const ENDGAME_MODE_OPTIONS: Array<{ value: StoryEndgameMode; label: string }> = [
  { value: 'victory', label: '胜利式收束' },
  { value: 'hard_won', label: '苦胜式收束' },
  { value: 'costly_victory', label: '代价式胜利' },
  { value: 'tragic', label: '悲剧式收束' },
  { value: 'ironic', label: '反讽式收束' },
  { value: 'open', label: '开放式收束' },
  { value: 'multi_line', label: '多线并收' },
]

const EMPTY_ENDGAME_VALUES: EndgameFormValues = {
  endingMode: '',
  finalConflict: '',
  themeAnswer: '',
  mustDeliverPromises: '',
  payoffChecklist: '',
  deliberateUnknowns: '',
  finalImage: '',
  lastScene: '',
}

function normalizeText(value?: string | null): string {
  return value?.trim() || ''
}

function countMultilineEntries(value?: string | null): number {
  return normalizeText(value)
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .length
}

function normalizeFormValues(values: EndgameFormValues): EndgameFormValues {
  return {
    endingMode: values.endingMode,
    finalConflict: normalizeText(values.finalConflict),
    themeAnswer: normalizeText(values.themeAnswer),
    mustDeliverPromises: normalizeText(values.mustDeliverPromises),
    payoffChecklist: normalizeText(values.payoffChecklist),
    deliberateUnknowns: normalizeText(values.deliberateUnknowns),
    finalImage: normalizeText(values.finalImage),
    lastScene: normalizeText(values.lastScene),
  }
}

function buildCurrentFormValues(
  snapshot: EndgameFormValues,
  formValues: Partial<EndgameFormValues>,
): EndgameFormValues {
  return {
    endingMode: formValues.endingMode ?? snapshot.endingMode,
    finalConflict: typeof formValues.finalConflict === 'string' ? formValues.finalConflict : snapshot.finalConflict,
    themeAnswer: typeof formValues.themeAnswer === 'string' ? formValues.themeAnswer : snapshot.themeAnswer,
    mustDeliverPromises: typeof formValues.mustDeliverPromises === 'string' ? formValues.mustDeliverPromises : snapshot.mustDeliverPromises,
    payoffChecklist: typeof formValues.payoffChecklist === 'string' ? formValues.payoffChecklist : snapshot.payoffChecklist,
    deliberateUnknowns: typeof formValues.deliberateUnknowns === 'string' ? formValues.deliberateUnknowns : snapshot.deliberateUnknowns,
    finalImage: typeof formValues.finalImage === 'string' ? formValues.finalImage : snapshot.finalImage,
    lastScene: typeof formValues.lastScene === 'string' ? formValues.lastScene : snapshot.lastScene,
  }
}

function mapLegacyEndingTypeToEndgameMode(endingType?: StoryEndingType): StoryEndgameMode | '' {
  switch (endingType) {
    case 'HE':
      return 'victory'
    case 'BE':
      return 'tragic'
    case 'open':
      return 'open'
    case 'multi':
      return 'multi_line'
    case 'HE_BE':
      return 'hard_won'
    default:
      return ''
  }
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

export default function EndgamePage({ novelId }: Props) {
  const navigate = useNavigate()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<EndgameFormValues>()
  const [saving, setSaving] = useState(false)
  const [assetSummary, setAssetSummary] = useState<EndgameAssetSummary | null>(null)

  const settings = useMemo(
    () => parseStorySettingsSnapshot(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )
  const snapshot = useMemo<EndgameFormValues>(() => ({
    endingMode: settings.endgameDesign.endingMode ?? '',
    finalConflict: settings.endgameDesign.finalConflict,
    themeAnswer: settings.endgameDesign.themeAnswer,
    mustDeliverPromises: settings.endgameDesign.mustDeliverPromises,
    payoffChecklist: settings.endgameDesign.payoffChecklist,
    deliberateUnknowns: settings.endgameDesign.deliberateUnknowns,
    finalImage: settings.endgameDesign.finalImage,
    lastScene: settings.endgameDesign.lastScene,
  }), [settings])

  useEffect(() => {
    form.setFieldsValue(snapshot)
  }, [form, snapshot])

  useEffect(() => {
    let cancelled = false
    window.electron.endgameAsset.getSummary(novelId)
      .then((summary) => {
        if (!cancelled) setAssetSummary(summary)
      })
      .catch((error) => {
        console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [novelId, currentNovel?.settingsJson])

  const watchedValues = (Form.useWatch([], form) as Partial<EndgameFormValues> | undefined) || {}
  const currentValues = normalizeFormValues(buildCurrentFormValues(snapshot, watchedValues))
  const readyCount = [
    currentValues.endingMode,
    currentValues.finalConflict,
    currentValues.themeAnswer,
    currentValues.mustDeliverPromises,
    currentValues.payoffChecklist,
    currentValues.deliberateUnknowns,
    currentValues.finalImage,
    currentValues.lastScene,
  ].filter(Boolean).length
  const promiseCount = countMultilineEntries(currentValues.mustDeliverPromises)
  const payoffCount = countMultilineEntries(currentValues.payoffChecklist)

  const applyDraft = React.useCallback((draft: Partial<EndgameFormValues>) => {
    form.setFieldsValue(buildCurrentFormValues(snapshot, draft))
  }, [form, snapshot])
  const applyAnchorDraft = React.useCallback((draft: Partial<EndgameFormValues>) => {
    applyDraft({
      endingMode: draft.endingMode,
      finalConflict: typeof draft.finalConflict === 'string' ? draft.finalConflict : undefined,
      themeAnswer: typeof draft.themeAnswer === 'string' ? draft.themeAnswer : undefined,
      lastScene: typeof draft.lastScene === 'string' ? draft.lastScene : undefined,
      finalImage: typeof draft.finalImage === 'string' ? draft.finalImage : undefined,
    })
  }, [applyDraft])
  const applyPayoffDraft = React.useCallback((draft: Partial<EndgameFormValues>) => {
    applyDraft({
      mustDeliverPromises: typeof draft.mustDeliverPromises === 'string' ? draft.mustDeliverPromises : undefined,
      payoffChecklist: typeof draft.payoffChecklist === 'string' ? draft.payoffChecklist : undefined,
      deliberateUnknowns: typeof draft.deliberateUnknowns === 'string' ? draft.deliberateUnknowns : undefined,
    })
  }, [applyDraft])

  const workspaceQualityController = useMemo<RegisteredWorkspaceQualityController>(() => ({
    workspaceKey: 'endgame',
    getSnapshot: () => ({
      scope: 'form',
      fields: normalizeFormValues(buildCurrentFormValues(snapshot, form.getFieldsValue(true))),
    }),
    applySnapshot: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<EndgameFormValues>
        : {}
      applyDraft({
        endingMode: fields.endingMode,
        finalConflict: typeof fields.finalConflict === 'string' ? fields.finalConflict : undefined,
        themeAnswer: typeof fields.themeAnswer === 'string' ? fields.themeAnswer : undefined,
        mustDeliverPromises: typeof fields.mustDeliverPromises === 'string' ? fields.mustDeliverPromises : undefined,
        payoffChecklist: typeof fields.payoffChecklist === 'string' ? fields.payoffChecklist : undefined,
        deliberateUnknowns: typeof fields.deliberateUnknowns === 'string' ? fields.deliberateUnknowns : undefined,
        finalImage: typeof fields.finalImage === 'string' ? fields.finalImage : undefined,
        lastScene: typeof fields.lastScene === 'string' ? fields.lastScene : undefined,
      })
    },
    persistPreview: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<EndgameFormValues>
        : {}

      const payload = buildStorySettingsPayload({
        endgameDesign: {
          endingMode: (fields.endingMode ?? snapshot.endingMode) || undefined,
          finalConflict: typeof fields.finalConflict === 'string' ? normalizeText(fields.finalConflict) : snapshot.finalConflict,
          themeAnswer: typeof fields.themeAnswer === 'string' ? normalizeText(fields.themeAnswer) : snapshot.themeAnswer,
          mustDeliverPromises: typeof fields.mustDeliverPromises === 'string' ? normalizeText(fields.mustDeliverPromises) : snapshot.mustDeliverPromises,
          payoffChecklist: typeof fields.payoffChecklist === 'string' ? normalizeText(fields.payoffChecklist) : snapshot.payoffChecklist,
          deliberateUnknowns: typeof fields.deliberateUnknowns === 'string' ? normalizeText(fields.deliberateUnknowns) : snapshot.deliberateUnknowns,
          finalImage: typeof fields.finalImage === 'string' ? normalizeText(fields.finalImage) : snapshot.finalImage,
          lastScene: typeof fields.lastScene === 'string' ? normalizeText(fields.lastScene) : snapshot.lastScene,
        },
      }, currentNovel?.settingsJson)

      await window.electron.novel.update(novelId, {
        settingsJson: JSON.stringify(payload),
      })
      const syncResult = await window.electron.endgameAsset.syncFromSettings(novelId, JSON.stringify(payload))
      setAssetSummary(syncResult.summary)

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
    },
  }), [applyDraft, currentNovel?.settingsJson, form, novelId, setCurrentNovel, snapshot])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = async () => {
    const rawValues = await form.validateFields().catch(() => null)
    if (!rawValues) return
    const values = normalizeFormValues(rawValues)
    setSaving(true)

    try {
      const payload = buildStorySettingsPayload({
        endgameDesign: {
          endingMode: values.endingMode || undefined,
          finalConflict: values.finalConflict,
          themeAnswer: values.themeAnswer,
          mustDeliverPromises: values.mustDeliverPromises,
          payoffChecklist: values.payoffChecklist,
          deliberateUnknowns: values.deliberateUnknowns,
          finalImage: values.finalImage,
          lastScene: values.lastScene,
        },
      }, currentNovel?.settingsJson)

      await window.electron.novel.update(novelId, {
        settingsJson: JSON.stringify(payload),
      })
      const syncResult = await window.electron.endgameAsset.syncFromSettings(novelId, JSON.stringify(payload))
      setAssetSummary(syncResult.summary)

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      message.success(getUserFacingMessage('endgame.savedWithAssets', { count: syncResult.summary.totalCount }))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleImportFromStoryDesign = () => {
    const current = normalizeFormValues(buildCurrentFormValues(snapshot, form.getFieldsValue(true)))
    const nextValues: Partial<EndgameFormValues> = {}

    if (!current.endingMode && settings.storyDesign.endingType) {
      nextValues.endingMode = mapLegacyEndingTypeToEndgameMode(settings.storyDesign.endingType)
    }
    if (!current.lastScene && settings.storyDesign.ending) {
      nextValues.lastScene = settings.storyDesign.ending
    }

    if (Object.keys(nextValues).length <= 0) {
      message.info(getUserFacingMessage('endgame.importNothing'))
      return
    }

    applyDraft(nextValues)
    message.success(getUserFacingMessage('endgame.importedReusableFields'))
  }

  const handleClear = React.useCallback(() => {
    Modal.confirm({
      title: '清空终局设计？',
      content: '会清空当前终局表单，并同步删除对应的终局承诺资产。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const payload = buildStorySettingsPayload({
          endgameDesign: {
            endingMode: undefined,
            finalConflict: '',
            themeAnswer: '',
            mustDeliverPromises: '',
            payoffChecklist: '',
            deliberateUnknowns: '',
            finalImage: '',
            lastScene: '',
          },
        }, currentNovel?.settingsJson)

        await window.electron.novel.update(novelId, {
          settingsJson: JSON.stringify(payload),
        })
        const syncResult = await window.electron.endgameAsset.syncFromSettings(novelId, JSON.stringify(payload))
        setAssetSummary(syncResult.summary)

        const updated = await window.electron.novel.get(novelId)
        if (updated) setCurrentNovel(updated)
        form.setFieldsValue(EMPTY_ENDGAME_VALUES)
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('endgame.cleared'))
      },
    })
  }, [currentNovel?.settingsJson, form, novelId, notifyWorkspaceMutation, setCurrentNovel])

  useEffect(() => {
    registerClearHandler(handleClear)
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  return (
    <WorkspacePage
      className="novel-endgame-page"
      layout="wide"
      heroVariant="compact"
      title="终局设计"
      description="提前锁定最终冲突、兑现承诺和最后一幕，避免长篇只会向前扩写不会向后收束。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>
            保存终局设计
          </Button>
          <Button icon={<ImportOutlined />} onClick={handleImportFromStoryDesign}>
            从故事设计导入初始化
          </Button>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, 'map'))}>
            去地图结构
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '世界规则', value: currentNovel?.worldRulesJson ? '已就绪' : '未完成' },
            { label: '故事设计', value: `${settings.storyDesignReadyCount}/4` },
            { label: '结局方向', value: settings.storyDesign.endingType || '未设置' },
            { label: '已同步资产', value: assetSummary ? `${assetSummary.totalCount} 条` : '未同步' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="终局清晰度" value={`${readyCount}/8`} tone="warm" />
          <WorkspaceMetric label="兑现承诺" value={promiseCount} />
          <WorkspaceMetric label="回收清单" value={payoffCount} tone="cool" />
          <WorkspaceMetric label="未绑定终局承诺" value={assetSummary?.unboundCount ?? 0} />
        </>
      )}
    >
      {!currentNovel?.worldRulesJson ? (
        <Alert
          type="info"
          showIcon
          message="世界规则尚未完成"
          description="终局设计最好建立在已经明确的世界口径之上，否则最终冲突和代价很容易失真。"
        />
      ) : null}

      {settings.storyDesign.ending && settings.endgameReadyCount <= 0 ? (
        <Alert
          type="info"
          showIcon
          message="故事设计里已经有结局方向"
          description="可以先用“从故事设计导入初始化”带入结局方向，再把最终冲突、主题答案和兑现清单补完整。"
        />
      ) : null}

      {assetSummary && assetSummary.unboundCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="存在未绑定的终局承诺"
          description={`当前有 ${assetSummary.unboundCount} 条终局承诺还没有进入卷级设计、章节合同、场景合同或伏笔账本。保存终局设计后，请继续在后续页面完成绑定。`}
        />
      ) : null}

      <WorkspacePanel extra={<Tag color={readyCount >= 5 ? 'green' : 'blue'}>{readyCount >= 5 ? '可进入后续资产设计' : '建议先补关键终局锚点'}</Tag>}>
        <div className="guided-step__checklist">
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>终局设计不等于一句结局说明</strong></div>
            <p>这里要锁定的是“最后怎么收”“哪些承诺必须兑现”“哪些问题故意不解释”，不是再写一遍主线梗概。</p>
          </div>
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>兑现链要具体</strong></div>
            <p>“会回收伏笔”“会完成成长”这种句子没有约束力，必须写成可核对的承诺和回收清单。</p>
          </div>
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>最后一幕要可视化</strong></div>
            <p>终章意象和最后一幕写清后，后续卷级设计、时间轴和正文更容易对准同一落点。</p>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel
        title="终局锚点"
        description="先固定最终冲突、主题答案和最后一幕。"
        extra={(
          <AIGenerateButton
            novelId={novelId}
            label="AI 生成·终局锚点"
            intent={hasFilledValues([
              currentValues.finalConflict,
              currentValues.themeAnswer,
              currentValues.lastScene,
              currentValues.finalImage,
            ]) ? 'complete' : 'generate'}
            isJson
            buildMessages={() => buildDraftMessages({
              task: '终局锚点',
              mode: hasFilledValues([
                currentValues.finalConflict,
                currentValues.themeAnswer,
                currentValues.lastScene,
                currentValues.finalImage,
              ]) ? 'optimize' : 'replace',
              context: buildPlanningContextSections(currentNovel, {
                includeSubplots: false,
                extraSections: [
                  { label: '当前终局方向', value: settings.storyDesign.ending || '' },
                  { label: '已同步终局资产', value: assetSummary ? `${assetSummary.totalCount} 条` : '' },
                ],
              }),
              fields: [
                { key: 'endingMode', label: '结局类型', value: currentValues.endingMode, hint: '只用 victory、hard_won、costly_victory、tragic、ironic、open、multi_line 之一。' },
                { key: 'finalConflict', label: '最终冲突对象', value: currentValues.finalConflict, hint: '写清主角最后必须正面解决的对象、体制、真相或困局。' },
                { key: 'themeAnswer', label: '主题答案', value: currentValues.themeAnswer, hint: '给出最终答案，不要空泛说教。' },
                { key: 'lastScene', label: '最后一幕', value: currentValues.lastScene, hint: '写清最后停留的画面、人物状态和情绪余波。' },
                { key: 'finalImage', label: '终章意象', value: currentValues.finalImage, hint: '保留会在结尾回响的动作、空间或意象。' },
              ],
              requirements: [
                '必须与已有故事设计、人物代价和世界规则一致。',
                '不要把终局锚点写成整段剧情梗概。',
                '最后一幕要具备可视化画面感。',
              ],
            })}
            onResult={(raw) => {
              const draft = parseDraftJson<Partial<EndgameFormValues>>(raw)
              applyAnchorDraft(draft)
            }}
          />
        )}
      >
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="endingMode" label="结局类型" rules={[{ required: true, message: '请选择结局类型' }]}>
                <Select allowClear options={ENDGAME_MODE_OPTIONS} placeholder="选择终局收束方式" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="finalConflict" label="最终冲突对象" rules={[{ required: true, message: '请写清最终冲突对象' }]}>
                <Input.TextArea rows={6} placeholder="写清主角最后必须正面解决的核心对手、体制、真相或困局。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="themeAnswer" label="主题答案" rules={[{ required: true, message: '请写清主题答案' }]}>
                <Input.TextArea rows={6} placeholder="写这本书最后给出的答案，不要写成空泛价值口号。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="lastScene" label="最后一幕" rules={[{ required: true, message: '请写清最后一幕' }]}>
                <Input.TextArea rows={6} placeholder="写终章最后停留在哪个场面、人物状态和情绪余波上。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="finalImage" label="终章意象">
                <Input.TextArea rows={6} placeholder="写会在结尾被看见或回响的意象、动作或空间画面。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </WorkspacePanel>

      <WorkspacePanel
        title="兑现与留白"
        description="把必须兑现和故意保留的内容拆开写。"
        extra={(
          <AIGenerateButton
            novelId={novelId}
            label="AI 生成·兑现与留白"
            intent={hasFilledValues([
              currentValues.mustDeliverPromises,
              currentValues.payoffChecklist,
              currentValues.deliberateUnknowns,
            ]) ? 'complete' : 'generate'}
            isJson
            buildMessages={() => buildDraftMessages({
              task: '终局兑现与留白',
              mode: hasFilledValues([
                currentValues.mustDeliverPromises,
                currentValues.payoffChecklist,
                currentValues.deliberateUnknowns,
              ]) ? 'optimize' : 'replace',
              context: buildPlanningContextSections(currentNovel, {
                includeSubplots: true,
                extraSections: [
                  { label: '当前终局锚点', value: [
                    currentValues.endingMode ? `结局类型：${currentValues.endingMode}` : '',
                    currentValues.finalConflict ? `最终冲突：${currentValues.finalConflict}` : '',
                    currentValues.themeAnswer ? `主题答案：${currentValues.themeAnswer}` : '',
                    currentValues.lastScene ? `最后一幕：${currentValues.lastScene}` : '',
                    currentValues.finalImage ? `终章意象：${currentValues.finalImage}` : '',
                  ].filter(Boolean).join('\n') },
                ],
              }),
              fields: [
                { key: 'mustDeliverPromises', label: '必须兑现的承诺', value: currentValues.mustDeliverPromises, hint: '建议每行一条，写读者会明确等待的结果。' },
                { key: 'payoffChecklist', label: '长线回收清单', value: currentValues.payoffChecklist, hint: '建议每行一条，只写终局阶段必须爆开的点。' },
                { key: 'deliberateUnknowns', label: '故意保留的未解释项', value: currentValues.deliberateUnknowns, hint: '只保留少量、明确、可控的留白。' },
              ],
              requirements: [
                '承诺和回收要写成可核对条目，不要写抽象愿景。',
                '故意保留的未解释项必须少而明确，不能把真正漏写包装成留白。',
                '优先对齐主线冲突、人物代价、支线回收和终局资产。',
              ],
            })}
            onResult={(raw) => {
              const draft = parseDraftJson<Partial<EndgameFormValues>>(raw)
              applyPayoffDraft(draft)
            }}
          />
        )}
      >
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card">
              <Form.Item name="mustDeliverPromises" label="必须兑现的承诺" rules={[{ required: true, message: '请写清必须兑现的承诺' }]}>
                <Input.TextArea rows={6} placeholder={'建议每行一条，例如：\n主角必须完成最初承诺\n开篇提出的失踪真相必须得到解释'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="payoffChecklist" label="长线回收清单">
                <Input.TextArea rows={6} placeholder={'建议每行一条，例如：\n王城旧伤的来源\n第一卷埋下的禁术代价\n反派真正的情报来源'} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="deliberateUnknowns" label="故意保留的未解释项">
                <Input.TextArea rows={5} placeholder="写允许在结尾故意不解释或只半揭示的谜团，避免后期误判成漏写。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <strong className="workspace-card-section-title">填写建议</strong>
              <div className="guided-step__checklist">
                <div className="guided-step__checkitem guided-step__checkitem--done">
                  <p>“必须兑现的承诺”写读者会明确等待的结果，不写抽象希望。</p>
                </div>
                <div className="guided-step__checkitem guided-step__checkitem--done">
                  <p>“长线回收清单”写会在终章或终局阶段被爆开的点，不要把普通线程推进全塞进来。</p>
                </div>
                <div className="guided-step__checkitem guided-step__checkitem--done">
                  <p>“故意保留的未解释项”要少而明确，否则后续很容易和真正漏写混在一起。</p>
                </div>
              </div>
            </div>
          </div>
        </Form>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
