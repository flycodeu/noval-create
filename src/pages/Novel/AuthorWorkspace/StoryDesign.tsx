import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button, Modal, message } from 'antd'
import { ArrowRightOutlined, EditOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'
import { useNovelResearchRefresh } from '../../../hooks/useNovelResearchRefresh'
import { getUserFacingMessage } from '../../../utils/user-facing-message'
import { parseProjectBriefDocument } from '../../../shared/project-brief'
import { parseStorySettingsDocument } from '../../../shared/story-settings'
import { parseThemeVoiceDocument } from '../../../shared/theme-voice'
import type { CreativeStage } from '../../../shared/creative-workflow'
import { AuthorPage, LoadFailure } from './shared'
import { ContentDocument, DocumentEditor } from './ContentDocument'
import { parseDocument, recordOf } from './content-document'
import { loadDocumentNames } from './document-references'
import { buildStoryDesignPatch, resolveStoryDesignLocation, STORY_DESIGN_TABS, STORY_VOICE_FIELDS, storyDesignParams } from './story-design-navigation'
import CreativeResearchLibrary from './CreativeResearchLibrary'
import StoryFacts from './StoryFacts'
import AuthorStoryLedger from './AuthorStoryLedger'
import AuthorStyleSamples from './AuthorStyleSamples'
import { StoryDirectionDocument } from './StoryDirectionDocument'
import { useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import ObjectTaskPanel, { type ObjectTaskTarget } from './ObjectTaskPanel'
import './story-design.css'

type Section = { key: string; title: string; value: unknown; stage: CreativeStage; contextVersion?: number }

export default function StoryDesign({ novelId }: { novelId: number }) { return <StoryDesignSession key={novelId} novelId={novelId} /> }
function StoryDesignSession({ novelId }: { novelId: number }) {
  const novel = useNovelStore(state => state.currentNovel)
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const [params, setParams] = useSearchParams()
  const { section: tab, topic, topics } = resolveStoryDesignLocation(params)
  useNovelResearchRefresh(novelId, tab !== 'sources')
  const [saveError, setError] = useState('')
  const [editing, setEditing] = useState<Section | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const draftRef = useRef<unknown>(null)
  const changeDraft = (value: unknown) => { draftRef.current = value; setDraft(value) }
  const [saving, setSaving] = useState(false)
  const [libraryDirty, setLibraryDirty] = useState(false)
  const [task, setTask] = useState<ObjectTaskTarget | null>(null)
  const saveEpoch = useRef(0)
  const saveInFlight = useRef(false)
  const dirty = libraryDirty || Boolean(editing) && JSON.stringify(draft) !== JSON.stringify(editing?.value)
  useRegisterWorkspaceLeaveGuard(dirty || saving)
  const story = parseStorySettingsDocument(novel?.settingsJson)
  const brief = parseProjectBriefDocument(novel?.projectBriefJson)
  const voice = parseThemeVoiceDocument(novel?.themeVoiceJson)
  // Normalizing world rules supplies genre defaults. Only stored rules are author facts.
  const world = recordOf(parseDocument(novel?.worldRulesJson))
  const chronology = { dynastyName: '', storyStartLabel: '', currentTimeLabel: '', currentTimeChapterNum: null, currentTimeEvidence: '', ...recordOf(world.timelineConfig) }
  const read = useCallback(async () => {
    let referenceError = ''
    const [chapters, names, latest] = await Promise.all([window.electron.chapter.list(novelId), loadDocumentNames(novelId, value => { referenceError = value }), window.electron.novel.get(novelId), window.electron.structure.getTree(novelId)])
    const current = useNovelStore.getState().currentNovel
    if (latest?.id === novelId && current?.id === novelId && (latest.contextVersion || 0) >= (current.contextVersion || 0)) setNovel(latest)
    return { chapters, names, referenceError }
  }, [novelId, setNovel])
  const { data, error: loadError, reload: load } = useAsyncSnapshot(read)
  const chapters = data?.chapters ?? [], names = data?.names ?? {}
  const error = saveError || (loadError ? String(loadError) : data?.referenceError || '')
  useEffect(() => () => { saveEpoch.current += 1 }, [])
  useEffect(() => { const refresh = () => { void load() }; window.addEventListener('novelforge:creative-completed', refresh); return () => window.removeEventListener('novelforge:creative-completed', refresh) }, [load])
  const changeView = (change: () => void) => {
    if (saveInFlight.current) return
    if (!dirty) { change(); return }
    Modal.confirm({
      title: '当前内容还有未保存的修改', okText: '放弃并切换', cancelText: '继续编辑',
      onOk: () => { flushSync(() => { setEditing(null); setDraft(null); setLibraryDirty(false) }); change() },
    })
  }
  const discuss = (stage: CreativeStage, request: string, title = section?.title || '故事设计') => changeView(() => setTask({ title, stage, request }))
  const sections: Section[] = tab === 'sources' ? [] : tab === 'background' ? [
    { key: 'background', title: '背景与简介', value: { title: novel?.title || '', synopsis: novel?.synopsis || '', userBackground: novel?.userBackground || '', expandedBackground: novel?.expandedBackground || '' }, stage: 'background' },
    { key: 'brief', title: '作品定位与读者承诺', value: brief, stage: 'story' },
  ] : tab === 'story' ? [
    { key: 'premise', title: '故事起点', value: story.premise, stage: 'story' },
    { key: 'storyDesign', title: '主线、支线与推进', value: story.storyDesign, stage: 'story' },
    { key: 'endgameDesign', title: '结局与承诺兑现', value: story.endgameDesign, stage: 'story' },
  ] : tab === 'style' ? topics.map(item => ({ key: item.key, title: item.label, value: Object.fromEntries(STORY_VOICE_FIELDS[item.key].map(field => [field, voice[field]])), stage: 'style' as const })) : tab === 'constraints' ? [
    { key: 'writingRules', title: '写作边界', value: story.writingRules, stage: 'story' },
    { key: 'world:writingConstraints', title: '世界与常识约束', value: world.writingConstraints, stage: 'world_rules' },
  ] : ['genreProfile', 'powerSystems', 'speciesSystem', 'factionSystem', 'characterEcology', 'mapBlueprint', 'worldDynamics', 'timelineConfig'].map(key => ({ key: `world:${key}`, title: ({ genreProfile: '世界基调', powerSystems: '能力、限制与代价', speciesSystem: '种属规则', factionSystem: '组织与社会', characterEcology: '人物生态', mapBlueprint: '地域层级', worldDynamics: '环境、生计与资源', timelineConfig: '朝代与时间' } as Record<string, string>)[key], value: key === 'timelineConfig' ? chronology : world[key], stage: 'world_rules' as const }))
  const section = sections.find(item => item.key === topic)
  const save = async () => {
    if (!novel || !editing || saveInFlight.current) return
    saveInFlight.current = true
    const epoch = ++saveEpoch.current
    const isCurrent = () => epoch === saveEpoch.current && useNovelStore.getState().currentNovelId === novelId
    const submitted = draftRef.current
    setSaving(true)
    try {
      const latest = await window.electron.novel.get(novelId)
      if (!isCurrent()) return
      if (latest?.id !== novelId || latest.contextVersion !== editing.contextVersion) throw new Error(getUserFacingMessage('novel.contextVersionConflict'))
      await window.electron.novel.update(novelId, buildStoryDesignPatch(latest, editing.key, submitted), { expectedContextVersion: editing.contextVersion })
      const updated = await window.electron.novel.get(novelId)
      if (!isCurrent()) return
      if (updated?.id === novelId && (updated.contextVersion || 0) >= (useNovelStore.getState().currentNovel?.contextVersion || 0)) setNovel(updated)
      if (JSON.stringify(draftRef.current) === JSON.stringify(submitted)) setEditing(null)
      else setEditing({ ...editing, value: submitted, contextVersion: updated?.contextVersion })
      setError(''); message.success(getUserFacingMessage('workspace.sectionSaved'))
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { if (isCurrent()) { saveInFlight.current = false; setSaving(false) } }
  }
  return <AuthorPage title="故事设计">
    <div className="author-tabs author-section-tabs story-design-tabs" role="tablist" aria-label="故事设计分类">{STORY_DESIGN_TABS.map(item => <button key={item.key} role="tab" aria-selected={tab === item.key} disabled={saving} onClick={() => { if (tab !== item.key) changeView(() => setParams(storyDesignParams(params, item.key))) }}>{item.label}</button>)}</div>
    {topics.length > 0 && <div className="story-design-topics" role="tablist" aria-label={`${STORY_DESIGN_TABS.find(item => item.key === tab)?.label}主题`}>{topics.map(item => <button key={item.key} id={`story-topic-${item.key}`} role="tab" aria-selected={topic === item.key} aria-controls="story-design-panel" disabled={saving} onClick={() => { if (topic !== item.key) changeView(() => setParams(storyDesignParams(params, tab, item.key))) }}>{item.label}</button>)}</div>}
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {tab === 'sources' ? <CreativeResearchLibrary novelId={novelId} onDirtyChange={setLibraryDirty} /> : <div id="story-design-panel" role="tabpanel" aria-labelledby={`story-topic-${topic}`}>
      {topic === 'ledger' ? <AuthorStoryLedger key={novelId} novelId={novelId} chapters={chapters} onDirtyChange={setLibraryDirty} /> : topic === 'facts' ? <StoryFacts novelId={novelId} chapters={chapters} onDiscuss={request => discuss('story', request, '秘密、信息点与知情边界')} /> : section && topic !== 'style:samples' && <section className="author-paper author-design-section" key={section.key}><div className="author-section-heading"><h2>{section.title}</h2><div className="author-heading-actions"><Button type="text" icon={<EditOutlined />} disabled={section.value == null} onClick={() => { setEditing({ ...section, contextVersion: novel?.contextVersion }); changeDraft(structuredClone(section.value)) }}>编辑</Button><Button onClick={() => discuss(section.stage, `结合现有作品，检查并完善“${section.title}”。保留已确定内容，指出依据不足与冲突，输出可讨论候选。`)}>AI 完善 <ArrowRightOutlined /></Button></div></div>{section.key === 'storyDesign' ? <StoryDirectionDocument story={story.storyDesign} onEdit={() => { setEditing({ ...section, contextVersion: novel?.contextVersion }); changeDraft(structuredClone(section.value)) }} /> : <ContentDocument value={section.value} names={names} />}</section>}
      {topic === 'style:samples' && <AuthorStyleSamples key={novelId} novelId={novelId} chapters={chapters} onDirtyChange={setLibraryDirty} preferences={<details className="author-style-preferences"><summary>文风与模仿指南</summary><div className="author-style-preferences__body"><div className="author-section-heading"><span>当前文风要求</span><Button size="small" icon={<EditOutlined />} disabled={saving} onClick={() => { if (section) { setEditing({ ...section, contextVersion: novel?.contextVersion }); changeDraft(structuredClone(section.value)) } }}>编辑要求</Button></div><ContentDocument value={section?.value} /></div></details>} />}
    </div>}
    <Modal width={850} title={`编辑 · ${editing?.title || ''}`} open={Boolean(editing)} closable={!saving} keyboard={!saving} cancelButtonProps={{ disabled: saving }} onCancel={() => {
      if (saveInFlight.current) return
      if (JSON.stringify(draft) === JSON.stringify(editing?.value)) setEditing(null)
      else Modal.confirm({ title: '放弃这一部分的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: () => setEditing(null) })
    }} okText="保存这一部分" cancelText="取消" confirmLoading={saving} onOk={() => void save()}><DocumentEditor value={draft} names={names} onChange={changeDraft} /></Modal>
    <ObjectTaskPanel novelId={novelId} target={task} onClose={() => setTask(null)} onApplied={() => void load()} />
  </AuthorPage>
}
