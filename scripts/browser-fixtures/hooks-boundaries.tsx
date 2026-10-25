import React, { act, useLayoutEffect } from 'react'
import type { Root } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { Form, Input, Modal } from 'antd'
import Characters from '../../src/pages/Novel/Characters/CharacterWorkspace'
import Glossary from '../../src/pages/Novel/Glossary'
import Factions from '../../src/pages/Novel/Factions'
import SceneTemplates from '../../src/pages/Novel/SceneTemplates'
import Versions from '../../src/pages/Novel/AuthorWorkspace/Versions'
import Contracts from '../../src/pages/Novel/Contracts'
import ChapterArrangement from '../../src/pages/Novel/AuthorWorkspace/ChapterArrangement'
import Manuscript from '../../src/pages/Novel/AuthorWorkspace/Manuscript'
import ReferenceExtraction from '../../src/pages/Novel/AuthorWorkspace/ReferenceExtraction'
import StoryDesign from '../../src/pages/Novel/AuthorWorkspace/StoryDesign'
import { useTimelineWorkspace } from '../../src/pages/Novel/Timeline/useTimelineWorkspace'
import { useNovelStore } from '../../src/stores/novel.store'
import { NovelWorkspaceActionsContext, type NovelWorkspaceActions } from '../../src/pages/Novel/workspace-shortcuts-context'
import { readFixtures, check, deferred, button, click, type, novel } from './hooks-lifecycles'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
const actions: NovelWorkspaceActions = { mutationToken: 0, registerSaveHandler() {}, registerClearHandler() {}, registerEscapeHandler() {}, registerLeaveGuard() {}, notifyWorkspaceMutation() {} }
async function reset() { await act(async () => { Modal.destroyAll(); root.render(null) }); useNovelStore.getState().setCurrentNovel(novel()) }

async function characterRoute() {
  const f = readFixtures()
  const writes: any[] = []
  f.character.query = async () => ({ items: [1, 2].map(id => ({ id, novelId: 1, fullName: 'person ' + id, roleType: 'major' })), total: 2 })
  f.character.getFilterOptions = async () => ({ species: [], entityTypes: [] })
  f.character.getGraph = async () => ({ characters: [], relations: [] })
  f.character.get = async (id: number) => ({ id, novelId: 1, fullName: 'person ' + id, roleType: 'major', recordStatus: 'confirmed' })
  f.character.getDetailContext = async () => ({ relatedItems: [], relatedCharacters: [], relatedRelations: [] })
  f.character.update = async (id: number, values: any) => { writes.push({ id, name: values.fullName }) }
  let navigate!: ReturnType<typeof useNavigate>
  function Nav() { const n = useNavigate(); useLayoutEffect(() => { navigate = n }); return null }
  Object.assign(window, { electron: f })
  await act(async () => root.render(<MemoryRouter initialEntries={['/?characterId=1']}><Nav /><NovelWorkspaceActionsContext.Provider value={actions}><Characters novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  check(document.querySelector<HTMLInputElement>('#fullName')?.value === 'person 1', 'character initial detail')
  await type(document.querySelector<HTMLInputElement>('#fullName'), 'unsaved person 1')
  await act(async () => navigate('/?characterId=2'))
  const shownName = document.querySelector<HTMLInputElement>('#fullName')?.value
  const confirmation = !!document.querySelector('.ant-modal-confirm')
  check(confirmation && shownName === 'unsaved person 1', 'routed character switch waits for dirty confirmation')
  await click(button('留下继续编辑'))
  await click(button('保存并确认'))
  check(writes.length === 1 && writes[0].id === 1 && writes[0].name === 'unsaved person 1', 'cancelled character navigation saves only the original entity')
  await type(document.querySelector<HTMLInputElement>('#fullName'), 'another draft')
  await act(async () => navigate('/?characterId=2'))
  await click([...document.querySelectorAll('button')].filter(item => item.textContent?.replace(/\s/g, '') === '放弃并切换').at(-1))
  check(document.querySelector<HTMLInputElement>('#fullName')?.value === 'person 2', 'accepted character navigation installs the new entity with its own form: ' + document.querySelector<HTMLInputElement>('#fullName')?.value)
  await type(document.querySelector<HTMLInputElement>('#fullName'), 'submitted person 2')
  const refresh = deferred<any>()
  f.character.query = () => refresh.promise
  await click(button('保存并确认'))
  await act(async () => navigate('/?characterId=1'))
  check(document.querySelector<HTMLInputElement>('#fullName')?.value === 'person 1', 'character can select another entity while the saved list refresh is pending')
  await type(document.querySelector<HTMLInputElement>('#fullName'), 'new draft on person 1')
  await act(async () => refresh.resolve({ items: [{ id: 2, novelId: 1, fullName: 'submitted person 2', roleType: 'major' }], total: 1 }))
  check(document.querySelector<HTMLInputElement>('#fullName')?.value === 'new draft on person 1', 'late save refresh cannot pull selection back or replace the newer character draft')
}

async function timelineSaving() {
  const f = readFixtures()
  f.timeline.query = async () => ({ items: [], total: 0 })
  f.timeline.get = async (id: number) => ({ id, novelId: 1, eventTitle: 'submitted title', timeLabel: 'day one' })
  const pending = deferred<number>()
  f.timeline.create = () => pending.promise
  Object.assign(window, { electron: f })
  let api!: ReturnType<typeof useTimelineWorkspace>
  function Harness() { const w = useTimelineWorkspace(1); useLayoutEffect(() => { api = w }); return <Form form={w.form} onValuesChange={w.handleFormValuesChange}>{['eventTitle', 'timeLabel'].map(name => <Form.Item key={name} name={name}><Input /></Form.Item>)}</Form> }
  await act(async () => root.render(<MemoryRouter><Harness /></MemoryRouter>))
  await act(async () => api.handleNew())
  await type(document.querySelector<HTMLInputElement>('#eventTitle'), 'submitted title')
  await type(document.querySelector<HTMLInputElement>('#timeLabel'), 'day one')
  let saving!: Promise<boolean>
  await act(async () => { saving = api.handleSave() })
  await type(document.querySelector<HTMLInputElement>('#eventTitle'), 'typed during save')
  check(api.hasUnsavedChanges, 'timeline newer draft dirty')
  await act(async () => { pending.resolve(91); await saving })
  check(api.form.getFieldValue('eventTitle') === 'typed during save' && api.hasUnsavedChanges && api.selectedId === 91, 'new timeline event retains newer input and adopts its saved identity')
  let updatedId: number | null = null
  f.timeline.update = async (id: number) => { updatedId = id }
  await act(async () => { saving = api.handleSave(); await saving })
  check(updatedId === 91 && !api.hasUnsavedChanges, 'saving a retained timeline draft updates the created event instead of creating another')
  const refresh = deferred<any>()
  f.timeline.query = () => refresh.promise
  await type(document.querySelector<HTMLInputElement>('#eventTitle'), 'submitted again')
  await act(async () => { saving = api.handleSave() })
  await act(async () => api.handleSelect({ id: 92, novelId: 1, eventTitle: 'second event' } as any))
  await type(document.querySelector<HTMLInputElement>('#eventTitle'), 'new draft on event 92')
  await act(async () => { refresh.resolve({ items: [{ id: 91, novelId: 1, eventTitle: 'submitted again' }], total: 1 }); await saving })
  check(api.selectedId === 92 && api.form.getFieldValue('eventTitle') === 'new draft on event 92' && api.hasUnsavedChanges, 'late timeline save refresh cannot replace a new selection or its draft: ' + JSON.stringify({ selected: api.selectedId, title: api.form.getFieldValue('eventTitle'), dirty: api.hasUnsavedChanges }))
}

async function glossaryFiltering() {
  const f = readFixtures()
  let count = 0
  const entry = { id: 1, novelId: 1, term: 'first term', category: 'concept', definition: 'definition', isCanonical: 1 }
  f.glossary.query = async () => ({ items: ++count === 1 ? [entry] : [], total: count === 1 ? 1 : 0 })
  f.glossary.usageReport = async () => null
  let guard: (() => boolean) | null = null
  Object.assign(window, { electron: f })
  const render = (revision: number) => root.render(<MemoryRouter><NovelWorkspaceActionsContext.Provider value={{ ...actions, mutationToken: revision, registerLeaveGuard(fn) { guard = fn } }}><Glossary novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>)
  await act(async () => render(0))
  check(document.querySelector<HTMLInputElement>('#term')?.value === 'first term', 'glossary initial term')
  await type(document.querySelector<HTMLInputElement>('#term'), 'unsaved term')
  check(guard?.(), 'glossary draft dirty')
  await type(document.querySelector<HTMLInputElement>('input[placeholder="搜索术语、定义或别名"]'), 'no matching term')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
  check(count === 2 && document.querySelector<HTMLInputElement>('#term')?.value === 'unsaved term' && guard?.(), 'filtered-out initial glossary selection preserves its draft and leave protection')
}

async function contractSaving() {
  const f = readFixtures()
  const record = { chapterId: 1, chapterGoal: 'old goal', requiredEndgameCommitmentIds: [], requiredCharacterArcIds: [], requiredRelationshipArcIds: [], requiredResistanceTrackIds: [] }
  const write = deferred<any>()
  let writes = 0
  f.chapter.list = async () => [{ id: 1, novelId: 1, chapterNum: 1, title: 'chapter one' }]
  f.contract = { getChapter: async () => record, listScenes: async () => [], upsertChapter: () => { writes++; return write.promise } }
  let guard: (() => boolean) | null = null
  Object.assign(window, { electron: f })
  await act(async () => root.render(<MemoryRouter initialEntries={['/?chapterId=1']}><NovelWorkspaceActionsContext.Provider value={{ ...actions, registerLeaveGuard(fn) { guard = fn } }}><Contracts novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  const goal = () => document.querySelector<HTMLTextAreaElement>('#chapterGoal')
  await type(goal(), 'submitted goal')
  await click(button('保存章节合同'))
  check(writes === 1, 'contract submitted')
  await type(goal(), 'typed during contract save')
  check(guard?.(), 'contract dirty while saving')
  await act(async () => write.resolve({ ...record, chapterGoal: 'submitted goal' }))
  check(goal()?.value === 'typed during contract save' && guard?.(), 'chapter contract save clears only submitted edits')
  await click(button('保存章节合同'))
  check(!guard?.(), 'saving the latest contract input clears dirty state')
}

async function versionRetry() {
  const f = readFixtures()
  let detailReads = 0
  let listReads = 0
  f.agentTools = { call: async ({ toolId, input }: any) => {
    if (toolId.endsWith('workflows.list')) { listReads++; return { ok: true, data: { runs: [] } } }
    if (toolId.endsWith('artifacts.list')) return { ok: true, data: { artifacts: input.parentArtifactId ? [{ id: 'comparison', parentArtifactId: 'a' }] : [] } }
    if (toolId.endsWith('artifacts.get')) {
      if (input.artifactId === 'comparison') return { ok: true, data: { artifact: { novelId: 1, content: { history: [{ path: '正文', fieldKey: 'content', before: 'frozen original', after: 'frozen candidate' }] } } } }
      if (++detailReads === 1) throw new Error('temporary detail failure')
      return { ok: true, data: { artifact: { id: 'a', novelId: 1, kind: 'chapter', status: 'draft', version: 1, content: { content: 'recovered version' } } } }
    }
    throw new Error(toolId)
  } }
  Object.assign(window, { electron: f })
  await act(async () => root.render(<MemoryRouter initialEntries={['/?artifact=a']}><Versions novelId={1} /></MemoryRouter>))
  const retry = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('重试'))
  check(retry, 'version retry exists')
  await click(retry)
  check(detailReads === 2 && listReads === 3 && !document.body.textContent?.includes('temporary detail failure') && document.body.textContent?.includes('recovered version'), 'version retry reloads detail and recovers a transient failure')
  check(document.body.textContent?.includes('frozen original') && document.body.textContent?.includes('frozen candidate'), 'recovered version uses the stored comparison snapshot')
}

async function arrangementSaving() {
  const f = readFixtures()
  const pending = deferred<void>()
  const writes: any[] = []
  let dirty = false
  let parentRefreshes = 0
  const chapter = { id: 1, novelId: 1, chapterNum: 1, title: 'one', outline: 'old outline' } as any
  f.contract = { getChapter: async () => null, listScenes: async () => [] }
  f.chapter.update = async (id: number, patch: any) => { writes.push({ id, ...patch }); await pending.promise; Object.assign(chapter, patch) }
  Object.assign(window, { electron: f })
  await act(async () => root.render(<MemoryRouter><ChapterArrangement chapter={chapter} onSaved={() => { parentRefreshes++ }} onDirtyChange={value => { dirty = value }} /></MemoryRouter>))
  await click(button('编辑'))
  await type(document.querySelector<HTMLTextAreaElement>('.ant-modal textarea'), 'submitted outline')
  await click(button('保存'))
  check(writes.length === 1, 'arrangement submitted')
  await type(document.querySelector<HTMLTextAreaElement>('.ant-modal textarea'), 'newer outline during save')
  check(dirty, 'arrangement newer draft dirty')
  await act(async () => pending.resolve())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
  check(dirty && parentRefreshes === 0 && document.querySelector<HTMLTextAreaElement>('.ant-modal textarea')?.value === 'newer outline during save', 'arrangement save retains newer input without an unmounting parent refresh')
  await click(button('保存'))
  check(!dirty && parentRefreshes === 1 && writes[1]?.outline === 'newer outline during save', 'second arrangement save persists the retained draft and then refreshes the parent')
}

async function manuscriptInitialRetry() {
  const f = readFixtures()
  let reads = 0
  const chapter = { id: 1, novelId: 1, chapterNum: 1, title: 'one', content: 'body', wordCount: 4 }
  f.chapter.list = async () => [chapter]
  f.chapter.get = async () => { if (++reads === 1) throw new Error('temporary manuscript read failure'); return chapter }
  f.agentTools = { call: async () => ({ ok: true, data: { run: null, runs: [] } }) }
  let guard: (() => boolean) | null = null
  Object.assign(window, { electron: f })
  await act(async () => root.render(<MemoryRouter initialEntries={['/?chapterId=1']}><NovelWorkspaceActionsContext.Provider value={{ ...actions, registerLeaveGuard(fn) { guard = fn } }}><Manuscript novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  check(document.body.textContent?.includes('temporary manuscript read failure'), 'manuscript initial failure shown')
  await click(button('重试'))
  check(reads === 2 && !!document.querySelector('textarea.author-manuscript__editor') && !document.body.textContent?.includes('temporary manuscript read failure'), 'manuscript initial detail failure can recover through retry')
  f.chapter.listVersions = async () => { throw new Error('temporary history failure') }
  await click(button('本章历史'))
  await click(document.querySelector('.ant-drawer-close'))
  const pending = deferred<any[]>()
  f.chapter.list = () => pending.promise
  await click(button('重试'))
  await type(document.querySelector<HTMLTextAreaElement>('textarea.author-manuscript__editor'), 'typed during retry')
  await act(async () => pending.resolve([chapter]))
  check(reads === 2 && document.querySelector<HTMLTextAreaElement>('textarea.author-manuscript__editor')?.value === 'typed during retry' && guard?.(), 'retry list response must not overwrite a newly edited manuscript')
}

async function manuscriptReviewSaveBoundary() {
  const f = readFixtures()
  const chapters = [1, 2].map(id => ({ id, novelId: 1, chapterNum: id, title: `chapter ${id}`, content: `body ${id}`, wordCount: 5 }))
  const reviews: number[] = []
  let pendingSave: ReturnType<typeof deferred<void>> | null = deferred<void>()
  f.chapter.list = async () => chapters.map(chapter => ({ ...chapter }))
  f.chapter.get = async (id: number) => ({ ...chapters[id - 1] })
  f.chapter.update = async (id: number, patch: any) => { await pendingSave?.promise; Object.assign(chapters[id - 1], patch) }
  f.agentTools = { call: async ({ toolId, input }: any) => {
    if (toolId === 'novelforge.chapters.review') reviews.push(input.chapterId)
    return { ok: true, data: { run: null, view: null, runs: [] } }
  } }
  let guard: (() => boolean) | null = null
  let navigate!: ReturnType<typeof useNavigate>
  function Nav() { const n = useNavigate(); useLayoutEffect(() => { navigate = n }); return null }
  Object.assign(window, { electron: f })
  await act(async () => root.render(<MemoryRouter initialEntries={['/?chapterId=1&panel=review']}><Nav /><NovelWorkspaceActionsContext.Provider value={{ ...actions, registerLeaveGuard(fn) { guard = fn } }}><Manuscript novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  const editor = () => document.querySelector<HTMLTextAreaElement>('textarea.author-manuscript__editor')
  await type(editor(), 'first saved draft')
  await click(button('仅评审第1章'))
  await type(editor(), 'newer draft typed during save')
  await act(async () => pendingSave!.resolve())
  check(reviews.length === 0 && guard?.() && editor()?.value === 'newer draft typed during save', 'review must not start against an older save when newer edits remain')
  check(chapters[0].content === 'first saved draft', 'in-flight save preserves its own snapshot without consuming subsequent edits')
  pendingSave = null
  await click(button('仅评审第1章'))
  check(reviews.length === 1 && reviews[0] === 1 && !guard?.() && chapters[0].content === 'newer draft typed during save', 'retry saves the newest draft before reviewing the intended chapter')

  await type(editor(), 'draft before chapter switch')
  const pendingList = deferred<any[]>()
  let listReads = 0
  f.chapter.list = () => ++listReads === 1 ? pendingList.promise : Promise.resolve(chapters.map(chapter => ({ ...chapter })))
  await click(button('仅评审第1章'))
  check(listReads === 1 && !guard?.(), 'save reaches post-write refresh with a clean draft')
  await act(async () => navigate('/?chapterId=2&panel=review'))
  check(editor()?.value === 'body 2', 'chapter navigation loads the new target while the old refresh is pending')
  await act(async () => pendingList.resolve(chapters.map(chapter => ({ ...chapter }))))
  check(reviews.length === 1 && editor()?.value === 'body 2' && !guard?.(), 'finishing the old save cannot review the previous chapter or replace the new draft')
}

async function extractionPreviewCloseBoundary() {
  const previews: Array<ReturnType<typeof deferred<any>>> = []
  let starts = 0
  Object.assign(window, { electron: { agentTools: { call: async ({ toolId }: any) => {
    if (toolId === 'novelforge.research.extract_preview') {
      const pending = deferred<any>(); previews.push(pending); return pending.promise
    }
    if (toolId === 'novelforge.research.extract') starts += 1
    return { ok: true, data: { runs: [], run: { taskId: starts, status: 'running' } } }
  } } } })
  const render = (open: boolean) => root.render(<ReferenceExtraction novelId={1} open={open} onClose={() => {}} onSaved={async () => {}} />)
  await act(async () => render(true))
  await type(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="提炼原文"]'), 'reference text')
  await click(button('开始提炼'))
  check(previews.length === 1 && starts === 0, 'extraction checks the budget before starting a paid task')
  await act(async () => render(false))
  await act(async () => render(true))
  await act(async () => previews[0].resolve({ ok: true, data: { budget: { estimatedTokens: 100, outputReserve: 100, fits: true } } }))
  check(starts === 0, 'closing and reopening the dialog invalidates the pending preview instead of starting a hidden task')
  await click(button('开始提炼'))
  check(previews.length === 2, 'reopening permits a fresh budget check')
  await act(async () => previews[1].resolve({ ok: true, data: { budget: { estimatedTokens: 100, outputReserve: 100, fits: true } } }))
  check(starts === 1, 'only a still-current preview can start extraction')
}

async function otherFilteredDrafts() {
  for (const kind of ['faction', 'sceneTemplate'] as const) {
    await reset()
    const f = readFixtures()
    let entry = { id: 1, novelId: 1, name: 'original name', type: 'faction', category: 'conflict', isBuiltin: 0 }
    let reads = 0
    let guard: (() => boolean) | null = null
    f[kind].query = async () => ({ items: ++reads === 1 ? [entry] : [], total: reads === 1 ? 1 : 0 })
    f.faction.getGraph = async () => ({ factions: [], relations: [] })
    f.faction.getAutoGenerateStatus = async () => ({ latestTask: null, pendingCount: 0, runningCount: 0 })
    Object.assign(window, { electron: f })
    await act(async () => root.render(<MemoryRouter><NovelWorkspaceActionsContext.Provider value={{ ...actions, registerLeaveGuard(fn) { guard = fn } }}>{kind === 'faction' ? <Factions novelId={1} /> : <SceneTemplates novelId={1} />}</NovelWorkspaceActionsContext.Provider></MemoryRouter>))
    const field = () => document.querySelector<HTMLInputElement>('#name')
    check(field()?.value === 'original name', kind + ' loads its initial automatic selection')
    if (kind === 'faction') {
      const pending = deferred<void>()
      let writeCount = 0
      f.faction.update = async (_id: number, patch: any) => { writeCount++; await pending.promise; entry = { ...entry, ...patch } }
      await type(field(), 'submitted faction')
      await click(button('保存势力'))
      check(writeCount === 1, 'faction write started')
      await type(field(), 'newer faction during save')
      await act(async () => pending.resolve())
      check(field()?.value === 'newer faction during save' && guard?.(), 'faction save retains newer form input and leave protection')
    }
    const beforeFilterReads = reads
    await type(field(), 'keep filtered draft')
    const search = kind === 'faction' ? '搜索势力、目标、资源或阶段' : '搜索模板名、描述或情绪弧线'
    await type(document.querySelector<HTMLInputElement>(`input[placeholder="${search}"]`), 'no match')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
    check(reads === beforeFilterReads + 1 && field()?.value === 'keep filtered draft' && guard?.(), kind + ' keeps the selected draft outside search results')
  }
}

async function storyDesignSaving() {
  const f = readFixtures()
  let persisted = { ...novel(), synopsis: 'old synopsis', contextVersion: 1 }
  let guard: (() => boolean) | null = null
  const pending = deferred<void>()
  const writes: any[] = []
  f.structure.getTree = async () => ({ volumes: [] })
  f.novel.get = async () => ({ ...persisted })
  f.novel.update = async (_id: number, patch: any) => {
    writes.push(patch)
    await pending.promise
    persisted = { ...persisted, ...patch, contextVersion: persisted.contextVersion + 1 }
  }
  Object.assign(window, { electron: f })
  await act(async () => root.render(<MemoryRouter><NovelWorkspaceActionsContext.Provider value={{ ...actions, registerLeaveGuard(fn) { guard = fn } }}><StoryDesign novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  await click(button('编辑'))
  const synopsis = () => [...document.querySelectorAll<HTMLTextAreaElement>('.ant-modal textarea')].find(field => field.value.includes('synopsis'))
  await type(synopsis(), 'submitted synopsis')
  await click(button('保存这一部分'))
  check(writes.length === 1, 'story design write started')
  await type(synopsis(), 'newer synopsis during save')
  await act(async () => pending.resolve())
  check(synopsis()?.value === 'newer synopsis during save' && guard?.(), 'story design save retains newer input and its leave guard')
  await click(button('保存这一部分'))
  check(writes.length === 2 && writes[1].synopsis === 'newer synopsis during save' && !guard?.(), 'retained story design draft saves with the new context version')
}

async function sceneContractSaving() {
  const f = readFixtures()
  const scene = { id: 10, chapterId: 1, novelId: 1, chapterNum: 1, segmentId: 10, segmentOrder: 1, segmentTitle: 'first scene', sceneGoal: 'old goal', revealPayload: [], requiredEndgameCommitmentIds: [], requiredForeshadowIds: [], status: 'draft' }
  const pending = deferred<void>()
  let guard: (() => boolean) | null = null
  const writes: any[] = []
  f.chapter.list = async () => [{ id: 1, novelId: 1, chapterNum: 1, title: 'one' }]
  f.contract = {
    getChapter: async () => null,
    listScenes: async () => [scene],
    upsertScene: async (_id: number, _segmentId: number, patch: any) => { writes.push(patch); await pending.promise; return [{ ...scene, ...patch }] },
  }
  Object.assign(window, { electron: f })
  await act(async () => root.render(<MemoryRouter><NovelWorkspaceActionsContext.Provider value={{ ...actions, registerLeaveGuard(fn) { guard = fn } }}><Contracts novelId={1} /></NovelWorkspaceActionsContext.Provider></MemoryRouter>))
  await click(document.querySelector('[data-contract-tab="scene"]'))
  const field = () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder="这一场要拿到什么、推进什么。"]')
  await type(field(), 'submitted scene goal')
  await click(button('保存场景合同'))
  await type(field(), 'newer scene goal during save')
  await act(async () => pending.resolve())
  check(writes.length === 1 && field()?.value === 'newer scene goal during save' && guard?.(), 'scene save preserves newer local scene edits and dirty state')
  await click(button('保存场景合同'))
  check(writes.length === 2 && writes[1].sceneGoal === 'newer scene goal during save' && !guard?.(), 'resaving a scene persists the latest draft')
}

export async function runBoundaryTests(testRoot: Root) {
  root = testRoot
  for (const test of [characterRoute, timelineSaving, glossaryFiltering, contractSaving, versionRetry, arrangementSaving, manuscriptInitialRetry, manuscriptReviewSaveBoundary, extractionPreviewCloseBoundary, otherFilteredDrafts, storyDesignSaving, sceneContractSaving]) {
    await reset()
    await test()
  }
  await reset()
}
