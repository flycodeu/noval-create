import React, { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button, Modal, Spin, message } from 'antd'
import { ArrowRightOutlined, EditOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { parseProjectBriefDocument } from '../../../shared/project-brief'
import { parseStorySettingsDocument } from '../../../shared/story-settings'
import { parseThemeVoiceDocument } from '../../../shared/theme-voice'
import type { CreativeStage } from '../../../shared/creative-workflow'
import type { Chapter, StoryStructureTree } from '../../../types'
import { AuthorPage, EmptyWork, LoadFailure } from './shared'
import { ContentDocument, DocumentEditor } from './ContentDocument'
import { parseDocument, recordOf } from './content-document'
import { loadDocumentNames } from './document-references'
import { buildStoryDesignPatch, resolveStoryDesignLocation, STORY_DESIGN_TABS, STORY_VOICE_FIELDS, storyDesignParams } from './story-design-navigation'
import ChapterArrangement from './ChapterArrangement'
import StoryFacts from './StoryFacts'
import { useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import './story-design.css'

type Section = { key: string; title: string; value: unknown; stage: CreativeStage; contextVersion?: number }

export default function StoryDesign({ novelId }: { novelId: number }) {
  const novel = useNovelStore(state => state.currentNovel)
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { section: tab, topic, topics } = resolveStoryDesignLocation(params)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [tree, setTree] = useState<StoryStructureTree | null>(null)
  const selectedChapter = Number(params.get('chapterId')) || null
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Section | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [arrangementDirty, setArrangementDirty] = useState(false)
  const dirty = arrangementDirty || Boolean(editing) && JSON.stringify(draft) !== JSON.stringify(editing?.value)
  useRegisterWorkspaceLeaveGuard(dirty || saving)
  const story = parseStorySettingsDocument(novel?.settingsJson)
  const brief = parseProjectBriefDocument(novel?.projectBriefJson)
  const voice = parseThemeVoiceDocument(novel?.themeVoiceJson)
  // Normalizing world rules supplies genre defaults. Only stored rules are author facts.
  const world = recordOf(parseDocument(novel?.worldRulesJson))
  const load = useCallback(async () => {
    setLoading(true)
    let referenceError = ''
    try {
      const [rows, structure, references, latest] = await Promise.all([
        window.electron.chapter.list(novelId), window.electron.structure.getTree(novelId),
        loadDocumentNames(novelId, value => { referenceError = value }), window.electron.novel.get(novelId),
      ])
      setChapters(rows); setTree(structure); setNames(references); setError(referenceError)
      if (latest && useNovelStore.getState().currentNovel?.id === novelId) setNovel(latest)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取结构失败') }
    finally { setLoading(false) }
  }, [novelId, setNovel])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const refresh = () => { void load() }; window.addEventListener('novelforge:creative-completed', refresh); return () => window.removeEventListener('novelforge:creative-completed', refresh) }, [load])
  const changeView = (change: () => void) => {
    if (saving) return
    if (!dirty) { change(); return }
    Modal.confirm({
      title: '当前内容还有未保存的修改', okText: '放弃并切换', cancelText: '继续编辑',
      onOk: () => { flushSync(() => { setEditing(null); setDraft(null); setArrangementDirty(false) }); change() },
    })
  }
  const discuss = (stage: CreativeStage, request: string) => changeView(() => navigate(buildWorkspaceRoute(novelId, `guide?${new URLSearchParams({ stage, request, autoApply: 'false' })}`)))
  const sections: Section[] = tab === 'background' ? [
    { key: 'background', title: '背景与简介', value: { title: novel?.title || '', synopsis: novel?.synopsis || '', userBackground: novel?.userBackground || '', expandedBackground: novel?.expandedBackground || '' }, stage: 'background' },
    { key: 'brief', title: '作品定位与读者承诺', value: brief, stage: 'story' },
  ] : tab === 'story' ? [
    { key: 'premise', title: '故事起点', value: story.premise, stage: 'story' },
    { key: 'storyDesign', title: '主线、支线与推进', value: story.storyDesign, stage: 'story' },
    { key: 'endgameDesign', title: '结局与承诺兑现', value: story.endgameDesign, stage: 'story' },
  ] : tab === 'style' ? topics.map(item => ({ key: item.key, title: item.label, value: Object.fromEntries(STORY_VOICE_FIELDS[item.key].map(field => [field, voice[field]])), stage: 'style' as const })) : tab === 'constraints' ? [
    { key: 'writingRules', title: '写作边界', value: story.writingRules, stage: 'story' },
    { key: 'world:writingConstraints', title: '世界与常识约束', value: world.writingConstraints, stage: 'world_rules' },
  ] : ['genreProfile', 'powerSystems', 'speciesSystem', 'factionSystem', 'characterEcology', 'mapBlueprint', 'worldDynamics', 'timelineConfig'].map(key => ({ key: `world:${key}`, title: ({ genreProfile: '世界基调', powerSystems: '能力、限制与代价', speciesSystem: '种属规则', factionSystem: '组织与社会', characterEcology: '人物生态', mapBlueprint: '地域层级', worldDynamics: '环境、生计与资源', timelineConfig: '历法与时间' } as Record<string, string>)[key], value: world[key], stage: 'world_rules' as const }))
  const section = sections.find(item => item.key === topic)
  const save = async () => {
    if (!novel || !editing) return
    setSaving(true)
    try {
      const latest = await window.electron.novel.get(novelId)
      if (!latest || latest.contextVersion !== editing.contextVersion) throw new Error('作品已被其他任务修改，请刷新后再编辑；当前编辑内容仍保留。')
      await window.electron.novel.update(novelId, buildStoryDesignPatch(latest, editing.key, draft))
      const updated = await window.electron.novel.get(novelId)
      if (updated) setNovel(updated)
      setEditing(null); message.success('已保存这一部分')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { setSaving(false) }
  }
  const chapter = chapters.find(item => item.id === selectedChapter)
  const assigned = new Set(tree?.volumes.flatMap(volume => volume.parts.flatMap(part => part.chapters.map(item => item.id))) || [])
  const chapterButton = (item: Chapter) => <button key={item.id} className={selectedChapter === item.id ? 'is-selected' : ''} onClick={() => { if (selectedChapter !== item.id) changeView(() => { const next = new URLSearchParams(params); next.set('chapterId', String(item.id)); setParams(next) }) }}>第 {item.chapterNum} 章 · {item.title || '未命名'}<small>{item.wordCount ? `${item.wordCount.toLocaleString()} 字` : '待写'}</small></button>
  return <AuthorPage compact eyebrow="故事设计" title={novel?.title || '故事设计'}>
    <div className="author-tabs author-section-tabs story-design-tabs" role="tablist" aria-label="故事设计分类">{STORY_DESIGN_TABS.map(item => <button key={item.key} role="tab" aria-selected={tab === item.key} disabled={saving} onClick={() => { if (tab !== item.key) changeView(() => setParams(storyDesignParams(params, item.key))) }}>{item.label}</button>)}</div>
    {topics.length > 0 && <div className="story-design-topics" role="tablist" aria-label={`${STORY_DESIGN_TABS.find(item => item.key === tab)?.label}主题`}>{topics.map(item => <button key={item.key} id={`story-topic-${item.key}`} role="tab" aria-selected={topic === item.key} aria-controls="story-design-panel" disabled={saving} onClick={() => { if (topic !== item.key) changeView(() => setParams(storyDesignParams(params, tab, item.key))) }}>{item.label}</button>)}</div>}
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {tab !== 'structure' ? <div id="story-design-panel" role="tabpanel" aria-labelledby={`story-topic-${topic}`}>
      {topic === 'facts' ? <StoryFacts novelId={novelId} chapters={chapters} /> : section && <section className="author-paper author-design-section" key={section.key}><div className="author-section-heading"><h2>{section.title}</h2><div className="author-heading-actions"><Button type="text" icon={<EditOutlined />} disabled={section.value == null} onClick={() => { setEditing({ ...section, contextVersion: novel?.contextVersion }); setDraft(structuredClone(section.value)) }}>编辑</Button><Button onClick={() => discuss(section.stage, `结合现有作品，检查并完善“${section.title}”。保留已确定内容，指出依据不足与冲突，输出可讨论候选。`)}>AI 完善 <ArrowRightOutlined /></Button></div></div><ContentDocument value={section.value} names={names} /></section>}
    </div> : <>
      <div className="author-section-heading"><h2>卷 → 单元 → 章节 → 场景</h2><Button onClick={() => discuss('outline', '结合已有作品规划接下来一个单元，保留已有卷、单元和章节；明确每章目标、场景、承接与约束。')}>规划下一单元</Button></div>
      {loading ? <Spin /> : chapters.length || tree?.volumes.length ? <div className="author-structure-layout"><nav className="author-structure-tree" aria-label="卷章结构">{tree?.volumes.map(volume => <details open key={volume.id}><summary>卷 {volume.volumeNumber} · {volume.title || '未命名'}</summary>{volume.summary && <p>{volume.summary}</p>}{volume.parts.map(part => <details open key={part.id}><summary>{part.title || `单元 ${part.partNumber}`}</summary>{part.summary && <p>{part.summary}</p>}{part.chapters.map(chapterButton)}</details>)}</details>)}{chapters.filter(item => !assigned.has(item.id)).length > 0 && <details open><summary>尚未归入单元</summary>{chapters.filter(item => !assigned.has(item.id)).map(chapterButton)}</details>}</nav><section className="author-paper">{chapter ? <><Button onClick={() => navigate(buildWorkspaceRoute(novelId, `writing/editor?chapterId=${chapter.id}`))}>打开本章正文</Button><ChapterArrangement key={chapter.id} chapter={chapter} onDirtyChange={setArrangementDirty} onSaved={() => void load()} /></> : <EmptyWork title="选择一章">查看完整大纲、章节边界和场景安排。</EmptyWork>}</section></div> : <EmptyWork title="尚未安排卷与章节" action={() => discuss('outline', '根据背景与人物设计首个单元及章节场景安排。')}>先从能够开始写作的一个单元规划。</EmptyWork>}
    </>}
    <Modal width={850} title={`编辑 · ${editing?.title || ''}`} open={Boolean(editing)} closable={!saving} keyboard={!saving} cancelButtonProps={{ disabled: saving }} onCancel={() => {
      if (saving) return
      if (JSON.stringify(draft) === JSON.stringify(editing?.value)) setEditing(null)
      else Modal.confirm({ title: '放弃这一部分的修改？', okText: '放弃修改', cancelText: '继续编辑', onOk: () => setEditing(null) })
    }} okText="保存这一部分" cancelText="取消" confirmLoading={saving} onOk={() => void save()}><DocumentEditor value={draft} names={names} onChange={setDraft} /></Modal>
  </AuthorPage>
}
