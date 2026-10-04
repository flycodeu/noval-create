import React, { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input, InputNumber, Select, message } from 'antd'
import { ArrowRightOutlined, SendOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'
import { CREATIVE_STAGES, CREATIVE_STAGE_LABELS, type CreativeStage, type CreativeChangeScope } from '../../../shared/creative-workflow'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type { Chapter, ModelConfig, RevisionTask } from '../../../types'
import { AuthorPage, EmptyWork, LoadFailure, RunProgress } from './shared'
import { callAuthorTool, useCreativeWorkflow } from './workflow-client'
import { buildStorySettingsPayload, parseStorySettingsDocument } from '../../../shared/story-settings'

export default function AuthorStudio({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const novel = useNovelStore((state) => state.currentNovel)
  const setNovel = useNovelStore((state) => state.setCurrentNovel)
  const stageParam = params.get('stage') as CreativeStage | null
  const [stage, setStage] = useState<CreativeStage>(stageParam && CREATIVE_STAGES.includes(stageParam) ? stageParam : 'background')
  const [request, setRequest] = useState(params.get('request') || '')
  const [autoApply, setAutoApply] = useState(params.get('autoApply') === 'true' || (params.get('autoApply') !== 'false' && !['characters', 'chapter', 'style'].includes(stage)))
  const [count, setCount] = useState<number>(Math.max(1, Number(params.get('count')) || 1))
  const [sourceArtifactId, setSourceArtifactId] = useState<string | null>(params.get('sourceArtifactId'))
  const [chapterScope, setChapterScope] = useState<CreativeChangeScope | undefined>()
  const [checkingNextChapter, setCheckingNextChapter] = useState(false)
  const nextPlanEpoch = useRef(0)
  const [repairTargetActive, setRepairTargetActive] = useState(true)
  const [atChapter, setAtChapter] = useState<number | null>(params.has('atChapter') ? Math.max(0, Number(params.get('atChapter')) || 0) : null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [issues, setIssues] = useState<RevisionTask[]>([])
  const [dataError, setDataError] = useState('')
  const [models, setModels] = useState<ModelConfig[]>([])
  const [savingModel, setSavingModel] = useState(false)
  const workflow = useCreativeWorkflow(novelId)

  useEffect(() => {
    let current = true
    void window.electron.model.list().then((rows) => { if (current) setModels(rows) }).catch((cause) => { if (current) setDataError(cause instanceof Error ? cause.message : '读取模型配置失败') })
    return () => { current = false }
  }, [novelId])
  const effectiveModel = novel?.modelConfigId ? models.find(model => model.id === novel.modelConfigId) : models.find(model => model.isDefault === 1)
  const reviewerId = parseStorySettingsDocument(novel?.settingsJson).aiEngine.reviewModelConfigId
  const changeReviewer = async (reviewModelConfigId: number) => {
    setSavingModel(true)
    try {
      const latest = await window.electron.novel.get(novelId)
      if (!latest) throw new Error('项目不存在')
      await window.electron.novel.update(novelId, { settingsJson: JSON.stringify(buildStorySettingsPayload({ aiEngine: { reviewModelConfigId: reviewModelConfigId || null } }, latest.settingsJson)) })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setNovel(updated)
    } catch (cause) { setDataError(cause instanceof Error ? cause.message : '保存审校模型失败') }
    finally { setSavingModel(false) }
  }
  const changeModel = async (modelConfigId: number) => {
    setSavingModel(true)
    try {
      await window.electron.novel.update(novelId, { modelConfigId })
      const updated = await window.electron.novel.get(novelId)
      if (updated) setNovel(updated)
      message.success('项目模型已更新，下一轮创作与 Codex 调用会使用此配置')
    } catch (cause) { setDataError(cause instanceof Error ? cause.message : '保存项目模型失败') }
    finally { setSavingModel(false) }
  }

  useEffect(() => {
    let current = true
    Promise.all([window.electron.chapter.list(novelId), window.electron.revision.list(novelId)])
      .then(([nextChapters, nextIssues]) => { if (current) { setChapters(nextChapters); setIssues(nextIssues); setDataError('') } })
      .catch((cause) => { if (current) setDataError(cause instanceof Error ? cause.message : '读取作品资料失败') })
    return () => { current = false }
  }, [novelId, workflow.run?.step])

  useEffect(() => {
    nextPlanEpoch.current += 1
    setCheckingNextChapter(false)
    setChapterScope(undefined)
    setStage(stageParam && CREATIVE_STAGES.includes(stageParam) ? stageParam : 'background')
    setRepairTargetActive(true)
    setRequest(params.get('request') || '')
    setAtChapter(params.has('atChapter') ? Math.max(0, Number(params.get('atChapter')) || 0) : null)
    setCount(Math.max(1, Number(params.get('count')) || 1))
    setSourceArtifactId(params.get('sourceArtifactId'))
    setAutoApply(params.get('autoApply') === 'true' || (params.get('autoApply') !== 'false' && !['characters', 'chapter', 'style'].includes(stageParam || 'background')))
  }, [novelId, params, stageParam])
  useEffect(() => () => { nextPlanEpoch.current += 1 }, [])

  const open = (route: string) => navigate(buildWorkspaceRoute(novelId, route))
  const drafted = chapters.filter((chapter) => Boolean(chapter.content?.trim()) || chapter.wordCount > 0)
  const pendingIssues = issues.filter((issue) => issue.status === 'open' || issue.status === 'in_progress')
  const nextChapter = chapters.find((chapter) => !chapter.content?.trim() && !(chapter.wordCount > 0))
  const targetLocked = Boolean(chapterScope || repairTargetActive && (params.get('changeScope') || sourceArtifactId || params.get('revisionIssueIds')))
  const changeStage = (value: CreativeStage) => { if (value === stage) return; nextPlanEpoch.current += 1; setCheckingNextChapter(false); setStage(value); setRepairTargetActive(false); setSourceArtifactId(null); setChapterScope(undefined); setAutoApply(!['characters', 'chapter', 'style'].includes(value)); if (value === 'chapter' && atChapter === 0) setAtChapter(null) }
  const planNextChapter = async () => {
    if (!nextChapter || workflow.active || workflow.submitting || checkingNextChapter) return
    const epoch = ++nextPlanEpoch.current
    setCheckingNextChapter(true)
    setDataError('')
    try {
      const readiness = await callAuthorTool<{ ready: boolean; chapterId: number | null; blockers: string[] }>('novelforge.chapters.readiness', { novelId, atChapter: nextChapter.chapterNum })
      if (epoch !== nextPlanEpoch.current) return
      if (readiness.chapterId !== nextChapter.id) throw new Error('下一章目标已变化，请刷新作品进展后重试。')
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
    <nav className="author-stage-path" aria-label="创作内容">{CREATIVE_STAGES.map(value => <button key={value} disabled={checkingNextChapter || workflow.submitting} className={stage === value ? 'is-selected' : ''} onClick={() => changeStage(value)}>{CREATIVE_STAGE_LABELS[value]}</button>)}</nav>
    <div className="author-model-route"><div className="author-model-route__field"><label htmlFor="author-project-model">生成模型</label><Select id="author-project-model" aria-label="生成模型" value={effectiveModel?.id} placeholder="选择已配置的模型" disabled={workflow.active || savingModel || !models.length} loading={savingModel} onChange={(value) => void changeModel(value)} options={models.map((model) => ({ value: model.id, label: `${model.name} · ${model.modelId}` }))} /></div>
      <div className="author-model-route__field"><label htmlFor="author-review-model">审校模型</label><Select id="author-review-model" aria-label="审校模型" value={reviewerId || 0} disabled={workflow.active || savingModel} loading={savingModel} onChange={value => void changeReviewer(value)} options={[{ value: 0, label: '跟随生成模型' }, ...models.map(model => ({ value: model.id, label: `${model.name} · ${model.modelId}` }))]} /></div>
      <span>{workflow.active ? '当前任务的模型已固定' : reviewerId && !models.some(model => model.id === reviewerId) ? '原审校模型已不可用，请重新选择' : novel?.modelConfigId && !effectiveModel ? '原项目模型已不可用，请重新选择' : novel?.modelConfigId ? '已用于本项目及 Codex 调用' : effectiveModel ? '生成模型跟随全局默认' : '先添加模型配置'}</span><Button type="link" onClick={() => navigate('/models')}>管理模型</Button></div>
    <section className="author-composer">
      <label htmlFor="author-request" className="author-composer__label">这一轮的要求</label>
      <Input.TextArea id="author-request" value={request} disabled={checkingNextChapter || workflow.submitting} onChange={(event) => setRequest(event.target.value)} autoSize={{ minRows: 5, maxRows: 12 }}
        placeholder="例如：结合前三章，把借灯客栈的地点和通行关系补齐，检查人物能否按现有线索完成调查。" />
      <div className="author-composer__options">
        <label>创作内容 <Select aria-label="创作内容" value={stage} disabled={checkingNextChapter || workflow.submitting} onChange={changeStage} options={CREATIVE_STAGES.map((value) => ({ value, label: CREATIVE_STAGE_LABELS[value] }))} /></label>
        <label>章位 <InputNumber aria-label="章节位置" min={stage === 'chapter' ? 1 : 0} precision={0} disabled={targetLocked || checkingNextChapter || workflow.submitting} value={stage === 'chapter' && atChapter === 0 ? null : atChapter} placeholder={stage === 'chapter' ? '下一章' : '当前'} title={targetLocked ? '已定位修订目标；切换创作内容可开始新的要求' : '正文留空表示下一章；其他内容的 0 表示初始设定'} onChange={value => setAtChapter(value)} /></label>
        {!['background', 'world_rules', 'story', 'style', 'chapter'].includes(stage) && <label>本轮数量 <InputNumber aria-label="本轮生成数量" min={1} max={30} precision={0} disabled={targetLocked || checkingNextChapter || workflow.submitting} value={count} onChange={value => setCount(value || 1)} /></label>}
        <Checkbox disabled={checkingNextChapter || workflow.submitting} checked={autoApply} onChange={(event) => setAutoApply(event.target.checked)}>模型评审通过后应用</Checkbox>
        <Button type="primary" icon={<SendOutlined />} loading={workflow.submitting} disabled={workflow.active || checkingNextChapter || savingModel || !request.trim() || !effectiveModel || Boolean(reviewerId && !models.some(model => model.id === reviewerId))} onClick={() => {
          try {
            const changeScope = chapterScope || (repairTargetActive && params.get('changeScope') ? JSON.parse(params.get('changeScope')!) as CreativeChangeScope : undefined)
            const revisionIssueIds = repairTargetActive && params.get('revisionIssueIds') ? JSON.parse(params.get('revisionIssueIds')!) as number[] : undefined
            void workflow.start({ stage, request: request.trim(), autoApply, count, changeScope, revisionIssueIds, ...(atChapter != null && !(stage === 'chapter' && atChapter === 0) ? { atChapter } : {}), ...(sourceArtifactId ? { sourceArtifactId } : {}) })
          } catch { setDataError('修订目标格式不正确，请重新打开问题。') }
        }}>开始这一轮</Button>
      </div>
      {chapterScope?.chapterIds?.length && <p className="author-composer__hint">本轮只修改第 {atChapter} 章的章节安排{chapterScope.preserveChapterFields?.length ? '，保留原章名、大纲、卷章位置与信息揭示' : ''}。</p>}
      {sourceArtifactId && <p className="author-composer__hint">正在修订所选候选</p>}
    </section>
    {workflow.error && <LoadFailure message={workflow.error} retry={() => void workflow.refresh()} />}
    {workflow.run && <RunProgress run={workflow.run} active={workflow.active} onCancel={() => void workflow.control('cancel')} onResume={() => void workflow.control('resume')} onOpenResult={() => open(`revision?artifact=${encodeURIComponent(workflow.run?.artifactId || '')}`)} />}
    <div className="author-overview-grid">
      <section className="author-paper"><div className="author-section-heading"><h2>作品进展</h2><Button type="text" onClick={() => open('writing/editor')}>打开正文 <ArrowRightOutlined /></Button></div>
        <div className="author-book-progress"><strong>{drafted.length}<small> 章已有正文</small></strong><span>{chapters.length} 章安排 · {chapters.reduce((total, chapter) => total + (chapter.wordCount || 0), 0).toLocaleString()} 字</span></div>
        {nextChapter ? <button className="author-next-chapter" disabled={checkingNextChapter || workflow.active || workflow.submitting || savingModel} onClick={() => { void planNextChapter() }}><span>{checkingNextChapter ? '检查章节安排' : '下一章'}</span><strong>第 {nextChapter.chapterNum} 章 · {nextChapter.title || '未命名'}</strong><ArrowRightOutlined /></button> : <p className="author-muted">{chapters.length ? '现有章节均已有正文，可继续安排下一阶段。' : '确定故事方向后，开始安排首个单元。'}</p>}
      </section>
      <section className="author-paper"><div className="author-section-heading"><h2>需要留意</h2><Button type="text" onClick={() => open('revision')}>查看全部 <ArrowRightOutlined /></Button></div>
        {pendingIssues.length ? <ul className="author-issue-preview">{pendingIssues.slice(0, 3).map((issue) => <li key={issue.id}><button onClick={() => open(`revision?issue=${issue.id}`)}>{issue.title}</button></li>)}</ul> : <p className="author-muted">当前没有记录中的待处理问题。新内容生成后会继续审校。</p>}
      </section>
    </div>
    {dataError && <p className="author-error" role="alert">{dataError}</p>}
    {!novel?.userBackground?.trim() && !workflow.run && <EmptyWork title="先给故事一个起点" actionLabel="填写背景要求" action={() => { setStage('background'); document.getElementById('author-request')?.focus() }}>可以直接描述时代、主角、想写的冲突和你不希望出现的内容。</EmptyWork>}
  </AuthorPage>
}
