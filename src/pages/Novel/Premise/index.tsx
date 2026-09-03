import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Modal, Space, Tag, message, notification } from 'antd'
import {
  ArrowRightOutlined,
  BarsOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type {
  PremiseGenerationMode,
  PremiseGenerationProgressEvent,
  PremiseGenerationResult,
} from '../../../shared/premise-generation'
import type { PremiseDraftRecord } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import {
  buildStorySettingsPayload,
  parseStorySettingsSnapshot,
} from '../../../shared/story-settings'
import {
  buildAiResultKey,
  useAiResultStore,
} from '../../../stores/ai-result.store'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import {
  isCharacterRosterReady,
  isItemsEquipmentReady,
  isMapStructureReady,
  isStoryPlotReady,
  isWorldFoundationReady,
  loadWorkflowStats,
} from '../workflow'
import {
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import type { RegisteredWorkspaceQualityController } from '../workspace-quality-context-core'
import {
  useRegisterWorkspaceQualityController,
} from '../workspace-quality-context-core'
import { useNovelWorkspaceActions, useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import './index.css'

interface Props {
  novelId: number
}

interface PremiseFormValues {
  positioning: string
  coreHook: string
  protagonistStart: string
  constraints: string
  languageGuardrails: string
  antiAiFlavor: string
  commonSenseRules: string
  bannedTerms: string
}

type PremiseGenerationResultWithMeta = PremiseGenerationResult & {
  missingFields?: string[]
  draftTaskId?: number
}

const EMPTY_STATS = {
  mapCount: 0,
  characterCount: 0,
  itemCount: 0,
  outlineCount: 0,
  timelineCount: 0,
  chapterCount: 0,
  completedChapterCount: 0,
  totalWords: 0,
  hasProtagonist: false,
}

const PREMISE_FIELD_LABELS: Record<string, string> = {
  positioning: '作品定位',
  coreHook: '核心信息',
  protagonistStart: '主角起点',
  constraints: '底层约束',
  languageGuardrails: '语言边界',
  antiAiFlavor: '去 AI 腔规则',
  commonSenseRules: '常识约束',
  bannedTerms: '禁用表达',
}

function normalizeText(value?: string | null): string {
  return value?.trim() || ''
}

function parsePremiseSettings(raw?: string | null) {
  const parsed = parseStorySettingsSnapshot(raw)
  if (!raw) return parsed

  try {
    const rootValue = JSON.parse(raw) as unknown
    if (!rootValue || typeof rootValue !== 'object' || Array.isArray(rootValue)) return parsed

    const root = rootValue as Record<string, unknown>
    const legacyPremise = root.premise && typeof root.premise === 'object' && !Array.isArray(root.premise)
      ? root.premise as Record<string, unknown>
      : {}
    const legacyWritingRules = root.writingRules && typeof root.writingRules === 'object' && !Array.isArray(root.writingRules)
      ? root.writingRules as Record<string, unknown>
      : {}
    const legacyText = (record: Record<string, unknown>, key: string) => (
      typeof record[key] === 'string' ? normalizeText(record[key] as string) : ''
    )

    return {
      ...parsed,
      premise: {
        ...parsed.premise,
        coreHook: parsed.premise.coreHook || legacyText(legacyPremise, 'coreHook'),
        protagonistStart: parsed.premise.protagonistStart || legacyText(legacyPremise, 'protagonistStart'),
        languageGuardrails: parsed.premise.languageGuardrails || legacyText(legacyPremise, 'languageGuardrails'),
      },
      writingRules: {
        ...parsed.writingRules,
        antiAiFlavor: parsed.writingRules.antiAiFlavor || legacyText(legacyWritingRules, 'antiAiFlavor'),
        commonSenseRules: parsed.writingRules.commonSenseRules || legacyText(legacyWritingRules, 'commonSenseRules'),
        bannedTerms: parsed.writingRules.bannedTerms || legacyText(legacyWritingRules, 'bannedTerms'),
      },
    }
  } catch {
    return parsed
  }
}

function compactText(value?: string | null, max = 46): string {
  const text = value?.trim() || ''
  if (!text) return '未补背景'
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function mergeGeneratedValues(
  current: PremiseFormValues,
  result: PremiseGenerationResult,
  mode: PremiseGenerationMode,
): PremiseFormValues {
  const pick = (existing?: string | null, next?: string | null) => {
    const currentValue = normalizeText(existing)
    if (mode === 'fill_blanks' && currentValue) return currentValue
    return normalizeText(next)
  }

  return {
    positioning: pick(current.positioning, result.positioning),
    coreHook: pick(current.coreHook, result.coreHook),
    protagonistStart: pick(current.protagonistStart, result.protagonistStart),
    constraints: pick(current.constraints, result.constraints),
    languageGuardrails: pick(current.languageGuardrails, result.languageGuardrails),
    antiAiFlavor: pick(current.antiAiFlavor, result.antiAiFlavor),
    commonSenseRules: pick(current.commonSenseRules, result.commonSenseRules),
    bannedTerms: pick(current.bannedTerms, result.bannedTerms),
  }
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

export default function PremisePage({ novelId }: Props) {
  const navigate = useNavigate()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const { notifyWorkspaceMutation, registerClearHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const pendingResultKey = useMemo(() => buildAiResultKey('premise_generate', novelId), [novelId])
  const [form] = Form.useForm<PremiseFormValues>()
  const [saving, setSaving] = useState(false)
  const [generatingMode, setGeneratingMode] = useState<PremiseGenerationMode | null>(null)
  const [generationProgress, setGenerationProgress] = useState<PremiseGenerationProgressEvent | null>(null)
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)
  const [stats, setStats] = useState(EMPTY_STATS)
  const aliveRef = useRef(true)
  const pendingResult = useAiResultStore(
    (state) => state.results[pendingResultKey],
  )
  const setPendingResult = useAiResultStore((state) => state.setPendingResult)
  const markApplied = useAiResultStore((state) => state.markApplied)
  const clearPendingResult = useAiResultStore((state) => state.clearPendingResult)

  const settings = useMemo(
    () => parsePremiseSettings(currentNovel?.settingsJson),
    [currentNovel?.settingsJson],
  )

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    form.setFieldsValue({
      positioning: settings.premise.positioning,
      coreHook: settings.premise.coreHook,
      protagonistStart: settings.premise.protagonistStart,
      constraints: settings.premise.constraints,
      languageGuardrails: settings.premise.languageGuardrails,
      antiAiFlavor: settings.writingRules.antiAiFlavor,
      commonSenseRules: settings.writingRules.commonSenseRules,
      bannedTerms: settings.writingRules.bannedTerms,
    })
  }, [form, settings])

  useEffect(() => {
    let active = true
    void loadWorkflowStats(novelId).then((workflowStats) => {
      if (active) setStats(workflowStats)
    }).catch(console.error)
    return () => {
      active = false
    }
  }, [novelId])

  useEffect(() => {
    const unsubscribe = window.electron.on('ai:premise-progress', (...args) => {
      const payload = args[0] as PremiseGenerationProgressEvent | undefined
      if (!payload || payload.novelId !== novelId) return
      setGenerationProgress(payload)
    })
    return unsubscribe
  }, [novelId])

  useEffect(() => {
    if (!pendingResult?.appliedAt) return

    const applyMode = (pendingResult.appliedMode || pendingResult.mode || 'replace') as PremiseGenerationMode
    const currentValues = form.getFieldsValue()
    form.setFieldsValue(mergeGeneratedValues(currentValues, pendingResult.result, applyMode))
  }, [
    form,
    pendingResult?.appliedAt,
    pendingResult?.appliedMode,
    pendingResult?.completedAt,
    pendingResult?.mode,
    pendingResult?.result,
  ])

  useEffect(() => {
    if (pendingResult) return

    let active = true
    void window.electron.premiseDraft.getLatest(novelId).then((draft) => {
      if (!active || !draft) return

      const restored = draft as PremiseDraftRecord
      setPendingResult({
        key: pendingResultKey,
        taskType: 'premise_generate',
        novelId,
        status: restored.status,
        result: restored.result as PremiseGenerationResultWithMeta,
        warnings: restored.warnings,
        sourcePage: restored.sourcePage,
        mode: restored.mode,
        appliedMode: restored.appliedMode,
        createdAt: restored.createdAt,
        completedAt: restored.completedAt,
        appliedAt: restored.appliedAt,
      })
    }).catch((error) => {
      console.error(error)
    })

    return () => {
      active = false
    }
  }, [novelId, pendingResult, pendingResultKey, setPendingResult])

  const syncDraftApplied = async (
    result: PremiseGenerationResultWithMeta | undefined,
    mode: PremiseGenerationMode,
  ) => {
    if (!result?.draftTaskId) return

    try {
      await window.electron.premiseDraft.markApplied(result.draftTaskId, mode)
    } catch (error) {
      console.error(error)
    }
  }

  const clearPersistedDrafts = React.useCallback(async () => {
    try {
      await window.electron.premiseDraft.clearAll(novelId)
    } catch (error) {
      console.error(error)
    }
  }, [novelId])

  const handleDiscardPendingResult = async () => {
    await clearPersistedDrafts()
    clearPendingResult(pendingResultKey)
    message.info(getUserFacingMessage('premise.discardedDraft'))
  }

  const formValues = (Form.useWatch([], form) as Partial<PremiseFormValues> | undefined) || {}
  const savedFormValues = useMemo<PremiseFormValues>(() => ({
    positioning: settings.premise.positioning,
    coreHook: settings.premise.coreHook,
    protagonistStart: settings.premise.protagonistStart,
    constraints: settings.premise.constraints,
    languageGuardrails: settings.premise.languageGuardrails,
    antiAiFlavor: settings.writingRules.antiAiFlavor,
    commonSenseRules: settings.writingRules.commonSenseRules,
    bannedTerms: settings.writingRules.bannedTerms,
  }), [settings])
  const savedValuesSignature = useMemo(() => JSON.stringify({
    positioning: normalizeText(savedFormValues.positioning),
    coreHook: normalizeText(savedFormValues.coreHook),
    protagonistStart: normalizeText(savedFormValues.protagonistStart),
    constraints: normalizeText(savedFormValues.constraints),
    languageGuardrails: normalizeText(savedFormValues.languageGuardrails),
    antiAiFlavor: normalizeText(savedFormValues.antiAiFlavor),
    commonSenseRules: normalizeText(savedFormValues.commonSenseRules),
    bannedTerms: normalizeText(savedFormValues.bannedTerms),
  }), [savedFormValues])
  const [lastSavedSignature, setLastSavedSignature] = useState(savedValuesSignature)
  useEffect(() => {
    setLastSavedSignature(savedValuesSignature)
  }, [savedValuesSignature])
  const currentFormValues = { ...savedFormValues, ...formValues }
  const currentValuesSignature = JSON.stringify({
    positioning: normalizeText(currentFormValues.positioning),
    coreHook: normalizeText(currentFormValues.coreHook),
    protagonistStart: normalizeText(currentFormValues.protagonistStart),
    constraints: normalizeText(currentFormValues.constraints),
    languageGuardrails: normalizeText(currentFormValues.languageGuardrails),
    antiAiFlavor: normalizeText(currentFormValues.antiAiFlavor),
    commonSenseRules: normalizeText(currentFormValues.commonSenseRules),
    bannedTerms: normalizeText(currentFormValues.bannedTerms),
  })
  const hasUnsavedChanges = currentValuesSignature !== lastSavedSignature
  useRegisterWorkspaceLeaveGuard(hasUnsavedChanges)
  const assetReadiness = [
    isWorldFoundationReady(currentNovel),
    isMapStructureReady(stats),
    isCharacterRosterReady(stats),
    isItemsEquipmentReady(stats),
  ].filter(Boolean).length
  const storyDesignReady = isStoryPlotReady(currentNovel)
  const premiseFilledCount = [
    formValues.positioning,
    formValues.coreHook,
    formValues.protagonistStart,
    formValues.constraints,
    formValues.languageGuardrails,
  ].filter((value) => typeof value === 'string' && value.trim()).length
  const writingRuleCount = [
    formValues.antiAiFlavor,
    formValues.commonSenseRules,
    formValues.bannedTerms,
  ].filter((value) => typeof value === 'string' && value.trim()).length

  const pendingMissingFields = pendingResult?.result.missingFields || []

  const applyPendingResult = async (mode: PremiseGenerationMode) => {
    if (!pendingResult) return

    const currentValues = form.getFieldsValue()
    form.setFieldsValue(mergeGeneratedValues(currentValues, pendingResult.result, mode))
    markApplied(pendingResultKey, mode)
    await syncDraftApplied(pendingResult.result, mode)
  }

  const workspaceQualityController = useMemo<RegisteredWorkspaceQualityController>(() => ({
    workspaceKey: 'core-settings',
    getSnapshot: () => {
      const values = form.getFieldsValue(true)
      return {
        scope: 'form',
        fields: {
          positioning: typeof values.positioning === 'string' ? values.positioning.trim() : '',
          coreHook: typeof values.coreHook === 'string' ? values.coreHook.trim() : '',
          protagonistStart: typeof values.protagonistStart === 'string' ? values.protagonistStart.trim() : '',
          constraints: typeof values.constraints === 'string' ? values.constraints.trim() : '',
          languageGuardrails: typeof values.languageGuardrails === 'string' ? values.languageGuardrails.trim() : '',
          antiAiFlavor: typeof values.antiAiFlavor === 'string' ? values.antiAiFlavor.trim() : '',
          commonSenseRules: typeof values.commonSenseRules === 'string' ? values.commonSenseRules.trim() : '',
          bannedTerms: typeof values.bannedTerms === 'string' ? values.bannedTerms.trim() : '',
        },
      }
    },
    applySnapshot: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<PremiseFormValues>
        : {}
      form.setFieldsValue({
        positioning: typeof fields.positioning === 'string' ? fields.positioning : undefined,
        coreHook: typeof fields.coreHook === 'string' ? fields.coreHook : undefined,
        protagonistStart: typeof fields.protagonistStart === 'string' ? fields.protagonistStart : undefined,
        constraints: typeof fields.constraints === 'string' ? fields.constraints : undefined,
        languageGuardrails: typeof fields.languageGuardrails === 'string' ? fields.languageGuardrails : undefined,
        antiAiFlavor: typeof fields.antiAiFlavor === 'string' ? fields.antiAiFlavor : undefined,
        commonSenseRules: typeof fields.commonSenseRules === 'string' ? fields.commonSenseRules : undefined,
        bannedTerms: typeof fields.bannedTerms === 'string' ? fields.bannedTerms : undefined,
      })
    },
    persistPreview: async (nextSnapshot) => {
      const fields = nextSnapshot.fields && typeof nextSnapshot.fields === 'object'
        ? nextSnapshot.fields as Partial<PremiseFormValues>
        : {}

      const payload = buildStorySettingsPayload({
        premise: {
          positioning: typeof fields.positioning === 'string' ? normalizeText(fields.positioning) : settings.premise.positioning,
          coreHook: typeof fields.coreHook === 'string' ? normalizeText(fields.coreHook) : settings.premise.coreHook,
          protagonistStart: typeof fields.protagonistStart === 'string' ? normalizeText(fields.protagonistStart) : settings.premise.protagonistStart,
          constraints: typeof fields.constraints === 'string' ? normalizeText(fields.constraints) : settings.premise.constraints,
          languageGuardrails: typeof fields.languageGuardrails === 'string' ? normalizeText(fields.languageGuardrails) : settings.premise.languageGuardrails,
        },
        writingRules: {
          antiAiFlavor: typeof fields.antiAiFlavor === 'string' ? normalizeText(fields.antiAiFlavor) : settings.writingRules.antiAiFlavor,
          commonSenseRules: typeof fields.commonSenseRules === 'string' ? normalizeText(fields.commonSenseRules) : settings.writingRules.commonSenseRules,
          bannedTerms: typeof fields.bannedTerms === 'string' ? normalizeText(fields.bannedTerms) : settings.writingRules.bannedTerms,
        },
      }, currentNovel?.settingsJson)

      await window.electron.novel.update(novelId, {
        settingsJson: JSON.stringify(payload),
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
    },
  }), [currentNovel?.settingsJson, form, novelId, setCurrentNovel, settings])

  useRegisterWorkspaceQualityController(workspaceQualityController)

  const handleSave = React.useCallback(async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return false
    setSaving(true)

    try {
      const payload = buildStorySettingsPayload({
        premise: {
          positioning: normalizeText(values.positioning),
          coreHook: normalizeText(values.coreHook),
          protagonistStart: normalizeText(values.protagonistStart),
          constraints: normalizeText(values.constraints),
          languageGuardrails: normalizeText(values.languageGuardrails),
        },
        writingRules: {
          antiAiFlavor: normalizeText(values.antiAiFlavor),
          commonSenseRules: normalizeText(values.commonSenseRules),
          bannedTerms: normalizeText(values.bannedTerms),
        },
      }, currentNovel?.settingsJson)

      await window.electron.novel.update(novelId, {
        settingsJson: JSON.stringify(payload),
      })

      const updated = await window.electron.novel.get(novelId)
      if (updated) setCurrentNovel(updated)
      setLastSavedSignature(JSON.stringify({
        positioning: normalizeText(values.positioning),
        coreHook: normalizeText(values.coreHook),
        protagonistStart: normalizeText(values.protagonistStart),
        constraints: normalizeText(values.constraints),
        languageGuardrails: normalizeText(values.languageGuardrails),
        antiAiFlavor: normalizeText(values.antiAiFlavor),
        commonSenseRules: normalizeText(values.commonSenseRules),
        bannedTerms: normalizeText(values.bannedTerms),
      }))
      await clearPersistedDrafts()
      if (pendingResult?.appliedAt) {
        clearPendingResult(pendingResultKey)
      }
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('premise.saved'))
      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'premise.saveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }, [clearPendingResult, clearPersistedDrafts, currentNovel?.settingsJson, form, novelId, notifyWorkspaceMutation, pendingResult?.appliedAt, pendingResultKey, setCurrentNovel])

  const navigateToThemeVoice = () => {
    if (!hasUnsavedChanges) {
      navigate(buildWorkspaceRoute(novelId, 'theme-voice'))
      return
    }
    Modal.confirm({
      title: '基础设定还有未保存修改',
      content: '先保存当前故事发动机与约束，再进入主题与文风。',
      okText: '保存并离开',
      cancelText: '留在当前页',
      onOk: async () => {
        const saved = await handleSave()
        if (saved) navigate(buildWorkspaceRoute(novelId, 'theme-voice'))
      },
    })
  }

  useEffect(() => {
    registerSaveHandler(() => {
      if (hasUnsavedChanges && !saving) void handleSave()
    })
    return () => registerSaveHandler(null)
  }, [handleSave, hasUnsavedChanges, registerSaveHandler, saving])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges || saving) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges, saving])

  const handleGenerate = async (mode: PremiseGenerationMode) => {
    setGeneratingMode(mode)
    setGenerationProgress(null)
    const startedAt = new Date().toISOString()

    try {
      const result = await window.electron.ai.generatePremise({
        novelId,
        mode,
        requirements: '只生成基础设定与写作边界，不要写主线、支线、章节、阶段转折和结局。',
      })

      setPendingResult({
        key: pendingResultKey,
        taskType: 'premise_generate',
        novelId,
        status: 'pending',
        result,
        warnings: result.warnings,
        sourcePage: 'premise',
        mode,
        createdAt: startedAt,
        completedAt: new Date().toISOString(),
      })

      if (aliveRef.current) {
        const currentValues = form.getFieldsValue()
        form.setFieldsValue(mergeGeneratedValues(currentValues, result, mode))
        markApplied(pendingResultKey, mode)
        await syncDraftApplied(result as PremiseGenerationResultWithMeta, mode)

        if (result.warnings.length > 0) {
          message.warning(getUserFacingMessage('premise.generatedWithWarnings', { count: result.warnings.length }))
        } else if (mode === 'fill_blanks') {
          message.success(getUserFacingMessage('premise.filledBlanks'))
        } else {
          message.success(getUserFacingMessage('premise.generated'))
        }
      } else {
        notification.success({
          message: getUserFacingMessage('premise.notificationCompletedTitle'),
          description: result.warnings.length > 0
            ? getUserFacingMessage('premise.notificationCompletedDescriptionWithWarnings', { count: result.warnings.length })
            : getUserFacingMessage('premise.notificationCompletedDescription'),
          duration: 6,
          placement: 'bottomRight',
          onClick: () => {
            navigate(buildWorkspaceRoute(novelId, 'core-settings'))
          },
        })
      }
    } catch (error) {
      console.error(error)
      const errorMessage = error instanceof Error ? error.message : getUserFacingMessage('premise.generateFailed')
      if (aliveRef.current) {
        message.error(errorMessage)
      } else {
        notification.error({
          message: getUserFacingMessage('premise.notificationFailedTitle'),
          description: errorMessage,
          duration: 6,
          placement: 'bottomRight',
          onClick: () => {
            navigate(buildWorkspaceRoute(novelId, 'core-settings'))
          },
        })
      }
    } finally {
      if (aliveRef.current) {
        setGeneratingMode(null)
        setGenerationProgress(null)
      }
    }
  }

  const handleClear = React.useCallback(() => {
    Modal.confirm({
      title: '清空基础设定？',
      content: '会清空当前基础设定与写作边界字段，并直接保存为空白基线。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const payload = buildStorySettingsPayload({
          premise: {
            positioning: '',
            coreHook: '',
            protagonistStart: '',
            constraints: '',
            languageGuardrails: '',
          },
          writingRules: {
            antiAiFlavor: '',
            commonSenseRules: '',
            bannedTerms: '',
          },
        }, currentNovel?.settingsJson)

        await window.electron.novel.update(novelId, {
          settingsJson: JSON.stringify(payload),
        })

        const updated = await window.electron.novel.get(novelId)
        if (updated) setCurrentNovel(updated)
        form.setFieldsValue({
          positioning: '',
          coreHook: '',
          protagonistStart: '',
          constraints: '',
          languageGuardrails: '',
          antiAiFlavor: '',
          commonSenseRules: '',
          bannedTerms: '',
        })
        await clearPersistedDrafts()
        clearPendingResult(pendingResultKey)
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('premise.cleared'))
      },
    })
  }, [clearPersistedDrafts, clearPendingResult, currentNovel?.settingsJson, form, novelId, notifyWorkspaceMutation, pendingResultKey, setCurrentNovel])

  useEffect(() => {
    registerClearHandler(handleClear)
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  return (
    <WorkspacePage
      className="novel-premise-page"
      layout="wide"
      heroVariant="compact"
      chrome="shared"
      title="基础设定"
      actionContract={{
        primary: {
          key: 'save',
          label: '保存基础设定',
          icon: <SaveOutlined />,
          loading: saving,
          onClick: () => void handleSave(),
        },
        secondary: [
          {
            key: 'generate',
            label: 'AI 生成·基础设定',
            icon: <RobotOutlined />,
            loading: generatingMode === 'replace',
            disabled: Boolean(generatingMode),
            onClick: () => void handleGenerate('replace'),
          },
          {
            key: 'fill-blanks',
            label: 'AI 补全·空白字段',
            loading: generatingMode === 'fill_blanks',
            disabled: Boolean(generatingMode),
            onClick: () => void handleGenerate('fill_blanks'),
          },
          {
            key: 'theme-voice',
            label: '去主题与文风',
            icon: <ArrowRightOutlined />,
            onClick: navigateToThemeVoice,
          },
        ],
      }}
    >
      <div className="premise-page__status-rail" data-premise-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
        <div>
          <strong>{hasUnsavedChanges ? '有未保存修改' : '已与项目数据同步'}</strong>
          <span>{currentNovel?.genreName || '未设置题材'} · 基础字段 {premiseFilledCount}/5 · 高级边界 {writingRuleCount}/3</span>
        </div>
        <div className="premise-page__status-meta">
          <span>世界资产 {assetReadiness}/4</span>
          <span>故事设计 {storyDesignReady ? '已存在' : '待设计'}</span>
        </div>
      </div>
      {!currentNovel?.expandedBackground && !currentNovel?.synopsis ? (
        <Alert type="warning" showIcon message="背景信息未补全" />
      ) : null}

      {generationProgress ? (
        <Alert
          type="info"
          showIcon
          message={`AI 正在生成：${generationProgress.label}`}
          description={generationProgress.detail || '正在根据当前背景和资产整理基础设定。'}
        />
      ) : null}

      {pendingResult ? (
        <div className="premise-page__ai-result-bar" data-premise-ai-result={pendingResult.appliedAt ? 'applied' : 'pending'}>
          <div>
            <strong>{pendingResult.mode === 'fill_blanks' ? 'AI 补空草稿' : 'AI 基础设定草稿'}</strong>
            <span>{pendingResult.appliedAt ? '已填入表单，保存前仍可重新应用。' : '已生成，等待应用。'}</span>
          </div>
          <Space size={8} wrap>
            <Tag color={pendingResult.appliedAt ? 'green' : 'gold'}>{pendingResult.appliedAt ? '未保存' : '待应用'}</Tag>
            {pendingMissingFields.length > 0 ? <Tag color="red">缺少 {pendingMissingFields.length} 项</Tag> : null}
            <Button size="small" onClick={() => setAiDrawerOpen(true)}>查看 AI 草稿</Button>
          </Space>
        </div>
      ) : null}

      <Form form={form} layout="vertical" className="premise-page__form">
        <WorkspacePanel
          className="premise-page__editor"
          title="故事发动机"
          extra={(
            <AIGenerateButton
            novelId={novelId}
            label="AI 生成·基础设定块"
            intent={hasFilledValues([
              typeof formValues.positioning === 'string' ? formValues.positioning : '',
              typeof formValues.coreHook === 'string' ? formValues.coreHook : '',
              typeof formValues.protagonistStart === 'string' ? formValues.protagonistStart : '',
              typeof formValues.constraints === 'string' ? formValues.constraints : '',
              typeof formValues.languageGuardrails === 'string' ? formValues.languageGuardrails : '',
            ]) ? 'complete' : 'generate'}
            isJson
            buildMessages={() => buildDraftMessages({
              task: '基础设定主块',
              mode: hasFilledValues([
                typeof formValues.positioning === 'string' ? formValues.positioning : '',
                typeof formValues.coreHook === 'string' ? formValues.coreHook : '',
                typeof formValues.protagonistStart === 'string' ? formValues.protagonistStart : '',
                typeof formValues.constraints === 'string' ? formValues.constraints : '',
                typeof formValues.languageGuardrails === 'string' ? formValues.languageGuardrails : '',
              ]) ? 'optimize' : 'replace',
              context: buildPlanningContextSections(currentNovel, {
                includeSubplots: false,
                extraSections: [
                  { label: '世界资产就绪', value: `${assetReadiness}/4` },
                ],
              }),
              fields: [
                { key: 'positioning', label: '作品定位', value: formValues.positioning, hint: '写清时代、环境、社会压力和整体叙事方向。' },
                { key: 'coreHook', label: '核心信息', value: formValues.coreHook, hint: '写这部书最值得展开的核心信息，不直接展开成事件链。' },
                { key: 'protagonistStart', label: '主角起点', value: formValues.protagonistStart, hint: '写身份、处境、资源和限制。' },
                { key: 'constraints', label: '底层约束', value: formValues.constraints, hint: '写不能违背的世界规则、社会规则、代价和常识边界。' },
                { key: 'languageGuardrails', label: '语言边界', value: formValues.languageGuardrails, hint: '写命名、称呼、语气、禁用表达和叙述口径边界。' },
              ],
              requirements: [
                '只生成基础设定，不要代替故事设计页面写主线、支线、章节和结局。',
                '必须与现有简介、背景、题材和世界资产一致。',
              ],
            })}
            onResult={(raw) => {
              const draft = parseDraftJson<Partial<PremiseFormValues>>(raw)
              form.setFieldsValue({
                positioning: typeof draft.positioning === 'string' ? draft.positioning : undefined,
                coreHook: typeof draft.coreHook === 'string' ? draft.coreHook : undefined,
                protagonistStart: typeof draft.protagonistStart === 'string' ? draft.protagonistStart : undefined,
                constraints: typeof draft.constraints === 'string' ? draft.constraints : undefined,
                languageGuardrails: typeof draft.languageGuardrails === 'string' ? draft.languageGuardrails : undefined,
              })
            }}
            />
          )}
        >
          <div className="premise-page__core-grid" data-premise-core-fields="visible">
            <div className="premise-page__field">
              <Form.Item name="positioning" label="作品定位" rules={[{ required: true, message: '请写清作品定位' }]}>
                <Input.TextArea rows={4} placeholder="写清作品的时代、环境、社会压力和整体叙事方向。" />
              </Form.Item>
            </div>
            <div className="premise-page__field">
              <Form.Item name="coreHook" label="核心钩子" rules={[{ required: true, message: '请写清核心钩子' }]}>
                <Input.TextArea rows={4} placeholder="写这部书最值得展开的核心钩子，不要直接写成事件链。" />
              </Form.Item>
            </div>
            <div className="premise-page__field">
              <Form.Item name="protagonistStart" label="主角起点" rules={[{ required: true, message: '请写清主角起点' }]}>
                <Input.TextArea rows={4} placeholder="写主角开局的身份、处境、资源和限制。" />
              </Form.Item>
            </div>
            <div className="premise-page__field">
              <Form.Item name="constraints" label="底层约束" rules={[{ required: true, message: '请写清底层约束' }]}>
                <Input.TextArea rows={4} placeholder="写不能违背的世界规则、社会规则、代价和常识边界。" />
              </Form.Item>
            </div>
          </div>
        </WorkspacePanel>

        <WorkspacePanel
          className="premise-page__advanced-panel"
          extra={(
            <AIGenerateButton
            novelId={novelId}
            label="AI 生成·写作边界"
            intent={hasFilledValues([
              typeof formValues.antiAiFlavor === 'string' ? formValues.antiAiFlavor : '',
              typeof formValues.commonSenseRules === 'string' ? formValues.commonSenseRules : '',
              typeof formValues.bannedTerms === 'string' ? formValues.bannedTerms : '',
            ]) ? 'complete' : 'generate'}
            isJson
            buildMessages={() => buildDraftMessages({
              task: '写作边界与语言限制',
              mode: hasFilledValues([
                typeof formValues.antiAiFlavor === 'string' ? formValues.antiAiFlavor : '',
                typeof formValues.commonSenseRules === 'string' ? formValues.commonSenseRules : '',
                typeof formValues.bannedTerms === 'string' ? formValues.bannedTerms : '',
              ]) ? 'optimize' : 'replace',
              context: buildPlanningContextSections(currentNovel, {
                includeSubplots: false,
                extraSections: [
                  { label: '当前基础设定', value: [
                    typeof formValues.positioning === 'string' ? `定位：${formValues.positioning}` : '',
                    typeof formValues.constraints === 'string' ? `约束：${formValues.constraints}` : '',
                    typeof formValues.languageGuardrails === 'string' ? `语言边界：${formValues.languageGuardrails}` : '',
                  ].filter(Boolean).join('\n') },
                ],
              }),
              fields: [
                { key: 'antiAiFlavor', label: '去 AI 腔规则', value: formValues.antiAiFlavor, hint: '写需要长期压制的总结腔、模板句和空泛句式。' },
                { key: 'commonSenseRules', label: '常识约束', value: formValues.commonSenseRules, hint: '写人物行为、伤势、资源、地图距离和制度压力的底线。' },
                { key: 'bannedTerms', label: '禁用表达', value: formValues.bannedTerms, hint: '写需要尽量避免的空洞词、套话和生造词。' },
              ],
              requirements: [
                '写成可执行规则，不要写空泛价值判断。',
                '必须服务当前题材、背景和人物生态。',
              ],
            })}
            onResult={(raw) => {
              const draft = parseDraftJson<Partial<PremiseFormValues>>(raw)
              form.setFieldsValue({
                antiAiFlavor: typeof draft.antiAiFlavor === 'string' ? draft.antiAiFlavor : undefined,
                commonSenseRules: typeof draft.commonSenseRules === 'string' ? draft.commonSenseRules : undefined,
                bannedTerms: typeof draft.bannedTerms === 'string' ? draft.bannedTerms : undefined,
              })
            }}
            />
          )}
        >
          <details className="premise-page__advanced" data-premise-disclosure="advanced-rules">
            <summary>
              <span className="premise-page__disclosure-title">语言与高级写作边界</span>
              <span className="premise-page__disclosure-summary">
                {compactText(currentFormValues.languageGuardrails || currentFormValues.antiAiFlavor || currentFormValues.commonSenseRules, 72)}
              </span>
              <span className="premise-page__disclosure-action">查看详情</span>
            </summary>
            <div className="premise-page__advanced-content">
              <div className="premise-page__language-handoff">
                <div>
                  <strong>语言边界兼容字段</strong>
                  <span>这里保留既有项目数据；完整主题、口吻与对白规范在“主题与文风”统一确认。</span>
                </div>
                <Button size="small" icon={<ArrowRightOutlined />} onClick={navigateToThemeVoice}>去主题与文风</Button>
              </div>
              <div className="premise-page__advanced-grid">
                <div className="premise-page__field premise-page__field--full">
                  <Form.Item name="languageGuardrails" label="语言边界">
                    <Input.TextArea rows={4} placeholder="写命名、称呼、语气、禁用表达和叙述口径边界。" />
                  </Form.Item>
                </div>
                <div className="premise-page__field">
                  <Form.Item name="antiAiFlavor" label="去 AI 腔规则">
                    <Input.TextArea rows={5} placeholder="例如：禁止口号式总结、禁止万能情绪句、禁止对称排比收尾。" />
                  </Form.Item>
                </div>
                <div className="premise-page__field">
                  <Form.Item name="commonSenseRules" label="常识约束">
                    <Input.TextArea rows={5} placeholder="例如：人物行为必须服从信息量、伤势、资源、地图距离和制度压力。" />
                  </Form.Item>
                </div>
                <div className="premise-page__field premise-page__field--full">
                  <Form.Item name="bannedTerms" label="禁用表达">
                    <Input.TextArea rows={4} placeholder="写需要尽量避免的空洞词、套话和生造词。" />
                  </Form.Item>
                </div>
              </div>
            </div>
          </details>
        </WorkspacePanel>
      </Form>

      <nav className="premise-page__related" aria-label="基础设定相关模块">
        <span>继续完善</span>
        <Button type="link" icon={<GlobalOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, 'world-rules'))}>世界规则</Button>
        <Button type="link" icon={<EnvironmentOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, 'map'))}>地图</Button>
        <Button type="link" icon={<TeamOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, 'characters'))}>人物</Button>
        <Button type="link" icon={<BarsOutlined />} onClick={() => navigate(buildWorkspaceRoute(novelId, 'story-design'))}>故事设计</Button>
      </nav>

      <Drawer
        title="AI 基础设定草稿"
        width={620}
        open={aiDrawerOpen}
        onClose={() => setAiDrawerOpen(false)}
      >
        {pendingResult ? (
          <div className={`premise-page__pending-result ${pendingResult.appliedAt ? 'premise-page__pending-result--applied' : ''}`}>
            <div className="premise-page__pending-head">
              <div className="premise-page__pending-copy">
                <strong>{pendingResult.mode === 'fill_blanks' ? '补空结果草稿' : '基础设定首版草稿'}</strong>
                <small>{pendingResult.appliedAt ? '结果已填入表单，但尚未保存。' : '结果已生成，等待应用到表单。'}</small>
              </div>
              <Space size={[8, 8]} wrap>
                <Tag color={pendingResult.appliedAt ? 'green' : 'gold'}>{pendingResult.appliedAt ? '已填入未保存' : '待应用'}</Tag>
                <Tag>{pendingResult.result.steps.filter((step) => step.status === 'success' || step.status === 'warning').length}/{pendingResult.result.steps.length} 步</Tag>
              </Space>
            </div>
            {pendingMissingFields.length > 0 ? (
              <div className="premise-page__pending-warnings">{`仍为空：${pendingMissingFields.map((field) => PREMISE_FIELD_LABELS[field] || field).join('、')}`}</div>
            ) : null}
            {pendingResult.warnings.length > 0 ? (
              <div className="premise-page__pending-warnings">
                {pendingResult.warnings.map((warning, index) => <div key={`${pendingResult.completedAt}-${index}`}>{warning}</div>)}
              </div>
            ) : null}
            <div className="premise-page__pending-actions">
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void applyPendingResult('replace')}>
                {pendingResult.appliedAt ? '重新应用全部' : '应用全部'}
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void applyPendingResult('fill_blanks')}>只补空字段</Button>
              <Button danger icon={<DeleteOutlined />} onClick={() => void handleDiscardPendingResult()}>丢弃结果</Button>
            </div>
          </div>
        ) : <Alert type="info" showIcon message="当前没有待处理的 AI 草稿" />}
      </Drawer>
    </WorkspacePage>
  )
}
