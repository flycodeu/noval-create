import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import AuthorStyleSamples from '../../src/pages/Novel/AuthorWorkspace/AuthorStyleSamples'
import { DocumentEditor } from '../../src/pages/Novel/AuthorWorkspace/ContentDocument'
import { StoryDirectionDocument } from '../../src/pages/Novel/AuthorWorkspace/StoryDirectionDocument'
import { AtlasRelationEditor } from '../../src/pages/Novel/AuthorWorkspace/AtlasRelationEditor'
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
const theme = getAntdThemeConfig('light'); theme.token = { ...theme.token, motion: false }
const root = createRoot(document.getElementById('root')!)
w.paint = (view = 'style') => root.render(<ConfigProvider theme={theme}><main className="author-workspace" style={{ padding: 24, minWidth: 0 }}>{view === 'style' ? <AuthorStyleSamples novelId={1} chapters={[]} onDirtyChange={dirty => { w.dirty = dirty }} preferences={<details className="author-style-preferences"><summary>文风要求</summary>动作和对话带出情绪，少作解释。</details>} /> : view === 'subplot' ? <Subplots /> : view === 'relation' ? <AtlasRelationEditor relation={relation} snapshot={snapshot} atChapter={null} onSaved={() => { w.saved = true }} onClose={() => { w.editorClosed = true; w.paint('story') }} /> : <section className="author-paper"><h2>主线、支线与推进</h2><StoryDirectionDocument story={story} onEdit={() => w.paint('subplot')} /></section>}</main></ConfigProvider>)
w.paint()
