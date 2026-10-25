import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input, InputNumber, Select, message } from 'antd'
import { ArrowRightOutlined, SendOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'
import { CREATIVE_STAGES, CREATIVE_STAGE_LABELS, type CreativeStage, type CreativeChangeScope, type CreativeChapterRevision } from '../../../shared/creative-workflow'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { getUserFacingMessage } from '../../../utils/user-facing-message'
import type { Chapter, ModelConfig, RevisionTask } from '../../../types'
import { AuthorPage, EmptyWork, LoadFailure, RunProgress } from './shared'
import { callAuthorTool, useCreativeWorkflow } from './workflow-client'
import { buildStorySettingsPayload, parseStorySettingsDocument } from '../../../shared/story-settings'
import ChapterIndexStatus from './ChapterIndexStatus'
import NovelBookHeading from '../../../components/novel/NovelBookHeading'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import ObjectTaskPanel, { type ObjectTaskTarget } from './ObjectTaskPanel'
import './studio-workspace.css'

type StudioDraft = { stage: CreativeStage; request: string; autoApply: boolean; count: number; sourceArtifactId: string | null; chapterScope?: CreativeChangeScope; repairTargetActive: boolean; atChapter: number | null }
// Form drafts stay in this app session. A target link and another book never share a draft.
const studioDrafts = new Map<string, StudioDraft>()
const STUDIO_TARGET_PARAMS = ['stage', 'request', 'autoApply', 'count', 'sourceArtifactId', 'changeScope', 'revisionIssueIds', 'chapterRevision', 'atChapter']
function studioDraftKey(novelId: number, params: URLSearchParams) {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)])) : value
  const target = new URLSearchParams()
  for (const key of STUDIO_TARGET_PARAMS) {
    const value = params.get(key)
    if (value == null) continue
    if (['changeScope', 'revisionIssueIds', 'chapterRevision'].includes(key)) {
      try { target.set(key, JSON.stringify(stable(JSON.parse(value)))); continue } catch { /* Keep invalid targets isolated until submission reports the error. */ }
    }
    target.set(key, value)
  }
  target.sort()
  return `${novelId}:${target}`
}
function rememberStudioDraft(key: string, draft: StudioDraft) {
  studioDrafts.delete(key); studioDrafts.set(key, structuredClone(draft))
  if (studioDrafts.size > 20) studioDrafts.delete(studioDrafts.keys().next().value!)
}
function initialStudioDraft(key: string, params: URLSearchParams): StudioDraft {
  const cached = studioDrafts.get(key)
  if (cached) { rememberStudioDraft(key, cached); return structuredClone(cached) }
  const previous = [...studioDrafts.entries()].reverse().find(([savedKey]) => savedKey.startsWith(key.slice(0, key.indexOf(':') + 1)))?.[1]
  const stageParam = params.get('stage') as CreativeStage | null
  const stage = stageParam && CREATIVE_STAGES.includes(stageParam) ? stageParam : previous?.stage || 'background'
  return { stage, request: params.get('request') ?? previous?.request ?? '', count: Math.max(1, Number(params.get('count')) || 1),
    autoApply: params.get('autoApply') === 'true' || (params.get('autoApply') !== 'false' && !['characters', 'chapter', 'style'].includes(stage)),
    sourceArtifactId: params.get('sourceArtifactId'), repairTargetActive: true,
    atChapter: params.has('atChapter') ? Math.max(0, Number(params.get('atChapter')) || 0) : null }
}

export default function AuthorStudio({ novelId }: { novelId: number }) {
  const [params] = useSearchParams()
  const draftKey = studioDraftKey(novelId, params)
  return <StudioSession key={draftKey} novelId={novelId} draftKey={draftKey} />
}

function StudioSession({ novelId, draftKey }: { novelId: number; draftKey: string }) {
  const { notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const novel = useNovelStore((state) => state.currentNovel)
  const setNovel = useNovelStore((state) => state.setCurrentNovel)
  const [initial] = useState(() => initialStudioDraft(draftKey, params))
  const [stage, setStage] = useState<CreativeStage>(initial.stage)
  const [request, setRequest] = useState(initial.request)
  const [autoApply, setAutoApply] = useState(initial.autoApply)
  const [count, setCount] = useState<number>(initial.count)
  const [sourceArtifactId, setSourceArtifactId] = useState<string | null>(initial.sourceArtifactId)
  const [chapterScope, setChapterScope] = useState<CreativeChangeScope | undefined>(initial.chapterScope)
  const [checkingNextChapter, setCheckingNextChapter] = useState(false)
  const nextPlanEpoch = useRef(0)
  const [repairTargetActive, setRepairTargetActive] = useState(initial.repairTargetActive)
  const [atChapter, setAtChapter] = useState<number | null>(initial.atChapter)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [issues, setIssues] = useState<RevisionTask[]>([])
  const [dataError, setDataError] = useState('')
  const [models, setModels] = useState<ModelConfig[]>([])
  const [savingModel, setSavingModel] = useState(false)
  const modelSaveInFlight = useRef(false)
  const [task, setTask] = useState<ObjectTaskTarget | null>(null)
  const workflow = useCreativeWorkflow(novelId)
  useLayoutEffect(() => { rememberStudioDraft(draftKey, { stage, request, autoApply, count, sourceArtifactId, chapterScope, repairTargetActive, atChapter }) }, [draftKey, stage, request, autoApply, count, sourceArtifactId, chapterScope, repairTargetActive, atChapter])

  useEffect(() => {
    let current = true
    void window.electron.model.list().then((rows) => { if (current) setModels(rows) }).catch((cause) => { if (current) setDataError(cause instanceof Error ? cause.message : '读取模型配置失败') })
    return () => { current = false }
  }, [novelId])
  const effectiveModel = novel?.modelConfigId ? models.find(model => model.id === novel.modelConfigId) : models.find(model => model.isDefault === 1)
  const reviewerId = parseStorySettingsDocument(novel?.settingsJson).aiEngine.reviewModelConfigId
  const changeReviewer = async (reviewModelConfigId: number) => {
    if (modelSaveInFlight.current || workflow.active || workflow.submitting) return
    modelSaveInFlight.current = true
    setSavingModel(true)
    try {
      const latest = await window.electron.novel.get(novelId)
      if (!latest || latest.id !== novelId) throw new Error(getUserFacingMessage('workspace.projectNotFound'))
      await window.electron.novel.update(novelId, { settingsJson: JSON.stringify(buildStorySettingsPayload({ aiEngine: { reviewModelConfigId: reviewModelConfigId || null } }, latest.settingsJson)) }, { expectedContextVersion: latest.contextVersion })
      const updated = await window.electron.novel.get(novelId)
      if (updated?.id === novelId && useNovelStore.getState().currentNovel?.id === novelId) setNovel(updated)
      setDataError('')
    } catch (cause) { setDataError(cause instanceof Error ? cause.message : '保存审校模型失败') }
    finally { modelSaveInFlight.current = false; setSavingModel(false) }
  }
  const changeModel = async (modelConfigId: number) => {
    if (modelSaveInFlight.current || workflow.active || workflow.submitting) return
    modelSaveInFlight.current = true
    setSavingModel(true)
    try {
      const latest = await window.electron.novel.get(novelId)
      if (!latest || latest.id !== novelId) throw new Error(getUserFacingMessage('workspace.projectNotFound'))
      await window.electron.novel.update(novelId, { modelConfigId }, { expectedContextVersion: latest.contextVersion })
      const updated = await window.electron.novel.get(novelId)
      if (updated?.id === novelId && useNovelStore.getState().currentNovel?.id === novelId) {
        setNovel(updated)
        setDataError(''); message.success(getUserFacingMessage('workspace.modelUpdated'))
      }
    } catch (cause) { setDataError(cause instanceof Error ? cause.message : '保存项目模型失败') }
    finally { modelSaveInFlight.current = false; setSavingModel(false) }
  }

  useEffect(() => {
    let current = true
    Promise.all([window.electron.chapter.list(novelId), window.electron.revision.list(novelId)])
      .then(([nextChapters, nextIssues]) => { if (current) { setChapters(nextChapters); setIssues(nextIssues); setDataError('') } })
      .catch((cause) => { if (current) setDataError(cause instanceof Error ? cause.message : '读取作品资料失败') })
    return () => { current = false }
  }, [novelId, workflow.run?.step])

  useEffect(() => () => { nextPlanEpoch.current += 1 }, [])

  const open = (route: string) => navigate(buildWorkspaceRoute(novelId, route))
  const drafted = chapters.filter((chapter) => Boolean(chapter.content?.trim()) || chapter.wordCount > 0)
  const pendingIssues = issues.filter((issue) => issue.status === 'open' || issue.status === 'in_progress')
  const nextChapter = chapters.find((chapter) => !chapter.content?.trim() && !(chapter.wordCount > 0))
  const targetLocked = Boolean(chapterScope || repairTargetActive && (params.get('changeScope') || sourceArtifactId || params.get('revisionIssueIds') || params.get('chapterRevision')))
  const changeStage = (value: CreativeStage) => { if (value === stage) return; nextPlanEpoch.current += 1; setCheckingNextChapter(false); setStage(value); setRepairTargetActive(false); setSourceArtifactId(null); setChapterScope(undefined); setAutoApply(!['characters', 'chapter', 'style'].includes(value)); if (value === 'chapter' && atChapter === 0) setAtChapter(null) }
  const planNextChapter = async () => {
    if (!nextChapter || workflow.active || workflow.submitting || checkingNextChapter) return
    const epoch = ++nextPlanEpoch.current
    setCheckingNextChapter(true)
    setDataError('')
    try {
      const readiness = await callAuthorTool<{ ready: boolean; chapterId: number | null; blockers: string[] }>('novelforge.chapters.readiness', { novelId, atChapter: nextChapter.chapterNum })
      if (epoch !== nextPlanEpoch.current) return
      if (readiness.chapterId !== nextChapter.id) throw new Error(getUserFacingMessage('workspace.nextChapterChanged'))
      const chapterStage = readiness.ready ? 'chapter' : 'outline'
      setStage(chapterStage)
      setRepairTargetActive(false)
      setSourceArtifactId(null)
      setChapterScope(undefined)
      setAutoApply(false)
      setCount(1)
      setAtChapter(nextChapter.chapterNum)
      if (readiness.ready) setRequest(`根据现有设定和前文，生成第 ${nextChapter.chapterNum} 章《${nextChapter.title || '未命名'}》候选，完成连续性与叙事评审。`)
      else {
        setAutoApply(false)
        if (readiness.chapterId) setChapterScope({ chapterIds: [readiness.chapterId], preserveChapterFields: ['title', 'outline', 'volumeId', 'partId', 'targetWords', 'allowedFactIds', 'revealedFactIds'] })
        setRequest(`仅补齐第 ${nextChapter.chapterNum} 章《${nextChapter.title || '未命名'}》的章节目标与完整场景安排；保留已有大纲、事实揭示边界和有效场景。需解决：${readiness.blockers.join('；')}。`)
      }
    } catch (cause) { if (epoch === nextPlanEpoch.current) setDataError(cause instanceof Error ? cause.message : '检查下一章准备情况失败') }
    finally { if (epoch === nextPlanEpoch.current) setCheckingNextChapter(false) }
  }

  return <AuthorPage title="创作台">
    {novel?.id === novelId && <NovelBookHeading key={novelId} novel={novel} chapterCount={chapters.length} onOpenChapters={() => open('writing/editor')} onManageModels={() => navigate('/models')} onSaved={notifyWorkspaceMutation} />}
    <div className="studio-workbench">
    <section className="studio-workbench__main" aria-label="本轮创作工作区">
    <section className="author-composer studio-composer" aria-label="本轮创作要求">
      <h2 className="studio-composer__heading"><label htmlFor="author-request">这一轮的要求</label></h2>
      {chapterScope?.chapterIds?.length && <p className="author-composer__hint studio-composer__boundary">本轮只修改第 {atChapter} 章的章节安排{chapterScope.preserveChapterFields?.length ? '，保留原章名、大纲、卷章位置与信息揭示' : ''}。</p>}
      {sourceArtifactId && <p className="author-composer__hint studio-composer__boundary">正在修订所选候选</p>}
      <Input.TextArea id="author-request" value={request} disabled={checkingNextChapter || workflow.submitting} onChange={(event) => setRequest(event.target.value)} autoSize={{ minRows: 5, maxRows: 12 }}
        placeholder="例如：结合前三章，把借灯客栈的地点和通行关系补齐，检查人物能否按现有线索完成调查。" />
      <div className="studio-composer__targets">
        <label>创作内容 <Select aria-label="创作内容" value={stage} disabled={checkingNextChapter || workflow.submitting} onChange={changeStage} options={CREATIVE_STAGES.map((value) => ({ value, label: CREATIVE_STAGE_LABELS[value] }))} /></label>
        <label>章位 <InputNumber aria-label="章节位置" min={stage === 'chapter' ? 1 : 0} precision={0} disabled={targetLocked || checkingNextChapter || workflow.submitting} value={stage === 'chapter' && atChapter === 0 ? null : atChapter} placeholder={stage === 'chapter' ? '下一章' : '当前'} title={targetLocked ? '已定位修订目标；切换创作内容可开始新的要求' : '正文留空表示下一章；其他内容的 0 表示初始设定'} onChange={value => setAtChapter(value)} /></label>
        {!['background', 'world_rules', 'story', 'style', 'chapter'].includes(stage) && <label>本轮数量 <InputNumber aria-label="本轮生成数量" min={1} max={30} precision={0} disabled={targetLocked || checkingNextChapter || workflow.submitting} value={count} onChange={value => setCount(value || 1)} /></label>}
      </div>
      <div className="studio-composer__submit">
        <Checkbox disabled={checkingNextChapter || workflow.submitting} checked={autoApply} onChange={(event) => setAutoApply(event.target.checked)}>模型评审通过后应用</Checkbox>
        <Button type="primary" icon={<SendOutlined />} loading={workflow.submitting} disabled={workflow.active || checkingNextChapter || savingModel || !request.trim() || !effectiveModel || Boolean(reviewerId && !models.some(model => model.id === reviewerId))} onClick={() => {
          try {
            const changeScope = chapterScope || (repairTargetActive && params.get('changeScope') ? JSON.parse(params.get('changeScope')!) as CreativeChangeScope : undefined)
            const revisionIssueIds = repairTargetActive && params.get('revisionIssueIds') ? JSON.parse(params.get('revisionIssueIds')!) as number[] : undefined
            const chapterRevision = stage === 'chapter' && repairTargetActive && params.get('chapterRevision') ? JSON.parse(params.get('chapterRevision')!) as CreativeChapterRevision : undefined
            void workflow.start({ stage, request: request.trim(), autoApply, count: stage === 'chapter' ? 1 : count, changeScope, revisionIssueIds, chapterRevision, ...(atChapter != null && !(stage === 'chapter' && atChapter === 0) ? { atChapter } : {}), ...(sourceArtifactId ? { sourceArtifactId } : {}) })
          } catch { setDataError('修订目标格式不正确，请重新打开问题。') }
        }}>开始这一轮</Button>
      </div>
      <details className="author-disclosure studio-model-settings" open={!effectiveModel || Boolean(reviewerId && !models.some(model => model.id === reviewerId))}><summary>模型与审校设置{effectiveModel ? ` · ${effectiveModel.name}` : ' · 尚未配置'}</summary>
        <div className="author-model-route"><div className="author-model-route__field"><label htmlFor="author-project-model">生成模型</label><Select id="author-project-model" aria-label="生成模型" value={effectiveModel?.id} placeholder="选择已配置的模型" disabled={workflow.active || workflow.submitting || savingModel || !models.length} loading={savingModel} onChange={(value) => void changeModel(value)} options={models.map((model) => ({ value: model.id, label: `${model.name} · ${model.modelId}` }))} /></div>
          <div className="author-model-route__field"><label htmlFor="author-review-model">审校模型</label><Select id="author-review-model" aria-label="审校模型" value={reviewerId || 0} disabled={workflow.active || workflow.submitting || savingModel} loading={savingModel} onChange={value => void changeReviewer(value)} options={[{ value: 0, label: '跟随生成模型' }, ...models.map(model => ({ value: model.id, label: `${model.name} · ${model.modelId}` }))]} /></div>
          <span>{workflow.active ? '当前任务的模型已固定' : reviewerId && !models.some(model => model.id === reviewerId) ? '原审校模型已不可用，请重新选择' : novel?.modelConfigId && !effectiveModel ? '原项目模型已不可用，请重新选择' : novel?.modelConfigId ? '本项目使用所选模型' : effectiveModel ? '生成模型跟随全局默认' : '先添加模型配置'}</span><Button type="link" onClick={() => navigate('/models')}>管理模型</Button></div>
      </details>
    </section>
    {dataError && <p className="author-error" role="alert">{dataError}</p>}
    {workflow.error && <LoadFailure message={workflow.error} retry={() => void workflow.refresh()} />}
    {workflow.run && <RunProgress run={workflow.run} active={workflow.active} onCancel={() => void workflow.control('cancel')} onResume={() => void workflow.control('resume')} onOpenResult={() => { const run = workflow.run; if (run) setTask({ title: `${CREATIVE_STAGE_LABELS[run.stage]} · 第 ${run.atChapter} 章`, stage: run.stage, request: run.request, atChapter: run.atChapter, changeScope: run.changeScope, chapterRevision: run.chapterRevision, revisionIssueIds: run.revisionIssueIds, sourceArtifactId: run.sourceArtifactId, runId: run.runId, artifactId: run.artifactId }) }} />}
    {!novel?.userBackground?.trim() && !workflow.run && <EmptyWork title="先给故事一个起点" actionLabel="填写背景要求" action={() => { setStage('background'); document.getElementById('author-request')?.focus() }} />}
    </section>
    <aside className="studio-workbench__aside" aria-label="作品进展与问题">
      <section className="author-paper studio-progress"><div className="author-section-heading"><h2>作品进展</h2><Button type="text" size="small" onClick={() => open('writing/editor')}>卷章与正文 <ArrowRightOutlined /></Button></div>
        <div className="author-book-progress"><strong>{drafted.length}<small> 章已有正文</small></strong><span>{chapters.length} 章安排 · {chapters.reduce((total, chapter) => total + (chapter.wordCount || 0), 0).toLocaleString()} 字</span></div>
        <ChapterIndexStatus novelId={novelId} />
        {nextChapter ? <button className="author-next-chapter" disabled={checkingNextChapter || workflow.active || workflow.submitting || savingModel} onClick={() => { void planNextChapter(); document.getElementById('author-request')?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }}><span>{checkingNextChapter ? '检查章节安排' : '下一章'}</span><strong>第 {nextChapter.chapterNum} 章 · {nextChapter.title || '未命名'}</strong><ArrowRightOutlined /></button> : <p className="author-muted">{chapters.length ? '现有章节均已有正文，可继续安排下一阶段。' : '确定故事方向后，开始安排首个单元。'}</p>}
      </section>
      <section className="author-paper studio-issues"><div className="author-section-heading"><h2>需要留意</h2><Button type="text" size="small" onClick={() => open('revision?view=issues')}>查看全部 <ArrowRightOutlined /></Button></div>
        {pendingIssues.length ? <ul className="author-issue-preview">{pendingIssues.slice(0, 3).map((issue) => <li key={issue.id}><button onClick={() => open(`revision?issue=${issue.id}`)}>{issue.title}</button></li>)}</ul> : <p className="author-muted">暂无待处理问题</p>}
      </section>
      <div className="studio-quick-links"><Button type="text" onClick={() => open('story-design?section=sources')}>作者资料卡</Button><Button type="text" onClick={() => open('narrative-board?tab=research')}>联网参考</Button><Button type="text" onClick={() => open('narrative-board?tab=rules')}>世界规则</Button></div>
    </aside>
    </div><ObjectTaskPanel novelId={novelId} target={task} onClose={() => setTask(null)} />
  </AuthorPage>
}
