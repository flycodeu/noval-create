import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import { WorldAtlasGraph } from '../../src/pages/Novel/AuthorWorkspace/WorldAtlasGraph'
import { AtlasWorkbench } from '../../src/pages/Novel/AuthorWorkspace/AtlasWorkbench'
import { AtlasEntityEditor } from '../../src/pages/Novel/AuthorWorkspace/AtlasEntityEditor'
import AuthorStyleSamples from '../../src/pages/Novel/AuthorWorkspace/AuthorStyleSamples'
import { DocumentEditor } from '../../src/pages/Novel/AuthorWorkspace/ContentDocument'
import { StoryDirectionDocument } from '../../src/pages/Novel/AuthorWorkspace/StoryDirectionDocument'
import { AtlasRelationEditor } from '../../src/pages/Novel/AuthorWorkspace/AtlasRelationEditor'
import ChapterReviewPanel from '../../src/pages/Novel/AuthorWorkspace/ChapterReviewPanel'
import { getAntdThemeConfig } from '../../src/theme/antd-tokens'
import { useNovelStore } from '../../src/stores/novel.store'
import '../../src/styles/global.css'
import '../../src/pages/Novel/AuthorWorkspace/author-workspace.css'
import '../../src/pages/Novel/AuthorWorkspace/story-design.css'
import '../../src/pages/Novel/AuthorWorkspace/world-workspace.css'

const w = window as any
const stats = { avgSentenceLength: 16, avgParagraphLength: 75, dialogueLineRate: 25 }
const sample = (id: number, name: string, novelId = 1) => ({ record: { id, name, novelId, sourceType: 'pasted', sourceText: '河水涨了，灯还亮着。' }, fingerprint: { narrativeTechniques: '让行动带出线索。', dialogueStyle: '人物说话有自己的语气。', descriptionDensity: '疏密相间', paceProfile: '快慢交替', exampleExcerpts: [] }, stats })
const samples = [sample(1, '河边样稿'), sample(2, '外部样稿', 2)]
let activeId: number | null = null
w.calls = []; w.applied = []
w.electron = {
  novel: { get: async () => ({ id: 1, contextVersion: 9 }) },
  storyAtlas: { apply: async (input: unknown) => { w.applied.push(input); if (w.failSave) throw Error('版本冲突，草稿保留'); if (w.deferSave) await new Promise(resolve => { w.resolveSave = resolve }); return {} } },
  agentTools: { call: async (request: any) => {
    w.calls.push(request)
    const { toolId, input } = request
    if (toolId === 'novelforge.chapters.review_view') {
      if (w.deferReview) return new Promise(resolve => { w.resolveReview = () => resolve({ ok: true, data: { view: structuredClone(w.reviewView) } }) })
      if (w.reviewError) throw Error('审校报告暂时不可用')
      return { ok: true, data: { view: structuredClone(w.reviewView) } }
    }
    if (toolId.endsWith('.list')) return { ok: true, data: { samples: samples.map(item => item.record), activeId, contextVersion: 9, diagnostics: [] } }
    if (toolId.endsWith('.get')) return w.failGet ? { ok: false, error: { message: '样稿读取失败' } } : { ok: true, data: samples.find(item => item.record.id === input.fingerprintId) }
    if (toolId.endsWith('.approve')) { activeId = input.fingerprintId; return { ok: true } }
    if (toolId.endsWith('.trial')) return { ok: true, data: { withFingerprint: { text: '有样稿的试写', stats }, without: { text: '没有样稿的试写', stats } } }
    if (toolId.endsWith('.analyze') && w.deferAnalyze) await new Promise(resolve => { w.resolveAnalyze = resolve })
    const created = sample(samples.length + 1, toolId.endsWith('.copy_sample') ? '外部样稿副本' : toolId.endsWith('.approve_trial') ? '试写样稿' : input.name)
    samples.push(created)
    if (toolId.endsWith('.approve_trial')) activeId = created.record.id
    return { ok: true, data: created }
  } },
}
useNovelStore.getState().setCurrentNovel({ id: 1, contextVersion: 9 } as any)
const snapshot: any = { novelId: 1, contextVersion: 9, entities: [{ id: 'character:1', name: '林芷' }, { id: 'character:2', name: '段宁' }], relations: [] }
const relation: any = { id: 'relationship:1', kind: 'relationship', fromId: 'character:1', toId: 'character:2', label: '同行', status: 'planned', attributes: { stateTiming: 'chapter_start', notes: '一起查案', approval_source: 'user_approved_author_design' }, effectiveFromChapter: 3 }
function Subplots() { const [value, setValue] = useState([]); return <DocumentEditor fieldKey="subPlotsList" value={value} onChange={next => { w.subplots = next; setValue(next as []) }} /> }
const story = { storyGoal: '绘图员要在暴风雨前送出新的航路图。', coreConflict: '出港时间与尚未核对的礁石位置发生冲突。', mainPlot: '港口：先找回测量记录，确认旧航路的变化。\n海岛：船员必须决定继续测绘还是返航。\n归航：用共同完成的地图帮助船队避开险滩。', subPlotsText: '出海之前，用一场准备物资的小冲突建立同伴关系。', subPlotsList: [{ name: '遗失的罗盘', characters: '林芷、段宁', conflict: '想修好旧物，却低估修补的代价。', mainlineLink: '修复的罗盘帮助核对航线。', endChapter: '归航前' }], ending: '船队平安返回，同伴各自开始下一段生活。' }
const graphEntities = [
  ['1', '林芷', 'protagonist', undefined], ['2', '段宁', 'major', 'companion'],
  ['3', '渡船老板', 'supporting', undefined], ['4', '邻船货主', 'major', 'potential_enemy'],
  ['5', '过路人', 'minor', undefined], ['6', '卖花人', 'minor', undefined],
].map(([id, name, roleType, castRole]) => ({ id: `character:${id}`, name, kind: 'character', summary: '沿河生活，有自己的来往与打算。', status: 'established', effectiveFromChapter: 0, parentId: null, attributes: { roleType, authorPlanning: castRole ? { castRole, notes: '保留独立的故事线' } : '原有规划，不要覆盖' } }))
const graphSnapshot: any = { novelId: 1, contextVersion: 9, atChapter: 3, entities: graphEntities, relations: [
  { ...relation, id: 'r1', label: '同行', status: 'established' },
  { ...relation, id: 'r2', fromId: 'character:3', toId: 'character:4', label: '借船未还' },
], diagnostics: [] }
function Graph() {
  const [selected, setSelected] = useState<string | null>(null)
  return <div className="world-and-cast"><AtlasWorkbench className="atlas-workbench atlas-workbench--graph" resizable><WorldAtlasGraph mode="relationships" snapshot={graphSnapshot} parentId={null} selectedId={selected} onSelect={entity => setSelected(entity.id)} onRelation={item => { w.clickedRelation = item.id }} onDrill={() => {}} onGenerate={() => {}} /><section className="atlas-profile-panel" style={{ padding: 20 }}><h2>{graphEntities.find(item => item.id === selected)?.name || '人物资料'}</h2><p>身份与日常</p><p>当前目标和具体矛盾</p></section></AtlasWorkbench></div>
}
const theme = getAntdThemeConfig('light'); theme.token = { ...theme.token, motion: false }
const root = createRoot(document.getElementById('root')!)
w.reviewView = { reportId: 'report-1', summary: '两处问题需要核实。', status: 'needs_revision', stale: false, contractVersionUnknown: false, reviewedContentHash: 'a'.repeat(64), currentContentHash: 'a'.repeat(64), requirements: [{ id: 'chapterGoal', title: '本章目标', requirement: '救出住客' }], issues: [
  { id: 'fact-1', category: 'fact', level: 'repair', message: '人物尚不知道这个姓名。', evidence: [{ start: 0, end: 4, quote: '他叫周丙', artifactHash: 'a'.repeat(64) }] },
  { id: 'style-1', category: 'style', level: 'advice', message: '删去重复的解释。', evidence: [] },
], deterministicBlockers: [] }
w.paintReview = () => root.render(<ConfigProvider theme={theme}><main style={{ padding: 24, minWidth: 0 }}><ChapterReviewPanel novelId={1} chapterId={w.reviewChapter || 1} version={w.reviewVersion || 'one'} dirty={Boolean(w.reviewDirty)} onLocate={() => { w.located = true }} onRepair={() => { w.repaired = true }} /></main></ConfigProvider>)
w.paint = (view = 'style') => root.render(<ConfigProvider theme={theme}><main className="author-workspace" style={{ padding: 24, minWidth: 0 }}>{view === 'graph' ? <Graph /> : view === 'cast-edit' ? <AtlasEntityEditor entity={graphEntities[2] as any} snapshot={graphSnapshot} atChapter={3} onSaved={() => { w.castSaved = true }} onClose={() => w.paint('graph')} /> : view === 'style' ? <AuthorStyleSamples novelId={1} chapters={[]} onDirtyChange={dirty => { w.dirty = dirty }} preferences={<details className="author-style-preferences"><summary>文风要求</summary>动作和对话带出情绪，少作解释。</details>} /> : view === 'subplot' ? <Subplots /> : view === 'relation' ? <AtlasRelationEditor relation={relation} snapshot={snapshot} atChapter={null} onSaved={() => { w.saved = true }} onClose={() => { w.editorClosed = true; w.paint('story') }} /> : <section className="author-paper"><h2>主线、支线与推进</h2><StoryDirectionDocument story={story} onEdit={() => w.paint('subplot')} /></section>}</main></ConfigProvider>)
w.paint()
